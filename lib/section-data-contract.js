"use strict";

/*
 * Versioned, source-agnostic contract for the five native UTampa workspaces.
 *
 * This module deliberately has no network, filesystem, OAuth, or server-route
 * behavior. The protected server passes optional environment JSON through
 * parseSectionFeedJson(); a future remote loader can use the same boundary.
 */

const CONTRACT_VERSION = "utampa-section-feed.v1";
const DEFAULT_FEED_ID = "feed:utampa-sections";
const SECTION_IDS = Object.freeze(["today", "teaching", "research", "service", "people"]);
const COMPLETENESS_STATUSES = Object.freeze(["unconfigured", "complete", "partial", "unavailable"]);
const SOURCE_KINDS = Object.freeze([
  "private-json",
  "approved-export",
  "google-calendar",
  "google-drive-metadata",
  "airtable-readonly",
  "manual-reviewed"
]);
const PROVENANCE_METHODS = Object.freeze(["direct", "derived", "manual-reviewed"]);
const ITEM_STATUSES = Object.freeze(["open", "blocked", "scheduled", "done", "archived", "unknown"]);
const FRESHNESS_STATUSES = Object.freeze(["current", "stale", "unknown"]);
const ACTION_POLICY = Object.freeze({
  open_details: Object.freeze({ effect: "read-only", target: "local" }),
  open_source: Object.freeze({ effect: "read-only", target: "https" }),
  open_section: Object.freeze({ effect: "read-only", target: "section" }),
  prepare: Object.freeze({ effect: "local-only", target: "local" }),
  complete_local: Object.freeze({ effect: "browser-local", target: "local" }),
  dismiss_local: Object.freeze({ effect: "browser-local", target: "local" }),
  stage_route_local: Object.freeze({ effect: "browser-local", target: "local" })
});
const ACTION_LABELS = Object.freeze({
  open_details: "Open details",
  open_source: "Open source",
  open_section: "Open section",
  prepare: "Prepare locally",
  complete_local: "Complete locally",
  dismiss_local: "Dismiss locally",
  stage_route_local: "Stage route locally"
});
const ITEM_CATEGORIES = Object.freeze({
  today: Object.freeze(["task", "deadline", "decision", "event"]),
  teaching: Object.freeze(["course", "session", "material", "deadline", "task"]),
  research: Object.freeze(["project", "milestone", "deliverable", "deadline", "task"]),
  service: Object.freeze(["program", "commitment", "need", "win", "recruiting", "media-review", "task"]),
  people: Object.freeze(["person", "relationship", "handoff", "task"])
});
const ITEM_KINDS = ITEM_CATEGORIES;

const ALLOWED_SOURCE_FIELDS = new Set(["id", "label", "kind", "readOnly", "asOf"]);
const ALLOWED_FEED_FIELDS = new Set(["contractVersion", "feedId", "generatedAt", "sources", "sections"]);
const ALLOWED_SECTION_FIELDS = new Set(["id", "asOf", "freshness", "staleAfter", "completeness", "sourceIds", "allowedActions", "items"]);
const ALLOWED_COMPLETENESS_FIELDS = new Set(["status", "expectedCount", "receivedCount", "reason"]);
const ALLOWED_ITEM_FIELDS = new Set([
  "id", "entityId", "section", "category", "title", "summary", "status", "priority", "needsOwner",
  "asOf", "freshness", "staleAfter", "dueAt", "startAt", "endAt", "tags", "sourceRef", "sourceUrl",
  "provenance", "actions"
]);
const ALLOWED_PROVENANCE_FIELDS = new Set(["sourceId", "recordId", "observedAt", "method", "note"]);
const ALLOWED_ACTION_FIELDS = new Set(["type", "label", "href", "targetSection"]);
const SHEET_ROW_FIELDS = new Set([
  "id", "entityId", "section", "category", "title", "summary", "status", "priority", "needsOwner",
  "asOf", "freshness", "staleAfter", "dueAt", "startAt", "endAt", "tags", "sourceRef", "sourceUrl", "actions"
]);
const ALLOWED_SECTION_STATE_FIELDS = new Set(["status", "expectedCount", "reason", "asOf", "freshness", "staleAfter"]);

const STABLE_ID_PATTERN = /^[a-z][a-z0-9]*(?::[a-z0-9][a-z0-9._-]*)+$/;
const RFC3339_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|([+-])(\d{2}):(\d{2}))$/;
const MAX_SOURCES = 100;
const MAX_ITEMS_PER_SECTION = 1000;
const MAX_ACTIONS_PER_ITEM = 10;
const MAX_TAGS_PER_ITEM = 20;
const MAX_PROVENANCE_PER_ITEM = 10;
const MAX_JSON_BYTES = 5 * 1024 * 1024;
const MAX_VALIDATION_ERRORS = 100;
const MAX_ERROR_MESSAGE_LENGTH = 4000;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
const SAFE_SOURCE_HOSTS = new Set([
  "calendar.google.com",
  "docs.google.com",
  "drive.google.com"
]);

function isRecord(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isDenseArray(value) {
  if (!Array.isArray(value)) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) return false;
  }
  return true;
}

function isTimestamp(value) {
  if (typeof value !== "string") return false;
  const match = RFC3339_PATTERN.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = Number(match[8] || 0);
  const offsetMinute = Number(match[9] || 0);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year > 0 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1] &&
    hour <= 23 && minute <= 59 && second <= 59 && offsetHour <= 23 && offsetMinute <= 59 &&
    Number.isFinite(Date.parse(value));
}

function isStableId(value) {
  return typeof value === "string" && value.length <= 160 && STABLE_ID_PATTERN.test(value);
}

function isTypedId(value, type) {
  return isStableId(value) && value.startsWith(`${type}:`);
}

function textOk(value, maxLength) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength;
}

function isSafeHttpsUrl(value) {
  if (typeof value !== "string") return false;
  try {
    const target = new URL(value);
    if (target.protocol !== "https:" || target.username || target.password || target.port || target.search || target.hash) return false;
    const hostname = target.hostname.toLowerCase();
    return SAFE_SOURCE_HOSTS.has(hostname);
  } catch { return false; }
}

function pushError(errors, path, message) {
  if (errors.length >= MAX_VALIDATION_ERRORS) return;
  errors.push({ path: String(path).slice(0, 240), message: String(message).slice(0, 500) });
}

function validateAllowedFields(value, allowedFields, path, errors) {
  if (!isRecord(value)) return;
  const unexpectedCount = Object.keys(value).filter(field => !allowedFields.has(field)).length;
  if (unexpectedCount) pushError(errors, path, `contains ${unexpectedCount} non-allowlisted field${unexpectedCount === 1 ? "" : "s"}`);
}

function requireOwnFields(value, fields, path, errors) {
  fields.forEach(field => {
    if (!Object.hasOwn(value, field)) pushError(errors, `${path}.${field}`, "is required as an own property");
  });
}

function validateOptionalTimestamp(value, path, errors) {
  if (value !== undefined && value !== null && !isTimestamp(value)) {
    pushError(errors, path, "must be null or an RFC 3339 date-time");
  }
}

function validateUniqueStrings(values, path, errors, predicate, label) {
  if (!Array.isArray(values)) {
    pushError(errors, path, "must be an array");
    return [];
  }
  const seen = new Set();
  for (let index = 0; index < values.length; index += 1) {
    if (!Object.hasOwn(values, index)) {
      pushError(errors, `${path}[${index}]`, "must not be a sparse array hole");
      continue;
    }
    const value = values[index];
    if (!predicate(value)) pushError(errors, `${path}[${index}]`, `must be ${label}`);
    if (seen.has(value)) pushError(errors, `${path}[${index}]`, "must not be duplicated");
    seen.add(value);
  }
  return values;
}

function validateSource(source, index, errors, sourceIds) {
  const path = `$.sources[${index}]`;
  if (!isRecord(source)) {
    pushError(errors, path, "must be an object");
    return;
  }
  validateAllowedFields(source, ALLOWED_SOURCE_FIELDS, path, errors);
  requireOwnFields(source, ["id", "label", "kind", "readOnly", "asOf"], path, errors);
  if (!isTypedId(source.id, "source")) pushError(errors, `${path}.id`, "must be a stable source: namespaced ID");
  if (sourceIds.has(source.id)) pushError(errors, `${path}.id`, "must be unique across sources");
  sourceIds.add(source.id);
  if (!textOk(source.label, 160)) pushError(errors, `${path}.label`, "must be non-empty text of at most 160 characters");
  if (!SOURCE_KINDS.includes(source.kind)) pushError(errors, `${path}.kind`, `must be one of: ${SOURCE_KINDS.join(", ")}`);
  if (source.readOnly !== true) pushError(errors, `${path}.readOnly`, "must be true; this contract does not authorize writes");
  if (source.asOf !== null && !isTimestamp(source.asOf)) pushError(errors, `${path}.asOf`, "must be null or an RFC 3339 date-time");
}

function validateCompleteness(section, sectionPath, errors) {
  const completeness = section.completeness;
  if (!isRecord(completeness)) {
    pushError(errors, `${sectionPath}.completeness`, "must be an object");
    return;
  }
  validateAllowedFields(completeness, ALLOWED_COMPLETENESS_FIELDS, `${sectionPath}.completeness`, errors);
  requireOwnFields(completeness, ["status", "expectedCount", "receivedCount"], `${sectionPath}.completeness`, errors);
  const status = completeness.status;
  if (!COMPLETENESS_STATUSES.includes(status)) {
    pushError(errors, `${sectionPath}.completeness.status`, `must be one of: ${COMPLETENESS_STATUSES.join(", ")}`);
    return;
  }
  const expected = completeness.expectedCount;
  const received = completeness.receivedCount;
  const itemsLength = Array.isArray(section.items) ? section.items.length : 0;
  const expectedIsCount = Number.isInteger(expected) && expected >= 0;
  const receivedIsCount = Number.isInteger(received) && received >= 0;

  if (["unconfigured", "unavailable"].includes(status)) {
    if (expected !== null) pushError(errors, `${sectionPath}.completeness.expectedCount`, `must be null when status is ${status}`);
    if (received !== null) pushError(errors, `${sectionPath}.completeness.receivedCount`, `must be null when status is ${status}`);
    if (itemsLength !== 0) pushError(errors, `${sectionPath}.items`, `must be empty when status is ${status}`);
    if (section.asOf !== null) pushError(errors, `${sectionPath}.asOf`, `must be null when status is ${status}`);
    if (section.freshness !== "unknown") pushError(errors, `${sectionPath}.freshness`, `must be unknown when status is ${status}`);
    if (!Object.hasOwn(completeness, "reason") || !textOk(completeness.reason, 500)) pushError(errors, `${sectionPath}.completeness.reason`, `must explain the ${status} state`);
  } else {
    if (!receivedIsCount) pushError(errors, `${sectionPath}.completeness.receivedCount`, "must be a non-negative integer");
    else if (received !== itemsLength) pushError(errors, `${sectionPath}.completeness.receivedCount`, "must equal the number of supplied items");
    if (status === "complete" && !expectedIsCount) pushError(errors, `${sectionPath}.completeness.expectedCount`, "must be a non-negative integer when status is complete");
    if (status === "partial" && expected !== null && !expectedIsCount) pushError(errors, `${sectionPath}.completeness.expectedCount`, "must be null or a non-negative integer");
    if (!isTimestamp(section.asOf)) pushError(errors, `${sectionPath}.asOf`, "must be an RFC 3339 date-time for complete or partial data");
    if (!FRESHNESS_STATUSES.includes(section.freshness)) pushError(errors, `${sectionPath}.freshness`, `must be one of: ${FRESHNESS_STATUSES.join(", ")}`);
    if (!Array.isArray(section.sourceIds) || section.sourceIds.length === 0) pushError(errors, `${sectionPath}.sourceIds`, "must identify at least one source for complete or partial data");
    if (status === "complete" && expectedIsCount && receivedIsCount && expected !== received) {
      pushError(errors, `${sectionPath}.completeness.expectedCount`, "must equal receivedCount when status is complete");
    }
    if (status === "partial") {
      if (!Object.hasOwn(completeness, "reason") || !textOk(completeness.reason, 500)) pushError(errors, `${sectionPath}.completeness.reason`, "must explain why the data is partial");
      if (expectedIsCount && receivedIsCount && expected < received) {
        pushError(errors, `${sectionPath}.completeness.expectedCount`, "must not be less than receivedCount");
      }
    }
  }
}

function validateAction(action, index, itemPath, allowedActions, errors) {
  const path = `${itemPath}.actions[${index}]`;
  if (!isRecord(action)) {
    pushError(errors, path, "must be an object");
    return;
  }
  validateAllowedFields(action, ALLOWED_ACTION_FIELDS, path, errors);
  requireOwnFields(action, ["type", "label"], path, errors);
  if (!Object.hasOwn(ACTION_POLICY, action.type)) pushError(errors, `${path}.type`, "must be a supported non-destructive action");
  if (!allowedActions.has(action.type)) pushError(errors, `${path}.type`, "must be included in the section allowedActions list");
  if (!textOk(action.label, 80)) pushError(errors, `${path}.label`, "must be non-empty text of at most 80 characters");
  else if (ACTION_LABELS[action.type] && action.label !== ACTION_LABELS[action.type]) pushError(errors, `${path}.label`, `must equal ${ACTION_LABELS[action.type]} for ${action.type}`);

  if (action.type === "open_source") {
    if (!Object.hasOwn(action, "href") || !isSafeHttpsUrl(action.href)) {
      pushError(errors, `${path}.href`, "must be a credential-free HTTPS URL for open_source");
    }
  } else if (action.href !== undefined) {
    pushError(errors, `${path}.href`, "is only allowed for open_source");
  }

  if (action.type === "open_section") {
    if (!Object.hasOwn(action, "targetSection") || !SECTION_IDS.includes(action.targetSection)) pushError(errors, `${path}.targetSection`, "must name a supported section for open_section");
  } else if (action.targetSection !== undefined) {
    pushError(errors, `${path}.targetSection`, "is only allowed for open_section");
  }
}

function validateItem(item, index, sectionId, section, sourceIds, globalItemIds, errors) {
  const itemPath = `$.sections.${sectionId}.items[${index}]`;
  if (!isRecord(item)) {
    pushError(errors, itemPath, "must be an object");
    return;
  }
  validateAllowedFields(item, ALLOWED_ITEM_FIELDS, itemPath, errors);
  requireOwnFields(item, [
    "id", "section", "category", "title", "status", "priority", "needsOwner", "asOf", "freshness",
    "staleAfter", "sourceRef", "provenance", "actions"
  ], itemPath, errors);
  if (!isTypedId(item.id, "item")) pushError(errors, `${itemPath}.id`, "must be a stable item: namespaced ID");
  if (globalItemIds.has(item.id)) pushError(errors, `${itemPath}.id`, "must be unique across all sections");
  globalItemIds.add(item.id);
  if (item.section !== sectionId) pushError(errors, `${itemPath}.section`, `must equal ${sectionId}`);
  if (!ITEM_CATEGORIES[sectionId].includes(item.category)) pushError(errors, `${itemPath}.category`, `must be one of: ${ITEM_CATEGORIES[sectionId].join(", ")}`);
  if (!textOk(item.title, 160)) pushError(errors, `${itemPath}.title`, "must be non-empty text of at most 160 characters");
  if (item.summary !== undefined && item.summary !== null && !textOk(item.summary, 1000)) pushError(errors, `${itemPath}.summary`, "must be null or non-empty text of at most 1000 characters");
  if (!ITEM_STATUSES.includes(item.status)) pushError(errors, `${itemPath}.status`, `must be one of: ${ITEM_STATUSES.join(", ")}`);
  if (typeof item.needsOwner !== "boolean") pushError(errors, `${itemPath}.needsOwner`, "must be a boolean");
  if (!isTimestamp(item.asOf)) pushError(errors, `${itemPath}.asOf`, "must be an RFC 3339 date-time");
  if (!FRESHNESS_STATUSES.includes(item.freshness)) pushError(errors, `${itemPath}.freshness`, `must be one of: ${FRESHNESS_STATUSES.join(", ")}`);
  if (!Object.hasOwn(item, "staleAfter")) pushError(errors, `${itemPath}.staleAfter`, "is required; use null when freshness is unknown");
  validateOptionalTimestamp(item.staleAfter, `${itemPath}.staleAfter`, errors);
  if (["current", "stale"].includes(item.freshness) && !isTimestamp(item.staleAfter)) pushError(errors, `${itemPath}.staleAfter`, `must be an RFC 3339 date-time when freshness is ${item.freshness}`);
  if (item.freshness === "unknown" && item.staleAfter !== null) pushError(errors, `${itemPath}.staleAfter`, "must be null when freshness is unknown");
  validateOptionalTimestamp(item.dueAt, `${itemPath}.dueAt`, errors);
  validateOptionalTimestamp(item.startAt, `${itemPath}.startAt`, errors);
  validateOptionalTimestamp(item.endAt, `${itemPath}.endAt`, errors);
  if (isTimestamp(item.startAt) && isTimestamp(item.endAt) && Date.parse(item.endAt) < Date.parse(item.startAt)) {
    pushError(errors, `${itemPath}.endAt`, "must not be earlier than startAt");
  }
  if (item.entityId !== undefined && !isTypedId(item.entityId, "entity")) pushError(errors, `${itemPath}.entityId`, "must be a stable entity: namespaced ID when supplied");
  if (item.priority !== null && (!Number.isInteger(item.priority) || item.priority < 1 || item.priority > 5)) {
    pushError(errors, `${itemPath}.priority`, "must be null or an integer from 1 through 5");
  }
  if (!isTypedId(item.sourceRef, "record")) pushError(errors, `${itemPath}.sourceRef`, "must be an opaque stable record: namespaced ID");
  if (item.sourceUrl !== undefined && item.sourceUrl !== null && !isSafeHttpsUrl(item.sourceUrl)) {
    pushError(errors, `${itemPath}.sourceUrl`, "must be null or a credential-free HTTPS URL");
  }
  if (item.tags !== undefined) {
    validateUniqueStrings(item.tags, `${itemPath}.tags`, errors, value => textOk(value, 40), "non-empty text of at most 40 characters");
    if (Array.isArray(item.tags) && item.tags.length > MAX_TAGS_PER_ITEM) pushError(errors, `${itemPath}.tags`, `must contain at most ${MAX_TAGS_PER_ITEM} tags`);
  }

  if (!Array.isArray(item.provenance) || item.provenance.length === 0) {
    pushError(errors, `${itemPath}.provenance`, "must identify at least one provenance record");
  } else {
    if (item.provenance.length > MAX_PROVENANCE_PER_ITEM) pushError(errors, `${itemPath}.provenance`, `must contain at most ${MAX_PROVENANCE_PER_ITEM} records`);
    for (let provenanceIndex = 0; provenanceIndex < item.provenance.length; provenanceIndex += 1) {
      if (!Object.hasOwn(item.provenance, provenanceIndex)) {
        pushError(errors, `${itemPath}.provenance[${provenanceIndex}]`, "must not be a sparse array hole");
        continue;
      }
      const entry = item.provenance[provenanceIndex];
      const path = `${itemPath}.provenance[${provenanceIndex}]`;
      if (!isRecord(entry)) {
        pushError(errors, path, "must be an object");
        continue;
      }
      validateAllowedFields(entry, ALLOWED_PROVENANCE_FIELDS, path, errors);
      requireOwnFields(entry, ["sourceId", "recordId", "observedAt", "method"], path, errors);
      if (!sourceIds.has(entry.sourceId)) pushError(errors, `${path}.sourceId`, "must reference a declared source");
      if (!(Array.isArray(section.sourceIds) ? section.sourceIds : []).includes(entry.sourceId)) pushError(errors, `${path}.sourceId`, "must also appear in the section sourceIds list");
      if (!isTimestamp(entry.observedAt)) pushError(errors, `${path}.observedAt`, "must be an RFC 3339 date-time");
      if (!PROVENANCE_METHODS.includes(entry.method)) pushError(errors, `${path}.method`, `must be one of: ${PROVENANCE_METHODS.join(", ")}`);
      if (entry.method === "derived" && (!Object.hasOwn(entry, "note") || !textOk(entry.note, 500))) pushError(errors, `${path}.note`, "must explain a derived assertion");
      if (!isTypedId(entry.recordId, "record")) pushError(errors, `${path}.recordId`, "must be an opaque stable record: namespaced ID");
      if (entry.note !== undefined && entry.note !== null && !textOk(entry.note, 500)) pushError(errors, `${path}.note`, "must be null or non-empty text of at most 500 characters");
    }
    if (!item.provenance.some(entry => isRecord(entry) && entry.recordId === item.sourceRef)) {
      pushError(errors, `${itemPath}.sourceRef`, "must match a provenance recordId");
    }
  }

  if (!Array.isArray(item.actions)) {
    pushError(errors, `${itemPath}.actions`, "must be an array");
  } else {
    if (item.actions.length > MAX_ACTIONS_PER_ITEM) pushError(errors, `${itemPath}.actions`, `must contain at most ${MAX_ACTIONS_PER_ITEM} actions`);
    const actionTypes = new Set();
    for (let actionIndex = 0; actionIndex < item.actions.length; actionIndex += 1) {
      if (!Object.hasOwn(item.actions, actionIndex)) {
        pushError(errors, `${itemPath}.actions[${actionIndex}]`, "must not be a sparse array hole");
        continue;
      }
      const action = item.actions[actionIndex];
      validateAction(action, actionIndex, itemPath, new Set(Array.isArray(section.allowedActions) ? section.allowedActions : []), errors);
      if (isRecord(action) && actionTypes.has(action.type)) pushError(errors, `${itemPath}.actions[${actionIndex}].type`, "must not be duplicated on an item");
      if (isRecord(action)) actionTypes.add(action.type);
    }
    const sourceActions = item.actions.filter(action => isRecord(action) && action.type === "open_source");
    if (sourceActions.length && (!Object.hasOwn(item, "sourceUrl") || !isSafeHttpsUrl(item.sourceUrl))) {
      pushError(errors, `${itemPath}.sourceUrl`, "is required when open_source is allowed");
    } else if (sourceActions.some(action => action.href !== item.sourceUrl)) {
      pushError(errors, `${itemPath}.actions`, "open_source href must exactly match sourceUrl");
    }
  }
}

function validateSection(section, sectionId, sourceIds, globalItemIds, errors) {
  const sectionPath = `$.sections.${sectionId}`;
  if (!isRecord(section)) {
    pushError(errors, sectionPath, "must be an object");
    return;
  }
  validateAllowedFields(section, ALLOWED_SECTION_FIELDS, sectionPath, errors);
  requireOwnFields(section, ["id", "asOf", "freshness", "staleAfter", "completeness", "sourceIds", "allowedActions", "items"], sectionPath, errors);
  if (section.id !== sectionId) pushError(errors, `${sectionPath}.id`, `must equal ${sectionId}`);
  validateOptionalTimestamp(section.asOf, `${sectionPath}.asOf`, errors);
  if (!FRESHNESS_STATUSES.includes(section.freshness)) pushError(errors, `${sectionPath}.freshness`, `must be one of: ${FRESHNESS_STATUSES.join(", ")}`);
  if (!Object.hasOwn(section, "staleAfter")) pushError(errors, `${sectionPath}.staleAfter`, "is required; use null when freshness is unknown");
  validateOptionalTimestamp(section.staleAfter, `${sectionPath}.staleAfter`, errors);
  if (["current", "stale"].includes(section.freshness) && !isTimestamp(section.staleAfter)) pushError(errors, `${sectionPath}.staleAfter`, `must be an RFC 3339 date-time when freshness is ${section.freshness}`);
  if (section.freshness === "unknown" && section.staleAfter !== null) pushError(errors, `${sectionPath}.staleAfter`, "must be null when freshness is unknown");
  const sectionSourceIds = validateUniqueStrings(section.sourceIds, `${sectionPath}.sourceIds`, errors, value => isTypedId(value, "source"), "a stable source: namespaced ID");
  sectionSourceIds.forEach((sourceId, index) => {
    if (!sourceIds.has(sourceId)) pushError(errors, `${sectionPath}.sourceIds[${index}]`, "must reference a declared source");
  });
  validateUniqueStrings(section.allowedActions, `${sectionPath}.allowedActions`, errors, value => Object.hasOwn(ACTION_POLICY, value), "a supported non-destructive action");
  if (!Array.isArray(section.items)) {
    pushError(errors, `${sectionPath}.items`, "must be an array");
  } else {
    if (section.items.length > MAX_ITEMS_PER_SECTION) pushError(errors, `${sectionPath}.items`, `must contain at most ${MAX_ITEMS_PER_SECTION} items`);
    for (let index = 0; index < section.items.length; index += 1) {
      if (!Object.hasOwn(section.items, index)) pushError(errors, `${sectionPath}.items[${index}]`, "must not be a sparse array hole");
      else validateItem(section.items[index], index, sectionId, section, sourceIds, globalItemIds, errors);
    }
  }
  validateCompleteness(section, sectionPath, errors);
  if (section.completeness?.status === "unconfigured") {
    if (sectionSourceIds.length !== 0) pushError(errors, `${sectionPath}.sourceIds`, "must be empty when no source is configured");
    if (Array.isArray(section.allowedActions) && section.allowedActions.length !== 0) pushError(errors, `${sectionPath}.allowedActions`, "must be empty when no source is configured");
  }
  if (section.completeness?.status === "unavailable" && Array.isArray(section.allowedActions) && section.allowedActions.length !== 0) {
    pushError(errors, `${sectionPath}.allowedActions`, "must be empty while the source is unavailable");
  }
  if (section.completeness?.status === "unavailable" && sectionSourceIds.length === 0) {
    pushError(errors, `${sectionPath}.sourceIds`, "must identify an approved source while that source is unavailable");
  }
}

function validateTemporalConsistency(feed, errors, now) {
  if (!isTimestamp(feed.generatedAt)) return;
  const generatedAt = Date.parse(feed.generatedAt);
  if (generatedAt > now + MAX_CLOCK_SKEW_MS) pushError(errors, "$.generatedAt", "must not be in the future beyond five minutes of clock skew");
  const checkObserved = (value, path) => {
    if (isTimestamp(value) && Date.parse(value) > generatedAt) pushError(errors, path, "must not be later than generatedAt");
  };

  if (Array.isArray(feed.sources)) feed.sources.forEach((source, index) => {
    if (isRecord(source)) checkObserved(source.asOf, `$.sources[${index}].asOf`);
  });
  if (!isRecord(feed.sections)) return;
  SECTION_IDS.forEach(sectionId => {
    const section = feed.sections[sectionId];
    if (!isRecord(section)) return;
    checkObserved(section.asOf, `$.sections.${sectionId}.asOf`);
    if (isTimestamp(section.staleAfter) && isTimestamp(section.asOf) && Date.parse(section.staleAfter) < Date.parse(section.asOf)) {
      pushError(errors, `$.sections.${sectionId}.staleAfter`, "must not be earlier than asOf");
    }
    if (section.freshness === "stale" && isTimestamp(section.staleAfter) && now < Date.parse(section.staleAfter)) {
      pushError(errors, `$.sections.${sectionId}.freshness`, "cannot be stale before staleAfter at validation time");
    }
    if (!Array.isArray(section.items)) return;
    const validFreshness = section.items.filter(isRecord).map(item => item.freshness).filter(value => FRESHNESS_STATUSES.includes(value));
    if (section.items.length && validFreshness.length === section.items.length) {
      const expectedFreshness = derivedFreshness(section.items);
      if (section.freshness !== expectedFreshness) pushError(errors, `$.sections.${sectionId}.freshness`, `must equal item-derived freshness ${expectedFreshness}`);
      const expectedStaleAfter = ["current", "stale"].includes(expectedFreshness)
        ? section.items.map(item => item.staleAfter).filter(isTimestamp).sort((left, right) => Date.parse(left) - Date.parse(right))[0] || null
        : null;
      if (section.staleAfter !== expectedStaleAfter) pushError(errors, `$.sections.${sectionId}.staleAfter`, "must equal the earliest item staleAfter");
    }
    section.items.forEach((item, itemIndex) => {
      if (!isRecord(item)) return;
      const itemPath = `$.sections.${sectionId}.items[${itemIndex}]`;
      checkObserved(item.asOf, `${itemPath}.asOf`);
      if (Array.isArray(item.provenance)) item.provenance.forEach((entry, provenanceIndex) => {
        if (isRecord(entry)) checkObserved(entry.observedAt, `${itemPath}.provenance[${provenanceIndex}].observedAt`);
      });
      if (isTimestamp(item.staleAfter) && isTimestamp(item.asOf) && Date.parse(item.staleAfter) < Date.parse(item.asOf)) {
        pushError(errors, `${itemPath}.staleAfter`, "must not be earlier than asOf");
      }
      if (item.freshness === "stale" && isTimestamp(item.staleAfter) && now < Date.parse(item.staleAfter)) {
        pushError(errors, `${itemPath}.freshness`, "cannot be stale before staleAfter at validation time");
      }
      if (item.freshness === "unknown" && item.staleAfter !== undefined && item.staleAfter !== null) {
        pushError(errors, `${itemPath}.staleAfter`, "must be null or omitted when freshness is unknown");
      }
    });
  });
}

function validateSectionFeed(feed, options = {}) {
  const errors = [];
  if (!isRecord(feed)) return { valid: false, errors: [{ path: "$", message: "must be an object" }] };
  let serialized;
  try { serialized = JSON.stringify(feed); }
  catch { return { valid: false, errors: [{ path: "$", message: "must be acyclic JSON data" }] }; }
  if (Buffer.byteLength(serialized, "utf8") > MAX_JSON_BYTES) {
    return { valid: false, errors: [{ path: "$", message: `must not exceed ${MAX_JSON_BYTES} UTF-8 bytes` }] };
  }
  validateAllowedFields(feed, ALLOWED_FEED_FIELDS, "$", errors);
  requireOwnFields(feed, ["contractVersion", "feedId", "generatedAt", "sources", "sections"], "$", errors);
  if (feed.contractVersion !== CONTRACT_VERSION) pushError(errors, "$.contractVersion", `must equal ${CONTRACT_VERSION}`);
  if (!isTypedId(feed.feedId, "feed")) pushError(errors, "$.feedId", "must be a stable feed: namespaced ID");
  if (!isTimestamp(feed.generatedAt)) pushError(errors, "$.generatedAt", "must be an RFC 3339 date-time");

  const sourceIds = new Set();
  if (!Array.isArray(feed.sources)) {
    pushError(errors, "$.sources", "must be an array");
  } else {
    if (feed.sources.length > MAX_SOURCES) pushError(errors, "$.sources", `must contain at most ${MAX_SOURCES} sources`);
    for (let index = 0; index < feed.sources.length; index += 1) {
      if (!Object.hasOwn(feed.sources, index)) pushError(errors, `$.sources[${index}]`, "must not be a sparse array hole");
      else validateSource(feed.sources[index], index, errors, sourceIds);
    }
  }

  if (!isRecord(feed.sections)) {
    pushError(errors, "$.sections", "must be an object");
  } else {
    const unknownSections = Object.keys(feed.sections).filter(sectionId => !SECTION_IDS.includes(sectionId));
    if (unknownSections.length) pushError(errors, "$.sections", `contains ${unknownSections.length} unsupported section${unknownSections.length === 1 ? "" : "s"}`);
    const globalItemIds = new Set();
    SECTION_IDS.forEach(sectionId => {
      if (!Object.hasOwn(feed.sections, sectionId)) pushError(errors, `$.sections.${sectionId}`, "is required after normalization");
      else validateSection(feed.sections[sectionId], sectionId, sourceIds, globalItemIds, errors);
    });
  }
  const validationNow = options.now === undefined ? Date.now() : Number(options.now);
  validateTemporalConsistency(feed, errors, Number.isFinite(validationNow) ? validationNow : Date.now());
  return { valid: errors.length === 0, errors };
}

function assertValidSectionFeed(feed, options = {}) {
  const result = validateSectionFeed(feed, options);
  if (!result.valid) {
    const details = result.errors.map(error => `${error.path}: ${error.message}`).join("; ");
    const message = details.length > MAX_ERROR_MESSAGE_LENGTH ? `${details.slice(0, MAX_ERROR_MESSAGE_LENGTH)}…` : details;
    const validationError = new TypeError(`Invalid UTampa section feed: ${message}`);
    validationError.code = "UTAMPA_SECTION_FEED_INVALID";
    validationError.errors = result.errors;
    throw validationError;
  }
  return feed;
}

function unconfiguredSection(sectionId, reason) {
  return {
    id: sectionId,
    asOf: null,
    freshness: "unknown",
    staleAfter: null,
    completeness: {
      status: "unconfigured",
      expectedCount: null,
      receivedCount: null,
      reason
    },
    sourceIds: [],
    allowedActions: [],
    items: []
  };
}

function createUnconfiguredFeed(options = {}) {
  const generatedAt = options.generatedAt === undefined ? new Date().toISOString() : options.generatedAt;
  const reason = options.reason === undefined ? "No approved private source is configured for this section." : options.reason;
  const sections = Object.fromEntries(SECTION_IDS.map(sectionId => [sectionId, unconfiguredSection(sectionId, reason)]));
  return assertValidSectionFeed({
    contractVersion: CONTRACT_VERSION,
    feedId: options.feedId === undefined ? DEFAULT_FEED_ID : options.feedId,
    generatedAt,
    sources: [],
    sections
  }, { now: options.now });
}

function createUnavailableFeed(options = {}) {
  const generatedAt = options.generatedAt === undefined ? new Date().toISOString() : options.generatedAt;
  const reason = options.reason === undefined ? "The approved private source is currently unavailable." : options.reason;
  const sources = options.sources === undefined ? [] : cloneJson(options.sources);
  if (!Array.isArray(sources) || sources.length === 0) {
    const sourceError = new TypeError("An approved source descriptor is required for an unavailable feed");
    sourceError.code = "UTAMPA_SECTION_SOURCE_REQUIRED";
    throw sourceError;
  }
  const sourceIds = Array.isArray(sources) ? sources.map(source => source?.id) : [];
  const sections = Object.fromEntries(SECTION_IDS.map(sectionId => [sectionId, {
    id: sectionId,
    asOf: null,
    freshness: "unknown",
    staleAfter: null,
    completeness: {
      status: "unavailable",
      expectedCount: null,
      receivedCount: null,
      reason
    },
    sourceIds,
    allowedActions: [],
    items: []
  }]));
  return assertValidSectionFeed({
    contractVersion: CONTRACT_VERSION,
    feedId: options.feedId === undefined ? DEFAULT_FEED_ID : options.feedId,
    generatedAt,
    sources,
    sections
  }, { now: options.now });
}

function cloneJson(value) {
  try { return JSON.parse(JSON.stringify(value)); }
  catch { throw new TypeError("UTampa section feed must be JSON-serializable"); }
}

/*
 * Missing legacy sections are materialized as unconfigured, never as an
 * inferred complete empty result. Existing values are otherwise validated
 * rather than silently repaired.
 */
function normalizeSectionFeed(input, options = {}) {
  if (input === undefined || input === null || input === "") return createUnconfiguredFeed(options);
  if (!isRecord(input)) throw new TypeError("UTampa section feed must be an object");
  const normalized = cloneJson(input);
  if (normalized.contractVersion === undefined) normalized.contractVersion = CONTRACT_VERSION;
  if (normalized.feedId === undefined) normalized.feedId = options.feedId === undefined ? DEFAULT_FEED_ID : options.feedId;
  if (normalized.generatedAt === undefined) normalized.generatedAt = options.generatedAt === undefined ? new Date().toISOString() : options.generatedAt;
  normalized.sources = normalized.sources === undefined ? [] : normalized.sources;
  if (normalized.sections === undefined) normalized.sections = {};
  const reason = options.reason === undefined ? "No approved private source is configured for this section." : options.reason;
  if (isRecord(normalized.sections)) SECTION_IDS.forEach(sectionId => {
    if (!Object.hasOwn(normalized.sections, sectionId)) normalized.sections[sectionId] = unconfiguredSection(sectionId, reason);
  });
  return assertValidSectionFeed(normalized, { now: options.now });
}

function parseSectionFeedJson(value, options = {}) {
  if (value === undefined || value === null || String(value).trim() === "") return createUnconfiguredFeed(options);
  const raw = String(value);
  if (Buffer.byteLength(raw, "utf8") > MAX_JSON_BYTES) {
    const sizeError = new TypeError("UTampa section feed JSON exceeds the maximum size");
    sizeError.code = "UTAMPA_SECTION_FEED_JSON_TOO_LARGE";
    throw sizeError;
  }
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch {
    const parseError = new TypeError("Invalid UTampa section feed JSON");
    parseError.code = "UTAMPA_SECTION_FEED_JSON_INVALID";
    throw parseError;
  }
  if (!isRecord(parsed)) {
    const shapeError = new TypeError("Invalid UTampa section feed: $ must be an object");
    shapeError.code = "UTAMPA_SECTION_FEED_INVALID";
    shapeError.errors = [{ path: "$", message: "must be an object" }];
    throw shapeError;
  }
  return assertValidSectionFeed(parsed, { now: options.now });
}

function rowsError(message) {
  const error = new TypeError(message);
  error.code = "UTAMPA_SECTION_ROWS_INVALID";
  return error;
}

function latestTimestamp(items) {
  return items.reduce((latest, item) => !latest || Date.parse(item.asOf) > Date.parse(latest) ? item.asOf : latest, null);
}

function derivedFreshness(items) {
  if (items.some(item => item.freshness === "stale")) return "stale";
  if (items.length && items.every(item => item.freshness === "current")) return "current";
  return "unknown";
}

/*
 * Convert sanitized Google Sheet/export rows into the section contract. The
 * row allowlist is intentionally closed so an unexpected sheet column cannot
 * silently enter the browser response. An explicit sectionStates assertion is
 * needed to call a section complete; populated sections without one are
 * labelled partial.
 */
function buildSectionFeedFromRows(rows, options = {}) {
  if (!Array.isArray(rows)) throw rowsError("UTampa section rows must be an array");
  if (!isDenseArray(rows)) throw rowsError("UTampa section rows must not contain sparse array holes");
  if (!isRecord(options.source)) throw rowsError("An approved read-only source descriptor is required for section rows");
  const source = cloneJson(options.source);
  const generatedAt = options.generatedAt === undefined ? new Date().toISOString() : options.generatedAt;
  if (options.sectionStates !== undefined && !isRecord(options.sectionStates)) throw rowsError("sectionStates must be an object");
  const sectionStates = options.sectionStates || {};
  const unknownSectionStates = Object.keys(sectionStates).filter(sectionId => !SECTION_IDS.includes(sectionId));
  if (unknownSectionStates.length) throw rowsError("sectionStates contains unsupported sections");
  const grouped = Object.fromEntries(SECTION_IDS.map(sectionId => [sectionId, []]));

  rows.forEach((row, index) => {
    if (!isRecord(row)) throw rowsError(`UTampa section row ${index + 1} must be an object`);
    const unknown = Object.keys(row).filter(field => !SHEET_ROW_FIELDS.has(field));
    if (unknown.length) throw rowsError(`UTampa section row ${index + 1} contains non-allowlisted fields`);
    if (!SECTION_IDS.includes(row.section)) throw rowsError(`UTampa section row ${index + 1} has an unsupported section`);
    const item = cloneJson(row);
    item.provenance = [{
      sourceId: source.id,
      recordId: item.sourceRef,
      observedAt: item.asOf,
      method: "direct"
    }];
    item.actions = item.actions === undefined ? [] : item.actions;
    grouped[row.section].push(item);
  });

  const sections = {};
  for (const sectionId of SECTION_IDS) {
    const items = grouped[sectionId];
    const assertion = sectionStates[sectionId];
    if (assertion !== undefined && !isRecord(assertion)) throw rowsError(`sectionStates.${sectionId} must be an object`);
    if (assertion !== undefined) {
      const unknown = Object.keys(assertion).filter(field => !ALLOWED_SECTION_STATE_FIELDS.has(field));
      if (unknown.length) throw rowsError(`sectionStates.${sectionId} contains non-allowlisted fields`);
    }
    if (!items.length && assertion === undefined) {
      sections[sectionId] = unconfiguredSection(sectionId, "No approved private source is configured for this section.");
      continue;
    }

    const status = assertion?.status === undefined ? "partial" : assertion.status;
    if (["unconfigured", "unavailable"].includes(status)) {
      sections[sectionId] = {
        id: sectionId,
        asOf: null,
        freshness: "unknown",
        staleAfter: null,
        completeness: {
          status,
          expectedCount: null,
          receivedCount: null,
          reason: assertion?.reason === undefined ? (status === "unavailable" ? "The approved source is currently unavailable." : "No approved private source is configured for this section.") : assertion.reason
        },
        sourceIds: status === "unavailable" ? [source.id] : [],
        allowedActions: [],
        items
      };
      continue;
    }

    const allowedActions = [...new Set(items.flatMap(item => Array.isArray(item.actions) ? item.actions.map(action => action?.type) : []))];
    const receivedCount = items.length;
    const freshness = assertion?.freshness === undefined ? derivedFreshness(items) : assertion.freshness;
    const itemStaleAfter = items
      .map(item => item.staleAfter)
      .filter(isTimestamp)
      .sort((left, right) => Date.parse(left) - Date.parse(right))[0] || null;
    sections[sectionId] = {
      id: sectionId,
      asOf: assertion?.asOf === undefined ? latestTimestamp(items) : assertion.asOf,
      freshness,
      staleAfter: assertion?.staleAfter === undefined ? (["current", "stale"].includes(freshness) ? itemStaleAfter : null) : assertion.staleAfter,
      completeness: {
        status,
        expectedCount: assertion?.expectedCount === undefined ? (status === "complete" ? receivedCount : null) : assertion.expectedCount,
        receivedCount,
        ...(status === "partial" ? { reason: assertion?.reason === undefined ? "Rows were supplied without an explicit complete-source assertion." : assertion.reason } : {})
      },
      sourceIds: [source.id],
      allowedActions,
      items
    };
  }

  return assertValidSectionFeed({
    contractVersion: CONTRACT_VERSION,
    feedId: options.feedId === undefined ? DEFAULT_FEED_ID : options.feedId,
    generatedAt,
    sources: [source],
    sections
  }, { now: options.now });
}

function parseSectionRowsJson(value, options = {}) {
  if (value === undefined || value === null || String(value).trim() === "") return createUnconfiguredFeed(options);
  const raw = String(value);
  if (Buffer.byteLength(raw, "utf8") > MAX_JSON_BYTES) {
    const sizeError = new TypeError("UTampa section rows JSON exceeds the maximum size");
    sizeError.code = "UTAMPA_SECTION_ROWS_JSON_TOO_LARGE";
    throw sizeError;
  }
  let rows;
  try { rows = JSON.parse(raw); }
  catch {
    const parseError = new TypeError("Invalid UTampa section rows JSON");
    parseError.code = "UTAMPA_SECTION_ROWS_JSON_INVALID";
    throw parseError;
  }
  if (!Array.isArray(rows)) throw rowsError("UTampa section rows must be an array");
  return buildSectionFeedFromRows(rows, options);
}

module.exports = {
  ACTION_LABELS,
  ACTION_POLICY,
  COMPLETENESS_STATUSES,
  CONTRACT_VERSION,
  FRESHNESS_STATUSES,
  ITEM_CATEGORIES,
  ITEM_KINDS,
  ITEM_STATUSES,
  ITEM_STATES: ITEM_STATUSES,
  PROVENANCE_METHODS,
  SECTION_IDS,
  SOURCE_KINDS,
  assertValidSectionFeed,
  buildSectionFeedFromRows,
  createUnconfiguredFeed,
  createUnavailableFeed,
  normalizeSectionFeed,
  parseSectionFeedJson,
  parseSectionRowsJson,
  validateSectionFeed
};
