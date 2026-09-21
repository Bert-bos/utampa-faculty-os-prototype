# UTampa Faculty OS release handoff

This repository owns a standalone, server-enforced Google identity boundary around the UTampa dashboard. It does not require the BOS or Entrepreneurship Professor runtime to authenticate or serve UTampa. BOS and EP remain optional navigation destinations and may be older or unavailable.

## Owner-confirmed account boundary — September 21, 2026

Bert explicitly requires `bert@bertseither.com`, his personal Google account, for private dashboard sign-in. Never request or use University accounts or institutional SSO for this dashboard. The prior University-account requirement was incorrect and is superseded by this owner instruction. `UTAMPA_ALLOWED_EMAIL` must allow only `bert@bertseither.com`; the variable name identifies the dashboard, not an institutional identity requirement.

Personal sign-in does not authorize University/student data access. Student records, Canvas, Workday and other protected institutional information remain excluded. Calendar and Drive connections, when implemented, must use separately authorized read-only access and approved sources under Bert's personal account.

## Data and feature boundary

- The committed Spartan Incubator file is synthetic demonstration data, not live University, student, founder, or FERPA data.
- Missing/non-array collections display `no data`; only a verified explicit empty collection may display zero.
- Dashboard cards and controls retain prototype behavior. They are not represented as live University system integrations.
- The sign-in surface uses Google OIDC. The browser receives only a random opaque session token; the process-local session record retains the allowlisted subject/email and provider tokens are discarded after verification.

## Required protected configuration

Set these values in the deployment provider; never commit credentials or secret values:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET` (minimum 12 characters)
- `GOOGLE_REDIRECT_URI` (the exact HTTPS callback URL ending in `/auth/google/callback`)
- `UTAMPA_ALLOWED_EMAIL` (`bert@bertseither.com` only; Bert's owner-confirmed personal Google account)
- `UTAMPA_SESSION_SECRET` (minimum 32 characters, randomly generated)
- `NODE_ENV=production`

Production uses Google's fixed authorization, token, and JWKS endpoints; `openid email` are the only scopes. The application enforces state, nonce, Authorization Code + PKCE, RS256 signature, issuer, audience/authorized-party, expiry, `email_verified`, exact email allowlisting, and immutable `sub`. A synthetic provider exists only when both `NODE_ENV=test` and `UTAMPA_SYNTHETIC_OIDC=1`; never set that flag in a deployed environment.

The service refuses to start if any required configuration is absent or too short. `/healthz`, `/login`, and the OAuth handshake are the only public surfaces. Dashboard, scripts, stylesheets, fixture data, and deep links default deny.

## Release gates

1. Preserve current live/rollback revision `b8d8df88`; deployment `dep-dafi6d0u01pc73aihnn0`.
2. Require exact-head CI PASS, exact synthetic OAuth browser evidence, and independent technical/security PASS.
3. Require exact-successor CREATIVE PASS for the branded Google sign-in/error surface and disabled BOS switcher state.
4. Reuse the existing single-instance Node web service `utampa-faculty-os-prod` (`srv-danbinjbc2fs73drgrqg`) with auto-deploy off and `npm start`. Do not provision a duplicate service or serve protected dashboard content from a public static runtime.
5. Configure the five protected environment values. Use a dedicated dashboard OAuth client with the exact production redirect URI. Enforce the owner-confirmed personal account `bert@bertseither.com` through the server's exact email allowlist; Google consent-screen audience settings do not replace this application check. Do not expose secrets in logs or evidence.
6. Only after explicit protected release authorization, deploy the exact reviewed revision.
7. Verify exact deployment identity; public `/healthz`; unauthenticated denial of root/assets/data/deep links; successful Google sign-in; wrong-account/default-deny behavior; session expiry/tamper denial; POST logout and replay denial; desktop, 390px, and 375px Service/Spartan workflow; synthetic/no-data labels; and fail-safe sibling navigation.
8. Record the provider deployment ID and commit. Roll back by routing to the preserved `b8d8df88` static service if any gate fails.

Sessions, pending OAuth transactions, and initiation throttling are process-local. The governed release therefore requires exactly one Node instance. A restart requires reauthentication but must not disclose data.

No merge, deployment, provider mutation, secret creation, spending, or real-data introduction is authorized by this handoff.
