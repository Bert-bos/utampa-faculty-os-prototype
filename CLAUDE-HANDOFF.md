# U TAMPA FACULTY OS — APPROVED PROTOTYPE — CLAUDE HANDOFF

## Current owner instruction — September 21, 2026

Private dashboard sign-in uses only the owner's personal Google account configured in the protected `UTAMPA_ALLOWED_EMAIL` environment value. Never request or use University accounts or institutional SSO. Student records, Canvas, Workday and protected institutional data remain excluded. The only data-source scopes in the same Google consent are Calendar read-only and Drive metadata read-only, alongside `openid` and `email` for identity. The app does not authenticate to or directly connect institutional systems; Calendar may include selected or subscribed feeds already visible to the authorized Google account, and Drive access is limited to metadata rather than document contents.

The current server/authentication release requirements in `docs/RELEASE-HANDOFF.md` supersede the original public static-prototype deployment method. Preserve the approved interface, separate repositories and Bert-only access.

## Closed-loop operating instructions — September 24, 2026

- Continue the full loop—reconcile the latest owner decisions, implement, test the exact candidate commit, obtain independent review, deploy that exact commit, and verify production—without handing routine test steps back to Bert.
- Pause only for a blocker that genuinely requires Bert's authority or private input. Report the exact blocker and the smallest action needed; do not treat ordinary implementation, QA, GitHub, or Render work as a user task.
- Google Drive is the authority for owner decisions and status; Git is the authority for code, tests, and exact revision identity. Never substitute remembered or inferred requirements for either source.
- A local success, preview, synthetic fixture, pushed branch, or passing unit suite is not a live result. Claim completion only after exact-head gates pass, the reviewed SHA is deployed, and the production checks in `docs/RELEASE-HANDOFF.md` pass.
- Preserve truth boundaries: Calendar and Drive expose sanitized read-only metadata only. Until an approved source contract is connected, Today, Teaching, Research, Service, and People must fail closed with a source-not-connected state; legacy sample cards, counts, identities, actions, and client-delivered records must not appear. Never infer program affiliation from Calendar title keywords.
- Record commit SHA, workflow run evidence, deployment ID, live revision, and rollback target. If any gate fails, fix and repeat the loop rather than asking Bert to discover the failure.

### Repository-verifiable Claude compliance

- This repository cannot inspect or prove the contents of Bert's private Claude account instructions. Do not claim that it can.
- For each Claude job, the GitHub record must identify the exact base SHA, the instruction files Claude followed, the bounded task, commands/tests run, and the resulting patch or no-change finding. Claude must explicitly acknowledge those constraints in its response.
- An `@claude` mention alone is not proof that the loop ran. At this revision there is no repository-local Claude workflow; invocation is intended to occur through the private BOS control plane described in `docs/CLOSED-LOOP-STANDARD.md`.
- BOS must independently compare Claude's result with the current owner decision record and the exact repository state before applying changes. Account-level instruction compliance is evidenced by the job output and independent verification, not assumed from configuration.
- Keep the correction loop active until the requested outcome and its release gates pass. A blocker report is valid only when the remaining action requires Bert's authority, private input, or a requirement decision that cannot be derived from approved sources.

## Status

APPROVED DESIGN. ACTIVE IMPLEMENTATION AND QA. DO NOT CLAIM LIVE-DATA COMPLETION UNTIL EVERY SECTION HAS AN APPROVED SOURCE CONTRACT AND PRODUCTION EVIDENCE.

## Source package

This folder now contains the reviewed standalone private-dashboard shell:

- `index.html`
- `app-shell.v1.css`
- `utampa-live.v1.js` and `utampa-live.v1.css`
- `cc-workspace-switcher.v2.js`
- `favicon.svg`
- `README.md`

The retired compiled prototype bundle was removed because it embedded legacy
people, venture, link, and operational claims in client-delivered bytes. Do
not restore that bundle or copy its sample records into the operational shell.
Preserve the current source-backed interaction and truth boundaries.

The login surface must say `My Work Login` and contain no University of Tampa
logo, University name, or Faculty OS label. The authenticated document title
is `My Work`; no compiled `Starter Project` metadata is allowed.

## GitHub destination

https://github.com/Bert-bos/utampa-faculty-os-prototype

Load the source package into that public repository.

## Render deployment

Reuse the existing `utampa-faculty-os-prod` Node web service (`srv-danbinjbc2fs73drgrqg`), with one instance, `npm start`, and auto-deploy off. Do not create a duplicate service or publish protected dashboard content as an unauthenticated static site.

Configure `UTAMPA_ALLOWED_EMAIL` with the owner-confirmed personal Google address only in the provider's protected configuration, along with the dedicated Google OAuth client. Complete the release gates in `docs/RELEASE-HANDOFF.md` before deployment.

- Preserve root-relative asset paths

## Required verification

Before returning a link:

1. Verify the existing Render service at the reviewed commit, including unauthenticated denial and Bert-only personal Google sign-in.
2. Verify Today, Teaching, Research, Service, People, and Calendar.
3. Click the global workspace switcher, countdown/Prepare Me, navigation tabs, source-backed cards, allowed actions, drawers, and modal states. Confirm the unsupported Record Meeting control is hidden and disabled rather than presented as operational.
4. Check desktop and mobile widths.
5. Confirm there are no missing assets, blank screens, console-breaking errors, or Site Not Found errors.
6. For Today, Teaching, Research, Service, People, and Calendar, verify the displayed production data against its approved source contract, including freshness and empty/partial/error behavior. Synthetic browser fixtures prove UI behavior only; they do not prove production data correctness.
7. Return the verified public URL, exact deployed SHA, deployment ID, and evidence for both interaction behavior and source-correct section population.

## Integration context

This U Tampa dashboard is one workspace in the larger coordinated operating system:

- U Tampa
- BOS
- Entrepreneurship Professor

Preserve workspace separation and branding. U Tampa and Entrepreneurship Professor are separate brands. Do not visually merge them.

## Important

The recovered source is the approved CREATIVE prototype. Treat it as the visual and interaction authority. Do not replace it with a generic dashboard or developer interpretation.
