"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { createApp, createGoogleOAuthProvider } = require("../server");

const CLIENT_ID = "synthetic-client-id.apps.googleusercontent.com";
const CLIENT_SECRET = "synthetic-client-secret";
const REDIRECT_URI = "https://utampa.example/auth/google/callback";
const ALLOWED_EMAIL = "bert@bertseither.com";
const SECRET = "0123456789abcdef0123456789abcdef";

function fakeOAuth(identity = { sub: "google-subject-123", email: ALLOWED_EMAIL }) {
  const calls = [];
  return {
    calls,
    authorizationUrl(values) {
      calls.push({ type: "authorize", ...values });
      return `https://identity.test/authorize?state=${encodeURIComponent(values.state)}&nonce=${encodeURIComponent(values.nonce)}&code_challenge=${encodeURIComponent(values.codeChallenge)}&scope=openid%20email`;
    },
    async exchangeAndVerify(values) {
      calls.push({ type: "exchange", ...values });
      if (values.code !== "valid-code") throw new Error("bad code");
      return identity;
    }
  };
}

async function fixture(t, options = {}) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "utampa-oauth-"));
  fs.writeFileSync(path.join(rootDir, "index.html"), '<h1>PRIVATE DASHBOARD MARKER →</h1><script>window.legitimateInline=true;</script><script>window.__CF$cv$params={};var src="/cdn-cgi/challenge-platform/scripts/jsd/main.js";</script>');
  fs.mkdirSync(path.join(rootDir, "data"));
  fs.mkdirSync(path.join(rootDir, "assets"));
  fs.writeFileSync(path.join(rootDir, "data", "fixture.json"), JSON.stringify({ synthetic: true }));
  fs.writeFileSync(path.join(rootDir, "data", "spartan-incubator.fixture.json"), JSON.stringify({ __synthetic: true }));
  fs.writeFileSync(path.join(rootDir, "assets", "app.js"), "window.privateDashboard=true;");
  fs.writeFileSync(path.join(rootDir, "server.js"), "SERVER SOURCE MUST NOT BE SERVED");
  fs.writeFileSync(path.join(rootDir, "package.json"), "{\"private\":true}");
  const oauth = options.oauth || fakeOAuth();
  const server = createApp({ rootDir, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, redirectUri: REDIRECT_URI, allowedEmail: ALLOWED_EMAIL, sessionSecret: SECRET, oauth, ...options });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  t.after(() => new Promise(resolve => server.close(resolve)));
  t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));
  return { origin, oauth };
}

function firstCookie(response, name) {
  const values = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [response.headers.get("set-cookie")];
  const found = values.find(value => value && value.startsWith(`${name}=`));
  return found && found.split(";", 1)[0];
}

async function begin(origin, next = "/") {
  const response = await fetch(`${origin}/auth/google?next=${encodeURIComponent(next)}`, { redirect: "manual" });
  const location = new URL(response.headers.get("location"));
  return { response, state: location.searchParams.get("state"), nonce: location.searchParams.get("nonce"), transactionCookie: firstCookie(response, "utampa_oauth_tx") };
}

async function signIn(origin, next = "/") {
  const started = await begin(origin, next);
  const callback = await fetch(`${origin}/auth/google/callback?state=${encodeURIComponent(started.state)}&code=valid-code`, { headers: { Cookie: started.transactionCookie }, redirect: "manual" });
  return { ...started, callback, sessionCookie: firstCookie(callback, "utampa_session") };
}

test("startup fails closed when OAuth or session configuration is absent or weak", () => {
  const base = { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, redirectUri: REDIRECT_URI, allowedEmail: ALLOWED_EMAIL, sessionSecret: SECRET, oauth: fakeOAuth() };
  for (const key of ["clientId", "clientSecret", "redirectUri", "allowedEmail", "sessionSecret"]) {
    const options = { ...base, [key]: "" };
    assert.throws(() => createApp(options), /required/);
  }
  assert.throws(() => createApp({ ...base, clientSecret: "short" }), /GOOGLE_CLIENT_SECRET/);
  assert.throws(() => createApp({ ...base, sessionSecret: "short" }), /UTAMPA_SESSION_SECRET/);
});

test("sign-in surface is neutral, accessible, touch-sized, and contains no local credentials", async t => {
  const { origin } = await fixture(t);
  const normal = await fetch(`${origin}/login?next=%2Fservice%2Fspartan-incubator`);
  const body = await normal.text();
  assert.match(body, /<title>My Work Login<\/title>/);
  assert.match(body, /<h1>My Work Login<\/h1>/);
  assert.doesNotMatch(body, /University of Tampa|Faculty OS|<img|<svg/i);
  assert.match(body, /Continue with Google/);
  assert.match(body, /min-height:48px/);
  assert.match(body, /google:focus-visible/);
  assert.match(body, /role="status"/);
  assert.match(body, /aria-live="polite"/);
  assert.match(body, /aria-describedby="auth-disclosure"/);
  assert.match(body, /read-only Calendar event metadata and Drive filename metadata visible to this personal Google account/);
  assert.match(body, /University accounts, Canvas, Workday, student records, and institutional systems are not connected/);
  assert.match(body, /Opening Google sign-in/);
  assert.doesNotMatch(body, /type="password"|name="username"/);
  const error = await fetch(`${origin}/login?error=sign-in`);
  const errorBody = await error.text();
  assert.match(errorBody, /role="alert"/);
  assert.match(errorBody, /aria-live="assertive"/);
  assert.match(errorBody, /aria-atomic="true"/);
  assert.match(errorBody, /\.focus\(\)/);
});

test("authorization uses state, nonce, PKCE, minimum read-only Google scopes, and an HttpOnly transaction cookie", async t => {
  const { origin, oauth } = await fixture(t);
  const started = await begin(origin, "/service/spartan-incubator");
  assert.equal(started.response.status, 303);
  assert.ok(started.state && started.nonce);
  const call = oauth.calls.find(item => item.type === "authorize");
  assert.equal(call.state, started.state);
  assert.equal(call.nonce, started.nonce);
  assert.match(call.codeChallenge, /^[A-Za-z0-9_-]{43}$/);
  assert.match(started.response.headers.get("set-cookie"), /HttpOnly/);
  assert.match(started.response.headers.get("set-cookie"), /SameSite=Lax/);
});

test("callback is one-time, state-bound, email-allowlisted, and rejects provider errors without disclosure", async t => {
  const wrongIdentity = fakeOAuth({ sub: "other-subject", email: "someone@example.edu" });
  const { origin } = await fixture(t, { oauth: wrongIdentity });
  const started = await begin(origin);
  for (const url of [
    `${origin}/auth/google/callback?state=wrong&code=valid-code`,
    `${origin}/auth/google/callback?state=${started.state}&error=access_denied`,
    `${origin}/auth/google/callback?state=${started.state}&code=valid-code`
  ]) {
    const response = await fetch(url, { headers: { Cookie: started.transactionCookie }, redirect: "manual" });
    assert.equal(response.status, 303);
    assert.equal(response.headers.get("location"), "/login?error=sign-in");
    assert.doesNotMatch(await response.text(), /someone|access_denied|valid-code/i);
  }
  const fresh = await begin(origin);
  const wrongEmail = await fetch(`${origin}/auth/google/callback?state=${fresh.state}&code=valid-code`, { headers: { Cookie: fresh.transactionCookie }, redirect: "manual" });
  assert.equal(wrongEmail.headers.get("location"), "/login?error=sign-in");
  assert.equal(firstCookie(wrongEmail, "utampa_session"), undefined);
});

test("verified allowlisted identity creates an opaque revocable session and preserves safe deep links", async t => {
  const { origin, oauth } = await fixture(t);
  const signed = await signIn(origin, "/service/spartan-incubator");
  assert.equal(signed.callback.status, 303);
  assert.equal(signed.callback.headers.get("location"), "/service/spartan-incubator");
  assert.match(signed.callback.headers.get("set-cookie"), /HttpOnly/);
  assert.match(signed.callback.headers.get("set-cookie"), /SameSite=Lax/);
  assert.ok(oauth.calls.find(item => item.type === "exchange").codeVerifier.length >= 43);
  const dashboard = await fetch(`${origin}/`, { headers: { Cookie: signed.sessionCookie } });
  assert.equal(dashboard.status, 200);
  assert.match(await dashboard.text(), /PRIVATE DASHBOARD MARKER/);
  const me = await fetch(`${origin}/api/me`, { headers: { Cookie: signed.sessionCookie } });
  assert.deepEqual(await me.json(), { email: ALLOWED_EMAIL, connected: false });
  const deepLink = await fetch(`${origin}/service/spartan-incubator`, { headers: { Cookie: signed.sessionCookie } });
  assert.match(await deepLink.text(), /PRIVATE DASHBOARD MARKER/);
  const external = await fetch(`${origin}/auth/google?next=${encodeURIComponent("//evil.example")}`, { redirect: "manual" });
  const externalLocation = new URL(external.headers.get("location"));
  const externalCallback = await fetch(`${origin}/auth/google/callback?state=${externalLocation.searchParams.get("state")}&code=valid-code`, { headers: { Cookie: firstCookie(external, "utampa_oauth_tx") }, redirect: "manual" });
  assert.equal(externalCallback.headers.get("location"), "/");
  for (const maliciousNext of ["/\\evil.example", "/%5cevil.example", "/%255cevil.example", "/%2f%2fevil.example", "/a/..//evil.example", "/logout", "/auth/google"]) {
    const attempt = await fetch(`${origin}/auth/google?next=${encodeURIComponent(maliciousNext)}`, { redirect: "manual" });
    const attemptLocation = new URL(attempt.headers.get("location"));
    const callback = await fetch(`${origin}/auth/google/callback?state=${attemptLocation.searchParams.get("state")}&code=valid-code`, { headers: { Cookie: firstCookie(attempt, "utampa_oauth_tx") }, redirect: "manual" });
    assert.equal(callback.headers.get("location"), "/", maliciousNext);
  }
});

test("only health and OAuth entry surfaces are public; private bytes default deny", async t => {
  const { origin } = await fixture(t);
  const health = await fetch(`${origin}/healthz`);
  assert.deepEqual(await health.json(), { status: "ok" });
  for (const route of ["/", "/assets/app.js", "/data/spartan-incubator.fixture.json", "/service/spartan-incubator"]) {
    const response = await fetch(`${origin}${route}`, { redirect: "manual" });
    assert.equal(response.status, 303, route);
    assert.match(response.headers.get("location"), /^\/login\?next=/, route);
    assert.doesNotMatch(await response.text(), /PRIVATE DASHBOARD MARKER|privateDashboard|synthetic/, route);
  }
});

test("authenticated delivery allowlists approved assets and denies repository, hidden, and sibling paths", async t => {
  const { origin } = await fixture(t);
  const { sessionCookie } = await signIn(origin);
  const fixtureResponse = await fetch(`${origin}/data/spartan-incubator.fixture.json`, { headers: { Cookie: sessionCookie } });
  assert.deepEqual(await fixtureResponse.json(), { __synthetic: true });
  const asset = await fetch(`${origin}/assets/app.js`, { headers: { Cookie: sessionCookie } });
  assert.match(await asset.text(), /privateDashboard/);
  for (const route of ["/server.js", "/package.json", "/docs/RELEASE-HANDOFF.md", "/.env", "/.git/config", "/data/fixture.json", "/boss/"]) {
    const response = await fetch(`${origin}${route}`, { headers: { Cookie: sessionCookie }, redirect: "manual" });
    assert.equal(response.status, 404, route);
    assert.doesNotMatch(await response.text(), /SERVER SOURCE|private|PRIVATE DASHBOARD MARKER|synthetic/i, route);
  }
});

test("authenticated index delivery removes only exported Cloudflare challenge code for GET and HEAD", async t => {
  const { origin } = await fixture(t);
  const { sessionCookie } = await signIn(origin);
  for (const route of ["/", "/service/spartan-incubator"]) {
    const response = await fetch(`${origin}${route}`, { headers: { Cookie: sessionCookie } });
    const body = await response.text();
    assert.equal(response.status, 200);
    assert.match(body, /PRIVATE DASHBOARD MARKER →/);
    assert.match(body, /window\.legitimateInline=true/);
    assert.doesNotMatch(body, /__CF\$cv\$params|challenge-platform/);
    assert.equal(Number(response.headers.get("content-length")), Buffer.byteLength(body));
    const head = await fetch(`${origin}${route}`, { method: "HEAD", headers: { Cookie: sessionCookie } });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");
    assert.equal(head.headers.get("content-length"), response.headers.get("content-length"));
    assert.match(head.headers.get("content-type"), /^text\/html/);
  }
});

test("tampered, expired, and logged-out sessions are denied", async t => {
  let current = 1_700_000_000_000;
  const { origin } = await fixture(t, { now: () => current, ttlMs: 1000 });
  const first = await signIn(origin);
  const tampered = `${first.sessionCookie.slice(0, -1)}${first.sessionCookie.endsWith("a") ? "b" : "a"}`;
  assert.equal((await fetch(`${origin}/`, { headers: { Cookie: tampered }, redirect: "manual" })).status, 303);
  const logout = await fetch(`${origin}/logout`, { method: "POST", headers: { Cookie: first.sessionCookie }, redirect: "manual" });
  assert.equal(logout.status, 303);
  assert.equal((await fetch(`${origin}/`, { headers: { Cookie: first.sessionCookie }, redirect: "manual" })).status, 303);
  const second = await signIn(origin);
  current += 1001;
  assert.equal((await fetch(`${origin}/`, { headers: { Cookie: second.sessionCookie }, redirect: "manual" })).status, 303);
});

test("malformed paths and unsupported methods fail safely", async t => {
  const { origin } = await fixture(t);
  assert.equal((await fetch(`${origin}/%E0%A4%A`, { redirect: "manual" })).status, 400);
  assert.equal((await fetch(`${origin}/healthz`, { method: "POST", redirect: "manual" })).status, 405);
  assert.equal((await fetch(`${origin}/logout`, { method: "GET", redirect: "manual" })).status, 405);
  assert.equal((await fetch(`${origin}/auth/google`, { method: "POST", redirect: "manual" })).status, 405);
});

test("Google provider verifies token signature and required claims", async () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = publicKey.export({ format: "jwk" });
  Object.assign(jwk, { kid: "synthetic-key", use: "sig", alg: "RS256" });
  const now = 1_700_000_000_000;
  const claims = { iss: "https://accounts.google.com", aud: CLIENT_ID, exp: now / 1000 + 600, iat: now / 1000, nonce: "expected-nonce", email_verified: true, email: ALLOWED_EMAIL, sub: "google-subject-123" };
  const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: jwk.kid })).toString("base64url");
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = crypto.sign("RSA-SHA256", Buffer.from(`${header}.${payload}`), privateKey).toString("base64url");
  const idToken = `${header}.${payload}.${signature}`;
  const requests = [];
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url, options });
    if (url.includes("/token")) return new Response(JSON.stringify({ id_token: idToken }), { status: 200, headers: { "content-type": "application/json" } });
    return new Response(JSON.stringify({ keys: [jwk] }), { status: 200, headers: { "content-type": "application/json", "cache-control": "public,max-age=300" } });
  };
  const provider = createGoogleOAuthProvider({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, redirectUri: REDIRECT_URI, fetchImpl, now: () => now });
  const auth = new URL(provider.authorizationUrl({ state: "state", nonce: "expected-nonce", codeChallenge: "challenge" }));
  assert.match(auth.searchParams.get("scope"), /openid/);
  assert.match(auth.searchParams.get("scope"), /calendar\.readonly/);
  assert.match(auth.searchParams.get("scope"), /drive\.metadata\.readonly/);
  assert.equal(auth.searchParams.get("access_type"), "offline");
  assert.equal(auth.searchParams.get("include_granted_scopes"), "true");
  assert.equal(auth.searchParams.get("code_challenge_method"), "S256");
  const identity = await provider.exchangeAndVerify({ code: "code", codeVerifier: "verifier", expectedNonce: "expected-nonce" });
  assert.equal(identity.sub, claims.sub);
  assert.equal(identity.email, claims.email);
  assert.equal(identity.accessToken, "");
  assert.equal(identity.refreshToken, "");
  assert.match(String(requests[0].options.body), /code_verifier=verifier/);
  await assert.rejects(() => provider.exchangeAndVerify({ code: "code", codeVerifier: "verifier", expectedNonce: "wrong" }), /claims rejected/);

  const conflictingPayload = Buffer.from(JSON.stringify({ ...claims, azp: "other-client" })).toString("base64url");
  const conflictingSignature = crypto.sign("RSA-SHA256", Buffer.from(`${header}.${conflictingPayload}`), privateKey).toString("base64url");
  const conflictingToken = `${header}.${conflictingPayload}.${conflictingSignature}`;
  const conflictingProvider = createGoogleOAuthProvider({
    clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, redirectUri: REDIRECT_URI, now: () => now,
    fetchImpl: async url => url.includes("/token")
      ? new Response(JSON.stringify({ id_token: conflictingToken }), { status: 200, headers: { "content-type": "application/json" } })
      : new Response(JSON.stringify({ keys: [jwk] }), { status: 200, headers: { "content-type": "application/json" } })
  });
  await assert.rejects(() => conflictingProvider.exchangeAndVerify({ code: "code", codeVerifier: "verifier", expectedNonce: "expected-nonce" }), /claims rejected/);

  const revokedProvider = createGoogleOAuthProvider({
    clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, redirectUri: REDIRECT_URI, now: () => now,
    fetchImpl: async () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400, headers: { "content-type": "application/json" } })
  });
  await assert.rejects(() => revokedProvider.refresh("revoked-refresh-token"), error => error.message === "Google access refresh failed" && error.status === 401);
});

test("authorized Calendar and Drive API routes proxy only read-only sanitized data", async t => {
  const requests = [];
  const oauth = fakeOAuth({
    sub: "google-subject-123", email: ALLOWED_EMAIL, accessToken: "access-token", refreshToken: "refresh-token",
    accessTokenExpiresAt: Date.now() + 3600000, grantedScope: "calendar.readonly drive.metadata.readonly"
  });
  const fetchImpl = async (url, options) => {
    requests.push({ url: String(url), options });
    if (String(url).includes("/users/me/calendarList")) return new Response(JSON.stringify({ items: [
      { id: "primary@example.com", summary: "Bert", primary: true, selected: true, accessRole: "owner" },
      { id: "outlook-feed@import.calendar.google.com", summary: "UTampa Outlook", selected: true, accessRole: "reader" },
      { id: "holidays@example.com", summary: "Holidays", selected: false, accessRole: "reader" }
    ] }), { status: 200, headers: { "content-type": "application/json" } });
    if (String(url).includes("/calendars/primary%40example.com/events")) return new Response(JSON.stringify({ items: [{ id: "event-1", summary: "ENT 330", description: "must not leak", start: { dateTime: "2026-09-22T16:00:00Z" }, end: { dateTime: "2026-09-22T17:00:00Z" }, htmlLink: "https://calendar.google.com/event" }] }), { status: 200, headers: { "content-type": "application/json" } });
    if (String(url).includes("/calendars/outlook-feed%40import.calendar.google.com/events")) return new Response(JSON.stringify({ items: [{ id: "event-2", summary: "Office hours", start: { dateTime: "2026-09-22T18:00:00Z" }, end: { dateTime: "2026-09-22T19:00:00Z" }, htmlLink: "https://calendar.google.com/event-2" }] }), { status: 200, headers: { "content-type": "application/json" } });
    return new Response(JSON.stringify({ files: [{ id: "file-1", name: "ENT 330 deck", mimeType: "application/vnd.google-apps.presentation", modifiedTime: "2026-09-22T12:00:00Z", webViewLink: "https://drive.google.com/file" }], nextPageToken: "more-drive-results" }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const { origin } = await fixture(t, { oauth, fetchImpl });
  const { sessionCookie } = await signIn(origin);
  const calendar = await fetch(`${origin}/api/calendar`, { headers: { Cookie: sessionCookie } });
  assert.equal(calendar.status, 200);
  const calendarBody = await calendar.json();
  assert.equal(calendarBody.events[0].title, "ENT 330");
  assert.equal(calendarBody.events[0].description, undefined);
  assert.match(calendarBody.events[0].id, /^[A-Za-z0-9_-]{24}$/);
  assert.doesNotMatch(calendarBody.events[0].id, /primary|example|event-1/);
  assert.equal(calendarBody.events[1].title, "Office hours");
  assert.equal(calendarBody.events[1].calendar, "UTampa Outlook");
  assert.equal(calendarBody.partial, false);
  assert.equal(calendarBody.truncated, false);
  assert.deepEqual(calendarBody.warnings, []);
  const drive = await fetch(`${origin}/api/drive?q=ENT%20330`, { headers: { Cookie: sessionCookie } });
  assert.equal(drive.status, 200);
  const driveBody = await drive.json();
  assert.equal(driveBody.files[0].name, "ENT 330 deck");
  assert.equal(driveBody.truncated, true);
  assert.match(driveBody.source, /first page returned 1 filename match; additional pages exist/);
  assert.ok(requests.every(request => request.options.headers.Authorization === "Bearer access-token"));
  assert.ok(requests.some(request => request.url.includes("/users/me/calendarList")));
  assert.ok(requests.some(request => request.url.includes("outlook-feed%40import.calendar.google.com/events")));
  assert.ok(!requests.some(request => request.url.includes("holidays%40example.com/events")));
  assert.ok(requests.some(request => /trashed/.test(request.url)));
});

test("Calendar reports partial and truncated source state without leaking source identifiers", async t => {
  const oauth = fakeOAuth({
    sub: "google-subject-123", email: ALLOWED_EMAIL, accessToken: "access-token", refreshToken: "refresh-token",
    accessTokenExpiresAt: Date.now() + 3600000, grantedScope: "calendar.readonly"
  });
  const fetchImpl = async url => {
    const value = String(url);
    if (value.includes("/users/me/calendarList")) return new Response(JSON.stringify({ items: [
      { id: "primary@example.com", summary: "Personal", primary: true, selected: true },
      { id: "outlook-feed@import.calendar.google.com", summary: "UTampa Outlook", selected: true },
      { id: "limited@example.com", summary: "Limited source", selected: true }
    ] }), { status: 200, headers: { "content-type": "application/json" } });
    if (value.includes("primary%40example.com")) return new Response(JSON.stringify({ items: [{
      id: "private-upstream-id", summary: "Spartan Incubator review",
      start: { dateTime: "2026-09-24T16:00:00Z" }, end: { dateTime: "2026-09-24T17:00:00Z" },
      htmlLink: "javascript:alert(1)"
    }], nextPageToken: "more-results-exist" }), { status: 200, headers: { "content-type": "application/json" } });
    if (value.includes("outlook-feed%40import.calendar.google.com")) return new Response(JSON.stringify({ items: [] }), { status: 500, headers: { "content-type": "application/json" } });
    return new Response(JSON.stringify({ items: [] }), { status: 403, headers: { "content-type": "application/json" } });
  };
  const { origin } = await fixture(t, { oauth, fetchImpl });
  const { sessionCookie } = await signIn(origin);
  const response = await fetch(`${origin}/api/calendar`, { headers: { Cookie: sessionCookie } });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.partial, true);
  assert.equal(body.truncated, true);
  assert.equal(body.warnings.length, 2);
  assert.match(body.source, /1 of 3 selected calendars loaded/);
  assert.equal(body.events.length, 1);
  assert.equal(body.events[0].url, "");
  assert.doesNotMatch(JSON.stringify(body), /primary@example|private-upstream-id|outlook-feed@/);
});

test("Calendar rejects invalid or over-broad time ranges", async t => {
  const oauth = fakeOAuth({
    sub: "google-subject-123", email: ALLOWED_EMAIL, accessToken: "access-token", refreshToken: "refresh-token",
    accessTokenExpiresAt: Date.now() + 3600000, grantedScope: "calendar.readonly"
  });
  const { origin } = await fixture(t, { oauth, fetchImpl: async () => new Response("{}", { status: 200 }) });
  const { sessionCookie } = await signIn(origin);
  for (const query of ["timeMin=not-a-number", "timeMin=1000&timeMax=999", `timeMin=0&timeMax=${32 * 24 * 60 * 60 * 1000}`]) {
    const response = await fetch(`${origin}/api/calendar?${query}`, { headers: { Cookie: sessionCookie } });
    assert.equal(response.status, 400, query);
    assert.deepEqual(await response.json(), { error: "invalid_time_range" });
  }
});

test("revoked refresh requires reauthorization while upstream 403 remains an unavailable source", async t => {
  const expiredIdentity = {
    sub: "google-subject-123", email: ALLOWED_EMAIL, accessToken: "expired-token", refreshToken: "revoked-token",
    accessTokenExpiresAt: 1, grantedScope: "calendar.readonly drive.metadata.readonly"
  };
  const revokedOauth = fakeOAuth(expiredIdentity);
  revokedOauth.refresh = async () => { const error = new Error("Google access refresh failed"); error.status = 401; throw error; };
  const revoked = await fixture(t, { oauth: revokedOauth, now: () => 2_000_000_000_000 });
  const revokedSession = await signIn(revoked.origin);
  for (const route of ["/api/calendar", "/api/drive?q=test"]) {
    const response = await fetch(`${revoked.origin}${route}`, { headers: { Cookie: revokedSession.sessionCookie } });
    assert.equal(response.status, 409, route);
    assert.deepEqual(await response.json(), { error: "reauthorization_required" }, route);
  }

  const rateLimitedOauth = fakeOAuth({ ...expiredIdentity, accessToken: "valid-token", accessTokenExpiresAt: 2_000_000_100_000 });
  const rateLimited = await fixture(t, {
    oauth: rateLimitedOauth, now: () => 2_000_000_000_000,
    fetchImpl: async () => new Response(JSON.stringify({ error: { errors: [{ reason: "rateLimitExceeded" }] } }), { status: 403, headers: { "content-type": "application/json" } })
  });
  const rateLimitedSession = await signIn(rateLimited.origin);
  for (const route of ["/api/calendar", "/api/drive?q=test"]) {
    const response = await fetch(`${rateLimited.origin}${route}`, { headers: { Cookie: rateLimitedSession.sessionCookie } });
    assert.equal(response.status, 502, route);
    assert.deepEqual(await response.json(), { error: route.includes("calendar") ? "calendar_unavailable" : "drive_unavailable" }, route);
  }
});

test("Calendar list pagination is disclosed and invalid upstream collections never become verified empty", async t => {
  const oauth = fakeOAuth({
    sub: "google-subject-123", email: ALLOWED_EMAIL, accessToken: "access-token", refreshToken: "refresh-token",
    accessTokenExpiresAt: Date.now() + 3600000, grantedScope: "calendar.readonly drive.metadata.readonly"
  });
  let calendarMode = "truncated-list";
  const fetchImpl = async url => {
    const value = String(url);
    if (value.includes("/users/me/calendarList")) {
      if (calendarMode === "invalid-list") return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
      if (calendarMode === "invalid-events" || calendarMode === "malformed-event") return new Response(JSON.stringify({ items: [{ id: "primary", summary: "Primary", primary: true }]}), { status: 200, headers: { "content-type": "application/json" } });
      return new Response(JSON.stringify({ items: [{ id: "primary", summary: "Primary", primary: true }], nextPageToken: "more-calendars" }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (value.includes("/calendars/")) return new Response(calendarMode === "invalid-events" ? "{}" : calendarMode === "malformed-event" ? JSON.stringify({ items: [{ id: "bad-event", summary: "Missing times" }] }) : JSON.stringify({ items: [] }), { status: 200, headers: { "content-type": "application/json" } });
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  };
  const { origin } = await fixture(t, { oauth, fetchImpl });
  const { sessionCookie } = await signIn(origin);

  const truncated = await fetch(`${origin}/api/calendar`, { headers: { Cookie: sessionCookie } });
  const truncatedBody = await truncated.json();
  assert.equal(truncated.status, 200);
  assert.equal(truncatedBody.partial, true);
  assert.equal(truncatedBody.truncated, true);
  assert.ok(truncatedBody.warnings.some(warning => warning.code === "calendar_list_truncated"));
  assert.match(truncatedBody.source, /additional calendars were not inspected and selected calendars may be missing/);

  calendarMode = "invalid-events";
  const invalidEvents = await fetch(`${origin}/api/calendar`, { headers: { Cookie: sessionCookie } });
  const invalidEventsBody = await invalidEvents.json();
  assert.equal(invalidEvents.status, 200);
  assert.equal(invalidEventsBody.partial, true);
  assert.equal(invalidEventsBody.events.length, 0);
  assert.ok(invalidEventsBody.warnings.some(warning => warning.code === "calendar_invalid_response"));

  calendarMode = "malformed-event";
  const malformedEvent = await fetch(`${origin}/api/calendar`, { headers: { Cookie: sessionCookie } });
  const malformedEventBody = await malformedEvent.json();
  assert.equal(malformedEvent.status, 200);
  assert.equal(malformedEventBody.partial, true);
  assert.equal(malformedEventBody.events.length, 0);
  assert.ok(malformedEventBody.warnings.some(warning => warning.code === "calendar_invalid_events"));

  calendarMode = "invalid-list";
  const invalidList = await fetch(`${origin}/api/calendar`, { headers: { Cookie: sessionCookie } });
  assert.equal(invalidList.status, 502);
  assert.deepEqual(await invalidList.json(), { error: "calendar_unavailable" });

  const invalidDrive = await fetch(`${origin}/api/drive?q=test`, { headers: { Cookie: sessionCookie } });
  assert.equal(invalidDrive.status, 502);
  assert.deepEqual(await invalidDrive.json(), { error: "drive_unavailable" });
});

test("repository data contract stays synthetic and unknown is never coerced to zero", () => {
  const root = path.resolve(__dirname, "..");
  const fixtureData = JSON.parse(fs.readFileSync(path.join(root, "data", "spartan-incubator.fixture.json"), "utf8"));
  assert.equal(fixtureData.__synthetic, true);
  const adapter = fs.readFileSync(path.join(root, "cc-incubator-adapter.v1.js"), "utf8");
  assert.match(adapter, /Array\.isArray\(rawSubmissions\)/);
  assert.match(adapter, /submissionsIsArray \? rawSubmissions\.length : null/);
  assert.match(adapter, /recruitingIsArray[\s\S]*: "no data"/);
  assert.doesNotMatch(adapter, /weeklySubmissions\s*\|\|\s*\[\]/);
  const context = { window: {}, document: { readyState: "loading", addEventListener() {} }, console };
  vm.runInNewContext(adapter, context);
  assert.equal(context.window.__ccIncubatorAdapterV1.formatCount(null), "no data");
  assert.equal(context.window.__ccIncubatorAdapterV1.formatCount(undefined), "no data");
  assert.equal(context.window.__ccIncubatorAdapterV1.formatCount(0), "0");
});

test("runtime and exact-head evidence enforce the owner-approved personal identity", () => {
  const root = path.resolve(__dirname, "..");
  const checkedFiles = [
    "server.js",
    "test/server.test.js",
    ".github/workflows/browser-evidence.yml",
    "docs/RELEASE-HANDOFF.md",
    "CLAUDE-HANDOFF.md"
  ];
  for (const relativePath of checkedFiles) {
    const source = fs.readFileSync(path.join(root, relativePath), "utf8");
    assert.doesNotMatch(source, /bert@utampa\.edu/i, relativePath);
  }
  const evidenceWorkflow = fs.readFileSync(path.join(root, ".github/workflows/browser-evidence.yml"), "utf8");
  assert.match(evidenceWorkflow, /UTAMPA_ALLOWED_EMAIL:\s*bert@bertseither\.com/);
  assert.match(evidenceWorkflow, /injected synthetic Google OIDC[^\n]*no real account or token/);
});
