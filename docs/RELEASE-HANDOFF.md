# UTampa Faculty OS release handoff

This repository owns a standalone, server-enforced Google identity boundary around the UTampa dashboard. It does not require the BOS or Entrepreneurship Professor runtime to authenticate or serve UTampa. BOS and EP remain optional navigation destinations and may be older or unavailable.

## Owner-confirmed account boundary — September 21, 2026

Bert explicitly requires `bert@bertseither.com`, his personal Google account, for private dashboard sign-in. Never request or use University accounts or institutional SSO for this dashboard. The prior University-account requirement was incorrect and is superseded by this owner instruction. `UTAMPA_ALLOWED_EMAIL` must allow only `bert@bertseither.com`; the variable name identifies the dashboard, not an institutional identity requirement.

Personal sign-in does not authorize University/student data access. Student records, Canvas, Workday and other protected institutional information remain excluded. The same owner-approved Google authorization requests Calendar read-only and Drive metadata read-only scopes; those scopes do not authorize document contents or University systems.

## Data and feature boundary

- The committed Spartan Incubator file is synthetic demonstration data, not live University, student, founder, or FERPA data.
- Missing/non-array collections display `no data`; only a verified explicit empty collection may display zero.
- Native dashboard cards and controls retain prototype behavior unless an inline source label explicitly identifies live read-only data. They are not represented as live University system integrations.
- The sign-in surface uses Google OIDC plus separately consented Calendar read-only and Drive metadata read-only scopes. The browser receives only a random opaque session token. Access and refresh tokens remain only in the process-local session record so the server can proxy sanitized read-only metadata; they are never exposed to browser JavaScript or committed to the repository.
- Calendar responses report partial and truncated source states. A source failure must never be presented as a complete empty result.

## Required protected configuration

Set these values in the deployment provider; never commit credentials or secret values:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET` (minimum 12 characters)
- `GOOGLE_REDIRECT_URI` (the exact HTTPS callback URL ending in `/auth/google/callback`)
- `UTAMPA_ALLOWED_EMAIL` (`bert@bertseither.com` only; Bert's owner-confirmed personal Google account)
- `UTAMPA_SESSION_SECRET` (minimum 32 characters, randomly generated)
- `NODE_ENV=production`

Production uses Google's fixed authorization, token, JWKS, Calendar, and Drive endpoints. Requested scopes are `openid`, `email`, `calendar.readonly`, and `drive.metadata.readonly`; no write or document-content scope is requested. The application enforces state, nonce, Authorization Code + PKCE, RS256 signature, issuer, audience/authorized-party, expiry, `email_verified`, and exact email allowlisting; it requires and stores Google's stable `sub` claim for each session. A synthetic provider exists only when both `NODE_ENV=test` and `UTAMPA_SYNTHETIC_OIDC=1`; never set that flag in a deployed environment.

The service refuses to start if any required configuration is absent or too short. `/healthz`, `/login`, and the OAuth handshake are the only public surfaces. Dashboard, scripts, stylesheets, fixture data, and deep links default deny.

## Release gates

1. Record the exact prior live revision and deployment before release, and preserve a verified rollback target.
2. Require exact-head CI PASS, exact synthetic OAuth browser evidence, and independent technical/security PASS.
3. Require exact-successor visual PASS for the neutral `My Work Login` Google sign-in/error surface (no University or Faculty OS branding) and disabled BOS switcher state.
4. Reuse the existing single-instance Node web service `utampa-faculty-os-prod` (`srv-danbinjbc2fs73drgrqg`) with auto-deploy off and `npm start`. Do not provision a duplicate service or serve protected dashboard content from a public static runtime.
5. Configure the five protected environment values. Use a dedicated dashboard OAuth client with the exact production redirect URI. Enforce the owner-confirmed personal account `bert@bertseither.com` through the server's exact email allowlist; Google consent-screen audience settings do not replace this application check. Do not expose secrets in logs or evidence.
6. Deploy only the exact reviewed revision after the current release authorization and required gates are satisfied.
7. Verify exact deployment identity; public `/healthz`; unauthenticated denial of root/assets/data/deep links; successful Google sign-in; wrong-account/default-deny behavior; session expiry/tamper denial; POST logout and replay denial; desktop, 390px, 375px, 320px, and 844×390 landscape states; Service/Spartan workflow; synthetic/no-data labels; and fail-safe sibling navigation.
8. Record the provider deployment ID and exact commit. Roll back to the preserved prior live revision if any gate fails.

Sessions, pending OAuth transactions, and initiation throttling are process-local. The governed release therefore requires exactly one Node instance. A restart requires reauthentication but must not disclose data.

This handoff does not authorize new secrets, spending, write scopes, protected-data introduction, or an unreviewed provider mutation. A user instruction to build and publish authorizes deployment only after the exact-head gates above pass.
