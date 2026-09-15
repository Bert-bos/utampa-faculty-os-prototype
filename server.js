"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { URL, URLSearchParams } = require("node:url");

const COOKIE_NAME = "utampa_session";
const DEFAULT_TTL_MS = 8 * 60 * 60 * 1000;
const MAX_BODY_BYTES = 8 * 1024;
const CONTENT_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2"
};
const ROOT_ASSETS = new Set([
  "index.html",
  "utampa-logo.svg",
  "favicon.svg",
  "cc-shell-responsive.v1.css",
  "cc-recorder.css",
  "cc-workspace-switcher.v2.js",
  "cc-shell-shim.v1.js",
  "cc-recorder.js",
  "cc-incubator-adapter.v1.js"
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

function encode(value) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function sign(value, secret) {
  return crypto.createHmac("sha256", secret).update(value).digest("base64url");
}

function createSession(username, secret, expiresAt) {
  const payload = encode(JSON.stringify({ username, expiresAt }));
  return `${payload}.${sign(payload, secret)}`;
}

function readSession(token, username, secret, now) {
  if (!token || !token.includes(".")) return false;
  const [payload, suppliedSignature, ...extra] = token.split(".");
  if (extra.length || !safeEqual(sign(payload, secret), suppliedSignature)) return false;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return parsed.username === username && Number.isFinite(parsed.expiresAt) && parsed.expiresAt > now();
  } catch {
    return false;
  }
}

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
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/login")
    ? value
    : "/";
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

function loginPage(next, error = false) {
  const escapedNext = next.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>UTampa Faculty OS sign in</title></head><body><main><h1>UTampa Faculty OS</h1>${error ? "<p role=alert>Sign-in failed.</p>" : ""}<form method="post" action="/login"><input type="hidden" name="next" value="${escapedNext}"><label>Username <input name="username" autocomplete="username" required></label><label>Password <input name="password" type="password" autocomplete="current-password" required></label><button type="submit">Sign in</button></form><p>This private prototype contains synthetic demonstration data only.</p></main></body></html>`;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", chunk => {
      body += chunk;
      if (Buffer.byteLength(body) > MAX_BODY_BYTES) reject(Object.assign(new Error("request body too large"), { status: 413 }));
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function createApp(options = {}) {
  const rootDir = path.resolve(options.rootDir || __dirname);
  const username = required("UTAMPA_USERNAME", options.username ?? process.env.UTAMPA_USERNAME);
  const password = required("UTAMPA_PASSWORD", options.password ?? process.env.UTAMPA_PASSWORD, 12);
  const sessionSecret = required("UTAMPA_SESSION_SECRET", options.sessionSecret ?? process.env.UTAMPA_SESSION_SECRET, 32);
  const ttlMs = options.ttlMs || DEFAULT_TTL_MS;
  const now = options.now || Date.now;
  const secureCookies = options.secureCookies ?? process.env.NODE_ENV === "production";

  return http.createServer(async (req, res) => {
    try {
      const requestUrl = new URL(req.url, "http://localhost");
      const pathname = decodeURIComponent(requestUrl.pathname);

      if (pathname === "/healthz") {
        return send(res, 200, JSON.stringify({ status: "ok" }), "application/json; charset=utf-8");
      }

      if (pathname === "/login" && req.method === "GET") {
        return send(res, 200, loginPage(safeNext(requestUrl.searchParams.get("next")) || "/"), "text/html; charset=utf-8");
      }

      if (pathname === "/login" && req.method === "POST") {
        const fields = new URLSearchParams(await readBody(req));
        const next = safeNext(fields.get("next"));
        if (!safeEqual(fields.get("username") || "", username) || !safeEqual(fields.get("password") || "", password)) {
          return send(res, 401, loginPage(next, true), "text/html; charset=utf-8");
        }
        const token = createSession(username, sessionSecret, now() + ttlMs);
        const cookie = `${COOKIE_NAME}=${token}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${Math.floor(ttlMs / 1000)}${secureCookies ? "; Secure" : ""}`;
        res.writeHead(303, { ...securityHeaders("text/plain; charset=utf-8"), Location: next, "Set-Cookie": cookie });
        return res.end("Signed in");
      }

      if (pathname === "/logout") {
        res.writeHead(303, {
          ...securityHeaders("text/plain; charset=utf-8"),
          Location: "/login",
          "Set-Cookie": `${COOKIE_NAME}=; HttpOnly; Path=/; SameSite=Strict; Max-Age=0${secureCookies ? "; Secure" : ""}`
        });
        return res.end("Signed out");
      }

      const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
      if (!readSession(token, username, sessionSecret, now)) {
        const next = safeNext(`${pathname}${requestUrl.search}`);
        res.writeHead(303, { ...securityHeaders("text/plain; charset=utf-8"), Location: `/login?next=${encodeURIComponent(next)}` });
        return res.end("Authentication required");
      }

      if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "Method not allowed", undefined, { Allow: "GET, HEAD" });

      const relative = pathname.replace(/^\/+/, "");
      const segments = relative.split("/").filter(Boolean);
      const hasHiddenSegment = segments.some(segment => segment.startsWith("."));
      const isCompiledAsset = segments[0] === "assets" && segments.length > 1;
      const isSyntheticFixture = relative === "data/spartan-incubator.fixture.json";
      const isRootAsset = ROOT_ASSETS.has(relative || "index.html");
      const isDeepLink = !relative || relative.endsWith("/") || !path.posix.extname(relative);
      const reservedMissingPath = segments[0] === "assets" || segments[0] === "data";

      if (hasHiddenSegment) return send(res, 404, "Not found");

      let selected;
      if (isRootAsset) selected = relative || "index.html";
      else if (isCompiledAsset || isSyntheticFixture) selected = relative;
      else if (isDeepLink && !reservedMissingPath) selected = "index.html";
      else return send(res, 404, "Not found");

      const filePath = path.resolve(rootDir, selected);
      if (filePath !== rootDir && !filePath.startsWith(`${rootDir}${path.sep}`)) return send(res, 400, "Bad request");

      let stat;
      try { stat = await fs.promises.stat(filePath); } catch {}
      if (!stat || !stat.isFile()) return send(res, 404, "Not found");

      const contentType = CONTENT_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream";
      const headers = securityHeaders(contentType);
      res.writeHead(200, headers);
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
  const server = createApp();
  server.listen(port, "0.0.0.0", () => console.log(`UTampa Faculty OS listening on ${port}`));
}

module.exports = { COOKIE_NAME, createApp, createSession, readSession, safeNext };
