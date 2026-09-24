"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  ACTION_POLICY,
  CONTRACT_VERSION,
  SECTION_IDS,
  assertValidSectionFeed,
  buildSectionFeedFromRows,
  createUnconfiguredFeed,
  createUnavailableFeed,
  normalizeSectionFeed,
  parseSectionFeedJson,
  parseSectionRowsJson,
  validateSectionFeed
} = require("../lib/section-data-contract");

const ROOT = path.resolve(__dirname, "..");
const WHEN = "2026-01-01T00:00:00Z";

function cloned(value) {
  return JSON.parse(JSON.stringify(value));
}

function approvedSource() {
  return {
    id: "source:approved-private-feed",
    label: "Approved private work feed",
    kind: "private-json",
    readOnly: true,
    asOf: WHEN
  };
}

function workItem(overrides = {}) {
  return {
    id: "item:today:example-001",
    entityId: "entity:work:example-001",
    section: "today",
    category: "task",
    title: "Review the approved work item",
    summary: "Example-only contract content.",
    status: "open",
    needsOwner: true,
    asOf: WHEN,
    freshness: "current",
    staleAfter: "2099-01-01T00:00:00Z",
    dueAt: null,
    priority: 1,
    tags: ["example"],
    sourceRef: "record:opaque-001",
    sourceUrl: "https://docs.google.com/document/example-001",
    provenance: [{
      sourceId: "source:approved-private-feed",
      recordId: "record:opaque-001",
      observedAt: WHEN,
      method: "direct"
    }],
    actions: [
      { type: "open_details", label: "Open details" },
      { type: "open_source", label: "Open source", href: "https://docs.google.com/document/example-001" },
      { type: "complete_local", label: "Complete locally" }
    ],
    ...overrides
  };
}

function withCompleteToday(items) {
  const feed = createUnconfiguredFeed({ generatedAt: WHEN, feedId: "feed:test-sections" });
  feed.sources = [approvedSource()];
  feed.sections.today = {
    id: "today",
    asOf: WHEN,
    freshness: "current",
    staleAfter: items.length ? items.map(item => item.staleAfter).sort()[0] : "2099-01-01T00:00:00Z",
    completeness: {
      status: "complete",
      expectedCount: items.length,
      receivedCount: items.length
    },
    sourceIds: ["source:approved-private-feed"],
    allowedActions: ["open_details", "open_source", "complete_local"],
    items
  };
  return feed;
}

test("the checked-in sample is a valid, explicit unconfigured state without user data", () => {
  const samplePath = path.join(ROOT, "data", "section-data.unconfigured.v1.json");
  const raw = fs.readFileSync(samplePath, "utf8");
  const sample = JSON.parse(raw);
  const result = validateSectionFeed(sample);
  assert.deepEqual(result, { valid: true, errors: [] });
  assert.deepEqual(sample, createUnconfiguredFeed({ generatedAt: sample.generatedAt, feedId: sample.feedId }));
  assert.equal(sample.contractVersion, CONTRACT_VERSION);
  assert.deepEqual(Object.keys(sample.sections), SECTION_IDS);
  for (const sectionId of SECTION_IDS) {
    const section = sample.sections[sectionId];
    assert.equal(section.completeness.status, "unconfigured");
    assert.equal(section.completeness.expectedCount, null);
    assert.equal(section.completeness.receivedCount, null);
    assert.equal(section.asOf, null);
    assert.equal(section.freshness, "unknown");
    assert.equal(section.staleAfter, null);
    assert.deepEqual(section.items, []);
    assert.deepEqual(section.allowedActions, []);
  }
  assert.doesNotMatch(raw, /@|student|founder|course code|university account/i);
});

test("createUnconfiguredFeed and blank environment JSON never fabricate empty-source zeroes", () => {
  const direct = createUnconfiguredFeed({ generatedAt: WHEN, feedId: "feed:test-unconfigured" });
  const fromMissingEnvironment = parseSectionFeedJson("", { generatedAt: WHEN, feedId: "feed:test-env" });
  for (const feed of [direct, fromMissingEnvironment]) {
    assert.equal(validateSectionFeed(feed).valid, true);
    for (const section of Object.values(feed.sections)) {
      assert.equal(section.completeness.status, "unconfigured");
      assert.equal(section.completeness.receivedCount, null);
    }
  }
});

test("createUnavailableFeed provides a valid fail-closed source-error response", () => {
  assert.throws(() => createUnavailableFeed({ generatedAt: WHEN }), error => error.code === "UTAMPA_SECTION_SOURCE_REQUIRED");
  const feed = createUnavailableFeed({
    generatedAt: WHEN,
    feedId: "feed:test-unavailable",
    reason: "Approved source could not be read.",
    sources: [approvedSource()]
  });
  assert.equal(validateSectionFeed(feed).valid, true);
  for (const section of Object.values(feed.sections)) {
    assert.equal(section.completeness.status, "unavailable");
    assert.equal(section.completeness.receivedCount, null);
    assert.equal(section.asOf, null);
    assert.equal(section.freshness, "unknown");
    assert.equal(section.staleAfter, null);
    assert.deepEqual(section.sourceIds, ["source:approved-private-feed"]);
    assert.deepEqual(section.items, []);
    assert.deepEqual(section.allowedActions, []);
  }
  const sourceLess = cloned(feed);
  sourceLess.sections.today.sourceIds = [];
  const sourceLessResult = validateSectionFeed(sourceLess);
  assert.ok(sourceLessResult.errors.some(error => error.path === "$.sections.today.sourceIds" && /approved source/.test(error.message)));
});

test("a complete explicit empty collection is the only verified zero state", () => {
  const feed = withCompleteToday([]);
  assert.equal(validateSectionFeed(feed).valid, true);
  assert.equal(feed.sections.today.completeness.receivedCount, 0);

  const fabricated = cloned(feed);
  fabricated.sections.today.completeness.status = "unconfigured";
  fabricated.sections.today.completeness.reason = "No source configured.";
  fabricated.sections.today.asOf = null;
  fabricated.sections.today.freshness = "unknown";
  fabricated.sections.today.staleAfter = null;
  fabricated.sections.today.sourceIds = [];
  fabricated.sections.today.allowedActions = [];
  const result = validateSectionFeed(fabricated);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(error => error.path.endsWith("receivedCount") && /must be null/.test(error.message)));
});

test("valid section items require stable IDs, provenance, freshness, and allowlisted actions", () => {
  const feed = withCompleteToday([workItem()]);
  assert.doesNotThrow(() => assertValidSectionFeed(feed));
  assert.equal(validateSectionFeed(feed).valid, true);
  assert.deepEqual(ACTION_POLICY.complete_local, { effect: "browser-local", target: "local" });
  assert.equal(Object.values(ACTION_POLICY).some(policy => /external|write|send/.test(policy.effect)), false);
});

test("the validator rejects duplicate IDs, unsupported actions, unsafe links, and untraceable provenance", () => {
  const feed = withCompleteToday([workItem()]);
  feed.sections.teaching = {
    id: "teaching",
    asOf: WHEN,
    freshness: "current",
    staleAfter: "2099-01-01T00:00:00Z",
    completeness: { status: "complete", expectedCount: 1, receivedCount: 1 },
    sourceIds: ["source:approved-private-feed"],
    allowedActions: ["open_source"],
    items: [workItem({
      section: "teaching",
      category: "task",
      actions: [
        { type: "send", label: "Send now" },
        { type: "open_source", label: "Unsafe source", href: "http://example.invalid/private" }
      ],
      provenance: [{ sourceId: "source:missing", observedAt: WHEN, method: "direct" }]
    })]
  };
  const result = validateSectionFeed(feed);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(error => error.path.endsWith(".id") && /unique across all sections/.test(error.message)));
  assert.ok(result.errors.some(error => error.path.endsWith(".type") && /supported non-destructive action/.test(error.message)));
  assert.ok(result.errors.some(error => error.path.endsWith(".href") && /HTTPS/.test(error.message)));
  assert.ok(result.errors.some(error => error.path.endsWith(".sourceId") && /declared source/.test(error.message)));
});

test("partial data must report its real item count and explain the gap", () => {
  const feed = withCompleteToday([workItem()]);
  feed.sections.today.completeness = {
    status: "partial",
    expectedCount: 3,
    receivedCount: 0
  };
  const result = validateSectionFeed(feed);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(error => error.path.endsWith("receivedCount") && /number of supplied items/.test(error.message)));
  assert.ok(result.errors.some(error => error.path.endsWith("reason") && /partial/.test(error.message)));
});

test("sanitized sheet rows map only allowlisted fields and preserve stale/source facts", () => {
  const source = approvedSource();
  const row = {
    id: "item:service:example-001",
    entityId: "entity:service:example-001",
    section: "service",
    category: "commitment",
    title: "Review an approved example commitment",
    summary: "Example-only row.",
    status: "blocked",
    priority: 2,
    needsOwner: true,
    asOf: "2025-12-01T00:00:00Z",
    freshness: "stale",
    staleAfter: "2025-12-15T00:00:00Z",
    dueAt: null,
    startAt: null,
    endAt: null,
    tags: ["example"],
    sourceRef: "record:sheet-row-001",
    sourceUrl: "https://docs.google.com/document/example-row-001",
    actions: [{ type: "open_source", label: "Open source", href: "https://docs.google.com/document/example-row-001" }]
  };
  const feed = buildSectionFeedFromRows([row], {
    source,
    feedId: "feed:sheet-example",
    generatedAt: WHEN,
    sectionStates: {
      service: { status: "complete", expectedCount: 1, asOf: row.asOf, freshness: "stale" }
    }
  });
  assert.equal(feed.sections.service.completeness.status, "complete");
  assert.equal(feed.sections.service.freshness, "stale");
  assert.equal(feed.sections.service.items[0].sourceRef, row.sourceRef);
  assert.equal(feed.sections.service.items[0].provenance[0].recordId, row.sourceRef);
  assert.deepEqual(feed.sections.service.allowedActions, ["open_source"]);
  assert.equal(feed.sections.today.completeness.status, "unconfigured");
  assert.equal(validateSectionFeed(feed).valid, true);

  assert.throws(
    () => buildSectionFeedFromRows([{ ...row, privateNotes: "must not pass through" }], { source, generatedAt: WHEN }),
    error => error.code === "UTAMPA_SECTION_ROWS_INVALID" && /non-allowlisted/.test(error.message)
  );
  assert.throws(
    () => buildSectionFeedFromRows([{ ...row, sourceUrl: "javascript:alert(1)" }], { source, generatedAt: WHEN }),
    error => error.code === "UTAMPA_SECTION_FEED_INVALID" && error.errors.some(item => item.path.endsWith("sourceUrl"))
  );
});

test("normalization fills omitted sections as unconfigured without mutating the supplied JSON", () => {
  const input = {
    contractVersion: CONTRACT_VERSION,
    feedId: "feed:partial-producer",
    generatedAt: WHEN,
    sources: [approvedSource()],
    sections: {
      today: withCompleteToday([workItem()]).sections.today
    }
  };
  const before = cloned(input);
  const normalized = normalizeSectionFeed(input);
  assert.deepEqual(input, before);
  assert.equal(normalized.sections.today.completeness.status, "complete");
  for (const sectionId of SECTION_IDS.slice(1)) {
    assert.equal(normalized.sections[sectionId].completeness.status, "unconfigured");
    assert.equal(normalized.sections[sectionId].completeness.receivedCount, null);
  }
  assert.equal(validateSectionFeed(normalized).valid, true);
});

test("invalid environment JSON and invalid normalized feeds fail closed with stable error codes", () => {
  assert.throws(
    () => parseSectionFeedJson("{not-json"),
    error => error.code === "UTAMPA_SECTION_FEED_JSON_INVALID"
  );
  for (const configuredButInvalid of ["null", "{}", '{"sections":{}}', '""']) {
    assert.throws(
      () => parseSectionFeedJson(configuredButInvalid),
      error => error.code === "UTAMPA_SECTION_FEED_INVALID" && Array.isArray(error.errors) && error.errors.length > 0
    );
  }
  for (const configuredButInvalid of ["null", "{}", '""']) {
    assert.throws(
      () => parseSectionRowsJson(configuredButInvalid, { source: approvedSource(), generatedAt: WHEN }),
      error => error.code === "UTAMPA_SECTION_ROWS_INVALID"
    );
  }
  assert.throws(
    () => normalizeSectionFeed({ sections: { unknown: {} } }, { generatedAt: WHEN }),
    error => error.code === "UTAMPA_SECTION_FEED_INVALID" && error.errors.some(item => /unsupported/.test(item.message))
  );
  assert.throws(
    () => normalizeSectionFeed({ sections: null }, { generatedAt: WHEN }),
    error => error.code === "UTAMPA_SECTION_FEED_INVALID" && error.errors.some(item => item.path === "$.sections")
  );
  assert.throws(
    () => normalizeSectionFeed({ contractVersion: "", feedId: "", generatedAt: null }),
    error => error.code === "UTAMPA_SECTION_FEED_INVALID" && error.errors.some(item => item.path === "$.contractVersion")
  );
});

test("closed allowlists, source dates, and complete counts fail closed", () => {
  const feed = withCompleteToday([workItem()]);
  feed.unreviewedPayload = "blocked";
  feed.sections.today.completeness.unreviewedMetric = 12;
  feed.sections.today.completeness.expectedCount = null;
  delete feed.sources[0].asOf;
  const result = validateSectionFeed(feed);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(error => error.path === "$" && /allowlisted/.test(error.message)));
  assert.ok(result.errors.some(error => error.path.endsWith("completeness") && /allowlisted/.test(error.message)));
  assert.ok(result.errors.some(error => error.path.endsWith("expectedCount") && /complete/.test(error.message)));
  assert.ok(result.errors.some(error => error.path === "$.sources[0].asOf" && /required/.test(error.message)));
});

test("calendar dates, observed times, and freshness assertions are internally consistent", () => {
  const invalidDate = withCompleteToday([workItem({ asOf: "2026-02-30T00:00:00Z" })]);
  assert.ok(validateSectionFeed(invalidDate).errors.some(error => error.path.endsWith("items[0].asOf")));

  const future = withCompleteToday([workItem()]);
  assert.ok(validateSectionFeed(future, { now: Date.parse("2025-12-31T00:00:00Z") }).errors.some(error => error.path === "$.generatedAt"));

  const contradiction = withCompleteToday([workItem({
    freshness: "stale",
    staleAfter: "2026-02-01T00:00:00Z"
  })]);
  contradiction.sections.today.freshness = "stale";
  const result = validateSectionFeed(contradiction, { now: Date.parse("2026-01-15T00:00:00Z") });
  assert.ok(result.errors.some(error => error.path.endsWith(".freshness") && /before staleAfter/.test(error.message)));

  const emptyExpired = withCompleteToday([]);
  emptyExpired.sections.today.staleAfter = "2026-02-01T00:00:00Z";
  const expiredResult = validateSectionFeed(emptyExpired, { now: Date.parse("2026-03-01T00:00:00Z") });
  assert.equal(expiredResult.valid, true, "a once-current stored snapshot remains loadable after expiry so the response layer can mark it stale");

  const mixed = withCompleteToday([
    workItem(),
    workItem({
      id: "item:today:example-002",
      entityId: "entity:work:example-002",
      sourceRef: "record:opaque-002",
      freshness: "unknown",
      staleAfter: null,
      provenance: [{ sourceId: "source:approved-private-feed", recordId: "record:opaque-002", observedAt: WHEN, method: "direct" }]
    })
  ]);
  mixed.sections.today.freshness = "unknown";
  mixed.sections.today.staleAfter = null;
  assert.equal(validateSectionFeed(mixed).valid, true);
});

test("source URLs are host-allowlisted, query-free, and bound to the displayed open action", () => {
  const privateHost = withCompleteToday([workItem({
    sourceUrl: "https://127.0.0.1/private",
    actions: [{ type: "open_source", label: "Open source", href: "https://127.0.0.1/private" }]
  })]);
  privateHost.sections.today.allowedActions = ["open_source"];
  assert.ok(validateSectionFeed(privateHost).errors.some(error => error.path.endsWith("sourceUrl")));

  const query = withCompleteToday([workItem({
    sourceUrl: "https://drive.google.com/file/example?token=secret",
    actions: [{ type: "open_source", label: "Open source", href: "https://drive.google.com/file/example?token=secret" }]
  })]);
  query.sections.today.allowedActions = ["open_source"];
  assert.ok(validateSectionFeed(query).errors.some(error => error.path.endsWith("href") || error.path.endsWith("sourceUrl")));

  const airtableCapability = withCompleteToday([workItem({
    sourceUrl: "https://airtable.com/shrSecretCapability",
    actions: [{ type: "open_source", label: "Open source", href: "https://airtable.com/shrSecretCapability" }]
  })]);
  airtableCapability.sections.today.allowedActions = ["open_source"];
  assert.ok(validateSectionFeed(airtableCapability).errors.some(error => error.path.endsWith("href") || error.path.endsWith("sourceUrl")));

  const mismatch = withCompleteToday([workItem({
    sourceUrl: "https://drive.google.com/file/example",
    actions: [{ type: "open_source", label: "Open source", href: "https://docs.google.com/document/example" }]
  })]);
  mismatch.sections.today.allowedActions = ["open_source"];
  assert.ok(validateSectionFeed(mismatch).errors.some(error => error.path.endsWith("actions") && /exactly match/.test(error.message)));

  const deceptiveUrl = { toString: () => "https://drive.google.com/file/example" };
  const coerced = withCompleteToday([workItem({
    sourceUrl: deceptiveUrl,
    actions: [{ type: "open_source", label: "Open source", href: deceptiveUrl }]
  })]);
  coerced.sections.today.allowedActions = ["open_source"];
  assert.ok(validateSectionFeed(coerced).errors.some(error => error.path.endsWith("sourceUrl")));

  const misleading = withCompleteToday([workItem({
    actions: [{ type: "open_source", label: "Send now", href: "https://docs.google.com/document/example-001" }]
  })]);
  misleading.sections.today.allowedActions = ["open_source"];
  assert.ok(validateSectionFeed(misleading).errors.some(error => error.path.endsWith("label") && /must equal Open source/.test(error.message)));
});

test("typed identifiers, bounded inputs, and redacted parse errors resist unsafe data", () => {
  const feed = withCompleteToday([workItem({ tags: Array.from({ length: 21 }, (_, index) => `tag-${index}`) })]);
  feed.sources[0].id = "item:wrong-type";
  feed.sections.today.sourceIds = ["item:wrong-type"];
  feed.sections.today.items[0].provenance[0].sourceId = "item:wrong-type";
  const result = validateSectionFeed(feed);
  assert.ok(result.errors.some(error => error.path === "$.sources[0].id" && /source:/.test(error.message)));
  assert.ok(result.errors.some(error => error.path.endsWith("tags") && /at most/.test(error.message)));

  const undefinedSourceDate = withCompleteToday([workItem()]);
  undefinedSourceDate.sources[0].asOf = undefined;
  assert.ok(validateSectionFeed(undefinedSourceDate).errors.some(error => error.path === "$.sources[0].asOf"));

  assert.throws(
    () => parseSectionFeedJson('{"secret_marker":'),
    error => error.code === "UTAMPA_SECTION_FEED_JSON_INVALID" && !error.message.includes("secret_marker")
  );
  assert.throws(
    () => parseSectionFeedJson("x".repeat(5 * 1024 * 1024 + 1)),
    error => error.code === "UTAMPA_SECTION_FEED_JSON_TOO_LARGE"
  );
});

test("validators reject inherited feeds and sparse arrays instead of skipping records", () => {
  const valid = withCompleteToday([workItem()]);
  const inherited = Object.create(valid);
  assert.equal(validateSectionFeed(inherited).valid, false);
  assert.ok(validateSectionFeed(inherited).errors.some(error => error.path === "$"));

  const sparseSources = cloned(valid);
  sparseSources.sources = Array(1);
  const sourceResult = validateSectionFeed(sparseSources);
  assert.equal(sourceResult.valid, false);
  assert.ok(sourceResult.errors.some(error => error.path === "$.sources[0]" && /sparse/.test(error.message)));

  const sparseItems = cloned(valid);
  sparseItems.sections.today.items = Array(1);
  sparseItems.sections.today.completeness.receivedCount = 1;
  const itemResult = validateSectionFeed(sparseItems);
  assert.equal(itemResult.valid, false);
  assert.ok(itemResult.errors.some(error => error.path.endsWith("items[0]") && /sparse/.test(error.message)));

  assert.throws(
    () => buildSectionFeedFromRows(Array(1), { source: approvedSource(), generatedAt: WHEN }),
    error => error.code === "UTAMPA_SECTION_ROWS_INVALID" && /sparse/.test(error.message)
  );
});

test("required fields must be own properties even if Object.prototype is polluted", () => {
  const topLevel = withCompleteToday([workItem()]);
  delete topLevel.contractVersion;
  const nested = withCompleteToday([workItem()]);
  delete nested.sections.today.items[0].title;
  Object.defineProperty(Object.prototype, "contractVersion", { value: CONTRACT_VERSION, configurable: true });
  Object.defineProperty(Object.prototype, "title", { value: "Polluted title", configurable: true });
  try {
    const topResult = validateSectionFeed(topLevel);
    const nestedResult = validateSectionFeed(nested);
    assert.equal(topResult.valid, false);
    assert.ok(topResult.errors.some(error => error.path === "$.contractVersion" && /own property/.test(error.message)));
    assert.equal(nestedResult.valid, false);
    assert.ok(nestedResult.errors.some(error => error.path.endsWith("items[0].title") && /own property/.test(error.message)));
  } finally {
    delete Object.prototype.contractVersion;
    delete Object.prototype.title;
  }
});

test("explicit validation clocks propagate through constructors and row builds", () => {
  const earlierNow = Date.parse("2025-12-31T00:00:00Z");
  assert.throws(
    () => createUnconfiguredFeed({ generatedAt: WHEN, now: earlierNow }),
    error => error.code === "UTAMPA_SECTION_FEED_INVALID" && error.errors.some(item => item.path === "$.generatedAt")
  );
  assert.throws(
    () => normalizeSectionFeed(null, { generatedAt: WHEN, now: earlierNow }),
    error => error.code === "UTAMPA_SECTION_FEED_INVALID" && error.errors.some(item => item.path === "$.generatedAt")
  );
  assert.throws(
    () => buildSectionFeedFromRows([], {
      generatedAt: WHEN,
      now: earlierNow,
      source: approvedSource()
    }),
    error => error.code === "UTAMPA_SECTION_FEED_INVALID" && error.errors.some(item => item.path === "$.generatedAt")
  );
});

test("Airtable can be represented only as truthful read-only provenance", () => {
  const feed = withCompleteToday([workItem()]);
  feed.sources[0].kind = "airtable-readonly";
  assert.equal(validateSectionFeed(feed).valid, true);
  feed.sources[0].readOnly = false;
  assert.ok(validateSectionFeed(feed).errors.some(error => error.path.endsWith("readOnly") && /must be true/.test(error.message)));
});

test("the producer schema is valid JSON and names the same contract", () => {
  const schemaPath = path.join(ROOT, "schemas", "section-data-feed.v1.schema.json");
  const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
  assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.equal(schema.properties.contractVersion.const, CONTRACT_VERSION);
  assert.deepEqual(schema.properties.sections.required, SECTION_IDS);
  assert.equal(schema.$defs.source.properties.readOnly.const, true);
  assert.ok(schema.$defs.source.properties.kind.enum.includes("airtable-readonly"));
  assert.equal(schema.additionalProperties, false);
  assert.ok(schema.$defs.section.required.includes("staleAfter"));

  function assertStrictKeywordTypes(node, location = "$") {
    if (!node || typeof node !== "object" || Array.isArray(node)) return;
    if (Object.hasOwn(node, "properties") || Object.hasOwn(node, "required")) {
      assert.equal(node.type, "object", `${location} must declare type object for strict properties/required`);
    }
    if (Object.hasOwn(node, "items")) assert.equal(node.type, "array", `${location} must declare type array for strict items`);
    for (const [key, value] of Object.entries(node)) {
      if (value && typeof value === "object") {
        if (key === "properties" || key === "$defs") Object.entries(value).forEach(([name, entry]) => assertStrictKeywordTypes(entry, `${location}.${key}.${name}`));
        else if (Array.isArray(value)) value.forEach((entry, index) => assertStrictKeywordTypes(entry, `${location}.${key}[${index}]`));
        else assertStrictKeywordTypes(value, `${location}.${key}`);
      }
    }
  }
  assertStrictKeywordTypes(schema);
});
