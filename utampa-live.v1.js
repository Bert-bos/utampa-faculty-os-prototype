(function () {
  "use strict";
  if (window.__utampaLiveInitialized) return;
  window.__utampaLiveInitialized = true;
  var STORAGE_KEY = "utampa-faculty-os-actions-v1";
  var SECTION_ACTION_STORAGE_KEY = "utampa-section-actions-v1";
  try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
  var sectionActionState = readSectionActionState();
  var sectionCache = {};
  var sectionLoadGeneration = {};
  var sectionPayloadTiming = new WeakMap();
  var sectionRequestId = 0;
  var sectionFreshnessTimer = null;
  var sessionAuthRequired = false;
  var activeNativeShade = null;
  var lastNativeTrigger = null;
  var headerCalendarResult = null;
  var headerCalendarError = false;
  var headerCountdownTimer = null;
  var headerRefreshTimer = null;
  var headerCalendarRequestId = 0;
  var activePageTimer = null;
  var observerWorkTimer = null;

  function isTypedSectionActionId(value, prefix) {
    return typeof value === "string" && value.length <= 160 && new RegExp("^" + prefix + "(?::[a-z0-9][a-z0-9._-]*)+$").test(value);
  }
  function readSectionActionState() {
    try {
      var stored = localStorage.getItem(SECTION_ACTION_STORAGE_KEY);
      var parsed = JSON.parse(stored || "{}");
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) { localStorage.removeItem(SECTION_ACTION_STORAGE_KEY); return {}; }
      var clean = {};
      Object.keys(parsed).slice(0, 500).forEach(function (key) {
        var record = parsed[key];
        if (!record || typeof record !== "object" || !isTypedSectionActionId(record.feedId, "feed") || !isTypedSectionActionId(record.itemId, "item")) return;
        if (!/^(complete_local|dismiss_local|stage_route_local)$/.test(record.actionType || "")) return;
        if (key !== record.feedId + "|" + record.itemId || !/^(today|teaching|research|service|people)$/.test(record.section || "")) return;
        var target = record.target === undefined ? "" : record.target;
        if (typeof target !== "string") return;
        if (record.actionType === "stage_route_local" ? !/^(BOS|UTampa|Entrepreneurship Professor)$/.test(target) : target !== "") return;
        if (typeof record.updatedAt !== "string" || record.updatedAt.length > 40 || !Number.isFinite(Date.parse(record.updatedAt))) return;
        clean[key.slice(0, 360)] = {
          feedId: record.feedId.slice(0, 160), itemId: record.itemId.slice(0, 160),
          section: record.section,
          actionType: record.actionType,
          target: target,
          updatedAt: record.updatedAt
        };
      });
      var sanitized = JSON.stringify(clean);
      if (stored !== null && sanitized !== stored) localStorage.setItem(SECTION_ACTION_STORAGE_KEY, sanitized);
      return clean;
    } catch (_) { try { localStorage.removeItem(SECTION_ACTION_STORAGE_KEY); } catch (_) {} return {}; }
  }
  function writeSectionActionState() {
    try { localStorage.setItem(SECTION_ACTION_STORAGE_KEY, JSON.stringify(sectionActionState)); return true; }
    catch (_) { return false; }
  }
  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (character) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[character];
    });
  }
  function formatDate(value, includeDate) {
    if (!value) return "Time unavailable";
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Time unavailable";
    return new Intl.DateTimeFormat(undefined, includeDate
      ? { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }
      : { hour: "numeric", minute: "2-digit" }).format(date);
  }
  function formatEventTime(event) {
    if (!event || !event.start) return "Time unavailable";
    var allDayParts = event.allDay && /^(\d{4})-(\d{2})-(\d{2})$/.exec(event.start);
    var date = allDayParts ? new Date(Number(allDayParts[1]), Number(allDayParts[2]) - 1, Number(allDayParts[3])) : new Date(event.start);
    if (Number.isNaN(date.getTime())) return "Time unavailable";
    if (event.allDay) return "All day · " + new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" }).format(date);
    return formatDate(event.start, true);
  }
  function tabPage(tab) {
    var label = Array.prototype.find.call(tab.childNodes, function (node) { return node.nodeType === 3 && node.textContent.trim(); });
    return label ? label.textContent.trim() : tab.textContent.replace(/[0-9]/g, "").replace(/^[^A-Za-z]+/, "").trim();
  }
  async function requestJson(path) {
    var response = await fetch(path, { credentials: "same-origin", headers: { Accept: "application/json" } });
    var body = await response.json().catch(function () { return {}; });
    if (response.status === 401) { renderSessionEnded(); return { authRequired: true }; }
    if (response.status === 409 && body.error === "reauthorization_required") return { reauthorize: true };
    if (!response.ok) throw new Error(body.error || "Request failed");
    return body;
  }
  function reconnectMarkup() {
    return '<div class="ut-empty" role="status" aria-live="polite" aria-atomic="true"><h3>Reconnect Google to finish setup</h3><p>Your current Google authorization is unavailable or does not include the required Calendar and Drive read-only access.</p><a class="ut-primary" href="/auth/google?next=' + encodeURIComponent(location.pathname + location.search) + '">Reconnect Google</a></div>';
  }
  function signInMarkup() {
    return '<div class="ut-empty" role="status" aria-live="polite" aria-atomic="true"><h3>Sign in again</h3><p>Your private dashboard session has ended.</p><a class="ut-primary" href="/login?next=' + encodeURIComponent(location.pathname + location.search) + '">Open My Work Login</a></div>';
  }
  function focusableElements(container) {
    return Array.prototype.filter.call(container.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'), function (node) {
      return !node.hidden && node.getAttribute("aria-hidden") !== "true";
    });
  }
  function inertSiblings(shade) {
    var records = [];
    var current = shade;
    while (current && current !== document.body) {
      var parent = current.parentElement;
      if (!parent) break;
      Array.prototype.forEach.call(parent.children, function (node) {
        if (node === current) return;
        records.push({ node: node, inert: Boolean(node.inert) });
        node.inert = true;
      });
      current = parent;
    }
    shade._utInerted = records;
  }
  function restoreInert(shade) {
    (shade && shade._utInerted || []).forEach(function (record) { if (record.node.isConnected) record.node.inert = record.inert; });
    if (shade) shade._utInerted = [];
  }
  function closeDrawer(restoreFocus) {
    var current = document.querySelector(".ut-live-shade");
    if (!current) return;
    var returnFocus = current._utReturnFocus;
    restoreInert(current);
    current.remove();
    if (restoreFocus !== false && returnFocus && returnFocus.isConnected) returnFocus.focus();
  }
  function openDrawer(title, body, eyebrow, returnFocus) {
    var outgoing = document.querySelector(".ut-live-shade");
    var inheritedReturnFocus = returnFocus || outgoing && outgoing._utReturnFocus || document.activeElement;
    closeDrawer(false);
    var shade = document.createElement("div");
    shade.className = "drawerShade ut-live-shade";
    shade._utReturnFocus = inheritedReturnFocus;
    shade.innerHTML = '<aside class="drawer ut-live-drawer" role="dialog" aria-modal="true" aria-labelledby="ut-live-title"><button class="drawerClose" aria-label="Close dialog">×</button><p class="eyebrow">' + escapeHtml(eyebrow || "DASHBOARD WORKSPACE") + '</p><h2 id="ut-live-title">' + escapeHtml(title) + '</h2><div class="ut-live-body" aria-live="polite" aria-atomic="true">' + body + '</div></aside>';
    shade.addEventListener("click", function (event) { if (event.target === shade) closeDrawer(); });
    shade.querySelector(".drawerClose").addEventListener("click", closeDrawer);
    shade.addEventListener("keydown", function (event) {
      if (event.key === "Escape") { event.preventDefault(); closeDrawer(); return; }
      if (event.key !== "Tab") return;
      var focusable = focusableElements(shade);
      if (!focusable.length) return;
      var first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
    document.body.appendChild(shade);
    inertSiblings(shade);
    shade.querySelector(".drawerClose").focus();
    return shade;
  }
  function loadingDrawer(title) { return openDrawer(title, '<div class="ut-loading" role="status" aria-live="polite">Loading authorized data…</div>', "AUTHORIZED READ-ONLY SOURCES"); }
  function mobileActionsMarkup() {
    return '<div class="ut-mobile-actions" aria-label="Dashboard actions"><button class="ut-mobile-actions-center">Actions' + (Object.keys(sectionActionState).length ? ' (' + Object.keys(sectionActionState).length + ')' : '') + '</button><button class="ut-mobile-search">Search</button><button class="ut-mobile-prepare">Prepare me</button></div>';
  }
  function wireMobileActions(container) {
    var actions = container.querySelector(".ut-mobile-actions-center");
    var search = container.querySelector(".ut-mobile-search");
    var prepare = container.querySelector(".ut-mobile-prepare");
    if (actions) actions.addEventListener("click", showActionCenter);
    if (search) search.addEventListener("click", showSearch);
    if (prepare) prepare.addEventListener("click", showPrepareMe);
  }
  function eventMarkup(event) {
    var link = event.url ? '<a href="' + escapeHtml(event.url) + '" target="_blank" rel="noopener">Open in Google Calendar</a>' : "";
    var details = [event.calendar, event.location].filter(Boolean).map(function (value) { return escapeHtml(value); }).join(" · ");
    return '<article class="ut-event"><div><time>' + escapeHtml(formatEventTime(event)) + '</time><h3>' + escapeHtml(event.title) + '</h3>' + (details ? '<p>' + details + '</p>' : "") + '</div><div class="ut-inline-actions"><button data-prepare-event="' + escapeHtml(event.title) + '">Prepare me</button>' + link + '</div></article>';
  }
  function fileMarkup(file) {
    var link = file.url ? '<a href="' + escapeHtml(file.url) + '" target="_blank" rel="noopener">Open</a>' : "";
    return '<article class="ut-file"><div><h3>' + escapeHtml(file.name) + '</h3><p>Modified ' + escapeHtml(formatDate(file.modifiedTime, true)) + '</p></div>' + link + '</article>';
  }
  function limitedFileListMarkup(files, limit) {
    var shown = files.slice(0, limit);
    return '<div class="ut-file-list">' + shown.map(fileMarkup).join("") + '</div>' + (files.length > shown.length ? '<p class="ut-source">Showing ' + shown.length + ' of ' + files.length + ' filename matches.</p>' : "");
  }
  async function loadCalendar() {
    var result = await requestJson("/api/calendar");
    if (result.reauthorize || result.authRequired) return result;
    if (!Array.isArray(result.events)) throw new Error("Calendar response invalid");
    return {
      events: result.events, source: result.source,
      partial: Boolean(result.partial), truncated: Boolean(result.truncated), warnings: Array.isArray(result.warnings) ? result.warnings : []
    };
  }
  function calendarQualityMarkup(result) {
    var messages = [];
    if (result.partial) messages.push("Calendar source warnings were reported; results may be incomplete.");
    if (result.truncated) messages.push("Additional calendars or events may exist beyond the results that loaded.");
    return messages.length ? '<div class="ut-source-warning" role="status"><strong>PARTIAL CALENDAR DATA</strong><p>' + escapeHtml(messages.join(" ")) + '</p></div>' : "";
  }
  function calendarIncomplete(result) { return Boolean(result && (result.partial || result.truncated)); }
  function driveQualityMarkup(result) {
    return result && result.truncated ? '<div class="ut-source-warning" role="status"><strong>PARTIAL DRIVE RESULTS</strong><p>Additional Drive pages exist beyond the filename matches loaded here.</p></div>' : "";
  }
  function driveFilesOrEmptyMarkup(result, files, limit) {
    if (files.length) return limitedFileListMarkup(files, limit);
    if (result.truncated) return '<div class="ut-empty"><h3>No complete Drive filename result</h3><p>The first page returned no filenames, but additional pages exist. Refine the search or retry before treating this as no match.</p></div>';
    return '<div class="ut-empty"><p>No matching Drive filenames were found.</p></div>';
  }
  async function showCalendarPanel() {
    if (sessionAuthRequired) { renderSessionEnded(); return; }
    document.body.classList.add("ut-live-managed", "ut-live-calendar");
    var shell = document.querySelector(".topShell");
    if (!shell) return;
    suppressNativeShell(shell);
    var managed = shell.querySelector(".ut-live-view"); if (managed) managed.remove();
    var sourceStatus = shell.querySelector(".ut-source-status"); if (sourceStatus) sourceStatus.remove();
    var panel = shell.querySelector(".ut-calendar-panel");
    if (!panel) {
      panel = document.createElement("section");
      panel.className = "ut-calendar-panel";
      panel.innerHTML = '<div class="ut-panel-head"><div><p class="eyebrow">GOOGLE CALENDAR · READ-ONLY</p><h2>Calendar</h2><span>Events visible through your authorized Google Calendar access, including selected or subscribed calendars. No University account or institutional system is connected.</span></div><button class="ut-refresh">Refresh</button></div>' + mobileActionsMarkup() + '<div class="ut-calendar-content" role="status" aria-live="polite" aria-atomic="true"><div class="ut-loading">Loading authorized calendar…</div></div>';
      shell.prepend(panel);
      panel.querySelector(".ut-refresh").addEventListener("click", showCalendarPanel);
      wireMobileActions(panel);
    }
    var content = panel.querySelector(".ut-calendar-content");
    var requestId = (panel._utCalendarRequestId || 0) + 1;
    panel._utCalendarRequestId = requestId;
    panel.setAttribute("aria-busy", "true");
    content.innerHTML = '<div class="ut-loading">Loading authorized calendar…</div>';
    try {
      var result = await loadCalendar();
      if (!panel.isConnected || panel._utCalendarRequestId !== requestId) return;
      if (result.authRequired) content.innerHTML = signInMarkup();
      else if (result.reauthorize) content.innerHTML = reconnectMarkup();
      else if (!result.events.length && calendarIncomplete(result)) content.innerHTML = calendarQualityMarkup(result) + '<div class="ut-empty"><h3>No complete result available</h3><p>No events were returned from the calendars that loaded. Retry before treating this as an empty calendar.</p></div><p class="ut-source">Source: ' + escapeHtml(result.source) + '</p>';
      else if (!result.events.length) content.innerHTML = '<div class="ut-empty"><h3>No events found</h3><p>Your selected Google calendars returned no events in the current authorized Calendar window.</p></div><p class="ut-source">Source: ' + escapeHtml(result.source) + '</p>';
      else content.innerHTML = calendarQualityMarkup(result) + '<div class="ut-event-list">' + result.events.map(eventMarkup).join("") + '</div><p class="ut-source">Source: ' + escapeHtml(result.source) + '</p>';
    } catch (_) {
      if (!panel.isConnected || panel._utCalendarRequestId !== requestId) return;
      content.innerHTML = '<div class="ut-empty" role="alert" aria-live="assertive" aria-atomic="true"><h3>Calendar is temporarily unavailable</h3><p>The dashboard could not read Google Calendar. Nothing was changed.</p><button class="ut-retry">Try again</button></div>';
      content.querySelector(".ut-retry").addEventListener("click", showCalendarPanel);
    } finally {
      if (panel.isConnected && panel._utCalendarRequestId === requestId) panel.removeAttribute("aria-busy");
    }
  }
  function suppressNativeShell(shell) {
    if (!shell) return;
    Array.prototype.forEach.call(shell.children, function (node) {
      if (node.matches(".ut-live-view,.ut-calendar-panel,.ut-source-status")) return;
      node.hidden = true; node.inert = true; node.setAttribute("aria-hidden", "true"); node.dataset.utSuppressedNative = "1";
    });
  }
  function restoreNativeView() {
    if (sectionFreshnessTimer !== null) { clearTimeout(sectionFreshnessTimer); sectionFreshnessTimer = null; }
    document.body.classList.remove("ut-live-managed", "ut-live-calendar");
    document.querySelectorAll(".ut-live-view,.ut-calendar-panel,.ut-source-status").forEach(function (node) { node.remove(); });
    suppressNativeShell(document.querySelector(".topShell"));
  }
  var PAGE_TO_SECTION = { Today: "today", Teaching: "teaching", Research: "research", Service: "service", People: "people" };
  var SECTION_TO_PAGE = { today: "Today", teaching: "Teaching", research: "Research", service: "Service", people: "People" };
  function sectionFreshUntil(payload) {
    if (!payload || !payload.section) return null;
    var candidates = [];
    var section = payload.section;
    if (section.freshness === "current" && section.staleAfter) candidates.push(Date.parse(section.staleAfter));
    (Array.isArray(section.items) ? section.items : []).forEach(function (item) {
      if (item && item.freshness === "current" && item.staleAfter) candidates.push(Date.parse(item.staleAfter));
    });
    candidates = candidates.filter(Number.isFinite);
    return candidates.length ? Math.min.apply(Math, candidates) : null;
  }
  function monotonicNow() {
    return window.performance && typeof window.performance.now === "function" ? window.performance.now() : Date.now();
  }
  function sectionFreshForMs(payload) {
    var freshUntil = sectionFreshUntil(payload);
    if (freshUntil === null) return null;
    var servedAt = Date.parse(payload && payload.servedAt);
    return Math.max(0, freshUntil - (Number.isFinite(servedAt) ? servedAt : Date.now()));
  }
  function sectionRemainingFreshMs(payload) {
    var freshForMs = sectionFreshForMs(payload);
    if (freshForMs === null) return null;
    var timing = sectionPayloadTiming.get(payload);
    if (!timing) return freshForMs;
    return Math.max(0, timing.freshForMs - Math.max(0, monotonicNow() - timing.loadedMonotonic));
  }
  function downgradeExpiredSectionFreshness(payload, nowMs) {
    if (!payload || !payload.section) return payload;
    var section = payload.section;
    var items = Array.isArray(section.items) ? section.items : [];
    items.forEach(function (item) {
      if (item && item.freshness === "current" && item.staleAfter && Date.parse(item.staleAfter) <= nowMs) item.freshness = "stale";
    });
    if (items.length) {
      var values = items.map(function (item) { return item.freshness; });
      section.freshness = values.some(function (value) { return value === "stale"; })
        ? "stale"
        : values.every(function (value) { return value === "current"; }) ? "current" : "unknown";
      section.staleAfter = section.freshness === "unknown" ? null : items.map(function (item) { return item.staleAfter; }).filter(Boolean).sort(function (left, right) { return Date.parse(left) - Date.parse(right); })[0] || null;
    } else if (section.freshness === "current" && section.staleAfter && Date.parse(section.staleAfter) <= nowMs) section.freshness = "stale";
    return payload;
  }
  function scheduleSectionFreshness(page, payload) {
    if (sectionFreshnessTimer !== null) clearTimeout(sectionFreshnessTimer);
    sectionFreshnessTimer = null;
    var freshForMs = sectionRemainingFreshMs(payload);
    if (freshForMs === null) return;
    var delay = Math.min(freshForMs + 50, 2147483000);
    sectionFreshnessTimer = setTimeout(function () {
      sectionFreshnessTimer = null;
      if (currentPage() === page) showNativeStatus(page, true);
    }, delay);
  }
  function renderSessionEnded() {
    sessionAuthRequired = true;
    sectionRequestId += 1;
    headerCalendarRequestId += 1;
    headerCalendarResult = { authRequired: true };
    headerCalendarError = false;
    sectionCache = {};
    sectionLoadGeneration = {};
    sectionActionState = {};
    try { localStorage.removeItem(SECTION_ACTION_STORAGE_KEY); localStorage.removeItem(STORAGE_KEY); } catch (_) {}
    if (sectionFreshnessTimer !== null) { clearTimeout(sectionFreshnessTimer); sectionFreshnessTimer = null; }
    document.querySelectorAll(".drawerShade").forEach(function (shade) {
      restoreInert(shade);
      if (activeNativeShade === shade) activeNativeShade = null;
      shade.remove();
    });
    renderHeaderCountdown();
    var shell = document.querySelector(".topShell");
    if (!shell) return;
    var page = currentPage() || "Today";
    var existing = shell.querySelector('.ut-session-ended[data-page="' + page + '"]');
    if (existing) return;
    document.body.classList.remove("ut-live-managed", "ut-live-calendar");
    shell.querySelectorAll(".ut-live-view,.ut-calendar-panel,.ut-source-status").forEach(function (node) { node.remove(); });
    suppressNativeShell(shell);
    Object.keys(PAGE_TO_SECTION).forEach(function (sectionPage) { setTrustedSectionCount(sectionPage, null); });
    var banner = document.createElement("section"); banner.className = "ut-source-status"; banner.dataset.page = page;
    banner.innerHTML = '<div><strong>SIGN IN REQUIRED</strong><span>Your private dashboard session has ended. Previously displayed source data was removed.</span></div>';
    var view = document.createElement("section"); view.className = "ut-live-view ut-unavailable-view ut-session-ended"; view.dataset.page = page; view.innerHTML = signInMarkup();
    shell.prepend(banner); shell.appendChild(view);
  }
  function sectionDefinition(page) {
    return {
      Today: {
        eyebrow: "WORK ITEMS",
        disconnected: "SOURCE NOT CONNECTED",
        title: "Today needs a verified work-item source",
        detail: "Ranked tasks, urgency counts, progress, and category-balance metrics are unavailable. The previous static examples have been removed from the operational view.",
        requirement: "Connect an approved current-work tracker before this page can prioritize, route, complete, or dismiss work."
      },
      Teaching: {
        eyebrow: "TEACHING",
        disconnected: "COURSE SOURCE NOT CONNECTED",
        title: "Teaching data is unavailable",
        detail: "Courses, class plans, students, engagement, messages, assignments, and LCOS status are not shown without a verified source.",
        requirement: "Canvas and student systems are intentionally not connected. An approved non-student course source is required for this workspace."
      },
      Research: {
        eyebrow: "RESEARCH",
        disconnected: "PROJECT SOURCE NOT CONNECTED",
        title: "Research data is unavailable",
        detail: "Projects, stages, deadlines, manuscript status, coauthor updates, and workload estimates are not shown without a verified source.",
        requirement: "Connect an approved research-project source before this workspace can report status or offer project actions."
      },
      Service: {
        eyebrow: "SERVICE",
        disconnected: "PROGRAM SOURCE NOT CONNECTED",
        title: "Service data is unavailable",
        detail: "Founder, mentor, internship, attendance, roster, and program-schedule data are not shown. The synthetic Incubator fixture is disabled.",
        requirement: "Connect an approved program source. Calendar event-title keywords are not evidence of program affiliation and are not used here."
      },
      People: {
        eyebrow: "PEOPLE",
        disconnected: "DIRECTORY SOURCE NOT CONNECTED",
        title: "People data is unavailable",
        detail: "Names, titles, relationships, project ownership, handoffs, and student-worker details are not shown without a verified source.",
        requirement: "Connect an approved directory or relationship source before this workspace can identify people or assign actions."
      }
    }[page];
  }
  function openSection(page) {
    var target = Array.prototype.find.call(document.querySelectorAll(".sectionTabs button"), function (button) {
      return tabPage(button) === page;
    });
    if (!target) return;
    target.click();
    target.focus();
    scheduleActivePage(60);
  }
  function sectionActionKey(feedId, itemId) { return feedId + "|" + itemId; }
  function sectionLocalRecord(feedId, itemId, sectionId) {
    var record = sectionActionState[sectionActionKey(feedId, itemId)];
    return record && record.section === sectionId ? record : undefined;
  }
  function saveSectionLocalAction(payload, item, actionType, target, returnFocus) {
    var key = sectionActionKey(payload.feedId, item.id);
    var previous = sectionActionState[key];
    sectionActionState[key] = {
      feedId: payload.feedId, itemId: item.id, section: item.section,
      actionType: actionType, target: target || "", updatedAt: new Date().toISOString()
    };
    if (!writeSectionActionState()) {
      if (previous) sectionActionState[key] = previous; else delete sectionActionState[key];
      openDrawer("Action not saved", '<div class="ut-empty" role="alert"><h3>Browser storage is unavailable</h3><p>The source item was not changed. Try again after enabling local browser storage.</p></div>', "PRIVATE BROWSER STATE", returnFocus);
      return;
    }
    updateActionCount();
    var label = actionType === "complete_local" ? "Completed locally" : actionType === "dismiss_local" ? "Dismissed locally" : "Route staged locally for " + target + " · nobody notified";
    document.querySelectorAll('[data-section-feed-id="' + CSS.escape(payload.feedId) + '"][data-section-item-id="' + CSS.escape(item.id) + '"] .ut-item-local-state').forEach(function (node) { node.textContent = label; node.hidden = false; });
    var toast = document.createElement("div");
    toast.className = "toast ut-toast";
    toast.setAttribute("role", "status"); toast.setAttribute("aria-live", "polite"); toast.setAttribute("aria-atomic", "true");
    toast.textContent = "✓ " + label;
    document.body.appendChild(toast); setTimeout(function () { toast.remove(); }, 2400);
    if (returnFocus && returnFocus.isConnected) returnFocus.focus();
  }
  function openLocalRoute(payload, item, returnFocus) {
    var drawer = openDrawer("Stage route locally", '<div class="ut-brief"><strong>Nobody will be notified</strong><p>This stores only an opaque item ID and route choice in this browser.</p></div><div class="ut-route-choices"></div>', "PRIVATE BROWSER STATE", returnFocus);
    ["BOS", "UTampa", "Entrepreneurship Professor"].forEach(function (target) {
      var button = document.createElement("button");
      button.className = "ut-primary"; button.type = "button"; button.textContent = target;
      button.addEventListener("click", function () { closeDrawer(false); saveSectionLocalAction(payload, item, "stage_route_local", target, returnFocus); });
      drawer.querySelector(".ut-route-choices").appendChild(button);
    });
  }
  function itemDetailsMarkup(item, prepare) {
    var heading = prepare ? "Local preparation view" : "Verified item details";
    var summary = item.summary ? '<p>' + escapeHtml(item.summary) + '</p>' : '<p>No additional summary was supplied.</p>';
    var timing = [item.startAt && "Starts " + formatDate(item.startAt, true), item.endAt && "Ends " + formatDate(item.endAt, true), item.dueAt && "Due " + formatDate(item.dueAt, true)].filter(Boolean).join(" · ");
    return '<div class="ut-brief"><strong>' + heading + '</strong>' + summary + (timing ? '<p>' + escapeHtml(timing) + '</p>' : '') + '<p>Source status: ' + escapeHtml(item.status) + ' · ' + escapeHtml(item.freshness) + '</p></div>';
  }
  function wireSectionAction(control, action, payload, item) {
    if (action.type === "open_source") return;
    control.addEventListener("click", function () {
      if (action.type === "open_details") openDrawer(item.title, itemDetailsMarkup(item, false), "VERIFIED READ-ONLY ITEM", control);
      else if (action.type === "open_section") openSection(SECTION_TO_PAGE[action.targetSection]);
      else if (action.type === "prepare") openDrawer("Prepare locally · " + item.title, itemDetailsMarkup(item, true), "LOCAL PREPARATION", control);
      else if (action.type === "complete_local" || action.type === "dismiss_local") saveSectionLocalAction(payload, item, action.type, "", control);
      else if (action.type === "stage_route_local") openLocalRoute(payload, item, control);
    });
  }
  function renderSectionItem(payload, item) {
    var article = document.createElement("article");
    article.className = "ut-section-item";
    article.dataset.sectionFeedId = payload.feedId;
    article.dataset.sectionItemId = item.id;
    article.dataset.sectionId = item.section;
    var heading = document.createElement("h3"); heading.textContent = item.title; article.appendChild(heading);
    var meta = document.createElement("p"); meta.className = "ut-item-meta";
    var metaParts = [item.category, item.status, item.priority === null ? "Priority unknown" : "Priority " + item.priority, item.needsOwner ? "Needs owner" : "Owner action not required"];
    meta.textContent = metaParts.join(" · "); article.appendChild(meta);
    if (item.summary) { var summary = document.createElement("p"); summary.textContent = item.summary; article.appendChild(summary); }
    var times = [item.startAt && "Starts " + formatDate(item.startAt, true), item.endAt && "Ends " + formatDate(item.endAt, true), item.dueAt && "Due " + formatDate(item.dueAt, true), item.asOf && "As of " + formatDate(item.asOf, true)].filter(Boolean);
    if (times.length) { var time = document.createElement("p"); time.className = "ut-item-time"; time.textContent = times.join(" · "); article.appendChild(time); }
    var freshness = document.createElement("p"); freshness.className = "ut-item-freshness"; freshness.textContent = item.freshness === "stale" ? "Stale source data" : item.freshness === "current" ? "Current source data" : "Source freshness unknown"; article.appendChild(freshness);
    var local = document.createElement("p"); local.className = "ut-item-local-state";
    var saved = sectionLocalRecord(payload.feedId, item.id, item.section);
    local.hidden = !saved;
    if (saved) local.textContent = saved.actionType === "complete_local" ? "Completed locally" : saved.actionType === "dismiss_local" ? "Dismissed locally" : "Route staged locally for " + saved.target + " · nobody notified";
    article.appendChild(local);
    if (Array.isArray(item.tags) && item.tags.length) { var tags = document.createElement("p"); tags.className = "ut-item-tags"; tags.textContent = item.tags.join(" · "); article.appendChild(tags); }
    if (Array.isArray(item.actions) && item.actions.length) {
      var actions = document.createElement("div"); actions.className = "ut-inline-actions";
      item.actions.forEach(function (action) {
        var control;
        if (action.type === "open_source") {
          control = document.createElement("a"); control.href = action.href; control.target = "_blank"; control.rel = "noopener noreferrer";
        } else { control = document.createElement("button"); control.type = "button"; }
        control.className = "ut-section-action"; control.dataset.sectionAction = action.type;
        control.textContent = action.label; control.setAttribute("aria-label", action.label + " · " + item.title);
        wireSectionAction(control, action, payload, item); actions.appendChild(control);
      });
      article.appendChild(actions);
    }
    return article;
  }
  function setTrustedSectionCount(page, section) {
    var tab = Array.prototype.find.call(document.querySelectorAll(".sectionTabs button"), function (button) { return tabPage(button) === page; });
    if (!tab) return;
    var count = tab.querySelector(".ut-section-count");
    var status = section && section.completeness && section.completeness.status;
    if (status !== "complete" && status !== "partial") { if (count) count.remove(); delete tab.dataset.utTrustedCount; delete tab.dataset.utTrustedStatus; tab.setAttribute("aria-label", page); return; }
    if (!count) { count = document.createElement("span"); count.className = "ut-section-count"; tab.appendChild(count); }
    if (count.textContent !== String(section.completeness.receivedCount)) count.textContent = String(section.completeness.receivedCount);
    tab.dataset.utTrustedCount = String(section.completeness.receivedCount); tab.dataset.utTrustedStatus = status;
    tab.setAttribute("aria-label", page + " · " + section.completeness.receivedCount + (status === "partial" ? " items from a partial source" : " verified items"));
  }
  function renderUnavailablePage(shell, page, status, reason, retry) {
    var definition = sectionDefinition(page);
    if (!definition) return;
    var view = document.createElement("section");
    view.className = "ut-live-view ut-unavailable-view";
    view.dataset.page = page;
    var headingId = "ut-section-title-" + PAGE_TO_SECTION[page];
    view.setAttribute("aria-labelledby", headingId);
    view.innerHTML = '<div class="ut-unavailable-card"><p class="eyebrow"></p><h2></h2><p class="ut-unavailable-detail"></p><div class="ut-source-requirement"><strong>Source state</strong><p></p></div><div class="ut-state-actions"></div></div><aside class="ut-connected-tools"><p class="eyebrow">CONNECTED READ-ONLY TOOLS</p><h3>Calendar and Drive metadata remain available separately</h3><p>Google Calendar event metadata and Google Drive filename metadata are live and read-only. They do not populate or verify this workspace.</p><div class="ut-state-actions"><button class="ut-open-calendar">Open Calendar</button><button class="ut-open-search">Search connected metadata</button></div></aside>';
    view.querySelector(".ut-unavailable-card .eyebrow").textContent = definition.eyebrow;
    view.querySelector("h2").id = headingId; view.querySelector("h2").textContent = definition.title;
    view.querySelector(".ut-unavailable-detail").textContent = definition.detail;
    view.querySelector(".ut-source-requirement p").textContent = reason || definition.requirement;
    if (reason && definition.requirement && reason !== definition.requirement) {
      var boundary = document.createElement("p"); boundary.className = "ut-source-boundary"; boundary.textContent = definition.requirement;
      view.querySelector(".ut-source-requirement").appendChild(boundary);
    }
    if (status === "unavailable" || retry) {
      var retryButton = document.createElement("button"); retryButton.type = "button"; retryButton.className = "ut-section-retry"; retryButton.textContent = "Retry verified source";
      retryButton.addEventListener("click", function () { showNativeStatus(page, true); }); view.querySelector(".ut-unavailable-card>.ut-state-actions").appendChild(retryButton);
    }
    shell.appendChild(view);
    view.querySelector(".ut-open-calendar").addEventListener("click", function () { openSection("Calendar"); });
    view.querySelector(".ut-open-search").addEventListener("click", showSearch);
  }
  function updateSectionBanner(banner, page, section) {
    var definition = sectionDefinition(page); var status = section.completeness.status;
    var strong = status === "complete" ? "VERIFIED SOURCE · COMPLETE" : status === "partial" ? "VERIFIED SOURCE · PARTIAL" : status === "unavailable" ? "SOURCE UNAVAILABLE" : definition.disconnected;
    if (section.freshness === "stale") strong += " · STALE";
    var count = status === "complete" || status === "partial" ? section.completeness.receivedCount + " item" + (section.completeness.receivedCount === 1 ? "" : "s") + ". " : "";
    banner.querySelector("strong").textContent = strong;
    banner.querySelector("span").textContent = count + (section.completeness.reason || (section.freshness === "stale" ? "The last verified snapshot is stale." : "Read-only source data."));
  }
  function renderConnectedSection(shell, page, payload) {
    var section = payload.section; var definition = sectionDefinition(page);
    var view = document.createElement("section"); view.className = "ut-live-view ut-section-view"; view.dataset.page = page;
    var headingId = "ut-section-title-" + section.id; view.setAttribute("aria-labelledby", headingId);
    var header = document.createElement("header"); header.className = "ut-panel-head";
    var copy = document.createElement("div"); var eyebrow = document.createElement("p"); eyebrow.className = "eyebrow"; eyebrow.textContent = definition.eyebrow + " · VERIFIED READ-ONLY SOURCE";
    var heading = document.createElement("h2"); heading.id = headingId; heading.textContent = page;
    var asOf = document.createElement("p"); asOf.className = "ut-source"; asOf.textContent = "As of " + formatDate(section.asOf || payload.generatedAt, true) + " · " + section.freshness + " · " + section.completeness.status;
    copy.appendChild(eyebrow); copy.appendChild(heading); copy.appendChild(asOf); header.appendChild(copy); view.appendChild(header);
    if (section.completeness.status === "partial" || section.freshness === "stale") {
      var warning = document.createElement("div"); warning.className = "ut-source-warning"; warning.setAttribute("role", "status");
      var warningTitle = document.createElement("strong"); warningTitle.textContent = section.freshness === "stale" ? "STALE SOURCE DATA" : "PARTIAL SOURCE DATA";
      var warningText = document.createElement("p"); warningText.textContent = section.completeness.reason || (section.freshness === "stale" ? "The last verified snapshot is stale. Refresh before relying on it as current." : "The approved source returned an incomplete result.");
      warning.appendChild(warningTitle); warning.appendChild(warningText); view.appendChild(warning);
    }
    var list = document.createElement("div"); list.className = "ut-section-item-list";
    if (!section.items.length) {
      var empty = document.createElement("div"); empty.className = "ut-empty";
      var emptyTitle = document.createElement("h3"); emptyTitle.textContent = section.completeness.status === "complete" ? section.freshness === "stale" ? "Verified empty as of a stale snapshot" : section.freshness === "current" ? "Verified empty" : "Verified empty snapshot · freshness unknown" : "No records supplied from the incomplete source";
      var emptyText = document.createElement("p"); emptyText.textContent = section.completeness.status === "complete" ? section.freshness === "stale" ? "The approved source reported zero items as of this snapshot, but the snapshot is stale. Refresh before treating it as current." : section.freshness === "current" ? "The approved source explicitly reported zero current items." : "The approved source reported zero items as of this snapshot, but its freshness is unknown. Refresh before treating it as current." : "This is not a verified zero. Retry or check the source before relying on it.";
      empty.appendChild(emptyTitle); empty.appendChild(emptyText); list.appendChild(empty);
    } else section.items.forEach(function (item) { list.appendChild(renderSectionItem(payload, item)); });
    view.appendChild(list); shell.appendChild(view);
  }
  async function loadSectionPayload(page, force) {
    var sectionId = PAGE_TO_SECTION[page]; var cached = sectionCache[sectionId]; var currentMonotonic = monotonicNow();
    var cacheAge = cached && Number.isFinite(cached.loadedMonotonic) ? currentMonotonic - cached.loadedMonotonic : Infinity;
    var freshnessValid = !cached || cached.freshForMs === null || cacheAge < cached.freshForMs;
    if (!force && cached && cached.value && cacheAge < 60000 && freshnessValid) return cached.value;
    if (!force && cached && cached.promise) return cached.promise;
    var generation = (sectionLoadGeneration[sectionId] || 0) + 1;
    sectionLoadGeneration[sectionId] = generation;
    var requestStartedMonotonic = monotonicNow();
    var promise = requestJson("/api/sections/" + encodeURIComponent(sectionId)).then(function (payload) {
      if (payload.authRequired) return payload;
      if (!payload || payload.viewVersion !== "utampa-section-view.v1" || !Number.isFinite(Date.parse(payload.servedAt)) || payload.section && payload.section.id !== sectionId || !payload.section || !payload.section.completeness || !Array.isArray(payload.section.items)) throw new Error("Section response invalid");
      var loadedMonotonic = monotonicNow();
      var requestElapsed = Math.max(0, loadedMonotonic - requestStartedMonotonic);
      downgradeExpiredSectionFreshness(payload, Date.parse(payload.servedAt) + requestElapsed);
      var freshForMs = sectionFreshForMs(payload);
      if (freshForMs !== null) freshForMs = Math.max(0, freshForMs - requestElapsed);
      sectionPayloadTiming.set(payload, { loadedMonotonic: loadedMonotonic, freshForMs: freshForMs });
      if (sectionLoadGeneration[sectionId] === generation) sectionCache[sectionId] = { value: payload, loadedMonotonic: loadedMonotonic, freshForMs: freshForMs };
      return payload;
    }).finally(function () {
      if (sectionCache[sectionId] && sectionCache[sectionId].promise === promise) delete sectionCache[sectionId];
    });
    sectionCache[sectionId] = { promise: promise, value: cached && cached.value, loadedMonotonic: cached && cached.loadedMonotonic, freshForMs: cached && cached.freshForMs };
    return promise;
  }
  function showNativeStatus(page, force) {
    if (sessionAuthRequired) { renderSessionEnded(); return; }
    restoreNativeView();
    var shell = document.querySelector(".topShell");
    var definition = sectionDefinition(page);
    if (!shell || !definition) return;
    var banner = shell.querySelector(".ut-source-status");
    if (!banner) {
      banner = document.createElement("section");
      banner.className = "ut-source-status";
      shell.prepend(banner);
    }
    banner.dataset.page = page;
    banner.innerHTML = '<div><strong>LOADING VERIFIED SOURCE</strong><span>Checking the approved read-only section feed.</span></div>' + mobileActionsMarkup();
    wireMobileActions(banner);
    var loading = document.createElement("section"); loading.className = "ut-live-view ut-section-loading"; loading.dataset.page = page; loading.setAttribute("aria-busy", "true"); loading.innerHTML = '<div class="ut-loading" role="status">Loading verified section data…</div>'; shell.appendChild(loading);
    var requestId = ++sectionRequestId;
    loadSectionPayload(page, force).then(function (payload) {
      if (requestId !== sectionRequestId || currentPage() !== page) return;
      document.querySelectorAll(".ut-live-view").forEach(function (node) { node.remove(); });
      if (payload.authRequired) {
        banner.querySelector("strong").textContent = "SIGN IN REQUIRED"; banner.querySelector("span").textContent = "Your private dashboard session has ended.";
        var authView = document.createElement("section"); authView.className = "ut-live-view ut-unavailable-view"; authView.dataset.page = page; authView.innerHTML = signInMarkup(); shell.appendChild(authView); setTrustedSectionCount(page, null); return;
      }
      updateSectionBanner(banner, page, payload.section); setTrustedSectionCount(page, payload.section);
      if (payload.section.completeness.status === "complete" || payload.section.completeness.status === "partial") renderConnectedSection(shell, page, payload);
      else renderUnavailablePage(shell, page, payload.section.completeness.status, payload.section.completeness.reason, payload.section.completeness.status === "unavailable");
      scheduleSectionFreshness(page, payload);
    }).catch(function () {
      if (requestId !== sectionRequestId || currentPage() !== page) return;
      document.querySelectorAll(".ut-live-view").forEach(function (node) { node.remove(); });
      banner.querySelector("strong").textContent = "SECTION SOURCE UNAVAILABLE"; banner.querySelector("span").textContent = "The verified section feed could not be loaded.";
      setTrustedSectionCount(page, null); renderUnavailablePage(shell, page, "unavailable", "The verified section feed could not be loaded. Nothing was inferred from Calendar, Drive, or sample data.", true);
    });
  }
  function syncActivePage() {
    var active = document.querySelector(".sectionTabs button.active");
    if (!active) return;
    var page = tabPage(active);
    if (page === "Calendar") {
      if (!document.querySelector(".ut-calendar-panel")) showCalendarPanel();
    } else {
      var status = document.querySelector('.ut-source-status[data-page="' + page + '"]');
      if (!status) showNativeStatus(page);
    }
  }
  async function prepareEvent(title) {
    var drawer = loadingDrawer("Prepare Me · " + title);
    try {
      var result = await requestJson("/api/drive?q=" + encodeURIComponent(title.split(/[·:\-]/)[0].trim()));
      var body = drawer.querySelector(".ut-live-body");
      if (result.authRequired) body.innerHTML = signInMarkup();
      else if (result.reauthorize) body.innerHTML = reconnectMarkup();
      else {
        if (!Array.isArray(result.files)) throw new Error("Drive response invalid");
        var files = result.files;
        body.innerHTML = '<div class="ut-brief"><strong>Next preparation move</strong><p>Review the event details, then open a relevant recent Drive filename match below.</p></div>' + driveQualityMarkup(result) + driveFilesOrEmptyMarkup(result, files, 8) + '<p class="ut-source">Source: ' + escapeHtml(result.source) + '</p>';
      }
    } catch (_) { drawer.querySelector(".ut-live-body").innerHTML = '<div class="ut-empty" role="alert" aria-live="assertive" aria-atomic="true"><h3>Preparation sources unavailable</h3><p>No files were changed. Try again shortly.</p></div>'; }
  }
  async function showPrepareMe() {
    var drawer = loadingDrawer("Prepare Me");
    try {
      var calendar = await loadCalendar();
      var body = drawer.querySelector(".ut-live-body");
      if (calendar.authRequired) return void (body.innerHTML = signInMarkup());
      if (calendar.reauthorize) return void (body.innerHTML = reconnectMarkup());
      var next = calendar.events.find(function (event) { return new Date(event.end || event.start).getTime() >= Date.now(); });
      if (!next && calendarIncomplete(calendar)) return void (body.innerHTML = calendarQualityMarkup(calendar) + '<div class="ut-empty"><h3>No complete preparation result</h3><p>No upcoming event was returned from the calendars that loaded. Retry before treating this as an empty schedule.</p></div>');
      if (!next) return void (body.innerHTML = '<div class="ut-empty"><h3>No upcoming event</h3><p>There is no upcoming event in the authorized Calendar window.</p></div>');
      body.innerHTML = calendarQualityMarkup(calendar) + eventMarkup(next) + '<div class="ut-loading" role="status">Finding related Drive filename matches…</div>';
      var drive = await requestJson("/api/drive?q=" + encodeURIComponent(next.title.split(/[·:\-]/)[0].trim()));
      if (drive.authRequired) return void (body.innerHTML += signInMarkup());
      if (drive.reauthorize) return void (body.innerHTML += reconnectMarkup());
      if (!Array.isArray(drive.files)) throw new Error("Drive response invalid");
      var files = drive.files;
      body.innerHTML += '<h3 class="ut-section-title">Related recent filename matches</h3>' + driveQualityMarkup(drive) + driveFilesOrEmptyMarkup(drive, files, 6) + '<p class="ut-source">Sources: Google Calendar event metadata + Google Drive filename metadata · read-only</p>';
    } catch (_) { drawer.querySelector(".ut-live-body").innerHTML = '<div class="ut-empty" role="alert" aria-live="assertive" aria-atomic="true"><h3>Prepare Me is temporarily unavailable</h3><p>The dashboard could not retrieve authorized Google data. Nothing was changed.</p></div>'; }
  }
  function showSearch() {
    var drawer = openDrawer("Search Calendar and Drive", '<form class="ut-search-form"><label for="ut-search-input">Search event titles in the current Calendar window and Drive filenames</label><div><input id="ut-search-input" maxlength="100" autocomplete="off" placeholder="Class, project, person, or topic"><button class="ut-primary">Search</button></div></form><div class="ut-search-results" role="status" aria-live="polite" aria-atomic="true"><p class="ut-source">Read-only metadata search. Calendar descriptions, document contents, University accounts, and student systems are not searched.</p></div>', "AUTHORIZED READ-ONLY SOURCES");
    var form = drawer.querySelector("form");
    var requestId = 0;
    form.addEventListener("submit", async function (event) {
      event.preventDefault();
      requestId += 1;
      var currentRequestId = requestId;
      var query = drawer.querySelector("input").value.trim();
      var output = drawer.querySelector(".ut-search-results");
      if (!query) {
        form.removeAttribute("aria-busy");
        return void (output.innerHTML = '<div class="ut-empty"><p>Enter a search term.</p></div>');
      }
      form.setAttribute("aria-busy", "true");
      output.innerHTML = '<div class="ut-loading">Searching authorized sources…</div>';
      try {
        var results = await Promise.all([loadCalendar(), requestJson("/api/drive?q=" + encodeURIComponent(query))]);
        if (!drawer.isConnected || currentRequestId !== requestId) return;
        if (results.some(function (item) { return item.authRequired; })) return void (output.innerHTML = signInMarkup());
        if (results.some(function (item) { return item.reauthorize; })) return void (output.innerHTML = reconnectMarkup());
        var events = results[0].events.filter(function (item) { return item.title.toLowerCase().includes(query.toLowerCase()); });
        if (!Array.isArray(results[1].files)) throw new Error("Drive response invalid");
        var files = results[1].files;
        output.innerHTML = calendarQualityMarkup(results[0]) + '<h3 class="ut-section-title">Calendar event titles</h3>' + (events.length ? events.map(eventMarkup).join("") : '<p class="ut-empty">No matching event titles in the authorized Calendar window.</p>') + '<h3 class="ut-section-title">Drive filenames</h3>' + driveQualityMarkup(results[1]) + driveFilesOrEmptyMarkup(results[1], files, files.length);
      } catch (_) {
        if (drawer.isConnected && currentRequestId === requestId) output.innerHTML = '<div class="ut-empty" role="alert" aria-live="assertive" aria-atomic="true"><p>Search is temporarily unavailable. Nothing was changed.</p></div>';
      } finally {
        if (drawer.isConnected && currentRequestId === requestId) form.removeAttribute("aria-busy");
      }
    });
    drawer.querySelector("input").focus();
  }
  function updateActionCount() {
    var count = Object.keys(sectionActionState).length;
    var countText = count ? " (" + count + ")" : "";
    document.querySelectorAll(".ut-actions-count").forEach(function (node) { if (node.textContent !== countText) node.textContent = countText; });
    document.querySelectorAll(".ut-mobile-actions-center").forEach(function (button) { var label = "Actions" + countText; if (button.textContent !== label) button.textContent = label; });
  }
  function currentSectionItemTitle(record) {
    var cached = sectionCache[record.section]; var items = cached && cached.value && cached.value.section && cached.value.section.items;
    if (!cached || !cached.value || cached.value.feedId !== record.feedId) return (SECTION_TO_PAGE[record.section] || "Section") + " work item";
    var item = Array.isArray(items) && items.find(function (candidate) { return candidate.id === record.itemId; });
    return item ? item.title : (SECTION_TO_PAGE[record.section] || "Section") + " work item";
  }
  function actionRecordMarkup(key, record) {
    var labels = { complete_local: "Completed locally", dismiss_local: "Dismissed locally", stage_route_local: "Route staged locally" };
    var detail = labels[record.actionType] + (record.target ? " · " + record.target + " · nobody notified" : "");
    return '<article class="ut-action-record" data-section-action-key="' + escapeHtml(key) + '"><div><h3>' + escapeHtml(currentSectionItemTitle(record)) + '</h3><p>' + escapeHtml(detail) + '</p><time>' + escapeHtml(formatDate(record.updatedAt, true)) + '</time></div><button class="ut-restore-action">Restore</button></article>';
  }
  function showActionCenter() {
    var entries = Object.keys(sectionActionState).map(function (key) { return { key: key, record: sectionActionState[key] }; }).sort(function (left, right) { return String(right.record.updatedAt).localeCompare(String(left.record.updatedAt)); });
    var body = entries.length
      ? '<p class="ut-source">Private browser state only. A staged route does not notify another person or system. Source records are never changed.</p><div class="ut-action-history">' + entries.map(function (item) { return actionRecordMarkup(item.key, item.record); }).join("") + '</div>'
      : '<div class="ut-empty"><h3>No saved actions</h3><p>Completed, dismissed, and locally staged section actions will appear here.</p></div>';
    var drawer = openDrawer("Actions", body, "PRIVATE BROWSER STATE");
    drawer.querySelectorAll(".ut-restore-action").forEach(function (button) {
      button.addEventListener("click", function () {
        var record = button.closest(".ut-action-record");
        var key = record.dataset.sectionActionKey;
        var previous = sectionActionState[key];
        delete sectionActionState[key];
        if (!writeSectionActionState()) {
          sectionActionState[key] = previous;
          button.textContent = "Try restore again";
          var error = record.querySelector(".ut-action-error");
          if (!error) { error = document.createElement("p"); error.className = "ut-action-error"; error.setAttribute("role", "alert"); record.querySelector("div").appendChild(error); }
          error.textContent = "Could not restore this item because browser storage is unavailable.";
          button.focus();
          return;
        }
        updateActionCount();
        document.querySelectorAll('[data-section-feed-id="' + CSS.escape(previous.feedId) + '"][data-section-item-id="' + CSS.escape(previous.itemId) + '"][data-section-id="' + CSS.escape(previous.section) + '"] .ut-item-local-state').forEach(function (node) { node.hidden = true; node.textContent = ""; });
        record.remove();
        var next = drawer.querySelector(".ut-restore-action");
        if (next) next.focus();
        else {
          drawer.querySelector(".ut-live-body").innerHTML = '<div class="ut-empty"><h3>No saved actions</h3><p>Completed, dismissed, and locally staged section actions will appear here.</p></div>';
          drawer.querySelector(".drawerClose").focus();
        }
      });
    });
  }
  function currentPage() {
    var active = document.querySelector(".sectionTabs button.active");
    return active ? tabPage(active) : "";
  }
  function clarifyNativeProvenance(page) {
    document.querySelectorAll('.topShell a[href*="docs.google.com"]:not(.ut-section-action),.topShell a[href*="drive.google.com"]:not(.ut-section-action)').forEach(function (link) {
      link.removeAttribute("href"); link.removeAttribute("target"); link.setAttribute("aria-disabled", "true");
      link.textContent = "Source not connected";
    });
    document.querySelectorAll(".todayTask small").forEach(function (node) {
      if (/source available/i.test(node.textContent)) node.textContent = node.textContent.replace(/source available/ig, "prototype item · source not connected");
    });
    document.querySelectorAll(".drawer:not(.ut-live-drawer) .drawerSource span").forEach(function (node) {
      if (/connected university source/i.test(node.textContent)) node.textContent = "Prototype content · no verified item source is connected";
    });
    if (page === "Research") document.querySelectorAll(".project .tag").forEach(function (node) {
      if (/AI PREPARED/i.test(node.textContent)) node.textContent = "PROTOTYPE DRAFT";
    });
    if (page === "People") document.querySelectorAll(".personProject dd").forEach(function (node) {
      if (/Latest source and next dependency available/i.test(node.textContent)) node.textContent = "Prototype entry · verify against an approved source before use";
    });
    document.querySelectorAll(".drawer:not(.ut-live-drawer),.founderPortal").forEach(function (container) {
      var actionArea = container.querySelector(".drawerActions,.portalSubmit");
      var external = actionArea && Array.prototype.some.call(actionArea.querySelectorAll("button"), function (button) { return /^(Send|Send…|Send\.\.\.|Share with founder|Submit update|Save draft|Edit myself|Approve \+ continue|View evidence|Not now)$/i.test(button.textContent.trim()); });
      if (external && !container.querySelector(".ut-prototype-boundary")) {
        var note = document.createElement("p"); note.className = "ut-prototype-boundary";
        note.setAttribute("role", "note");
        note.textContent = "Prototype only — nothing will be sent or saved. Entered values are discarded when this preview closes.";
        actionArea.parentNode.insertBefore(note, actionArea);
      }
      var revision = Array.prototype.find.call(container.querySelectorAll("button"), function (button) { return /record revision/i.test(button.textContent); });
      if (revision && !container.querySelector(".ut-recording-boundary")) {
        var recordingNote = document.createElement("p"); recordingNote.className = "ut-prototype-boundary ut-recording-boundary";
        recordingNote.textContent = "Prototype animation only — no audio is captured and no automated revision is created.";
        revision.parentNode.appendChild(recordingNote);
      }
    });
    var portalFooter = document.querySelector(".founderPortal footer span");
    var portalFooterText = "Prototype only · no record system is connected · entries are discarded when closed";
    if (portalFooter && portalFooter.textContent !== portalFooterText) portalFooter.textContent = portalFooterText;
    var portalSubmit = document.querySelector(".founderPortal .portalSubmit span");
    var portalSubmitText = "Nothing is sent or saved. Entries are discarded when this preview closes.";
    if (portalSubmit && portalSubmit.textContent !== portalSubmitText) portalSubmit.textContent = portalSubmitText;
  }
  function syncSectionAccessibility() {
    var nav = document.querySelector("nav.sectionTabs");
    if (nav) nav.setAttribute("aria-label", "UTampa workspaces");
    document.querySelectorAll(".sectionTabs button").forEach(function (button) {
      var label = tabPage(button);
      var fixedBadge = button.querySelector("em");
      if (fixedBadge) { fixedBadge.hidden = true; fixedBadge.setAttribute("aria-hidden", "true"); }
      var sectionId = PAGE_TO_SECTION[label]; var cached = sectionId && sectionCache[sectionId];
      if (cached && cached.value) setTrustedSectionCount(label, cached.value.section);
      if (button.dataset.utTrustedCount !== undefined) button.setAttribute("aria-label", label + " · " + button.dataset.utTrustedCount + (button.dataset.utTrustedStatus === "partial" ? " items from a partial source" : " verified items"));
      else button.setAttribute("aria-label", label);
      if (button.classList.contains("active")) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
    var app = document.querySelector("main.topApp");
    if (app && !app.querySelector(".ut-app-title")) {
      var heading = document.createElement("h1"); heading.className = "ut-app-title"; heading.textContent = "My Work";
      app.insertBefore(heading, app.firstChild);
    }
  }
  function releaseNativeDialog(shade, restoreFocus) {
    if (!shade) return;
    var returnFocus = shade._utReturnFocus;
    restoreInert(shade);
    if (activeNativeShade === shade) activeNativeShade = null;
    if (restoreFocus !== false && returnFocus && returnFocus.isConnected && !document.querySelector(".ut-live-shade")) returnFocus.focus();
  }
  function closeNativeDialog(shade, afterClose) {
    if (!shade) { if (afterClose) afterClose(); return; }
    var close = shade.querySelector(".drawerClose");
    releaseNativeDialog(shade, false);
    if (close) close.click();
    if (afterClose) setTimeout(afterClose, 0);
  }
  function enhanceNativeDialogs() {
    if (activeNativeShade && !activeNativeShade.isConnected) releaseNativeDialog(activeNativeShade, true);
    var shade = document.querySelector(".drawerShade:not(.ut-live-shade)");
    if (!shade || shade.dataset.utDialogReady === "1") return;
    var panel = shade.querySelector(".drawer,.founderPortal,.reviewModal");
    if (!panel) return;
    shade.dataset.utDialogReady = "1";
    activeNativeShade = shade;
    shade._utReturnFocus = lastNativeTrigger;
    panel.setAttribute("role", "dialog"); panel.setAttribute("aria-modal", "true");
    var heading = panel.querySelector("h2");
    if (heading) { heading.id = heading.id || "ut-native-dialog-title"; panel.setAttribute("aria-labelledby", heading.id); }
    var close = panel.querySelector(".drawerClose"); if (close) close.setAttribute("aria-label", "Close dialog");
    shade.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && close) { event.preventDefault(); close.click(); return; }
      if (event.key !== "Tab") return;
      var focusable = focusableElements(panel); if (!focusable.length) return;
      var first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
    inertSiblings(shade);
    if (close && shade.isConnected) close.focus();
  }
  function showAccount() {
    var drawer = loadingDrawer("Account and data boundary");
    requestJson("/api/me").then(function (me) {
      if (me.authRequired) return void (drawer.querySelector(".ut-live-body").innerHTML = signInMarkup());
      drawer.querySelector(".ut-live-body").innerHTML = '<div class="ut-brief"><strong>Authorized account</strong><p>' + escapeHtml(me.email) + '</p></div><div class="ut-brief"><strong>Data boundary</strong><p>Google Calendar events visible to this account and Google Drive metadata are read-only. University accounts, Canvas, Workday, student records, and institutional systems are not connected.</p></div><form method="post" action="/logout"><button class="ut-primary">Sign out</button></form>';
      drawer.querySelector("form").addEventListener("submit", function () {
        try { localStorage.removeItem(SECTION_ACTION_STORAGE_KEY); localStorage.removeItem(STORAGE_KEY); } catch (_) {}
      });
    }).catch(function () { drawer.querySelector(".ut-live-body").innerHTML = '<div class="ut-empty"><p>Account details are temporarily unavailable.</p></div>'; });
  }
  function renderHeaderCountdown() {
    var countdown = document.querySelector(".ut-live-countdown");
    if (!countdown) return;
    if (headerCalendarError) {
      updateCountdownAttributes(countdown, "error", "Calendar unavailable. Open Calendar to retry.");
      updateCountdownText(countdown, "—", "CALENDAR UNAVAILABLE", "Open Calendar to retry");
      return;
    }
    if (!headerCalendarResult) {
      updateCountdownAttributes(countdown, "loading", "Finding the next Calendar event.");
      updateCountdownText(countdown, "…", "CALENDAR", "Finding the next event");
      return;
    }
    if (headerCalendarResult.reauthorize) {
      updateCountdownAttributes(countdown, "reauthorize", "Calendar connection required. Reconnect Google to load events.");
      updateCountdownText(countdown, "—", "CALENDAR CONNECTION", "Reconnect Google to load events");
      return;
    }
    if (headerCalendarResult.authRequired) {
      updateCountdownAttributes(countdown, "sign-in", "Dashboard session ended. Sign in again to load Calendar events.");
      updateCountdownText(countdown, "—", "SIGN IN REQUIRED", "Open My Work Login");
      return;
    }
    var nowMs = Date.now();
    var next = headerCalendarResult.events.find(function (event) {
      var end = new Date(event.end || event.start).getTime();
      return Number.isFinite(end) && end >= nowMs;
    });
    if (!next) {
      updateCountdownAttributes(countdown, calendarIncomplete(headerCalendarResult) ? "partial" : "empty", calendarIncomplete(headerCalendarResult) ? "Calendar data is incomplete. No next event was returned from the sources that loaded." : "No upcoming Calendar event in the current window.");
      updateCountdownText(countdown, "—", calendarIncomplete(headerCalendarResult) ? "CALENDAR · INCOMPLETE" : "CALENDAR", calendarIncomplete(headerCalendarResult) ? "No next event in the sources that loaded" : "No upcoming event in the current window");
      return;
    }
    var startMs = new Date(next.start).getTime();
    var minutes = Number.isFinite(startMs) ? Math.max(0, Math.ceil((startMs - nowMs) / 60000)) : null;
    var value = minutes === null ? "—" : minutes < 1 ? "NOW" : minutes < 60 ? minutes + "m" : Math.floor(minutes / 60) + "h";
    updateCountdownAttributes(countdown, calendarIncomplete(headerCalendarResult) ? "partial" : "ready", (calendarIncomplete(headerCalendarResult) ? "Next known Calendar event from incomplete results: " : "Next Calendar event: ") + next.title + ", " + formatEventTime(next));
    updateCountdownText(countdown, value, calendarIncomplete(headerCalendarResult) ? "NEXT KNOWN · PARTIAL" : "NEXT CALENDAR EVENT", formatEventTime(next) + " · " + next.title);
  }
  function updateNodeText(node, value) {
    if (!node) return;
    if (node.textContent === String(value)) return;
    if (node.childNodes.length === 1 && node.firstChild.nodeType === 3) node.firstChild.data = String(value);
    else node.textContent = String(value);
  }
  function updateCountdownAttributes(countdown, stateName, label) {
    if (countdown.dataset.state !== stateName) countdown.dataset.state = stateName;
    if (countdown.getAttribute("aria-label") !== label) countdown.setAttribute("aria-label", label);
  }
  function updateCountdownText(countdown, value, label, detail) {
    updateNodeText(countdown.querySelector("b"), value);
    updateNodeText(countdown.querySelector("small"), label);
    updateNodeText(countdown.querySelector("span"), detail);
  }
  function refreshHeaderCountdown() {
    if (sessionAuthRequired) { renderHeaderCountdown(); return; }
    var requestId = ++headerCalendarRequestId;
    headerCalendarError = false;
    loadCalendar().then(function (result) {
      if (requestId !== headerCalendarRequestId) return;
      headerCalendarResult = result; renderHeaderCountdown();
    }).catch(function () {
      if (requestId !== headerCalendarRequestId) return;
      headerCalendarResult = null; headerCalendarError = true; renderHeaderCountdown();
    });
  }
  function ensureLiveCountdown(tools) {
    if (tools.querySelector(".ut-live-countdown")) return;
    var countdown = document.createElement("div");
    countdown.className = "headerCountdown ut-live-countdown";
    countdown.setAttribute("role", "status"); countdown.setAttribute("aria-live", "polite"); countdown.setAttribute("aria-atomic", "true");
    countdown.innerHTML = '<b></b><div><small></small><span></span></div>';
    tools.insertBefore(countdown, tools.firstChild);
    renderHeaderCountdown(); refreshHeaderCountdown();
    if (!headerCountdownTimer) headerCountdownTimer = setInterval(renderHeaderCountdown, 30000);
    if (!headerRefreshTimer) headerRefreshTimer = setInterval(refreshHeaderCountdown, 5 * 60 * 1000);
  }
  function wireHeader() {
    var tools = document.querySelector(".persistentTools"); if (!tools) return;
    ensureLiveCountdown(tools);
    var record = tools.querySelector(".globalRecord");
    if (record) { record.hidden = true; record.disabled = true; record.setAttribute("aria-hidden", "true"); }
    var prepare = tools.querySelector(".prepareHeader");
    if (prepare) {
      if (!prepare.dataset.liveWired) {
        prepare.addEventListener("click", function (event) { event.preventDefault(); event.stopImmediatePropagation(); showPrepareMe(); }, true);
        prepare.dataset.liveWired = "1";
      }
      prepare.classList.add("ut-live-ready"); prepare.hidden = false; prepare.disabled = false; prepare.removeAttribute("aria-hidden");
    }
    if (!tools.querySelector(".ut-search-button")) { var search = document.createElement("button"); search.className = "ut-search-button"; search.textContent = "Search"; search.addEventListener("click", showSearch); tools.insertBefore(search, prepare || tools.firstChild); }
    var profile = tools.querySelector(".profile");
    if (profile && !profile.dataset.liveWired) { profile.dataset.liveWired = "1"; profile.addEventListener("click", function (event) { event.preventDefault(); event.stopImmediatePropagation(); showAccount(); }, true); }
  }
  document.addEventListener("click", function (event) {
    var trigger = event.target.closest("button,a");
    if (trigger && !trigger.closest(".drawerShade")) lastNativeTrigger = trigger;
  }, true);
  document.addEventListener("click", function (event) {
    var prepare = event.target.closest("[data-prepare-event]");
    if (prepare) { event.preventDefault(); prepareEvent(prepare.dataset.prepareEvent); return; }
    var tab = event.target.closest(".sectionTabs button");
    if (tab) {
      document.querySelectorAll(".sectionTabs button").forEach(function (button) { button.classList.toggle("active", button === tab); });
      syncSectionAccessibility();
      scheduleActivePage(60);
    }
  });
  function reconcileObservedDom() {
    wireHeader(); syncSectionAccessibility(); suppressNativeShell(document.querySelector(".topShell")); clarifyNativeProvenance(currentPage()); enhanceNativeDialogs();
  }
  var observer = new MutationObserver(function () {
    if (observerWorkTimer !== null) return;
    /* Apply safety labels and dialog semantics in the mutation microtask so
       newly committed native drawers never expose the old connected-source
       claim for a frame. Re-run after the coalescing window so a second
       meaningful mutation cannot be lost while the guard is active. */
    observerWorkTimer = setTimeout(function () {
      observerWorkTimer = null;
      reconcileObservedDom();
      scheduleActivePage(0);
    }, 0);
    reconcileObservedDom();
  });
  function scheduleActivePage(delay) {
    if (activePageTimer !== null) clearTimeout(activePageTimer);
    activePageTimer = setTimeout(function () { activePageTimer = null; syncActivePage(); }, delay);
  }
  function start() {
    wireHeader(); syncSectionAccessibility(); clarifyNativeProvenance(currentPage());
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("storage", function (event) {
      if (event.key === STORAGE_KEY && event.newValue !== null) { try { localStorage.removeItem(STORAGE_KEY); } catch (_) {} }
      if (event.key === SECTION_ACTION_STORAGE_KEY) { sectionActionState = readSectionActionState(); updateActionCount(); }
    });
    scheduleActivePage(80);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
}());
