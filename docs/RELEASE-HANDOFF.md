# UTampa Faculty OS release handoff

This repository now owns a self-contained, server-enforced authentication boundary around the static UTampa dashboard. The approved dashboard HTML, responsive CSS, Spartan Incubator adapter, synthetic fixture, and adapter contract remain unchanged. One bounded user-facing successor change disables the false BOS switcher target, and the new sign-in page is a new surface; both require exact-successor CREATIVE review before release.

## Data and feature boundary

- The committed Spartan Incubator file is synthetic demonstration data, not live University, student, founder, or FERPA data.
- Missing/non-array collections display `no data`; an explicit empty collection may display zero.
- Dashboard cards and controls retain their prototype behavior. They are not represented as live University system integrations.
- The dashboard is served independently. BOS and Entrepreneurship Professor may remain on older releases or be unavailable without blocking the UTampa root, assets, data adapter, or deep links.

## Required protected configuration

Set these values in the deployment provider; never commit their values:

- `UTAMPA_USERNAME`
- `UTAMPA_PASSWORD` (minimum 12 characters)
- `UTAMPA_SESSION_SECRET` (minimum 32 characters, randomly generated)
- `NODE_ENV=production`

The service refuses to start if any credential or signing secret is absent or too short. `/healthz` is the only public route. Every dashboard, script, stylesheet, fixture-data, and deep-link request defaults to the sign-in boundary.

## Release gates

1. Preserve current exact live and rollback revision `b8d8df88`; deployment `dep-dafi6d0u01pc73aihnn0`.
2. Require exact-head CI PASS and independent technical review of the auth successor.
3. Confirm the approved dashboard/data bytes remain identical to `bb4c32aa4357f3745f4cc2eaa06190220a4833d8` except the bounded `cc-workspace-switcher.v2.js` change that disables the false BOS target. Require exact-successor CREATIVE PASS for that disabled state and the new sign-in page.
4. Configure the three protected environment values and a Node web-service start command `npm start`.
5. Only after explicit release authorization, merge/deploy the exact reviewed revision.
6. Verify public `/healthz`; unauthenticated denial of `/`, static assets, `/data/spartan-incubator.fixture.json`, and a deep link; successful sign-in; session expiry/tamper denial; logout; desktop plus 390px and 375px workflow smoke; synthetic/no-data labels; and switcher behavior.
7. Record the exact provider deployment ID and commit. Roll back to `b8d8df88` if any gate fails.

No merge, deployment, provider mutation, secret creation, or real-data introduction is authorized by this handoff.
