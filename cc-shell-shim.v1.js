/* cc-shell-shim.v1.js
   Claude lane — application-shell identity shim.
   Return ID: CC-20260905-FIX-033

   Purpose: make the record control discoverable by cc-recorder.v3 on BOTH sites
   without editing recorder v3, and restore the accessible name EP is missing.

   Fixes:
     N1  UTampa's record control is <button class="globalRecord" aria-label="Record meeting">
         with NO id. Recorder v3 binds to #quickRecord, so it would bind to nothing.
     N1b EP's control is <button class="record-btn" id="quickRecord"> with NO aria-label.

   VERIFIED 2026-09-05 on both live sites: on UTampa the shim produced
   <button class="globalRecord" aria-label="Record meeting" id="quickRecord" type="button">
   and on EP it added aria-label="Record meeting" to the existing #quickRecord.

   PREFERRED FIX IS IN SOURCE (see manifest). This shim is the safety net that makes the
   recorder deploy correct even if the markup edit is missed in one repo.

   Idempotent, additive only, removes nothing, changes no visible text.
   LOAD ORDER: in <head>, BEFORE cc-recorder.v3.js.
*/
(function () {
  'use strict';

  function apply() {
    var changed = [];

    // N1 — ensure a single #quickRecord exists.
    if (!document.getElementById('quickRecord')) {
      var btn = document.querySelector(
        'button.globalRecord, button.record-btn, [data-role="record"]'
      );
      if (btn) {
        btn.id = 'quickRecord';
        changed.push('added id="quickRecord" to ' + btn.className);
      }
    }

    // N1b — ensure the control has an accessible name.
    var rec = document.getElementById('quickRecord');
    if (rec) {
      if (!rec.getAttribute('aria-label') && !rec.getAttribute('aria-labelledby')) {
        rec.setAttribute('aria-label', 'Record meeting');
        changed.push('added aria-label="Record meeting"');
      }
      // Button semantics preserved; only set type when the element is a real <button>.
      if (rec.tagName === 'BUTTON' && !rec.getAttribute('type')) {
        rec.setAttribute('type', 'button');
      }
    }

    if (changed.length) {
      console.info('[cc-shell-shim v1]', changed.join('; '));
    }
    return changed;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', apply, { once: true });
  } else {
    apply();
  }

  // Shells that render the header client-side may replace it after first paint.
  // One bounded re-check; no permanent observer, no polling loop.
  setTimeout(apply, 1500);

  window.ccShellShimV1 = { version: 1, apply: apply };
})();
