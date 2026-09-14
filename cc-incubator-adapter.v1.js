/* cc-incubator-adapter.v1.js
   Claude lane -- Service / Spartan Incubator data adapter (UTAMPA-NEXT-01).

   Purpose: populate the existing Service column on the Today page with
   incubator data from a single fetchable JSON source, without touching the
   compiled dashboard bundle. Follows the same pattern as
   cc-shell-shim.v1.js / cc-workspace-switcher.v2.js already shipped in
   this repo: additive, idempotent, no build step, safe to load twice.

   CANONICAL-DATA BOUNDARY:
   This file only knows how to render the shape documented in
   docs/SPARTAN-INCUBATOR-ADAPTER-CONTRACT.md. Today DATA_SOURCE_URL points
   at the synthetic fixture. Swapping to the canonical UTampa/Drive weekly
   check-in export means changing DATA_SOURCE_URL below (and, if needed,
   adding a mapping step before render runs) -- nothing else in this file
   should need to change.
   Review/demo path: synthetic fixture data only. No real student, founder,
   or FERPA data may be placed at DATA_SOURCE_URL until BOS explicitly
   approves that change.

   NO-FABRICATED-ZERO BOUNDARY (UTAMPA-NEXT-02B):
   An absent or non-array collection is UNKNOWN, not zero. renderSummary()
   below must never coerce a missing/malformed collection to [] before
   counting it -- that coercion is what let count 0 render for data the
   source never provided. Only a collection that is actually present as an
   array (including a present empty array) may report a numeric count.
*/
(function () {
  "use strict";

  if (window.__ccIncubatorAdapterV1) return;

  var DATA_SOURCE_URL = "/data/spartan-incubator.fixture.json";
  var DEFAULT_STALE_HOURS = 168;

  function formatCount(n) {
    return (n === null || n === undefined) ? "no data" : String(n);
  }

  function isStale(meta) {
    if (!meta || !meta.fetchedAt) return true;
    var hours = meta.staleThresholdHours || DEFAULT_STALE_HOURS;
    var thresholdMs = hours * 60 * 60 * 1000;
    var fetched = Date.parse(meta.fetchedAt);
    if (isNaN(fetched)) return true;
    return (Date.now() - fetched) > thresholdMs;
  }

  function findServiceColumn() {
    var cols = document.querySelectorAll(".workcol");
    var found = null;
    Array.prototype.forEach.call(cols, function (col) {
      if (found) return;
      var heading = col.querySelector(".colhead h2");
      var label = heading ? (heading.textContent || "").trim() : "";
      if (/^service$/i.test(label)) found = col;
    });
    return found;
  }

  function removeExisting(col, className) {
    var node = col.querySelector("." + className);
    if (node) node.parentNode.removeChild(node);
  }

  function renderMeta(col, data) {
    removeExisting(col, "ccIncubatorMeta");

    var meta = (data && data.meta) || {};
    var stale = isStale(meta);
    var wrap = document.createElement("div");
    wrap.className = stale ? "ccIncubatorMeta ccIncubatorStale" : "ccIncubatorMeta";
    wrap.style.cssText = "margin-top:8px;font-size:12px;opacity:0.8;";

    var sourceLabel = meta.sourceLabel || meta.source || "Unknown source";
    var freshnessText = stale
      ? "Data may be out of date (source: " + sourceLabel + ")"
      : "Source: " + sourceLabel;
    wrap.appendChild(document.createTextNode(freshnessText));

    var runMode = data && data.runMode;
    if (runMode && runMode.isWednesdaySummaryActive) {
      var banner = document.createElement("div");
      banner.className = "ccIncubatorRunMode";
      banner.style.cssText = "margin-top:4px;font-weight:600;";
      banner.appendChild(document.createTextNode(
        "Wednesday run-mode: " + (runMode.summary || "No summary available.")
      ));
      wrap.appendChild(banner);
    }

    col.appendChild(wrap);
  }

  function buildReviewPanelId(label) {
    return "ccIncubatorReview-" + label.replace(/[^a-z0-9]+/gi, "-");
  }

  function renderMediaFlags(col, data) {
    var allFlags = (data && data.mediaFlags) || [];
    var reviewable = allFlags.filter(function (flag) {
      return flag && flag.reviewRequired;
    });
    removeExisting(col, "ccIncubatorMediaFlags");
    if (!reviewable.length) return;

    var wrap = document.createElement("div");
    wrap.className = "ccIncubatorMediaFlags";
    wrap.style.cssText = "margin-top:8px;";

    reviewable.forEach(function (flag) {
      var chip = document.createElement("button");
      chip.type = "button";
      chip.className = "ccIncubatorMediaChip";
      chip.style.cssText = "font-size:12px;padding:4px 8px;border-radius:999px;" +
        "border:1px solid currentColor;background:transparent;cursor:pointer;margin-right:6px;";
      chip.appendChild(document.createTextNode(
        "Press/founder-story review: " + flag.type + " -- " + flag.relatedTo
      ));
      chip.setAttribute("aria-expanded", "false");
      var panelId = buildReviewPanelId(flag.relatedTo);

      chip.addEventListener("click", function () {
        var isOpen = chip.getAttribute("aria-expanded") === "true";
        var panel = document.getElementById(panelId);
        if (isOpen) {
          if (panel) panel.parentNode.removeChild(panel);
          chip.setAttribute("aria-expanded", "false");
          return;
        }
        if (panel) return;
        panel = document.createElement("div");
        panel.id = panelId;
        panel.style.cssText = "margin-top:6px;padding:8px;border:1px solid currentColor;" +
          "border-radius:8px;font-size:12px;";
        panel.appendChild(document.createTextNode(
          "Status: " + (flag.status || "unknown") + " -- Deadline: " + (flag.deadline || "none set")
        ));
        chip.insertAdjacentElement("afterend", panel);
        chip.setAttribute("aria-expanded", "true");
      });

      wrap.appendChild(chip);
    });

    col.appendChild(wrap);
  }

  function renderMissing(col) {
    removeExisting(col, "ccIncubatorMeta");
    removeExisting(col, "ccIncubatorSummary");
    removeExisting(col, "ccIncubatorMediaFlags");
    var wrap = document.createElement("div");
    wrap.className = "ccIncubatorMeta ccIncubatorMissing";
    wrap.style.cssText = "margin-top:8px;font-size:12px;opacity:0.8;";
    wrap.appendChild(document.createTextNode("No incubator data available yet."));
    col.appendChild(wrap);
  }

  function renderSummary(col, data) {
    removeExisting(col, "ccIncubatorSummary");

    var rawSubmissions = data.weeklySubmissions;
    var submissionsIsArray = Array.isArray(rawSubmissions);
    var submissionsCount = submissionsIsArray ? rawSubmissions.length : null;
    var missingSubmissions = submissionsIsArray ? rawSubmissions.filter(function (s) {
      return !s || s.status === "missing";
    }).length : 0;

    var rawCommitments = data.commitments;
    var commitmentsCount = Array.isArray(rawCommitments) ? rawCommitments.length : null;

    var rawWins = data.wins;
    var winsCount = Array.isArray(rawWins) ? rawWins.length : null;

    var rawNeeds = data.needs;
    var needsCount = Array.isArray(rawNeeds) ? rawNeeds.length : null;

    var rawRecruiting = data.recruiting;
    var recruitingIsArray = Array.isArray(rawRecruiting);
    var recruitingCount = recruitingIsArray ? rawRecruiting.length : null;
    var verifiedRecruitingCount = recruitingIsArray ? rawRecruiting.filter(function (r) {
      return r && r.verified;
    }).length : null;

    var stats = [
      "Submissions: " + formatCount(submissionsCount) +
        (submissionsIsArray && missingSubmissions ? " (" + missingSubmissions + " missing)" : ""),
      "Commitments outstanding: " + formatCount(commitmentsCount),
      "Wins: " + formatCount(winsCount),
      "Needs/blockers: " + formatCount(needsCount),
      "Recruiting verified: " + (recruitingIsArray
        ? (formatCount(verifiedRecruitingCount) + "/" + formatCount(recruitingCount))
        : "no data")
    ];

    var wrap = document.createElement("div");
    wrap.className = "ccIncubatorSummary";
    wrap.style.cssText = "margin-top:8px;font-size:12px;display:flex;flex-wrap:wrap;gap:10px;";
    stats.forEach(function (text) {
      var span = document.createElement("span");
      span.appendChild(document.createTextNode(text));
      wrap.appendChild(span);
    });

    col.appendChild(wrap);
  }

  function render(data) {
    var col = findServiceColumn();
    if (!col) return;
    if (!data) {
      renderMissing(col);
      return;
    }
    renderMeta(col, data);
    renderSummary(col, data);
    renderMediaFlags(col, data);
  }

  function boot() {
    fetch(DATA_SOURCE_URL, { credentials: "same-origin" })
      .then(function (res) {
        if (!res.ok) throw new Error("fetch failed: " + res.status);
        return res.json();
      })
      .then(function (data) { render(data); })
      .catch(function (err) {
        console.warn("[cc-incubator-adapter v1] falling back to missing-data state:", err);
        render(null);
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }

  window.__ccIncubatorAdapterV1 = {
    version: 1,
    formatCount: formatCount,
    isStale: isStale,
    render: render
  };
})();
