# U TAMPA FACULTY OS — APPROVED PROTOTYPE — CLAUDE HANDOFF

## Current owner instruction — September 21, 2026

Private dashboard sign-in uses only `bert@bertseither.com`, Bert's personal Google account. Never request or use University accounts or institutional SSO. Student records, Canvas, Workday and protected institutional data remain excluded. The only data-source scopes in the same Google consent are Calendar read-only and Drive metadata read-only, alongside `openid` and `email` for identity. The app does not authenticate to or directly connect institutional systems; Calendar may include selected or subscribed feeds already visible to the authorized Google account, and Drive access is limited to metadata rather than document contents.

The current server/authentication release requirements in `docs/RELEASE-HANDOFF.md` supersede the original public static-prototype deployment method. Preserve the approved interface, separate repositories and Bert-only access.

## Closed-loop operating instructions — September 24, 2026

- Continue the full loop—reconcile the latest owner decisions, implement, test the exact candidate commit, obtain independent review, deploy that exact commit, and verify production—without handing routine test steps back to Bert.
- Pause only for a blocker that genuinely requires Bert's authority or private input. Report the exact blocker and the smallest action needed; do not treat ordinary implementation, QA, GitHub, or Render work as a user task.
- Google Drive is the authority for owner decisions and status; Git is the authority for code, tests, and exact revision identity. Never substitute remembered or inferred requirements for either source.
- A local success, preview, synthetic fixture, pushed branch, or passing unit suite is not a live result. Claim completion only after exact-head gates pass, the reviewed SHA is deployed, and the production checks in `docs/RELEASE-HANDOFF.md` pass.
- Preserve truth boundaries: Calendar and Drive expose sanitized read-only metadata only; every other native workspace remains clearly labeled prototype unless an approved source contract says otherwise. Never infer program affiliation from Calendar title keywords.
- Record commit SHA, workflow run evidence, deployment ID, live revision, and rollback target. If any gate fails, fix and repeat the loop rather than asking Bert to discover the failure.

## Status

APPROVED DESIGN. IMPLEMENTATION MAY BEGIN.

## Source package

This folder includes the recovered, exact interactive prototype source:

- `index.html`
- `assets/`
- `utampa-logo.svg`
- `favicon.svg`
- `README.md`

Do not redesign, reinterpret, or start over. Preserve the approved design and interactions exactly.

The login surface is the explicit exception to legacy branding: it must say `My Work Login` and contain no University of Tampa logo, University name, or Faculty OS label. Dashboard workspace branding remains unchanged.

## GitHub destination

https://github.com/Bert-bos/utampa-faculty-os-prototype

Load the source package into that public repository.

## Render deployment

Reuse the existing `utampa-faculty-os-prod` Node web service (`srv-danbinjbc2fs73drgrqg`), with one instance, `npm start`, and auto-deploy off. Do not create a duplicate service or publish protected dashboard content as an unauthenticated static site.

Configure `UTAMPA_ALLOWED_EMAIL=bert@bertseither.com` and the dedicated Google OAuth client through the provider's protected configuration. Complete the release gates in `docs/RELEASE-HANDOFF.md` before deployment.

- Preserve root-relative asset paths

## Required verification

Before returning a link:

1. Verify the existing Render service at the reviewed commit, including unauthenticated denial and Bert-only personal Google sign-in.
2. Verify Today, Teaching, Research, Service, People, and Calendar.
3. Click the global workspace switcher, countdown/Prepare Me, Record Meeting, navigation tabs, cards, buttons, drawers, and modal states.
4. Check desktop and mobile widths.
5. Confirm there are no missing assets, blank screens, console-breaking errors, or Site Not Found errors.
6. Return the verified public URL and screenshot evidence.

## Integration context

This U Tampa dashboard is one workspace in the larger coordinated operating system:

- U Tampa
- BOS
- Entrepreneurship Professor

Preserve workspace separation and branding. U Tampa and Entrepreneurship Professor are separate brands. Do not visually merge them.

## Important

The recovered source is the approved CREATIVE prototype. Treat it as the visual and interaction authority. Do not replace it with a generic dashboard or developer interpretation.
