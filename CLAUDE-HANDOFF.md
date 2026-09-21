# U TAMPA FACULTY OS — APPROVED PROTOTYPE — CLAUDE HANDOFF

## Current owner instruction — September 21, 2026

Private dashboard sign-in uses only `bert@bertseither.com`, Bert's personal Google account. Never request or use University accounts or institutional SSO. Student records, Canvas, Workday and protected institutional data remain excluded. Personal sign-in does not grant data-source access.

The current server/authentication release requirements in `docs/RELEASE-HANDOFF.md` supersede the original public static-prototype deployment method. Preserve the approved interface, separate repositories and Bert-only access.

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
