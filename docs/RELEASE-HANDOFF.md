# UTampa Faculty OS release handoff

This repository owns a standalone, server-enforced Google identity boundary around the UTampa dashboard. It does not require the BOS or Entrepreneurship Professor runtime to authenticate or serve UTampa. BOS and EP remain optional navigation destinations and may be older or unavailable.

## Owner-confirmed account boundary — September 21, 2026

The owner explicitly requires his personal Google account for private dashboard sign-in. Never request or use University accounts or institutional SSO for this dashboard. The prior University-account requirement was incorrect and is superseded by this owner instruction. `UTAMPA_ALLOWED_EMAIL` must contain only the owner-confirmed address in protected provider configuration; do not commit the address to this public repository. The variable name identifies the dashboard, not an institutional identity requirement.

Personal sign-in does not authorize University/student data access. Student records, Canvas, Workday and other protected institutional information remain excluded. The same owner-approved Google authorization requests Calendar read-only and Drive metadata read-only scopes; those scopes do not authorize document contents or University systems.

## Data and feature boundary

- The retired compiled prototype, standalone Incubator adapter, and repository fixture were removed. Production must not deliver legacy sample people, venture, source-link, or operational claims.
- Missing/non-array collections display `no data`; only a verified explicit empty collection may display zero.
- Today, Teaching, Research, Service, and People fail closed when their approved source is not connected. Their legacy sample cards, counts, identities, and actions are hidden from the operational view; the unavailable state must not imply that a source returned zero records.
- Calendar and Drive metadata may render only when their authorized read-only APIs provide it. They are not represented as University system integrations.
- The sign-in surface uses Google OIDC plus separately consented Calendar read-only and Drive metadata read-only scopes. The browser receives only a random opaque session token. Access and refresh tokens remain only in the process-local session record so the server can proxy sanitized read-only metadata; they are never exposed to browser JavaScript or committed to the repository.
- Calendar responses report partial and truncated source states. A source failure must never be presented as a complete empty result.
- Passing synthetic OAuth/browser evidence proves only the tested authentication and interface states. It is not evidence that production sections contain the correct live data.
- Before any live-data completion claim, Today, Teaching, Research, Service, People, and Calendar must each have an approved source contract that names the source, allowed fields, freshness expectation, section mapping, and empty/partial/error semantics. Compare the production rendering with that source; do not substitute fixture counts or visual presence.

## Required protected configuration

Set these values in the deployment provider; never commit credentials or secret values:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET` (minimum 12 characters)
- `GOOGLE_REDIRECT_URI` (the exact HTTPS callback URL ending in `/auth/google/callback`)
- `UTAMPA_ALLOWED_EMAIL` (the owner-confirmed personal Google address only; keep it in protected provider configuration)
- `UTAMPA_SESSION_SECRET` (minimum 32 characters, randomly generated)
- `NODE_ENV=production`

`UTAMPA_SECTION_FEED_JSON` is optional and sensitive. Leave it absent to produce
the explicit all-sections-unconfigured state. Set it only after the source,
field allowlist, completeness owner, freshness policy, and protected delivery
have been approved. The value must be a full validated
`utampa-section-feed.v1` document; never commit it, paste it into a ticket, or
copy its raw contents into logs or release evidence. An invalid configured
value intentionally prevents startup instead of falling back to sample data.

Production uses Google's fixed authorization, token, JWKS, Calendar, and Drive endpoints. Requested scopes are `openid`, `email`, `calendar.readonly`, and `drive.metadata.readonly`; no write or document-content scope is requested. The application enforces state, nonce, Authorization Code + PKCE, RS256 signature, issuer, audience/authorized-party, expiry, `email_verified`, and exact email allowlisting; it requires and stores Google's stable `sub` claim for each session. Synthetic OAuth is injected only by `test/browser-server.js`, which binds to loopback and requires `NODE_ENV=test`. The deployed `server.js` entrypoint rejects `UTAMPA_SYNTHETIC_OIDC` instead of enabling a test identity.

The service refuses to start if any required configuration is absent or too short. `/healthz`, `/login`, and the OAuth handshake are the only public surfaces. Dashboard, allowlisted scripts/stylesheets, and deep links default deny; retired compiled assets and data paths return 404 even after authentication.

## Release gates

1. Record the exact prior live revision and deployment before release, and preserve a verified rollback target.
2. Require exact-head CI PASS, exact synthetic OAuth browser evidence, and independent technical/security PASS.
3. Require a section-by-section source-correctness PASS against each approved source contract. A green synthetic browser run cannot satisfy this gate. Record only the non-sensitive feed identity (`feedId`, `generatedAt`, mapping revision, and a checksum/digest), plus each section's completeness, count, and freshness; do not record raw private records or the feed secret.
4. Require exact-successor visual PASS for the neutral `My Work Login` Google sign-in/error surface (no University or Faculty OS branding) and disabled BOS switcher state.
5. Reuse the existing single-instance Node web service `utampa-faculty-os-prod` (`srv-danbinjbc2fs73drgrqg`) with auto-deploy off and `npm start`. Do not provision a duplicate service or serve protected dashboard content from a public static runtime.
6. Configure the five protected environment values. Use a dedicated dashboard OAuth client with the exact production redirect URI. Enforce the owner-confirmed personal account through the server's exact email allowlist; Google consent-screen audience settings do not replace this application check. Do not expose the address or secrets in logs or evidence.
7. Deploy only the exact reviewed revision after the current release authorization and required gates are satisfied.
8. Verify exact deployment identity; public `/healthz`; unauthenticated denial of root/retired-assets/data/deep links; successful Google sign-in; wrong-account/default-deny behavior; session expiry/tamper denial; POST logout and replay denial; desktop, 390px, 375px, 320px, and 844×390 landscape states; correct source-backed population for every connected section; fail-closed source-not-connected states with no legacy sample cards/actions or client-delivered legacy records; Calendar title non-inference; and fail-safe sibling navigation.
9. Record the provider deployment ID and exact commit. Roll back to the preserved prior live revision if any gate fails.

Sessions, pending OAuth transactions, and initiation throttling are process-local. The governed release therefore requires exactly one Node instance. A restart requires reauthentication but must not disclose data.

This handoff does not authorize new secrets, spending, write scopes, protected-data introduction, or an unreviewed provider mutation. A user instruction to build and publish authorizes deployment only after the exact-head gates above pass.
