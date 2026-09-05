/*!
 * cc-workspace-switcher.v2.js
 * Wires the shared three-workspace switcher in the integrated dashboard shell.
 *
 * SUPERSEDES cc-workspace-switcher.v1.js (Drive 1k9LVbm7CwNGeSIy-lmmO8sXQ8f7aNNlV).
 * Do not push v1. v2 is a strict superset; everything v1 did, v2 still does.
 *
 * Fixes defect D3 (Bert): the switcher shows labels but does not navigate.
 *   UTampa / EP  — bare <button>, no handler at all.
 *   BOS          — buttons ARE bound, but to a drawer that says "In production,
 *                  this shared header opens the dedicated dashboard". Also inert
 *                  as navigation, and it fires alongside any listener added
 *                  later, so v1 alone would flash that drawer on the way out.
 *
 * WHAT CHANGED FROM v1
 *   1. Recognises the BOS switcher container (.product-switcher, [data-os]).
 *      v1 only knew .workspace-switcher / .wordSwitcher / .centeredSwitcher and
 *      fell through to a whole-document button scan on BOS.
 *   2. Clears any pre-existing inline onclick on a matched button before wiring,
 *      so the legacy BOS drawer cannot fire during a workspace switch.
 *   3. Marks the container role="navigation" and every wired control with an
 *      explicit accessible state.
 *
 * Drop-in and repo-agnostic. Ship the SAME unmodified file to all three
 * workspaces. No dependencies. No network calls. No storage. No data
 * collection. Safe to load twice.
 */
(function () {
  'use strict';

  /* ---- The only block that changes when a workspace URL changes ---- */
  var WORKSPACES = [
    { key: 'utampa', match: /^u\s*tampa|faculty\s*os/i,
      url: 'https://utampa-faculty-os-prototype.onrender.com/' },
    { key: 'bos',    match: /^bos\b|^boss\b/i,
      url: null },   /* TODO: set once the BOS static site exists */
    { key: 'ep',     match: /entrepreneurship\s*professor/i,
      url: 'https://entrepreneurship-professor-prototype.onrender.com/' }
  ];
  var PENDING_TITLE = 'This workspace is not deployed yet.';
  /* ---------------------------------------------------------------- */

  if (window.__ccWorkspaceSwitcherWired) return;

  var HOSTS = '.workspace-switcher, .wordSwitcher, .centeredSwitcher, .product-switcher';

  function findButtons() {
    var host = document.querySelector(HOSTS);
    var pool;
    if (host) {
      pool = host.querySelectorAll('button, a');
    } else if (document.querySelector('[data-os]')) {
      pool = document.querySelectorAll('[data-os]');
    } else {
      pool = document.querySelectorAll('header button, header a, button, a');
    }
    var found = [];
    Array.prototype.forEach.call(pool, function (el) {
      var label = (el.textContent || '').trim();
      if (!label || label.length > 40) return;
      for (var i = 0; i < WORKSPACES.length; i++) {
        if (WORKSPACES[i].match.test(label) && !found.some(function (f) { return f.ws === WORKSPACES[i]; })) {
          found.push({ el: el, ws: WORKSPACES[i] });
          return;
        }
      }
    });
    return found.length >= 2 ? found : [];
  }

  function sameOrigin(url) {
    try { return new URL(url, location.href).origin === location.origin; }
    catch (e) { return false; }
  }

  function wire() {
    var found = findButtons();
    if (!found.length) return false;

    var container = found[0].el.parentElement;
    if (container) container.setAttribute('role', 'navigation');

    found.forEach(function (item) {
      var el = item.el, ws = item.ws;
      if (el.getAttribute('data-cc-workspace')) return;
      el.setAttribute('data-cc-workspace', ws.key);

      /* v2: drop any legacy inline handler (BOS binds a drawer here). */
      if (typeof el.onclick === 'function') el.onclick = null;

      var isCurrent = !!ws.url && sameOrigin(ws.url);

      if (isCurrent) {
        el.classList.add('active');
        el.setAttribute('aria-current', 'page');
        el.removeAttribute('title');
        return;
      }
      el.classList.remove('active');
      el.removeAttribute('aria-current');

      if (!ws.url) {
        el.setAttribute('aria-disabled', 'true');
        el.setAttribute('title', PENDING_TITLE);
        el.style.opacity = '0.55';
        el.style.cursor = 'not-allowed';
        el.addEventListener('click', function (e) {
          e.preventDefault(); e.stopPropagation();
        });
        return;
      }

      if (el.tagName === 'A') el.setAttribute('href', ws.url);
      el.style.cursor = 'pointer';
      el.setAttribute('title', 'Switch to this workspace');
      el.addEventListener('click', function (e) {
        e.preventDefault();
        window.location.assign(ws.url);
      });
      el.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); window.location.assign(ws.url); }
      });
    });

    window.__ccWorkspaceSwitcherWired = true;
    return true;
  }

  function boot() {
    if (wire()) return;
    var tries = 0;
    var t = setInterval(function () {
      if (wire() || ++tries > 20) clearInterval(t);
    }, 150);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
