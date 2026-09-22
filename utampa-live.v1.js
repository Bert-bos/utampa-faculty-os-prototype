(function () {
  "use strict";
  var STORAGE_KEY = "utampa-faculty-os-actions-v1";
  var state = readState();

  function readState() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); }
    catch (_) { return {}; }
  }
  function writeState() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
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
    return '<div class="ut-empty"><h3>Reconnect Google to finish setup</h3><p>The original sign-in approved identity only. Reconnect once to authorize Calendar and Drive metadata as read-only.</p><a class="ut-primary" href="/auth/google?next=' + encodeURIComponent(location.pathname + location.search) + '">Reconnect Google</a></div>';
  }
  function closeDrawer() {
    var current = document.querySelector(".ut-live-shade");
    if (current) current.remove();
  }
  function openDrawer(title, body) {
    closeDrawer();
    var shade = document.createElement("div");
    shade.className = "drawerShade ut-live-shade";
    shade.innerHTML = '<aside class="drawer ut-live-drawer" role="dialog" aria-modal="true" aria-labelledby="ut-live-title"><button class="drawerClose" aria-label="Close">×</button><p class="eyebrow">AUTHORIZED LIVE DATA</p><h2 id="ut-live-title">' + escapeHtml(title) + '</h2><div class="ut-live-body">' + body + '</div></aside>';
    shade.addEventListener("click", function (event) { if (event.target === shade) closeDrawer(); });
    shade.querySelector(".drawerClose").addEventListener("click", closeDrawer);
    document.body.appendChild(shade);
    shade.querySelector(".drawerClose").focus();
    return shade;
  }
  function loadingDrawer(title) { return openDrawer(title, '<div class="ut-loading" role="status">Loading authorized data…</div>'); }
  function mobileActionsMarkup() {
    return '<div class="ut-mobile-actions" aria-label="Dashboard actions"><button class="ut-mobile-search">Search</button><button class="ut-mobile-prepare">Prepare me</button></div>';
  }
  function wireMobileActions(container) {
    var search = container.querySelector(".ut-mobile-search");
    var prepare = container.querySelector(".ut-mobile-prepare");
    if (search) search.addEventListener("click", showSearch);
    if (prepare) prepare.addEventListener("click", showPrepareMe);
  }
  function eventMarkup(event) {
    var link = event.url ? '<a href="' + escapeHtml(event.url) + '" target="_blank" rel="noopener">Open in Google Calendar</a>' : "";
    var details = [event.calendar, event.location].filter(Boolean).map(function (value) { return escapeHtml(value); }).join(" · ");
    return '<article class="ut-event"><div><time>' + escapeHtml(event.allDay ? "All day" : formatDate(event.start, true)) + '</time><h3>' + escapeHtml(event.title) + '</h3>' + (details ? '<p>' + details + '</p>' : "") + '</div><div class="ut-inline-actions"><button data-prepare-event="' + escapeHtml(event.title) + '">Prepare me</button>' + link + '</div></article>';
  }
  function fileMarkup(file) {
    var link = file.url ? '<a href="' + escapeHtml(file.url) + '" target="_blank" rel="noopener">Open</a>' : "";
    return '<article class="ut-file"><div><h3>' + escapeHtml(file.name) + '</h3><p>Modified ' + escapeHtml(formatDate(file.modifiedTime, true)) + '</p></div>' + link + '</article>';
  }
  async function loadCalendar() {
    var result = await requestJson("/api/calendar");
    if (result.reauthorize) return result;
    return { events: result.events || [], source: result.source };
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
      panel.innerHTML = '<div class="ut-panel-head"><div><p class="eyebrow">GOOGLE CALENDAR · READ-ONLY</p><h2>Calendar</h2><span>Authorized events from bert@bertseither.com. No University account or institutional system is connected.</span></div><button class="ut-refresh">Refresh</button></div>' + mobileActionsMarkup() + '<div class="ut-calendar-content"><div class="ut-loading">Loading authorized calendar…</div></div>';
      shell.prepend(panel);
      panel.querySelector(".ut-refresh").addEventListener("click", showCalendarPanel);
      wireMobileActions(panel);
    }
    var content = panel.querySelector(".ut-calendar-content");
    content.innerHTML = '<div class="ut-loading">Loading authorized calendar…</div>';
    try {
      var result = await loadCalendar();
      if (result.reauthorize) content.innerHTML = reconnectMarkup();
      else if (!result.events.length) content.innerHTML = '<div class="ut-empty"><h3>No events found</h3><p>Your selected personal Google calendars have no events in the next two weeks.</p></div>';
      else content.innerHTML = '<div class="ut-event-list">' + result.events.map(eventMarkup).join("") + '</div><p class="ut-source">Source: ' + escapeHtml(result.source) + '</p>';
    } catch (_) {
      content.innerHTML = '<div class="ut-empty"><h3>Calendar is temporarily unavailable</h3><p>The dashboard could not read Google Calendar. Nothing was changed.</p><button class="ut-retry">Try again</button></div>';
      content.querySelector(".ut-retry").addEventListener("click", showCalendarPanel);
    }
  }
  function restoreNativeView() {
    document.body.classList.remove("ut-live-managed", "ut-live-calendar");
    document.querySelectorAll(".ut-live-view,.ut-calendar-panel").forEach(function (node) { node.remove(); });
  }
  function sourceStatus(page) {
    return {
      Today: ["PROTOTYPE DECISION WORKSPACE", "Ranking and work items are prototype content until an approved work-item feed is connected."],
      Teaching: ["SOURCE-LINKED PROTOTYPE", "Course workspace only. Canvas and student systems are not connected; synthetic student examples remain clearly labeled."],
      Research: ["SOURCE-LINKED PROTOTYPE", "Research workflow is not connected to a verified live project feed yet."],
      Service: ["SAMPLE / PROTOTYPE DATA", "Service workflows are not connected to the private founder or student records. Treat names and metrics as illustrative."],
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
    }
  }
  async function prepareEvent(title) {
    var drawer = loadingDrawer("Prepare Me · " + title);
    try {
      var result = await requestJson("/api/drive?q=" + encodeURIComponent(title.split(/[·:\-]/)[0].trim()));
      var body = drawer.querySelector(".ut-live-body");
      if (result.reauthorize) body.innerHTML = reconnectMarkup();
      else {
        var files = result.files || [];
        body.innerHTML = '<div class="ut-brief"><strong>Next preparation move</strong><p>Review the event details, then open the most relevant recent source below.</p></div>' + (files.length ? '<div class="ut-file-list">' + files.slice(0, 8).map(fileMarkup).join("") + '</div>' : '<div class="ut-empty"><p>No related Drive files were found. That is a legitimate empty result.</p></div>') + '<p class="ut-source">Source: ' + escapeHtml(result.source) + '</p>';
      }
    } catch (_) { drawer.querySelector(".ut-live-body").innerHTML = '<div class="ut-empty"><h3>Preparation sources unavailable</h3><p>No files were changed. Try again shortly.</p></div>'; }
  }
  async function showPrepareMe() {
    var drawer = loadingDrawer("Prepare Me");
    try {
      var calendar = await loadCalendar();
      var body = drawer.querySelector(".ut-live-body");
      if (calendar.reauthorize) return void (body.innerHTML = reconnectMarkup());
      var next = calendar.events.find(function (event) { return new Date(event.end || event.start).getTime() >= Date.now(); });
      if (!next) return void (body.innerHTML = '<div class="ut-empty"><h3>No upcoming event</h3><p>There is nothing on your personal Google Calendar to prepare for in the next two weeks.</p></div>');
      body.innerHTML = eventMarkup(next) + '<div class="ut-loading">Finding related Drive sources…</div>';
      var drive = await requestJson("/api/drive?q=" + encodeURIComponent(next.title.split(/[·:\-]/)[0].trim()));
      if (drive.reauthorize) return void (body.innerHTML += reconnectMarkup());
      var files = drive.files || [];
      body.innerHTML += '<h3 class="ut-section-title">Related recent files</h3>' + (files.length ? '<div class="ut-file-list">' + files.slice(0, 6).map(fileMarkup).join("") + '</div>' : '<div class="ut-empty"><p>No related Drive files were found. Nothing is missing from the dashboard.</p></div>') + '<p class="ut-source">Sources: Google Calendar + Google Drive metadata · read-only</p>';
    } catch (_) { drawer.querySelector(".ut-live-body").innerHTML = '<div class="ut-empty"><h3>Prepare Me is temporarily unavailable</h3><p>The dashboard could not retrieve authorized Google data. Nothing was changed.</p></div>'; }
  }
  function showSearch() {
    var drawer = openDrawer("Search Calendar and Drive", '<form class="ut-search-form"><label for="ut-search-input">Search your authorized personal Google sources</label><div><input id="ut-search-input" maxlength="100" autocomplete="off" placeholder="Class, project, person, or topic"><button class="ut-primary">Search</button></div></form><div class="ut-search-results"><p class="ut-source">Read-only search. No University account or student system is connected.</p></div>');
    var form = drawer.querySelector("form");
    form.addEventListener("submit", async function (event) {
      event.preventDefault();
      var query = drawer.querySelector("input").value.trim();
      var output = drawer.querySelector(".ut-search-results");
      if (!query) return void (output.innerHTML = '<div class="ut-empty"><p>Enter a search term.</p></div>');
      output.innerHTML = '<div class="ut-loading">Searching authorized sources…</div>';
      try {
        var results = await Promise.all([loadCalendar(), requestJson("/api/drive?q=" + encodeURIComponent(query))]);
        if (results.some(function (item) { return item.reauthorize; })) return void (output.innerHTML = reconnectMarkup());
        var events = results[0].events.filter(function (item) { return item.title.toLowerCase().includes(query.toLowerCase()); });
        var files = results[1].files || [];
        output.innerHTML = '<h3 class="ut-section-title">Calendar</h3>' + (events.length ? events.map(eventMarkup).join("") : '<p class="ut-empty">No matching calendar events.</p>') + '<h3 class="ut-section-title">Drive</h3>' + (files.length ? files.map(fileMarkup).join("") : '<p class="ut-empty">No matching Drive files.</p>');
      } catch (_) { output.innerHTML = '<div class="ut-empty"><p>Search is temporarily unavailable. Nothing was changed.</p></div>'; }
    });
    drawer.querySelector("input").focus();
  }
  function applyTaskState() {
    document.querySelectorAll(".todayTask").forEach(function (button) {
      var title = (button.querySelector("h3") || {}).textContent || "";
      var record = state[title];
      button.hidden = Boolean(record && (record.status === "completed" || record.status === "dismissed" || record.status === "routed"));
    });
  }
  function saveAction(title, status, target) {
    state[title] = { status: status, target: target || "", updatedAt: new Date().toISOString() };
    writeState(); applyTaskState();
    var shade = document.querySelector(".drawerShade:not(.ut-live-shade)");
    if (shade) shade.remove();
    var toast = document.createElement("div"); toast.className = "toast ut-toast";
    toast.textContent = status === "routed" ? "✓ Routed to " + target : status === "completed" ? "✓ Completed" : "✓ Dismissed";
    document.body.appendChild(toast); setTimeout(function () { toast.remove(); }, 2400);
  }
  function enhanceTaskDrawer(drawer) {
    if (drawer.classList.contains("ut-live-drawer") || drawer.querySelector(".ut-action-controls")) return;
    var heading = drawer.querySelector("h2"); if (!heading) return;
    var title = heading.textContent.split(" · ").pop().trim();
    var controls = document.createElement("div"); controls.className = "ut-action-controls";
    controls.innerHTML = '<strong>Manage this item</strong><div><button class="ut-complete">Complete</button><label>Route <select><option value="">Choose…</option><option>BOS</option><option>UTampa</option><option>Entrepreneurship Professor</option></select></label><button class="ut-route">Route</button><button class="ut-dismiss">Dismiss</button></div><small>Saved privately in this browser.</small>';
    controls.querySelector(".ut-complete").addEventListener("click", function () { saveAction(title, "completed"); });
    controls.querySelector(".ut-dismiss").addEventListener("click", function () { saveAction(title, "dismissed"); });
    controls.querySelector(".ut-route").addEventListener("click", function () { var target = controls.querySelector("select").value; if (!target) return void controls.querySelector("select").focus(); saveAction(title, "routed", target); });
    drawer.appendChild(controls);
  }
  function showAccount() {
    var drawer = loadingDrawer("Account and data boundary");
    requestJson("/api/me").then(function (me) {
      drawer.querySelector(".ut-live-body").innerHTML = '<div class="ut-brief"><strong>Authorized account</strong><p>' + escapeHtml(me.email) + '</p></div><div class="ut-brief"><strong>Data boundary</strong><p>Personal Google Calendar and Drive metadata are read-only. University accounts, Canvas, Workday, student records, and institutional systems are not connected.</p></div><form method="post" action="/logout"><button class="ut-primary">Sign out</button></form>';
    }).catch(function () { drawer.querySelector(".ut-live-body").innerHTML = '<div class="ut-empty"><p>Account details are temporarily unavailable.</p></div>'; });
  }
  function wireHeader() {
    var tools = document.querySelector(".persistentTools"); if (!tools) return;
    var prepare = tools.querySelector(".prepareHeader");
    if (prepare && !prepare.dataset.liveWired) { prepare.dataset.liveWired = "1"; prepare.addEventListener("click", function (event) { event.preventDefault(); event.stopImmediatePropagation(); showPrepareMe(); }, true); }
    if (!tools.querySelector(".ut-search-button")) { var search = document.createElement("button"); search.className = "ut-search-button"; search.textContent = "Search"; search.addEventListener("click", showSearch); tools.insertBefore(search, prepare || tools.firstChild); }
    var profile = tools.querySelector(".profile");
    if (profile && !profile.dataset.liveWired) { profile.dataset.liveWired = "1"; profile.addEventListener("click", function (event) { event.preventDefault(); event.stopImmediatePropagation(); showAccount(); }, true); }
  }
  document.addEventListener("click", function (event) {
    var prepare = event.target.closest("[data-prepare-event]");
    if (prepare) { event.preventDefault(); prepareEvent(prepare.dataset.prepareEvent); return; }
    var tab = event.target.closest(".sectionTabs button");
    if (tab) {
      var page = tabPage(tab);
      setTimeout(function () { if (page === "Calendar") showCalendarPanel(); else showNativeStatus(page); }, 60);
    }
  });
  var observer = new MutationObserver(function () {
    wireHeader(); applyTaskState(); document.querySelectorAll(".drawer:not(.ut-live-drawer)").forEach(enhanceTaskDrawer);
    setTimeout(syncActivePage, 0);
  });
  function start() { wireHeader(); applyTaskState(); observer.observe(document.body, { childList: true, subtree: true }); setTimeout(syncActivePage, 80); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
}());
