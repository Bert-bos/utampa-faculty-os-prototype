"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createApp } = require("../server");

const USERNAME = "bert";
const PASSWORD = "correct-horse-battery-staple";
const SECRET = "0123456789abcdef0123456789abcdef";

async function fixture(t, options = {}) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "utampa-server-"));
  fs.writeFileSync(path.join(rootDir, "index.html"), "<h1>PRIVATE DASHBOARD MARKER</h1>");
  fs.mkdirSync(path.join(rootDir, "data"));
  fs.writeFileSync(path.join(rootDir, "data", "fixture.json"), JSON.stringify({ synthetic: true }));
  fs.writeFileSync(path.join(rootDir, "app.js"), "window.privateDashboard=true;");
  const server = createApp({ rootDir, username: USERNAME, password: PASSWORD, sessionSecret: SECRET, ...options });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  t.after(() => new Promise(resolve => server.close(resolve)));
  t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));
  return origin;
}

async function signIn(origin, next = "/") {
  const body = new URLSearchParams({ username: USERNAME, password: PASSWORD, next });
  const response = await fetch(`${origin}/login`, { method: "POST", body, redirect: "manual" });
  return { response, cookie: response.headers.get("set-cookie").split(";", 1)[0] };
}

test("startup fails closed when any credential or signing secret is absent or weak", () => {
  assert.throws(() => createApp({ username: "", password: PASSWORD, sessionSecret: SECRET }), /UTAMPA_USERNAME/);
  assert.throws(() => createApp({ username: USERNAME, password: "short", sessionSecret: SECRET }), /UTAMPA_PASSWORD/);
  assert.throws(() => createApp({ username: USERNAME, password: PASSWORD, sessionSecret: "short" }), /UTAMPA_SESSION_SECRET/);
});

test("health is minimal while dashboard, scripts, fixture data, and deep links default deny", async t => {
  const origin = await fixture(t);
  const health = await fetch(`${origin}/healthz`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: "ok" });
  for (const route of ["/", "/app.js", "/data/fixture.json", "/service/spartan-incubator"]) {
    const response = await fetch(`${origin}${route}`, { redirect: "manual" });
    assert.equal(response.status, 303, route);
    assert.match(response.headers.get("location"), /^\/login\?next=/, route);
    assert.doesNotMatch(await response.text(), /PRIVATE DASHBOARD MARKER|privateDashboard|synthetic/, route);
  }
});

test("bad login is denied and cannot redirect off-site", async t => {
  const origin = await fixture(t);
  const body = new URLSearchParams({ username: USERNAME, password: "wrong-password", next: "//evil.example" });
  const response = await fetch(`${origin}/login`, { method: "POST", body, redirect: "manual" });
  assert.equal(response.status, 401);
  assert.match(await response.text(), /Sign-in failed/);
});

test("valid signed session serves dashboard, assets, fixture, HEAD, and SPA deep links", async t => {
  const origin = await fixture(t);
  const { response: login, cookie } = await signIn(origin, "/service/spartan-incubator");
  assert.equal(login.status, 303);
  assert.equal(login.headers.get("location"), "/service/spartan-incubator");
  assert.match(login.headers.get("set-cookie"), /HttpOnly/);
  assert.match(login.headers.get("set-cookie"), /SameSite=Strict/);
  const dashboard = await fetch(`${origin}/`, { headers: { Cookie: cookie } });
  assert.equal(dashboard.status, 200);
  assert.match(await dashboard.text(), /PRIVATE DASHBOARD MARKER/);
  const script = await fetch(`${origin}/app.js`, { headers: { Cookie: cookie } });
  assert.match(await script.text(), /privateDashboard/);
  const data = await fetch(`${origin}/data/fixture.json`, { headers: { Cookie: cookie } });
  assert.deepEqual(await data.json(), { synthetic: true });
  const deepLink = await fetch(`${origin}/service/spartan-incubator`, { headers: { Cookie: cookie } });
  assert.match(await deepLink.text(), /PRIVATE DASHBOARD MARKER/);
  const head = await fetch(`${origin}/`, { method: "HEAD", headers: { Cookie: cookie } });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
});

test("tampered and expired sessions are rejected", async t => {
  let current = 1_700_000_000_000;
  const origin = await fixture(t, { now: () => current, ttlMs: 1000 });
  const { cookie } = await signIn(origin);
  const tampered = `${cookie.slice(0, -1)}${cookie.endsWith("a") ? "b" : "a"}`;
  assert.equal((await fetch(`${origin}/`, { headers: { Cookie: tampered }, redirect: "manual" })).status, 303);
  current += 1001;
  assert.equal((await fetch(`${origin}/`, { headers: { Cookie: cookie }, redirect: "manual" })).status, 303);
});

test("logout clears the session cookie", async t => {
  const origin = await fixture(t);
  const { cookie } = await signIn(origin);
  const response = await fetch(`${origin}/logout`, { headers: { Cookie: cookie }, redirect: "manual" });
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), "/login");
  assert.match(response.headers.get("set-cookie"), /Max-Age=0/);
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
});
