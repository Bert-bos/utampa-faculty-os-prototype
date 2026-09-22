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
  function eventMarkup(event) {
    var link = event.url ? '<a href="' + escapeHtml(event.url) + '" target="_blank" rel="noopener">Open in Google Calendar</a>' : "";
    return '<article class="ut-event"><div><time>' + escapeHtml(event.allDay ? "All day" : formatDate(event.start, true)) + '</time><h3>' + escapeHtml(event.title) + '</h3>' + (event.location ? '<p>' + escapeHtml(event.location) + '</p>' : "") + '</div><div class="ut-inline-actions"><button data-prepare-event="' + escapeHtml(event.title) + '">Prepare me</button>' + link + '</div></article>';
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
      panel.innerHTML = '<div class="ut-panel-head"><div><p class="eyebrow">GOOGLE CALENDAR · READ-ONLY</p><h2>Calendar</h2><span>Authorized events from bert@bertseither.com. No University account or institutional system is connected.</span></div><button class="ut-refresh">Refresh</button></div><div class="ut-calendar-content"><div class="ut-loading">Loading authorized calendar…</div></div>';
      shell.prepend(panel);
      panel.querySelector(".ut-refresh").addEventListener("click", showCalendarPanel);
    }
    var content = panel.querySelector(".ut-calendar-content");
    content.innerHTML = '<div class="ut-loading">Loading authorized calendar…</div>';
    try {
      var result = await loadCalendar();
      if (result.reauthorize) content.innerHTML = reconnectMarkup();
      else if (!result.events.length) content.innerHTML = '<div class="ut-empty"><h3>No events found</h3><p>Your personal Google Calendar has no events in the next two weeks.</p></div>';
      else content.innerHTML = '<div class="ut-event-list">' + result.events.map(eventMarkup).join("") + '</div><p class="ut-source">Source: ' + escapeHtml(result.source) + '</p>';
    } catch (_) {
      content.innerHTML = '<div class="ut-empty"><h3>Calendar is temporarily unavailable</h3><p>The dashboard could not read Google Calendar. Nothing was changed.</p><button class="ut-retry">Try again</button></div>';
      content.querySelector(".ut-retry").addEventListener("click", showCalendarPanel);
    }
  }
  function actionHistoryMarkup() {
    var items = Object.keys(state).map(function (title) { return { title: title, record: state[title] }; }).sort(function (left, right) { return String(right.record.updatedAt).localeCompare(String(left.record.updatedAt)); });
    if (!items.length) return '<div class="ut-empty"><h3>No saved decisions yet</h3><p>Complete, route, or dismiss an item and the decision will persist privately in this browser.</p></div>';
    return '<div class="ut-action-history">' + items.slice(0, 10).map(function (item) { return '<article class="ut-file"><div><h3>' + escapeHtml(item.title) + '</h3><p>' + escapeHtml(item.record.status) + (item.record.target ? ' · ' + escapeHtml(item.record.target) : '') + '</p></div><time>' + escapeHtml(formatDate(item.record.updatedAt, true)) + '</time></article>'; }).join("") + '</div>';
  }
  async function showManagedView(page) {
    if (page === "Calendar") return showCalendarPanel();
    document.body.classList.add("ut-live-managed"); document.body.classList.remove("ut-live-calendar");
    var shell = document.querySelector(".topShell"); if (!shell) return;
    var old = shell.querySelector(".ut-live-view,.ut-calendar-panel"); if (old) old.remove();
    var view = document.createElement("section"); view.className = "ut-live-view";
    var descriptions = { Today: "Your next authorized calendar commitments, recent Drive sources, and saved decisions.", Teaching: "Teaching-related items found in your personal Google Calendar and Drive metadata.", Research: "Research-related items found in your personal Google Calendar and Drive metadata.", Service: "Spartan Incubator and service-related items found in your personal Google sources.", People: "No contacts or student-record source is connected. Search remains limited to Calendar and Drive metadata." };
    view.innerHTML = '<div class="ut-panel-head"><div><p class="eyebrow">AUTHORIZED PERSONAL GOOGLE SOURCES</p><h2>' + escapeHtml(page) + '</h2><span>' + escapeHtml(descriptions[page] || "Authorized live data") + '</span></div><button class="ut-refresh">Refresh</button></div><div class="ut-managed-content"><div class="ut-loading">Loading authorized data…</div></div>';
    shell.prepend(view); view.querySelector(".ut-refresh").addEventListener("click", function () { showManagedView(page); });
    var content = view.querySelector(".ut-managed-content");
    if (page === "People") {
      content.innerHTML = '<div class="ut-empty"><h3>No authorized people source connected</h3><p>Google Contacts, University directories, Canvas, student records, and institutional systems are intentionally excluded. Use Search for calendar events or Drive files instead.</p><button class="ut-open-search">Search authorized sources</button></div>';
      content.querySelector(".ut-open-search").addEventListener("click", showSearch); return;
    }
    var query = { Today: "", Teaching: "ENT", Research: "research", Service: "Spartan" }[page] || "";
    try {
      var results = await Promise.all([loadCalendar(), requestJson("/api/drive?q=" + encodeURIComponent(query))]);
      if (results.some(function (item) { return item.reauthorize; })) return void (content.innerHTML = reconnectMarkup());
      var terms = { Teaching: /ENT|class|course|office hours|teaching/i, Research: /research|manuscript|analysis|study|IRB/i, Service: /Spartan|incubator|mentor|service|LEC/i }[page];
      var events = terms ? results[0].events.filter(function (item) { return terms.test(item.title); }) : results[0].events;
      var files = results[1].files || [];
      content.innerHTML = '<div class="ut-managed-grid"><section><h3>Calendar</h3>' + (events.length ? '<div class="ut-event-list">' + events.slice(0, 12).map(eventMarkup).join("") + '</div>' : '<div class="ut-empty"><p>No matching authorized calendar events.</p></div>') + '</section><section><h3>Recent Drive files</h3>' + (files.length ? '<div class="ut-file-list">' + files.slice(0, 10).map(fileMarkup).join("") + '</div>' : '<div class="ut-empty"><p>No matching authorized Drive files.</p></div>') + '</section></div>' + (page === "Today" ? '<section class="ut-decisions"><h3>Saved decisions</h3>' + actionHistoryMarkup() + '</section>' : '') + '<p class="ut-source">Sources: Google Calendar + Google Drive metadata · read-only</p>';
    } catch (_) { content.innerHTML = '<div class="ut-empty"><h3>Authorized sources are temporarily unavailable</h3><p>Nothing was changed. Refresh to try again.</p></div>'; }
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
    if (tab) { var page = tab.textContent.replace(/[0-9]/g, "").trim(); setTimeout(function () { showManagedView(page); }, 60); }
  });
  var observer = new MutationObserver(function () {
    wireHeader(); applyTaskState(); document.querySelectorAll(".drawer:not(.ut-live-drawer)").forEach(enhanceTaskDrawer);
    var active = document.querySelector(".sectionTabs button.active"); if (active && !document.querySelector(".ut-live-view,.ut-calendar-panel")) setTimeout(function () { showManagedView(active.textContent.replace(/[0-9]/g, "").trim()); }, 0);
  });
  function start() { wireHeader(); applyTaskState(); observer.observe(document.body, { childList: true, subtree: true }); setTimeout(function () { showManagedView("Today"); }, 80); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
}());
