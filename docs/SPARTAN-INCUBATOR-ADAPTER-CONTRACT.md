# Spartan Incubator Adapter Contract (UTAMPA-NEXT-01, corrected UTAMPA-NEXT-02B)

Applies to `cc-incubator-adapter.v1.js`. This adapter is additive and
idempotent: it does not touch the compiled dashboard bundle, and it is
safe to load twice (guarded by `window.__ccIncubatorAdapterV1`).

## Canonical-data boundary

`DATA_SOURCE_URL` currently points at the synthetic fixture
(`/data/spartan-incubator.fixture.json`). Swapping to the canonical
UTampa/Drive weekly check-in export means changing `DATA_SOURCE_URL`
(and, if needed, adding a mapping step before render runs) -- nothing
else in the adapter should need to change.

Review/demo path: synthetic fixture data only. No real student, founder,
or FERPA data may be placed at `DATA_SOURCE_URL` until BOS explicitly
approves that change.

## Top-level shape

The fetched document may define these top-level keys: `meta`,
`weeklySubmissions`, `commitments`, `wins`, `needs`, `recruiting`,
`mediaFlags`, and an optional `runMode`.

- `meta.source`, `meta.sourceLabel`: freshness/source labelling used by
  `renderMeta`.
- `meta.fetchedAt`, `meta.staleThresholdHours`: drive `isStale()`; a
  missing or unparsable `fetchedAt` is treated as stale.
- `weeklySubmissions[]`: each entry has `founder`, `company`, `weekOf`,
  `status` (`submitted` / `missing`), `summary`.
- `commitments[]`: each entry has `who`, `what`, `dueDate`, `status`.
- `wins[]`: each entry has `founder`, `company`, `description`,
  `evidenceUrl`, `date`.
- `needs[]`: each entry has `founder`, `company`, `description`,
  `blockedSince`, `severity`.
- `recruiting[]`: each entry has `role`, `company`, `stage`, `verified`
  (boolean), `lastVerifiedDate`.
- `mediaFlags[]`: each entry has `relatedTo`, `type`, `deadline`,
  `status`, `reviewRequired` (boolean); only entries with
  `reviewRequired: true` render a review chip.
- `runMode.isWednesdaySummaryActive`, `runMode.summary`: when active,
  renders the Wednesday run-mode banner inside `renderMeta`.

## No-fabricated-zero rule (binding, corrected in UTAMPA-NEXT-02B)

Superseded text: an earlier draft of this contract said an absent
collection array was rendered as count `0` and told producers to
"always include arrays." That statement is removed -- it described the
defect UTAMPA-NEXT-02B exists to eliminate, and it must not be
reintroduced.

Binding rule going forward:

| Source state for a collection key | Rendered count |
| --- | --- |
| Key absent from the document | `no data` |
| Key present but not an array (string, object, null, number) | `no data` |
| Key present as `[]` (an explicit, source-provided empty array) | `0` |
| Key present as a non-empty array | the array's `length` |

This applies independently to `weeklySubmissions`, `commitments`,
`wins`, `needs`, and `recruiting`. A count may only ever be a verified
number when the source actually provided an array for that key --
never inferred from absence.

Collection-specific consequences:

- `weeklySubmissions`: the `(N missing)` suffix after the Submissions
  count is computed only when `weeklySubmissions` is a present array.
  If `weeklySubmissions` is absent or non-array, the line reads exactly
  `Submissions: no data`, with no missing-count suffix of any kind.
- `recruiting`: `Recruiting verified` is only ever rendered as a
  `verified/total` fraction when `recruiting` is a present array
  (including an empty one, which renders `0/0` as a verified zero). If
  `recruiting` is absent or non-array, the line reads exactly
  `Recruiting verified: no data` -- never `0/0`.
- `commitments`, `wins`, `needs`: each independently follows the same
  table above; one collection being absent must not affect the
  rendered count of any other collection.

`mediaFlags` and `runMode` are unaffected by this correction: an absent
or empty `mediaFlags` array already renders nothing (no fabricated
chip), and an absent `runMode` already renders no banner.

## Media-review boundary

Only `mediaFlags` entries with `reviewRequired: true` render a
press/founder-story review chip. Chips are click-to-expand and closed
by default; no review content is shown until a user opens it.

## Freshness / staleness

`isStale()` treats a missing `meta`, a missing `meta.fetchedAt`, or an
unparsable `meta.fetchedAt` as stale. `meta.staleThresholdHours`
overrides the 168-hour default when present.

## Synthetic-only boundary

The fixture at `DATA_SOURCE_URL` is demo/review data for
UTAMPA-NEXT-01 only (`__synthetic: true`,
`__doNotUseForRealDecisions`). No real student, founder, or FERPA data
may be substituted until BOS explicitly approves the canonical-data
swap described above.
