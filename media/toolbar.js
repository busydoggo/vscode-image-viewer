(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ViewerToolbar = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const paths = {
    // A crisp corner and a dotted corner distinguish the JPEG repair comparison control.
    jpegRepair: '<path d="M4 19V5h14M9 19V10h9"/><path d="M14 19v-4h4" stroke-dasharray="1 3"/>',
    fit: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/><rect x="7" y="7" width="10" height="10" rx="1.5"/>',
    minus: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5M7.5 10.5h6"/>',
    plus: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5M7.5 10.5h6m-3-3v6"/>',
    refresh: '<path d="M20 10a8 8 0 1 0-2 8M20 4v6h-6"/>',
    coefficients: '<path d="M4 6h3m4 0h9M4 12h9m4 0h3M4 18h3m4 0h9"/><circle cx="9" cy="6" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="9" cy="18" r="2"/>',
    properties: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="7.5" r="1" fill="currentColor" stroke="none"/><path d="M10.5 11h1.5v6m-1.5 0h3"/>',
    display: '<path d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5"/>',
    alpha: '<circle cx="9" cy="12" r="6.5"/><circle cx="15" cy="12" r="6.5"/><path d="M12 6.24a6.5 6.5 0 0 1 0 11.52 6.5 6.5 0 0 1 0-11.52Z" fill="currentColor" fill-opacity=".3" stroke="none"/>'
  };
  // Inherit currentColor so focus highlights the icon strokes as well as the button surface.
  function icon(name) {
    return `<svg class="toolbar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths[name] || ''}</svg>`;
  }
  function tooltips({ document, root, window, setTimer = setTimeout, clearTimer = clearTimeout }) {
    const tip = document.createElement('div');
    tip.id = 'toolbar-tooltip'; tip.className = 'toolbar-tooltip'; tip.setAttribute('role', 'tooltip'); tip.hidden = true;
    document.body.append(tip);
    let timer, active, described, pressed = false;
    function hide() {
      clearTimer(timer); timer = undefined; tip.hidden = true;
      if (described) {
        const ids = (described.getAttribute('aria-describedby') || '').split(/\s+/).filter(id => id && id !== tip.id);
        if (ids.length) described.setAttribute('aria-describedby', ids.join(' ')); else described.removeAttribute('aria-describedby');
        described = undefined;
      }
    }
    function target(event) {
      const el = event.target.closest?.('[data-tooltip]');
      return el && root.contains(el) ? el : undefined;
    }
    // Every pointer movement restarts the two-second dwell; dragging suppresses help entirely.
    function schedule(el) {
      hide(); active = el;
      if (!el) return;
      timer = setTimer(() => {
        if (document.hidden || !el.getClientRects().length) return;
        tip.textContent = el.getAttribute('data-tooltip');
        if (!tip.textContent) return;
        const bounds = el.getBoundingClientRect(), margin = 8;
        tip.style.maxWidth = `${Math.max(0, document.documentElement.clientWidth - margin * 2)}px`;
        tip.hidden = false;
        const box = tip.getBoundingClientRect();
        tip.style.left = `${Math.max(margin, Math.min(bounds.left + bounds.width / 2 - box.width / 2, document.documentElement.clientWidth - box.width - margin))}px`;
        tip.style.top = `${Math.max(margin, Math.min(bounds.bottom + 8, window.innerHeight - box.height - margin))}px`;
        described = el;
        el.setAttribute('aria-describedby', [el.getAttribute('aria-describedby'), tip.id].filter(Boolean).join(' '));
      }, 2000);
    }
    root.addEventListener('pointerover', event => { const el = target(event); if (el !== active) schedule(el); });
    root.addEventListener('pointermove', event => { if (event.buttons) { hide(); return; } schedule(target(event)); });
    root.addEventListener('pointerleave', () => { hide(); active = undefined; });
    root.addEventListener('pointerdown', () => { pressed = true; hide(); });
    document.addEventListener('pointerup', event => { if (pressed) { pressed = false; schedule(target(event)); } });
    document.addEventListener('pointercancel', () => { pressed = false; hide(); });
    root.addEventListener('focusin', event => { if (!pressed) schedule(target(event)); });
    root.addEventListener('focusout', () => { hide(); active = undefined; });
    root.addEventListener('input', hide); root.addEventListener('change', hide);
    document.addEventListener('keydown', hide);
    document.addEventListener('scroll', hide, true);
    document.addEventListener('visibilitychange', () => { hide(); active = undefined; });
    window.addEventListener('blur', () => { pressed = false; hide(); active = undefined; });
    window.addEventListener('resize', hide);
    return { hide };
  }
  return { icon, tooltips };
});
