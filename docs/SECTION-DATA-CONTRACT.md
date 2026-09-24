# UTampa section data contract v1

`lib/section-data-contract.js` defines the read-only data boundary for Today,
Teaching, Research, Service, and People. The server now validates the optional
`UTAMPA_SECTION_FEED_JSON` value at startup and exposes sanitized, authenticated
`/api/sections/:section` views. The browser renders those views and fails
closed to explicit unconfigured/unavailable states. No approved live feed is
configured by the repository, and this adds no OAuth scope.

The checked-in example at `data/section-data.unconfigured.v1.json` contains no
user, student, founder, course, or University records. Every section is
explicitly `unconfigured`, so the honest current count is `null`, not zero.

## Truth states

Each section carries `asOf`, `freshness`, `staleAfter`, and a `completeness`
object. `current` and `stale` require an explicit `staleAfter`; `unknown`
requires `staleAfter: null`. A once-current stored snapshot remains structurally
valid after that threshold so a service restart does not fail. The authenticated
response projection downgrades it to `stale` at request time. Complete-empty
sections follow the same rule and therefore cannot appear permanently fresh.

| `completeness.status` | Meaning | `receivedCount` | Items |
| --- | --- | --- | --- |
| `unconfigured` | No approved source is configured | `null` | Must be empty |
| `unavailable` | An approved source exists but could not be read | `null` | Must be empty |
| `partial` | The source read was incomplete; zero or more validated records were received | Exact supplied item count | May contain validated items |
| `complete` | The producer explicitly asserts a complete read | Exact supplied item count | May be empty; this is the only verified zero |

`partial`, `unavailable`, and `unconfigured` require a human-readable reason.
Missing sections are normalized to `unconfigured`; they are never interpreted
as complete empty collections. `freshness` is one of `current`, `stale`, or
`unknown`. A stale item also requires `staleAfter`.

## Stable identity and provenance

All feed, source, item, entity, and record references use opaque namespaced
IDs such as `item:service:opaque-001`. IDs must remain stable when a title or
status changes. They must not embed email addresses, student IDs, names, sheet
row contents, or other protected data.

Every item requires:

- its containing `section` and a section-specific `category`;
- `status`, nullable `priority`, boolean `needsOwner`, `asOf`, and `freshness`;
- an opaque `sourceRef` that matches a provenance `recordId`;
- at least one provenance entry naming a declared read-only source; and
- an explicit action list, which may be empty.

`sourceUrl`, when present, must be a credential-free, query-free, fragment-free
HTTPS URL on the closed Google Drive/Docs/Calendar host allowlist.
The URL is not an authorization grant; the server and upstream source must
still enforce access.

Source kinds include `airtable-readonly` so a future approved export can state
direct Airtable provenance truthfully. That enum value does not connect,
authorize, or configure Airtable, and it never permits a write or an Airtable
link. Airtable share/capability paths are deliberately rejected by v1.

## Allowed actions

The contract intentionally cannot describe send, share, submit, approve,
delete, update, or other connected-system writes.

| Action | Effect |
| --- | --- |
| `open_details` | Read local details |
| `open_source` | Open a validated HTTPS source |
| `open_section` | Navigate within the five workspaces |
| `prepare` | Build a local preparation view |
| `complete_local` | Store a browser-local completion marker |
| `dismiss_local` | Store a browser-local dismissal marker |
| `stage_route_local` | Store a local route note; nobody is notified |

Action labels are canonical contract values (for example, `Open source` and
`Complete locally`), not producer-written copy. A producer therefore cannot
pair a local action type with a misleading label such as “Send now.”

Each section has `allowedActions`. Every item action must be a subset of that
list. Adding a connected-system side effect requires a new reviewed contract
version and separate authorization; it must not be smuggled through a label or
URL.

## Sanitized Google Sheet/export rows

`buildSectionFeedFromRows(rows, options)` converts already-sanitized row JSON
into this contract. `parseSectionRowsJson(value, options)` performs the same
conversion from an environment/secret JSON string. The accepted row columns
are closed to this allowlist:

`id`, `entityId`, `section`, `category`, `title`, `summary`, `status`,
`priority`, `needsOwner`, `asOf`, `freshness`, `staleAfter`, `dueAt`, `startAt`,
`endAt`, `tags`, `sourceRef`, `sourceUrl`, and `actions`.

An unexpected column fails validation instead of passing through. Arbitrary
notes, email addresses, source payloads, and unreviewed fields therefore cannot
silently enter the browser response. This is a validation boundary, not a data
loss prevention system; the approved producer must still omit protected data
from allowlisted text fields.

The parser also needs one read-only source descriptor:

```js
const { parseSectionRowsJson } = require("./lib/section-data-contract");
const generatedAt = new Date().toISOString();
const staleAfter = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

const feed = parseSectionRowsJson(process.env.UTAMPA_SECTION_ROWS_JSON, {
  feedId: "feed:approved-section-export",
  generatedAt,
  source: {
    id: "source:approved-sheet-export",
    label: "Approved private sheet export",
    kind: "approved-export",
    readOnly: true,
    asOf: generatedAt
  },
  sectionStates: {
    service: {
      status: "complete",
      expectedCount: 0,
      asOf: generatedAt,
      freshness: "current",
      staleAfter
    }
  }
});
```

The snippet is structural only: it contains no live source, credentials, or
records. If rows are present without a producer completeness assertion, the
parser marks their section `partial`. An explicit `complete` assertion is
required to display a verified zero.

## Backward-compatible consumption

- `normalizeSectionFeed()` fills omitted known sections as `unconfigured`.
- Unknown fields are rejected at the top level and at source, completeness,
  section, item, provenance, action, and sanitized-row boundaries.
- Unknown sections and contract versions fail closed. Adding a sixth section
  or a connected write action requires a version change.
- `parseSectionFeedJson()` accepts only a full v1 feed from a protected JSON/env
  source. A blank value produces the explicit unconfigured feed. Any nonblank
  partial object (including `{}`), invalid JSON, or invalid record throws a
  stable error and must not be normalized or fall back to sample content.
- Parsed JSON is capped at 5 MiB, tags/provenance/actions are bounded, parse
  errors do not echo source text, and typed ID prefixes prevent source/item/
  entity/record identity collisions.
- `createUnavailableFeed()` constructs the valid all-sections-unavailable
  response for a future runtime source failure. Invalid configured startup JSON
  currently stops startup; sample data is never a fallback.

The JSON Schema for producer tooling is
`schemas/section-data-feed.v1.schema.json`. The dependency-free JavaScript
validator additionally enforces cross-record rules that JSON Schema cannot
express conveniently: source-reference integrity, feed-wide item-ID
uniqueness, action subsets, exact received counts, sourceRef/provenance
matching, safe URLs, real calendar dates, non-future observation times,
freshness consistency, and state-dependent truth rules.

## Exact integration path

1. Approve one private, sanitized source and its owner. If it is a Google
   Sheet, export only the allowlisted columns through a server-side mechanism;
   do not broaden the user's current Drive metadata-only OAuth scope.
2. Give every upstream row immutable opaque `id` and `sourceRef` values. Have
   the producer state section completeness and freshness explicitly.
3. Deliver full contract JSON through the protected
   `UTAMPA_SECTION_FEED_JSON` environment value. A Sheet/export producer may
   use `buildSectionFeedFromRows()` before delivery. Never commit the live feed
   or its credential.
4. The current server validates the value once at startup and serves only a
   sanitized projection through authenticated `/api/sections/:section`
   routes. Each view includes a request-time `servedAt` timestamp so the
   browser can age freshness relative to the server clock rather than trusting
   the client wall clock. A future remote-fetch loader must add bounded refresh timeouts and
   return `createUnavailableFeed(...)` on source failure; it must never serve
   the synthetic fixture or claim an empty complete result.
5. The standalone browser shell renders the protected section view. It renders
   counts only for `complete` or `partial`,
   shows reasons for `unconfigured`/`unavailable`, labels stale data, and
   renders only supplied allowed actions.
6. Maintain exact-server and browser tests for complete, partial, unavailable,
   unconfigured, stale, unsafe URL, unexpected field, duplicate ID, and source
   failure states before production deployment.

## Decisions still required before live data activation

- Which approved Sheet/export is authoritative for each of the five sections,
  and whether one source may truthfully assert each section is complete.
- The owner-approved, non-protected column mapping. Teaching and People must
  not introduce student records, Canvas/Workday data, University credentials,
  or other institutional systems through an export.
- How the deployed server will receive the private feed and credential
  (protected environment JSON, mounted secret, or authenticated fetch).
- Which current prototype controls should remain local actions and which
  should disappear. This v1 contract does not authorize external writes.

Until those decisions are supplied, the safe runtime state is the checked-in
unconfigured example, not fabricated cards or synthetic counts.
