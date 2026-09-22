"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { URL, URLSearchParams } = require("node:url");

const COOKIE_NAME = "utampa_session";
const TRANSACTION_COOKIE = "utampa_oauth_tx";
const DEFAULT_TTL_MS = 8 * 60 * 60 * 1000;
const TRANSACTION_TTL_MS = 10 * 60 * 1000;
const AUTH_WINDOW_MS = 15 * 60 * 1000;
const AUTH_MAX_ATTEMPTS = 20;
const MAX_PENDING_AUTH = 500;
const GOOGLE_ISSUERS = new Set(["accounts.google.com", "https://accounts.google.com"]);
const GOOGLE_AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GOOGLE_JWKS_ENDPOINT = "https://www.googleapis.com/oauth2/v3/certs";
const GOOGLE_CALENDAR_ENDPOINT = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const GOOGLE_DRIVE_ENDPOINT = "https://www.googleapis.com/drive/v3/files";
const GOOGLE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/drive.metadata.readonly"
].join(" ");
const CONTENT_TYPES = {
  ".css": "text/css; charset=utf-8", ".html": "text/html; charset=utf-8", ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8", ".webp": "image/webp", ".woff": "font/woff", ".woff2": "font/woff2"
};
const ROOT_ASSETS = new Set([
  "index.html", "utampa-logo.svg", "favicon.svg", "cc-shell-responsive.v1.css", "cc-recorder.css",
  "cc-workspace-switcher.v2.js", "cc-shell-shim.v1.js", "cc-recorder.js", "cc-incubator-adapter.v1.js",
  "utampa-live.v1.js", "utampa-live.v1.css"
]);

function required(name, value, minLength = 1) {
  if (typeof value !== "string" || value.length < minLength) {
    throw new Error(`${name} is required${minLength > 1 ? ` and must be at least ${minLength} characters` : ""}`);
  }
  return value;
}

function safeEqual(left, right) {
  const a = crypto.createHash("sha256").update(String(left)).digest();
  const b = crypto.createHash("sha256").update(String(right)).digest();
  return crypto.timingSafeEqual(a, b);
}

function tokenKey(token, secret) {
  return secret
    ? crypto.createHmac("sha256", secret).update(String(token || "")).digest("base64url")
    : crypto.createHash("sha256").update(String(token || "")).digest("base64url");
}

function createSession() { return crypto.randomBytes(32).toString("base64url"); }

function parseCookies(header = "") {
  const cookies = {};
  for (const pair of header.split(";")) {
    const index = pair.indexOf("=");
    if (index < 0) continue;
    const key = pair.slice(0, index).trim();
    const value = pair.slice(index + 1).trim();
    if (key) cookies[key] = value;
  }
  return cookies;
}

function safeNext(value) {
  if (typeof value !== "string") return "/";
  let candidate = value;
  try {
    for (let pass = 0; pass < 3; pass += 1) {
      if (/[\\\u0000-\u001f\u007f]/.test(candidate)) return "/";
      const decoded = decodeURIComponent(candidate);
      if (decoded === candidate) break;
      candidate = decoded;
    }
    const parsed = new URL(candidate, "https://utampa.invalid");
    if (parsed.origin !== "https://utampa.invalid" || !candidate.startsWith("/") || candidate.startsWith("//") || parsed.pathname.startsWith("//")) return "/";
    if (/^\/(?:login|logout|auth|__test)(?:\/|$)/i.test(parsed.pathname)) return "/";
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch { return "/"; }
}

function securityHeaders(contentType) {
  return {
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'self'; base-uri 'none'; connect-src 'self'; font-src 'self' data:; form-action 'self'; frame-ancestors 'none'; img-src 'self' data:; object-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'",
    "Content-Type": contentType,
    "Cross-Origin-Opener-Policy": "same-origin",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY"
  };
}

function send(res, status, body, contentType = "text/plain; charset=utf-8", extraHeaders = {}) {
  res.writeHead(status, { ...securityHeaders(contentType), ...extraHeaders });
  res.end(body);
}

function signInPage(next, error = false) {
  const alert = error ? '<p id="auth-error" class="error" role="alert" aria-live="assertive" aria-atomic="true" tabindex="-1">We could not complete sign-in. Please try again with your authorized personal Google account.</p>' : "";
  const behavior = '<script>(()=>{const error=document.getElementById("auth-error");if(error)error.focus();const link=document.getElementById("google-sign-in");const status=document.getElementById("auth-status");if(link&&status)link.addEventListener("click",()=>{status.textContent="Opening Google sign-in…";link.setAttribute("aria-busy","true")},{once:true})})()</script>';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign in — UTampa Faculty OS</title><style>:root{font-family:Inter,Arial,sans-serif;color:#171717;background:#f5f5f3}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px}main{width:min(100%,480px);background:#fff;border-top:8px solid #d71920;border-radius:12px;box-shadow:0 16px 48px #0002;padding:32px}h1{margin:0 0 8px;font-size:clamp(1.75rem,6vw,2.25rem)}p{line-height:1.5}.eyebrow{font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#8f1015}.google{min-height:48px;width:100%;display:flex;align-items:center;justify-content:center;margin:24px 0 16px;border:2px solid #171717;border-radius:8px;background:#171717;color:#fff;font-weight:700;text-decoration:none}.google:focus-visible{outline:4px solid #f1c400;outline-offset:3px}.error{border-left:4px solid #d71920;background:#fff2f2;padding:12px}.note{font-size:.92rem;color:#4b4b4b}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}</style></head><body><main><p class="eyebrow">University of Tampa</p><h1>Faculty OS</h1><p>Use your authorized personal Google account to open the private dashboard.</p>${alert}<a id="google-sign-in" class="google" data-testid="google-sign-in" aria-describedby="auth-disclosure" href="/auth/google?next=${encodeURIComponent(next)}">Continue with Google</a><p id="auth-status" class="sr-only" role="status" aria-live="polite" aria-atomic="true"></p><p id="auth-disclosure" class="note">This prototype contains synthetic demonstration data only. It is not a live University system of record.</p></main>${behavior}</body></html>`;
}

function parseJwtPart(value) {
  try { return JSON.parse(Buffer.from(value, "base64url").toString("utf8")); }
  catch { throw new Error("invalid identity token"); }
}

function createGoogleOAuthProvider(config) {
  const { clientId, clientSecret, redirectUri, fetchImpl = fetch, now = Date.now } = config;
  let jwksCache = { expiresAt: 0, keys: [] };
  async function getKeys() {
    if (jwksCache.expiresAt > now() && jwksCache.keys.length) return jwksCache.keys;
    const response = await fetchImpl(GOOGLE_JWKS_ENDPOINT, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error("identity key fetch failed");
    const body = await response.json();
    if (!Array.isArray(body.keys)) throw new Error("identity key response invalid");
    const maxAge = /max-age=(\d+)/i.exec(response.headers.get("cache-control") || "");
    jwksCache = { keys: body.keys, expiresAt: now() + Math.min(Number(maxAge?.[1] || 300), 3600) * 1000 };
    return jwksCache.keys;
  }
  return {
    authorizationUrl({ state, nonce, codeChallenge }) {
      const url = new URL(GOOGLE_AUTHORIZATION_ENDPOINT);
      url.search = new URLSearchParams({
        client_id: clientId, redirect_uri: redirectUri, response_type: "code", scope: GOOGLE_SCOPES,
        state, nonce, code_challenge: codeChallenge, code_challenge_method: "S256", access_type: "offline",
        include_granted_scopes: "true", prompt: "consent select_account"
      });
      return url.toString();
    },
    async exchangeAndVerify({ code, codeVerifier, expectedNonce }) {
      const response = await fetchImpl(GOOGLE_TOKEN_ENDPOINT, {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code, code_verifier: codeVerifier, grant_type: "authorization_code", redirect_uri: redirectUri })
      });
      if (!response.ok) throw new Error("identity token exchange failed");
      const token = await response.json();
      if (typeof token.id_token !== "string") throw new Error("identity token missing");
      const parts = token.id_token.split(".");
      if (parts.length !== 3) throw new Error("identity token malformed");
      const header = parseJwtPart(parts[0]);
      const claims = parseJwtPart(parts[1]);
      if (header.alg !== "RS256" || typeof header.kid !== "string") throw new Error("identity token algorithm rejected");
      const jwk = (await getKeys()).find(candidate => candidate.kid === header.kid && candidate.kty === "RSA");
      if (!jwk) throw new Error("identity signing key not found");
      const verified = crypto.verify("RSA-SHA256", Buffer.from(`${parts[0]}.${parts[1]}`), crypto.createPublicKey({ key: jwk, format: "jwk" }), Buffer.from(parts[2], "base64url"));
      if (!verified) throw new Error("identity token signature rejected");
      const seconds = Math.floor(now() / 1000);
      const audienceOk = claims.aud === clientId || (Array.isArray(claims.aud) && claims.aud.includes(clientId));
      const authorizedPartyOk = claims.azp === undefined ? !Array.isArray(claims.aud) : claims.azp === clientId;
      if (!GOOGLE_ISSUERS.has(claims.iss) || !audienceOk || !authorizedPartyOk || !Number.isFinite(claims.exp) || claims.exp <= seconds ||
          (Number.isFinite(claims.iat) && claims.iat > seconds + 300) || claims.nonce !== expectedNonce ||
          claims.email_verified !== true || typeof claims.email !== "string" || typeof claims.sub !== "string" || !claims.sub) {
        throw new Error("identity token claims rejected");
      }
      return {
        sub: claims.sub,
        email: claims.email,
        accessToken: typeof token.access_token === "string" ? token.access_token : "",
        refreshToken: typeof token.refresh_token === "string" ? token.refresh_token : "",
        accessTokenExpiresAt: now() + Math.max(0, Number(token.expires_in || 0)) * 1000,
        grantedScope: typeof token.scope === "string" ? token.scope : ""
      };
    },
    async refresh(refreshToken) {
      const response = await fetchImpl(GOOGLE_TOKEN_ENDPOINT, {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" })
      });
      if (!response.ok) throw new Error("Google access refresh failed");
      const token = await response.json();
      if (typeof token.access_token !== "string" || !token.access_token) throw new Error("Google access token missing");
      return {
        accessToken: token.access_token,
        accessTokenExpiresAt: now() + Math.max(0, Number(token.expires_in || 0)) * 1000,
        grantedScope: typeof token.scope === "string" ? token.scope : ""
      };
    }
  };
}

function createSyntheticOAuthProvider() {
  return {
    synthetic: true,
    authorizationUrl({ state, nonce }) { return `/__test/authorize?state=${encodeURIComponent(state)}&nonce=${encodeURIComponent(nonce)}`; },
    async exchangeAndVerify({ code, expectedNonce }) {
      if (code !== `synthetic:${expectedNonce}`) throw new Error("synthetic identity rejected");
      return { sub: "synthetic-subject", email: "bert@utampa.edu", accessToken: "synthetic-access-token", refreshToken: "synthetic-refresh-token", accessTokenExpiresAt: Date.now() + 3600000, grantedScope: GOOGLE_SCOPES };
    },
    async refresh() {
      return { accessToken: "synthetic-refreshed-token", accessTokenExpiresAt: Date.now() + 3600000, grantedScope: GOOGLE_SCOPES };
    }
  };
}

function createApp(options = {}) {
  const rootDir = path.resolve(options.rootDir || __dirname);
  const clientId = required("GOOGLE_CLIENT_ID", options.clientId ?? process.env.GOOGLE_CLIENT_ID);
  const clientSecret = required("GOOGLE_CLIENT_SECRET", options.clientSecret ?? process.env.GOOGLE_CLIENT_SECRET, 12);
  const redirectUri = required("GOOGLE_REDIRECT_URI", options.redirectUri ?? process.env.GOOGLE_REDIRECT_URI);
  const allowedEmail = required("UTAMPA_ALLOWED_EMAIL", options.allowedEmail ?? process.env.UTAMPA_ALLOWED_EMAIL);
  const sessionSecret = required("UTAMPA_SESSION_SECRET", options.sessionSecret ?? process.env.UTAMPA_SESSION_SECRET, 32);
  const ttlMs = options.ttlMs || DEFAULT_TTL_MS;
  const now = options.now || Date.now;
  const secureCookies = options.secureCookies ?? process.env.NODE_ENV === "production";
  const allowSynthetic = process.env.NODE_ENV === "test" && process.env.UTAMPA_SYNTHETIC_OIDC === "1";
  const oauth = options.oauth || (allowSynthetic ? createSyntheticOAuthProvider() : createGoogleOAuthProvider({ clientId, clientSecret, redirectUri, fetchImpl: options.fetchImpl, now }));
  const activeSessions = new Map();
  const pendingAuth = new Map();
  const authAttempts = new Map();

  async function googleAccessToken(session) {
    if (session.accessToken && session.accessTokenExpiresAt > now() + 60000) return session.accessToken;
    if (!session.refreshToken || typeof oauth.refresh !== "function") return "";
    const refreshed = await oauth.refresh(session.refreshToken);
    session.accessToken = refreshed.accessToken;
    session.accessTokenExpiresAt = refreshed.accessTokenExpiresAt;
    if (refreshed.grantedScope) session.grantedScope = refreshed.grantedScope;
    return session.accessToken;
  }

  async function googleJson(session, target) {
    const accessToken = await googleAccessToken(session);
    if (!accessToken) return { reauthorize: true };
    const response = await (options.fetchImpl || fetch)(target, { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } });
    if (response.status === 401) {
      session.accessToken = "";
      session.accessTokenExpiresAt = 0;
    }
    if (!response.ok) {
      const error = new Error(`Google API request failed (${response.status})`);
      error.status = response.status;
      throw error;
    }
    return response.json();
  }

  function clean(current) {
    for (const [key, session] of activeSessions) if (session.expiresAt <= current) activeSessions.delete(key);
    for (const [key, transaction] of pendingAuth) if (transaction.expiresAt <= current) pendingAuth.delete(key);
    for (const [key, attempt] of authAttempts) if (attempt.resetAt <= current) authAttempts.delete(key);
  }

  return http.createServer(async (req, res) => {
    try {
      const requestUrl = new URL(req.url, "http://localhost");
      let pathname;
      try { pathname = decodeURIComponent(requestUrl.pathname); }
      catch { return send(res, 400, "Bad request"); }

      if (pathname === "/healthz") {
        if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "Method not allowed", undefined, { Allow: "GET, HEAD" });
        const body = JSON.stringify({ status: "ok" });
        return send(res, 200, req.method === "HEAD" ? "" : body, "application/json; charset=utf-8");
      }

      if (pathname === "/login") {
        if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "Method not allowed", undefined, { Allow: "GET, HEAD" });
        const body = signInPage(safeNext(requestUrl.searchParams.get("next")), requestUrl.searchParams.has("error"));
        return send(res, 200, req.method === "HEAD" ? "" : body, "text/html; charset=utf-8");
      }

      if (pathname === "/auth/google") {
        if (req.method !== "GET") return send(res, 405, "Method not allowed", undefined, { Allow: "GET" });
        const current = now(); clean(current);
        const attemptKey = req.socket.remoteAddress || "unknown";
        const attempt = authAttempts.get(attemptKey);
        if (attempt && attempt.count >= AUTH_MAX_ATTEMPTS) return send(res, 429, "Too many sign-in attempts", undefined, { "Retry-After": String(Math.ceil((attempt.resetAt - current) / 1000)) });
        authAttempts.set(attemptKey, attempt ? { ...attempt, count: attempt.count + 1 } : { count: 1, resetAt: current + AUTH_WINDOW_MS });
        if (pendingAuth.size >= MAX_PENDING_AUTH) return send(res, 503, "Sign-in is temporarily unavailable");
        const state = crypto.randomBytes(24).toString("base64url");
        const nonce = crypto.randomBytes(24).toString("base64url");
        const codeVerifier = crypto.randomBytes(48).toString("base64url");
        const codeChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url");
        pendingAuth.set(tokenKey(state), { state, nonce, codeVerifier, next: safeNext(requestUrl.searchParams.get("next")), expiresAt: current + TRANSACTION_TTL_MS });
        const transactionCookie = `${TRANSACTION_COOKIE}=${state}; HttpOnly; Path=/auth/google/callback; SameSite=Lax; Max-Age=${Math.floor(TRANSACTION_TTL_MS / 1000)}${secureCookies ? "; Secure" : ""}`;
        res.writeHead(303, { ...securityHeaders("text/plain; charset=utf-8"), Location: oauth.authorizationUrl({ state, nonce, codeChallenge }), "Set-Cookie": transactionCookie });
        return res.end("Continue to Google");
      }

      if (pathname === "/__test/authorize" && oauth.synthetic) {
        if (process.env.NODE_ENV !== "test" || req.method !== "GET") return send(res, 404, "Not found");
        const state = requestUrl.searchParams.get("state") || "";
        const nonce = requestUrl.searchParams.get("nonce") || "";
        res.writeHead(303, { ...securityHeaders("text/plain; charset=utf-8"), Location: `/auth/google/callback?state=${encodeURIComponent(state)}&code=${encodeURIComponent(`synthetic:${nonce}`)}` });
        return res.end("Synthetic identity redirect");
      }

      if (pathname === "/auth/google/callback") {
        if (req.method !== "GET") return send(res, 405, "Method not allowed", undefined, { Allow: "GET" });
        const current = now(); clean(current);
        const state = requestUrl.searchParams.get("state") || "";
        const cookieState = parseCookies(req.headers.cookie)[TRANSACTION_COOKIE] || "";
        const transaction = pendingAuth.get(tokenKey(state));
        pendingAuth.delete(tokenKey(state));
        const clearTransaction = `${TRANSACTION_COOKIE}=; HttpOnly; Path=/auth/google/callback; SameSite=Lax; Max-Age=0${secureCookies ? "; Secure" : ""}`;
        if (!transaction || transaction.expiresAt <= current || !safeEqual(state, cookieState) || !safeEqual(state, transaction.state) || requestUrl.searchParams.has("error")) {
          res.writeHead(303, { ...securityHeaders("text/plain; charset=utf-8"), Location: "/login?error=sign-in", "Set-Cookie": clearTransaction });
          return res.end("Sign-in rejected");
        }
        let identity;
        try { identity = await oauth.exchangeAndVerify({ code: requestUrl.searchParams.get("code") || "", codeVerifier: transaction.codeVerifier, expectedNonce: transaction.nonce }); }
        catch { identity = null; }
        if (!identity || !safeEqual(String(identity.email).toLowerCase(), allowedEmail.toLowerCase()) || typeof identity.sub !== "string" || !identity.sub) {
          res.writeHead(303, { ...securityHeaders("text/plain; charset=utf-8"), Location: "/login?error=sign-in", "Set-Cookie": clearTransaction });
          return res.end("Sign-in rejected");
        }
        authAttempts.delete(req.socket.remoteAddress || "unknown");
        const expiresAt = current + ttlMs;
        const token = createSession();
        activeSessions.set(tokenKey(token, sessionSecret), {
          sub: identity.sub, email: identity.email, expiresAt,
          accessToken: identity.accessToken || "", refreshToken: identity.refreshToken || "",
          accessTokenExpiresAt: identity.accessTokenExpiresAt || 0, grantedScope: identity.grantedScope || ""
        });
        const sessionCookie = `${COOKIE_NAME}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${Math.floor(ttlMs / 1000)}${secureCookies ? "; Secure" : ""}`;
        res.writeHead(303, { ...securityHeaders("text/plain; charset=utf-8"), Location: transaction.next, "Set-Cookie": [clearTransaction, sessionCookie] });
        return res.end("Signed in");
      }

      if (pathname === "/logout") {
        if (req.method !== "POST") return send(res, 405, "Method not allowed", undefined, { Allow: "POST" });
        const logoutToken = parseCookies(req.headers.cookie)[COOKIE_NAME];
        activeSessions.delete(tokenKey(logoutToken, sessionSecret));
        res.writeHead(303, { ...securityHeaders("text/plain; charset=utf-8"), Location: "/login", "Set-Cookie": `${COOKIE_NAME}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${secureCookies ? "; Secure" : ""}` });
        return res.end("Signed out");
      }

      const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
      const current = now();
      const sessionKey = tokenKey(token, sessionSecret);
      const session = activeSessions.get(sessionKey);
      if (!session || session.expiresAt <= current || !safeEqual(String(session.email).toLowerCase(), allowedEmail.toLowerCase()) || typeof session.sub !== "string" || !session.sub) {
        activeSessions.delete(sessionKey);
        const next = safeNext(`${pathname}${requestUrl.search}`);
        res.writeHead(303, { ...securityHeaders("text/plain; charset=utf-8"), Location: `/login?next=${encodeURIComponent(next)}` });
        return res.end("Authentication required");
      }

      if (pathname === "/api/me") {
        if (req.method !== "GET") return send(res, 405, "Method not allowed", undefined, { Allow: "GET" });
        return send(res, 200, JSON.stringify({ email: session.email, connected: Boolean(session.accessToken || session.refreshToken) }), "application/json; charset=utf-8");
      }

      if (pathname === "/api/calendar") {
        if (req.method !== "GET") return send(res, 405, "Method not allowed", undefined, { Allow: "GET" });
        const timeMin = new Date(Math.max(Date.now() - 12 * 60 * 60 * 1000, Number(requestUrl.searchParams.get("timeMin") || 0) || 0));
        const timeMax = new Date(Math.min(timeMin.getTime() + 31 * 24 * 60 * 60 * 1000, Number(requestUrl.searchParams.get("timeMax") || 0) || timeMin.getTime() + 14 * 24 * 60 * 60 * 1000));
        const target = new URL(GOOGLE_CALENDAR_ENDPOINT);
        target.search = new URLSearchParams({
          timeMin: timeMin.toISOString(), timeMax: timeMax.toISOString(), singleEvents: "true", orderBy: "startTime", maxResults: "100",
          fields: "items(id,summary,start,end,location,htmlLink,status),nextPageToken"
        });
        try {
          const data = await googleJson(session, target);
          if (data.reauthorize) return send(res, 409, JSON.stringify({ error: "reauthorization_required" }), "application/json; charset=utf-8");
          const events = Array.isArray(data.items) ? data.items.filter(item => item && item.status !== "cancelled").map(item => ({
            id: String(item.id || ""), title: String(item.summary || "Busy"),
            start: String(item.start?.dateTime || item.start?.date || ""), end: String(item.end?.dateTime || item.end?.date || ""),
            allDay: Boolean(item.start?.date && !item.start?.dateTime), location: String(item.location || ""), url: String(item.htmlLink || "")
          })) : [];
          return send(res, 200, JSON.stringify({ source: "Google Calendar · read-only", events }), "application/json; charset=utf-8");
        } catch (error) {
          const status = error.status === 401 || error.status === 403 ? 409 : 502;
          return send(res, status, JSON.stringify({ error: status === 409 ? "reauthorization_required" : "calendar_unavailable" }), "application/json; charset=utf-8");
        }
      }

      if (pathname === "/api/drive") {
        if (req.method !== "GET") return send(res, 405, "Method not allowed", undefined, { Allow: "GET" });
        const query = String(requestUrl.searchParams.get("q") || "").trim().slice(0, 100);
        const escaped = query.replace(/['\\]/g, character => `\\${character}`);
        const target = new URL(GOOGLE_DRIVE_ENDPOINT);
        const params = { pageSize: "25", orderBy: "modifiedTime desc", fields: "files(id,name,mimeType,modifiedTime,webViewLink,iconLink)" };
        params.q = query ? `trashed = false and name contains '${escaped}'` : "trashed = false";
        target.search = new URLSearchParams(params);
        try {
          const data = await googleJson(session, target);
          if (data.reauthorize) return send(res, 409, JSON.stringify({ error: "reauthorization_required" }), "application/json; charset=utf-8");
          const files = Array.isArray(data.files) ? data.files.map(item => ({
            id: String(item.id || ""), name: String(item.name || "Untitled"), mimeType: String(item.mimeType || ""),
            modifiedTime: String(item.modifiedTime || ""), url: String(item.webViewLink || ""), icon: String(item.iconLink || "")
          })) : [];
          return send(res, 200, JSON.stringify({ source: "Google Drive metadata · read-only", files }), "application/json; charset=utf-8");
        } catch (error) {
          const status = error.status === 401 || error.status === 403 ? 409 : 502;
          return send(res, status, JSON.stringify({ error: status === 409 ? "reauthorization_required" : "drive_unavailable" }), "application/json; charset=utf-8");
        }
      }

      if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "Method not allowed", undefined, { Allow: "GET, HEAD" });

      const relative = pathname.replace(/^\/+/, "");
      const segments = relative.split("/").filter(Boolean);
      const hasHiddenSegment = segments.some(segment => segment.startsWith("."));
      const isCompiledAsset = segments[0] === "assets" && segments.length > 1;
      const isSyntheticFixture = relative === "data/spartan-incubator.fixture.json";
      const isRootAsset = ROOT_ASSETS.has(relative || "index.html");
      const isDeepLink = !relative || relative.endsWith("/") || !path.posix.extname(relative);
      const reservedMissingPath = ["assets", "data", "boss", "auth", "login", "logout", "__test"].includes(segments[0]);
      if (hasHiddenSegment) return send(res, 404, "Not found");
      let selected;
      if (isRootAsset) selected = relative || "index.html";
      else if (isCompiledAsset || isSyntheticFixture) selected = relative;
      else if (isDeepLink && !reservedMissingPath) selected = "index.html";
      else return send(res, 404, "Not found");
      const filePath = path.resolve(rootDir, selected);
      if (filePath !== rootDir && !filePath.startsWith(`${rootDir}${path.sep}`)) return send(res, 400, "Bad request");
      let stat; try { stat = await fs.promises.stat(filePath); } catch {}
      if (!stat || !stat.isFile()) return send(res, 404, "Not found");
      res.writeHead(200, securityHeaders(CONTENT_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream"));
      if (req.method === "HEAD") return res.end();
      fs.createReadStream(filePath).on("error", () => res.destroy()).pipe(res);
    } catch (error) {
      const status = error.status || 500;
      send(res, status, status === 500 ? "Internal server error" : error.message);
    }
  });
}

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  createApp().listen(port, "0.0.0.0", () => console.log(`UTampa Faculty OS listening on ${port}`));
}

module.exports = { COOKIE_NAME, TRANSACTION_COOKIE, createApp, createGoogleOAuthProvider, createSession, safeNext, signInPage };
