/* ============================================================================
   SHARED RECORDING COMPONENT — v3 — CC-20260904-BRIDGE-012
   One component, identical in every workspace. Satisfies the approved
   implementation packet requirement that the header recording control open a
   side panel with Start / Pause / Stop + Save, a visible timer, and a
   confirmable filing destination — and NOT a "recording started" toast.

   HOW TO APPLY
     Immediately before </body> in each workspace's index.html, after the
     integration-layer shim, insert:
        <link rel="stylesheet" href="cc-recorder.css">   (or inline the CSS)
        <script src="cc-recorder.js"></script>           (or inline this file)
     Nothing else changes. No build step, no framework, no dependency.

   WHAT IT TOUCHES
     - Adds one <aside id="cc-recorder"> to <body>. Nothing existing is removed.
     - Intercepts clicks on the header record control in the CAPTURE phase, so
       the prototype's own handler never runs. Attributes only are set on that
       control — children are never rewritten (rewriting children tripped React
       hydration error #418 in the UTampa bundle; same rule as the shim).
     - BOSS's separate "Send to BOS" capture panel (#recording, opened by
       #voiceBtn) is deliberately left untouched. It is a different feature.

   DATA
     Prototype only. No audio, video or transcript is captured, requested or
     transmitted. getUserMedia is never called. The panel states this on its
     face. Destinations are the workspace's own approved section names.
   ==========================================================================*/
(function () {
  "use strict";

  var DEST_FALLBACK = ["Needs Bert", "Projects", "Messages"];

  /* Per-workspace configuration. `control` is matched in document order; the
     first selector that resolves wins. `destinations` is a function so the
     list can be read from the workspace's own navigation and stay in the
     approved terminology rather than being retyped here. */
  var WORKSPACES = {
    bos: {
      label: "BOS",
      control: ["#recordMeeting", ".record-top"],
      destinations: function () {
        return list("nav.section-nav button[data-view]", textOf)
          .filter(function (n) { return n && n !== "Today" && n !== "Calendar"; });
      }
    },
    ep: {
      label: "Entrepreneurship Professor",
      control: ["#quickRecord", ".header-actions .record-btn"],
      /* EP's own copy: "BOS will determine whether this is training, content,
         a reply, an opportunity, or a task." Those are its destinations. */
      destinations: function () {
        return ["Training", "Content", "Reply", "Opportunity", "Task"];
      }
    },
    utampa: {
      label: "University of Tampa",
      /* Verified against app/page.tsx of the owned Sites source repository
         (UTAMPA FULL SOURCE, SHA-256 6fd0164...9ad2): the header control is
         <button className={recording ? "globalRecord live" : "globalRecord"}
         aria-label="Record meeting"> inside .persistentTools. It carries no id
         and no data-* attribute, so .globalRecord is the match, and it is the
         first selector in this list. */
      control: [".globalRecord", "#globalRecord", ".persistentTools .recordBtn"],
      /* Each nav.sectionTabs button renders <Icon>glyph</Icon> + label +
         <em>count</em>, so textContent would yield "◆Today6". Read the
         button's own text nodes only. "Calendar" is excluded because UTampa's
         own recording panel offers Today / Teaching / Research / Service /
         People as filing destinations and not Calendar - its approved
         terminology, read from its markup rather than retyped here. */
      destinations: function () {
        return list("nav.sectionTabs button", textOf).filter(function (n) {
          return n && n !== "Calendar";
        });
      }
    }
  };

  /* An element's OWN text nodes only - ignores icon glyphs and count badges
     that the prototypes render as element children of the same button. */
  function textOf(el) {
    var out = "";
    for (var i = 0; i < el.childNodes.length; i++) {
      if (el.childNodes[i].nodeType === 3) out += el.childNodes[i].nodeValue;
    }
    return out.trim();
  }

  function list(sel, fn) {
    var out = [];
    document.querySelectorAll(sel).forEach(function (el) {
      var v = fn(el);
      if (v && out.indexOf(v) === -1) out.push(v);
    });
    return out;
  }

  /* --- which workspace are we in? ---------------------------------------- */
  function detect() {
    var explicit = document.documentElement.getAttribute("data-cc-workspace");
    if (explicit && WORKSPACES[explicit]) return explicit;
    /* The integration-layer shim marks the active switcher button. */
    var cur = document.querySelector("[data-workspace][aria-current='true']");
    if (cur && WORKSPACES[cur.getAttribute("data-workspace")]) {
      return cur.getAttribute("data-workspace");
    }
    var active = document.querySelector(".product-switcher .product.active[data-os]");
    if (active && WORKSPACES[active.getAttribute("data-os")]) {
      return active.getAttribute("data-os");
    }
    for (var id in WORKSPACES) {
      if (findControl(WORKSPACES[id])) return id;
    }
    return null;
  }

  function findControl(cfg) {
    for (var i = 0; i < cfg.control.length; i++) {
      var el = document.querySelector(cfg.control[i]);
      if (el) return el;
    }
    return null;
  }

  var WS = null, CFG = null;

  /* --- panel ------------------------------------------------------------- */
  var panel, elTime, elState, elStart, elPause, elStop, elSave, elDest,
      elConfirm, elDestNote, elHint, elDone, prevFocus;

  var TICK = null, running = false, elapsedMs = 0, startedAt = 0,
      stopped = false, destConfirmed = false;

  function build() {
    panel = document.createElement("aside");
    panel.id = "cc-recorder";
    panel.className = "cc-rec";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-label", "Recording");
    panel.setAttribute("aria-hidden", "true");
    panel.hidden = true;
    panel.innerHTML =
      '<div class="cc-rec__scrim" data-cc-close></div>' +
      '<div class="cc-rec__panel">' +
        '<button class="cc-rec__close" data-cc-close aria-label="Close recording panel">×</button>' +
        '<span class="cc-rec__eyebrow">Recording</span>' +
        '<h2 class="cc-rec__title">Record</h2>' +
        '<p class="cc-rec__sub">Prototype · no audio is captured. The timer, states and filing destination behave exactly as the shipped control will.</p>' +
        '<div class="cc-rec__meter">' +
          '<span class="cc-rec__dot" aria-hidden="true"></span>' +
          '<span class="cc-rec__time" id="cc-rec-time" role="timer" aria-live="off">00:00</span>' +
          '<span class="cc-rec__state" id="cc-rec-state">Ready</span>' +
        '</div>' +
        '<div class="cc-rec__controls">' +
          '<button class="cc-rec__btn cc-rec__btn--primary" id="cc-rec-start">Start</button>' +
          '<button class="cc-rec__btn" id="cc-rec-pause" disabled>Pause</button>' +
          '<button class="cc-rec__btn" id="cc-rec-stop" disabled>Stop</button>' +
        '</div>' +
        '<div class="cc-rec__field">' +
          '<label class="cc-rec__label" for="cc-rec-dest">Filing destination</label>' +
          '<div class="cc-rec__destrow">' +
            '<select class="cc-rec__select" id="cc-rec-dest"></select>' +
            '<button class="cc-rec__btn cc-rec__btn--confirm" id="cc-rec-confirm">Confirm</button>' +
          '</div>' +
          '<p class="cc-rec__note" id="cc-rec-destnote">Choose where this recording is filed, then confirm.</p>' +
        '</div>' +
        '<div class="cc-rec__foot">' +
          '<button class="cc-rec__btn cc-rec__btn--save" id="cc-rec-save" disabled>Save</button>' +
          '<span class="cc-rec__hint" id="cc-rec-hint">Stop the recording and confirm a destination to save.</span>' +
        '</div>' +
        '<p class="cc-rec__done" id="cc-rec-done" hidden></p>' +
      '</div>';
    document.body.appendChild(panel);

    elTime = panel.querySelector("#cc-rec-time");
    elState = panel.querySelector("#cc-rec-state");
    elStart = panel.querySelector("#cc-rec-start");
    elPause = panel.querySelector("#cc-rec-pause");
    elStop = panel.querySelector("#cc-rec-stop");
    elSave = panel.querySelector("#cc-rec-save");
    elDest = panel.querySelector("#cc-rec-dest");
    elConfirm = panel.querySelector("#cc-rec-confirm");
    elDestNote = panel.querySelector("#cc-rec-destnote");
    elHint = panel.querySelector("#cc-rec-hint");
    elDone = panel.querySelector("#cc-rec-done");

    panel.querySelectorAll("[data-cc-close]").forEach(function (el) {
      el.addEventListener("click", close);
    });
    elStart.addEventListener("click", onStart);
    elPause.addEventListener("click", onPause);
    elStop.addEventListener("click", onStop);
    elSave.addEventListener("click", onSave);
    elConfirm.addEventListener("click", onConfirm);
    elDest.addEventListener("change", function () {
      destConfirmed = false;
      elConfirm.disabled = false;
      elConfirm.textContent = "Confirm";
      elDestNote.textContent = "Choose where this recording is filed, then confirm.";
      elDestNote.classList.remove("is-ok");
      render();
    });

    /* Escape must close this panel and must not reach the workspace's own
       global Escape handler (BOSS closes #recording on Escape). */
    panel.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { e.stopPropagation(); close(); }
      if (e.key === "Tab") trapTab(e);
    });
  }

  function fillDestinations() {
    var names = [];
    try { names = CFG.destinations() || []; } catch (err) { names = []; }
    if (!names.length) names = DEST_FALLBACK.slice();
    elDest.innerHTML = "";
    names.forEach(function (n) {
      var o = document.createElement("option");
      o.value = n; o.textContent = n;
      elDest.appendChild(o);
    });
  }

  /* Disabling the element that currently has focus moves focus to <body>,
     which takes it outside this dialog: Escape stops working and Tab restarts
     from the top of the page. Called after any state change that disables a
     focused control. */
  function keepFocusInPanel() {
    if (panel.contains(document.activeElement)) return;
    var f = panel.querySelectorAll("button:not([disabled]), select:not([disabled])");
    if (f.length) f[f.length - 1].focus();
  }

  function trapTab(e) {
    var f = panel.querySelectorAll("button:not([disabled]), select, [href], input");
    if (!f.length) return;
    var first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  /* --- timer ------------------------------------------------------------- */
  function now() { return Date.now(); }

  function currentMs() {
    return elapsedMs + (running ? now() - startedAt : 0);
  }

  function fmt(ms) {
    var t = Math.floor(ms / 1000);
    var h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
    var pad = function (n) { return (n < 10 ? "0" : "") + n; };
    return (h ? h + ":" + pad(m) : pad(m)) + ":" + pad(s);
  }

  function tick() { elTime.textContent = fmt(currentMs()); }

  function startTick() {
    stopTick();
    TICK = setInterval(tick, 250);
  }
  function stopTick() { if (TICK) { clearInterval(TICK); TICK = null; } }

  /* --- state transitions ------------------------------------------------- */
  function onStart() {
    if (stopped) return;
    running = true;
    startedAt = now();
    startTick(); tick();
    render();
    elPause.focus();
  }

  function onPause() {
    if (stopped) return;
    if (running) {
      elapsedMs += now() - startedAt;
      running = false;
      stopTick(); tick();
    } else {
      running = true;
      startedAt = now();
      startTick();
    }
    render();
  }

  function onStop() {
    if (running) { elapsedMs += now() - startedAt; running = false; }
    stopped = true;
    stopTick(); tick();
    render();
    elSave.disabled ? elDest.focus() : elSave.focus();
  }

  function onConfirm() {
    destConfirmed = true;
    elConfirm.disabled = true;
    elConfirm.textContent = "Confirmed";
    elDestNote.textContent = "Filing to " + elDest.value + " · confirmed.";
    elDestNote.classList.add("is-ok");
    render();
    /* Confirm has just been disabled. If it held focus, the browser drops focus
       to <body> and this dialog's keydown listener stops receiving Escape.
       Keep focus inside the dialog. */
    keepFocusInPanel();
  }

  function onSave() {
    if (elSave.disabled) return;
    var dur = fmt(currentMs()), dest = elDest.value;
    elDone.hidden = false;
    elDone.textContent = "Saved · " + dur + " filed to " + dest +
      " in " + CFG.label + ". Prototype — nothing was uploaded.";
    elState.textContent = "Saved";
    panel.setAttribute("data-cc-state", "saved");
    elStart.disabled = elPause.disabled = elStop.disabled = elSave.disabled = true;
    elConfirm.disabled = true;
    elDest.disabled = true;
    elHint.textContent = "Close this panel to return.";
    keepFocusInPanel();
    /* Use the workspace's own toast as a secondary confirmation if it has one,
       never as the primary result. */
    try {
      if (typeof window.toast === "function") {
        window.toast("Recording saved · " + dur + " · " + dest);
      }
    } catch (err) {}
  }

  function render() {
    var state = stopped ? "stopped" : running ? "recording"
      : currentMs() > 0 ? "paused" : "idle";
    panel.setAttribute("data-cc-state", state);
    elState.textContent = { idle: "Ready", recording: "Recording",
      paused: "Paused", stopped: "Stopped" }[state];
    elStart.disabled = stopped || running || currentMs() > 0;
    elPause.disabled = stopped || currentMs() === 0 && !running;
    elPause.textContent = running ? "Pause" : (currentMs() > 0 ? "Resume" : "Pause");
    elStop.disabled = stopped || (currentMs() === 0 && !running);
    var ready = stopped && destConfirmed;
    elSave.disabled = !ready;
    elHint.textContent = ready ? "Ready to save."
      : stopped ? "Confirm a filing destination to save."
      : destConfirmed ? "Stop the recording to save."
      : "Stop the recording and confirm a destination to save.";
  }

  function reset() {
    stopTick();
    running = false; stopped = false; elapsedMs = 0; startedAt = 0;
    destConfirmed = false;
    elDest.disabled = false;
    elConfirm.disabled = false;
    elConfirm.textContent = "Confirm";
    elDestNote.textContent = "Choose where this recording is filed, then confirm.";
    elDestNote.classList.remove("is-ok");
    elDone.hidden = true; elDone.textContent = "";
    elTime.textContent = "00:00";
    render();
  }

  /* --- open / close ------------------------------------------------------ */
  function open() {
    prevFocus = document.activeElement;
    fillDestinations();
    reset();
    panel.hidden = false;
    panel.setAttribute("aria-hidden", "false");
    /* next frame so the transition runs */
    requestAnimationFrame(function () { panel.classList.add("is-open"); });
    elStart.focus();
  }

  function close() {
    stopTick();
    panel.classList.remove("is-open");
    panel.setAttribute("aria-hidden", "true");
    panel.hidden = true;
    if (prevFocus && prevFocus.focus) prevFocus.focus();
  }

  /* --- wiring ------------------------------------------------------------ */
  function wire() {
    var ctrl = findControl(CFG);
    if (!ctrl || ctrl.__ccRecWired) return;
    ctrl.__ccRecWired = true;
    ctrl.setAttribute("data-cc-recorder", "1");
    ctrl.setAttribute("aria-haspopup", "dialog");
    ctrl.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();          /* capture phase: the prototype's own
                                       onclick never runs */
      open();
    }, true);
  }

  function init() {
    WS = detect();
    if (!WS) return;               /* nothing to attach to; stay inert */
    CFG = WORKSPACES[WS];
    build();
    wire();
    /* All three prototypes re-render their headers; keep the wiring current. */
    new MutationObserver(function () {
      var id = detect();
      if (id && id !== WS) { WS = id; CFG = WORKSPACES[id]; }
      wire();
    }).observe(document.documentElement, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else { init(); }

  /* Exposed for QA only. */
  window.__ccRecorder = {
    open: function () { open(); },
    close: close,
    state: function () {
      return { workspace: WS, ms: currentMs(), running: running,
               stopped: stopped, destConfirmed: destConfirmed,
               dest: elDest && elDest.value, saveEnabled: elSave && !elSave.disabled };
    }
  };
})();
