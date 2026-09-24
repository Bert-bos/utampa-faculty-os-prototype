(function () {
  "use strict";
  if (window.__utampaLiveInitialized) return;
  window.__utampaLiveInitialized = true;
  var STORAGE_KEY = "utampa-faculty-os-actions-v1";
  var state = readState();
  var activeNativeShade = null;
  var lastNativeTrigger = null;
  var headerCalendarResult = null;
  var headerCalendarError = false;
  var headerCountdownTimer = null;
  var headerRefreshTimer = null;
  var headerCalendarRequestId = 0;
  var activePageTimer = null;
  var observerWorkTimer = null;

  function readState() {
    try {
      var parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
      var clean = {};
      Object.keys(parsed).forEach(function (key) {
        var record = parsed[key];
        if (!record || typeof record !== "object" || typeof record.status !== "string") return;
        clean[String(key).slice(0, 240)] = {
          status: record.status, target: typeof record.target === "string" ? record.target.slice(0, 120) : "",
          updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : ""
        };
      });
      return clean;
    }
    catch (_) { return {}; }
  }
  function writeState() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); return true; }
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
    if (response.status === 409 && body.error === "reauthorization_required") return { reauthorize: true };
    if (!response.ok) throw new Error(body.error || "Request failed");
    return body;
  }
  function reconnectMarkup() {
    return '<div class="ut-empty" role="status" aria-live="polite" aria-atomic="true"><h3>Reconnect Google to finish setup</h3><p>Your current Google authorization is unavailable or does not include the required Calendar and Drive read-only access.</p><a class="ut-primary" href="/auth/google?next=' + encodeURIComponent(location.pathname + location.search) + '">Reconnect Google</a></div>';
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
    return '<div class="ut-mobile-actions" aria-label="Dashboard actions"><button class="ut-mobile-actions-center">Actions' + (Object.keys(state).length ? ' (' + Object.keys(state).length + ')' : '') + '</button><button class="ut-mobile-search">Search</button><button class="ut-mobile-prepare">Prepare me</button></div>';
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
  function serviceEventMarkup(event) {
    var link = event.url ? '<a href="' + escapeHtml(event.url) + '" target="_blank" rel="noopener">Open in Google Calendar</a>' : "";
    var source = event.calendar ? '<p>' + escapeHtml(event.calendar) + '</p>' : "";
    return '<article class="ut-event ut-service-event"><div><time>' + escapeHtml(formatEventTime(event)) + '</time><h3>' + escapeHtml(event.title) + '</h3>' + source + '</div><div class="ut-inline-actions">' + link + '</div></article>';
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
    if (result.reauthorize) return result;
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
    document.body.classList.add("ut-live-managed", "ut-live-calendar");
    var shell = document.querySelector(".topShell");
    if (!shell) return;
    var managed = shell.querySelector(".ut-live-view"); if (managed) managed.remove();
    var panel = shell.querySelector(".ut-calendar-panel");
    if (!panel) {
      panel = document.createElement("section");
      panel.className = "ut-calendar-panel";
      panel.innerHTML = '<div class="ut-panel-head"><div><p class="eyebrow">GOOGLE CALENDAR · READ-ONLY</p><h2>Calendar</h2><span>Events visible through authorized Google Calendar access for bert@bertseither.com, including selected or subscribed calendars. No University account or institutional system is connected.</span></div><button class="ut-refresh">Refresh</button></div>' + mobileActionsMarkup() + '<div class="ut-calendar-content" role="status" aria-live="polite" aria-atomic="true"><div class="ut-loading">Loading authorized calendar…</div></div>';
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
      if (result.reauthorize) content.innerHTML = reconnectMarkup();
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
  function restoreNativeView() {
    document.body.classList.remove("ut-live-managed", "ut-live-calendar");
    document.querySelectorAll(".ut-live-view,.ut-calendar-panel").forEach(function (node) { node.remove(); });
  }
  function sourceStatus(page) {
    return {
      Today: ["PROTOTYPE DECISION WORKSPACE", "Ranking and work items are prototype content until an approved work-item feed is connected."],
      Teaching: ["PROTOTYPE COURSE WORKSPACE", "Canvas and student systems are not connected. Course, student, message, and engagement details shown below are illustrative."],
      Research: ["PROTOTYPE RESEARCH WORKSPACE", "Research workflow is not connected to a verified live project feed yet."],
      Service: ["MIXED SOURCES", "The Calendar area shows authorized event-title matches for program keywords; affiliation is not verified. Founder, internship, mentor, attendance, and roster areas remain sample/prototype."],
      People: ["MIXED PROTOTYPE · VERIFY BEFORE USE", "No directory, contacts, or student system is connected. Entries marked source-needed are not verified."]
    }[page];
  }
  function showNativeStatus(page) {
    restoreNativeView();
    var shell = document.querySelector(".topShell");
    var status = sourceStatus(page);
    if (!shell || !status) return;
    var banner = shell.querySelector(".ut-source-status");
    if (!banner) {
      banner = document.createElement("section");
      banner.className = "ut-source-status";
      shell.prepend(banner);
    }
    banner.dataset.page = page;
    banner.innerHTML = '<div><strong>' + escapeHtml(status[0]) + '</strong><span>' + escapeHtml(status[1]) + '</span></div>' + mobileActionsMarkup();
    wireMobileActions(banner);
    clarifyNativeProvenance(page);
    if (page === "Service") setTimeout(renderServiceSchedule, 0);
  }
  function renderServiceSchedule() {
    var schedule = document.querySelector(".lecCalendar.hoverCalendar.promoted");
    if (!schedule || schedule.dataset.liveSchedule) return;
    var requestId = (schedule._utCalendarRequestId || 0) + 1;
    schedule._utCalendarRequestId = requestId;
    schedule.dataset.liveSchedule = "loading";
    schedule.setAttribute("aria-busy", "true");
    schedule.innerHTML = '<div class="ut-service-schedule-head"><div><p class="eyebrow">AUTHORIZED CALENDAR TITLE MATCHES · READ-ONLY</p><h2>Possible program events</h2><p>Matched only by event-title keywords; program affiliation is not verified.</p></div><button class="ut-service-refresh">Refresh</button></div><div class="ut-service-schedule-body" role="status" aria-live="polite" aria-atomic="true"><div class="ut-loading">Loading authorized Calendar title matches…</div></div>';
    schedule.querySelector(".ut-service-refresh").addEventListener("click", function () { schedule.dataset.liveSchedule = ""; renderServiceSchedule(); });
    loadCalendar().then(function (result) {
      if (!schedule.isConnected || schedule._utCalendarRequestId !== requestId) return;
      var body = schedule.querySelector(".ut-service-schedule-body");
      if (!body) return;
      var eyebrow = schedule.querySelector(".ut-service-schedule-head .eyebrow");
      if (result.reauthorize) {
        if (eyebrow) eyebrow.textContent = "CALENDAR CONNECTION REQUIRED";
        schedule.dataset.liveSchedule = "reauthorize";
        return void (body.innerHTML = reconnectMarkup());
      }
      if (eyebrow) eyebrow.textContent = calendarIncomplete(result) ? "CALENDAR TITLE MATCHES · INCOMPLETE SOURCE" : "AUTHORIZED CALENDAR TITLE MATCHES · READ-ONLY";
      var nowMs = Date.now();
      var matches = result.events.filter(function (event) {
        var end = new Date(event.end || event.start).getTime();
        return /(?:spartan\s+incubator|\bincubator\b|\blowth\b|\blec\b)/i.test(event.title || "") && Number.isFinite(end) && end >= nowMs;
      });
      var quality = calendarQualityMarkup(result);
      if (!matches.length && calendarIncomplete(result)) body.innerHTML = quality + '<div class="ut-empty"><h3>No complete program schedule available</h3><p>No matching events were returned from the calendars that loaded. Retry before relying on this as an empty schedule.</p></div><p class="ut-source">Source: ' + escapeHtml(result.source) + '</p>';
      else if (!matches.length) body.innerHTML = '<div class="ut-empty"><h3>No matching Calendar titles found</h3><p>No upcoming event titles containing Spartan Incubator, Incubator, Lowth, or LEC were found in the authorized Calendar window.</p></div><p class="ut-source">Source: ' + escapeHtml(result.source) + '</p>';
      else body.innerHTML = quality + '<div class="ut-service-events">' + matches.map(serviceEventMarkup).join("") + '</div><p class="ut-source">Source: ' + escapeHtml(result.source) + '</p>';
      schedule.dataset.liveSchedule = "ready";
    }).catch(function () {
      if (!schedule.isConnected || schedule._utCalendarRequestId !== requestId) return;
      var body = schedule.querySelector(".ut-service-schedule-body");
      var eyebrow = schedule.querySelector(".ut-service-schedule-head .eyebrow");
      if (eyebrow) eyebrow.textContent = "CALENDAR SCHEDULE UNAVAILABLE";
      if (body) body.innerHTML = '<div class="ut-empty" role="alert" aria-live="assertive" aria-atomic="true"><h3>Program schedule unavailable</h3><p>Google Calendar could not be read. Static or sample program events are not shown as a fallback.</p><button class="ut-retry">Try again</button></div>';
      var retry = schedule.querySelector(".ut-retry");
      if (retry) retry.addEventListener("click", function () { schedule.dataset.liveSchedule = ""; renderServiceSchedule(); });
      schedule.dataset.liveSchedule = "error";
    }).finally(function () {
      if (schedule.isConnected && schedule._utCalendarRequestId === requestId) schedule.removeAttribute("aria-busy");
    });
  }
  function syncActivePage() {
    var active = document.querySelector(".sectionTabs button.active");
    if (!active) return;
    var page = tabPage(active);
    if (page === "Calendar") {
      var nativeCalendar = document.querySelector(".topShell .calendarHeader,.topShell .gcal");
      if (nativeCalendar && !document.querySelector(".ut-calendar-panel")) showCalendarPanel();
    } else {
      var status = document.querySelector('.ut-source-status[data-page="' + page + '"]');
      if (!status) showNativeStatus(page);
      else if (page === "Service") renderServiceSchedule();
    }
  }
  async function prepareEvent(title) {
    var drawer = loadingDrawer("Prepare Me · " + title);
    try {
      var result = await requestJson("/api/drive?q=" + encodeURIComponent(title.split(/[·:\-]/)[0].trim()));
      var body = drawer.querySelector(".ut-live-body");
      if (result.reauthorize) body.innerHTML = reconnectMarkup();
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
      if (calendar.reauthorize) return void (body.innerHTML = reconnectMarkup());
      var next = calendar.events.find(function (event) { return new Date(event.end || event.start).getTime() >= Date.now(); });
      if (!next && calendarIncomplete(calendar)) return void (body.innerHTML = calendarQualityMarkup(calendar) + '<div class="ut-empty"><h3>No complete preparation result</h3><p>No upcoming event was returned from the calendars that loaded. Retry before treating this as an empty schedule.</p></div>');
      if (!next) return void (body.innerHTML = '<div class="ut-empty"><h3>No upcoming event</h3><p>There is no upcoming event in the authorized Calendar window.</p></div>');
      body.innerHTML = calendarQualityMarkup(calendar) + eventMarkup(next) + '<div class="ut-loading" role="status">Finding related Drive filename matches…</div>';
      var drive = await requestJson("/api/drive?q=" + encodeURIComponent(next.title.split(/[·:\-]/)[0].trim()));
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
  function applyTaskState() {
    document.querySelectorAll(".todayTask").forEach(function (button) {
      var title = (button.querySelector("h3") || {}).textContent || "";
      var record = state[title];
      button.hidden = Boolean(record && (record.status === "completed" || record.status === "dismissed" || record.status === "routed" || record.status === "route-staged"));
    });
    updateActionCount();
  }
  function updateActionCount() {
    var count = Object.keys(state).length;
    var countText = count ? " (" + count + ")" : "";
    document.querySelectorAll(".ut-actions-count").forEach(function (node) { if (node.textContent !== countText) node.textContent = countText; });
    document.querySelectorAll(".ut-mobile-actions-center").forEach(function (button) { var label = "Actions" + countText; if (button.textContent !== label) button.textContent = label; });
  }
  function actionRecordMarkup(title, record) {
    var status = String(record.status || "saved");
    var labels = { "route-staged": "Route staged locally", routed: "Route staged locally", previewed: "Prototype boundary reviewed", completed: "Completed", dismissed: "Dismissed", staged: "Prototype boundary reviewed" };
    var detail = (labels[status] || status.charAt(0).toUpperCase() + status.slice(1)) + (record.target ? " · " + record.target : "");
    return '<article class="ut-action-record" data-action-title="' + escapeHtml(title) + '"><div><h3>' + escapeHtml(title) + '</h3><p>' + escapeHtml(detail) + '</p><time>' + escapeHtml(formatDate(record.updatedAt, true)) + '</time></div><button class="ut-restore-action">Restore</button></article>';
  }
  function showActionCenter() {
    var entries = Object.keys(state).map(function (title) { return { title: title, record: state[title] }; }).sort(function (left, right) { return String(right.record.updatedAt).localeCompare(String(left.record.updatedAt)); });
    var body = entries.length
      ? '<p class="ut-source">Private browser state only. A staged route does not notify another person or system. Prototype form entries are never retained here.</p><div class="ut-action-history">' + entries.map(function (item) { return actionRecordMarkup(item.title, item.record); }).join("") + '</div>'
      : '<div class="ut-empty"><h3>No saved actions</h3><p>Completed, dismissed, locally staged routes, and reviewed prototype boundaries will appear here.</p></div>';
    var drawer = openDrawer("Actions", body, "PRIVATE BROWSER STATE");
    drawer.querySelectorAll(".ut-restore-action").forEach(function (button) {
      button.addEventListener("click", function () {
        var record = button.closest(".ut-action-record");
        var key = record.dataset.actionTitle;
        var previous = state[key];
        delete state[key];
        if (!writeState()) {
          state[key] = previous;
          button.textContent = "Try restore again";
          var error = record.querySelector(".ut-action-error");
          if (!error) { error = document.createElement("p"); error.className = "ut-action-error"; error.setAttribute("role", "alert"); record.querySelector("div").appendChild(error); }
          error.textContent = "Could not restore this item because browser storage is unavailable.";
          button.focus();
          return;
        }
        applyTaskState(); record.remove();
        var next = drawer.querySelector(".ut-restore-action");
        if (next) next.focus();
        else {
          drawer.querySelector(".ut-live-body").innerHTML = '<div class="ut-empty"><h3>No saved actions</h3><p>Completed, dismissed, locally staged routes, and reviewed prototype boundaries will appear here.</p></div>';
          drawer.querySelector(".drawerClose").focus();
        }
      });
    });
  }
  function saveAction(title, status, target) {
    var previous = state[title];
    state[title] = { status: status, target: target || "", updatedAt: new Date().toISOString() };
    if (!writeState()) {
      if (previous) state[title] = previous; else delete state[title];
      openDrawer("Action not saved", '<div class="ut-empty" role="alert"><h3>Browser storage is unavailable</h3><p>The item was not changed. Try again after enabling local browser storage.</p></div>', "PRIVATE BROWSER STATE");
      return;
    }
    applyTaskState();
    var shade = document.querySelector(".drawerShade:not(.ut-live-shade)");
    var focusTarget = document.querySelector(".ut-mobile-actions-center,.ut-actions-button,.sectionTabs button.active");
    if (shade) closeNativeDialog(shade, function () { if (focusTarget && focusTarget.isConnected) focusTarget.focus(); });
    var toast = document.createElement("div"); toast.className = "toast ut-toast";
    toast.setAttribute("role", "status"); toast.setAttribute("aria-live", "polite"); toast.setAttribute("aria-atomic", "true");
    toast.textContent = status === "route-staged" || status === "routed" ? "✓ Route staged locally for " + target + " · nobody notified" : status === "completed" ? "✓ Completed" : status === "previewed" || status === "staged" ? "✓ Prototype boundary reviewed" : "✓ Dismissed";
    document.body.appendChild(toast); setTimeout(function () { toast.remove(); }, 2400);
  }
  function stageExternalAction(button) {
    var label = button.textContent.trim();
    var container = button.closest(".drawer,.founderPortal");
    var inlineReply = button.closest(".reply,.phoneChat footer");
    if (!container && inlineReply) {
      var inlineKey = "Prototype boundary · inline reply · " + label;
      state[inlineKey] = { status: "previewed", target: label, updatedAt: new Date().toISOString() };
      var inlineMarkerSaved = writeState();
      if (!inlineMarkerSaved) delete state[inlineKey];
      updateActionCount();
      openDrawer("Send preview is not connected", '<div class="ut-brief"><strong>No message was sent or saved to a connected system</strong><p>Your draft remains only in this prototype page until you navigate away or refresh. SMS, email, and messaging systems are not connected.</p><p>' + (inlineMarkerSaved ? 'A private marker that you reviewed this boundary was saved in this browser.' : 'The private reviewed-boundary marker could not be saved because browser storage is unavailable.') + '</p></div>', "PROTOTYPE ACTION BOUNDARY", button);
      return true;
    }
    if (!container) return false;
    var heading = container.querySelector("h2");
    var title = heading ? heading.textContent.trim() : label;
    var key = "Prototype boundary · " + title + " · " + label;
    state[key] = { status: "previewed", target: label, updatedAt: new Date().toISOString() };
    var markerSaved = writeState();
    if (!markerSaved) delete state[key];
    updateActionCount();
    var shade = container.closest(".drawerShade,.portalShade");
    var returnFocus = shade && shade._utReturnFocus;
    closeNativeDialog(shade, function () {
      openDrawer("Prototype preview closed", '<div class="ut-brief"><strong>No connected-system action occurred</strong><p>No message, submission, draft, item, or evidence was sent, saved, opened, or started in a connected system. Values entered in this prototype were discarded when the preview closed. Email, Canvas, student systems, founder systems, and item-specific evidence are not connected.</p><p>' + (markerSaved ? 'A private marker that you reviewed this boundary was saved in this browser.' : 'The private reviewed-boundary marker could not be saved because browser storage is unavailable.') + '</p></div>', "PROTOTYPE ACTION BOUNDARY", returnFocus);
    });
    return true;
  }
  function enhanceTaskDrawer(drawer) {
    if (drawer.classList.contains("ut-live-drawer") || drawer.querySelector(".ut-action-controls")) return;
    if (currentPage() !== "Today") return;
    var heading = drawer.querySelector("h2"); if (!heading) return;
    var title = heading.textContent.split(" · ").pop().trim();
    var controls = document.createElement("div"); controls.className = "ut-action-controls";
    controls.innerHTML = '<strong>Manage this prototype item</strong><div><button class="ut-complete">Complete</button><label>Local route note <select aria-describedby="ut-route-disclosure ut-route-error"><option value="">Choose…</option><option>BOS</option><option>UTampa</option><option>Entrepreneurship Professor</option></select></label><button class="ut-route">Stage route locally</button><button class="ut-dismiss">Dismiss</button></div><p class="ut-route-error" id="ut-route-error" role="alert" hidden>Choose a local route note before staging.</p><small id="ut-route-disclosure">Saved privately in this browser. A staged route notifies nobody.</small>';
    controls.querySelector(".ut-complete").addEventListener("click", function () { saveAction(title, "completed"); });
    controls.querySelector(".ut-dismiss").addEventListener("click", function () { saveAction(title, "dismissed"); });
    var routeSelect = controls.querySelector("select");
    var routeError = controls.querySelector(".ut-route-error");
    routeSelect.addEventListener("change", function () { routeSelect.removeAttribute("aria-invalid"); routeError.hidden = true; });
    controls.querySelector(".ut-route").addEventListener("click", function () {
      var target = routeSelect.value;
      if (!target) { routeSelect.setAttribute("aria-invalid", "true"); routeError.hidden = false; routeSelect.focus(); return; }
      saveAction(title, "route-staged", target);
    });
    drawer.appendChild(controls);
  }
  function currentPage() {
    var active = document.querySelector(".sectionTabs button.active");
    return active ? tabPage(active) : "";
  }
  function clarifyNativeProvenance(page) {
    document.querySelectorAll('.topShell a[href*="docs.google.com"],.topShell a[href*="drive.google.com"]').forEach(function (link) {
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
      button.setAttribute("aria-label", label);
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
      drawer.querySelector(".ut-live-body").innerHTML = '<div class="ut-brief"><strong>Authorized account</strong><p>' + escapeHtml(me.email) + '</p></div><div class="ut-brief"><strong>Data boundary</strong><p>Google Calendar events visible to this account and Google Drive metadata are read-only. University accounts, Canvas, Workday, student records, and institutional systems are not connected.</p></div><form method="post" action="/logout"><button class="ut-primary">Sign out</button></form>';
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
    updateCountdownText(countdown, value, calendarIncomplete(headerCalendarResult) ? "NEXT KNOWN · PARTIAL" : "NEXT CALENDAR EVENT", next.title + " · " + formatEventTime(next));
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
    var prepare = tools.querySelector(".prepareHeader");
    if (prepare && !prepare.dataset.liveWired) { prepare.dataset.liveWired = "1"; prepare.addEventListener("click", function (event) { event.preventDefault(); event.stopImmediatePropagation(); showPrepareMe(); }, true); }
    if (!tools.querySelector(".ut-search-button")) { var search = document.createElement("button"); search.className = "ut-search-button"; search.textContent = "Search"; search.addEventListener("click", showSearch); tools.insertBefore(search, prepare || tools.firstChild); }
    var profile = tools.querySelector(".profile");
    if (profile && !profile.dataset.liveWired) { profile.dataset.liveWired = "1"; profile.addEventListener("click", function (event) { event.preventDefault(); event.stopImmediatePropagation(); showAccount(); }, true); }
  }
  document.addEventListener("click", function (event) {
    var trigger = event.target.closest("button,a");
    if (trigger && !trigger.closest(".drawerShade")) lastNativeTrigger = trigger;
  }, true);
  document.addEventListener("click", function (event) {
    var actionButton = event.target.closest("button");
    if (actionButton && /^(Send|Send…|Send\.\.\.|Share with founder|Submit update|Save draft|Edit myself|Approve \+ continue|View evidence|Not now)$/i.test(actionButton.textContent.trim()) && stageExternalAction(actionButton)) {
      event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation(); return;
    }
    if (actionButton && /record revision/i.test(actionButton.textContent.trim()) && actionButton.closest(".drawer,.founderPortal")) {
      event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation();
      var nativeShade = actionButton.closest(".drawerShade");
      var returnFocus = nativeShade && nativeShade._utReturnFocus;
      closeNativeDialog(nativeShade, function () {
        openDrawer("Recording is not connected", '<div class="ut-empty"><h3>Prototype control only</h3><p>No audio was captured and no automated revision was created. Typed text in the preview is not retained.</p></div>', "PROTOTYPE ACTION BOUNDARY", returnFocus);
      });
    }
  }, true);
  document.addEventListener("click", function (event) {
    var prepare = event.target.closest("[data-prepare-event]");
    if (prepare) { event.preventDefault(); prepareEvent(prepare.dataset.prepareEvent); return; }
    var tab = event.target.closest(".sectionTabs button");
    if (tab) {
      scheduleActivePage(60);
    }
  });
  function reconcileObservedDom() {
    wireHeader(); applyTaskState(); syncSectionAccessibility(); clarifyNativeProvenance(currentPage()); enhanceNativeDialogs();
    document.querySelectorAll(".drawer:not(.ut-live-drawer)").forEach(enhanceTaskDrawer);
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
    wireHeader(); applyTaskState(); syncSectionAccessibility(); clarifyNativeProvenance(currentPage());
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("storage", function (event) { if (event.key === STORAGE_KEY) { state = readState(); applyTaskState(); } });
    scheduleActivePage(80);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
}());
