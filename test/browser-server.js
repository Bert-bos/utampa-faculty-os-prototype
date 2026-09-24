"use strict";

if (process.env.NODE_ENV !== "test") throw new Error("The browser evidence server runs only with NODE_ENV=test");

const { createApp, createSyntheticOAuthProvider } = require("../server");
const { buildSectionFeedFromRows } = require("../lib/section-data-contract");

function configuredSectionFeedJson() {
  if (process.env.UTAMPA_BROWSER_SECTION_FIXTURE !== "connected") return undefined;
  const generatedAt = new Date().toISOString();
  const staleAfter = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  return JSON.stringify(buildSectionFeedFromRows([{
    id: "item:today:real-route-fixture",
    entityId: "entity:work:real-route-fixture",
    section: "today",
    category: "task",
    title: "Configured server route item",
    summary: "Synthetic configured-feed browser evidence.",
    status: "open",
    priority: 1,
    needsOwner: true,
    asOf: generatedAt,
    freshness: "current",
    staleAfter,
    dueAt: null,
    startAt: null,
    endAt: null,
    tags: ["synthetic-evidence"],
    sourceRef: "record:real-route-fixture",
    actions: [{ type: "open_details", label: "Open details" }]
  }], {
    feedId: "feed:browser-real-route",
    generatedAt,
    now: Date.now(),
    source: { id: "source:browser-real-route", label: "Synthetic browser evidence source", kind: "approved-export", readOnly: true, asOf: generatedAt },
    sectionStates: { today: { status: "complete", expectedCount: 1, asOf: generatedAt, freshness: "current", staleAfter } }
  }));
}

const port = Number(process.env.PORT || 4175);
createApp({
  oauth: createSyntheticOAuthProvider(process.env.UTAMPA_ALLOWED_EMAIL),
  secureCookies: false,
  sectionFeedJson: configuredSectionFeedJson()
}).listen(port, "127.0.0.1", () => console.log(`Synthetic browser evidence server listening on ${port}`));
