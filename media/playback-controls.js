(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PlaybackControls = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  // Any active interaction lock suspends the three-second idle timer.
  class AutoHide {
    constructor({ changed, setTimer = (fn, delay) => setTimeout(fn, delay), clearTimer = id => clearTimeout(id) }) {
      Object.assign(this, { changed, setTimer, clearTimer });
      this.enabled = false; this.locks = new Set(); this.hidden = false;
    }
    setEnabled(enabled) {
      if (this.enabled === enabled) return;
      this.enabled = enabled;
      this.clearTimer(this.timer);
      if (enabled) this.activity();
      else { this.locks.clear(); this.hidden = false; this.changed(false); }
    }
    activity() {
      this.clearTimer(this.timer);
      if (!this.enabled) return;
      this.hidden = false; this.changed(false);
      if (!this.locks.size) this.timer = this.setTimer(() => {
        this.hidden = true; this.changed(true);
      }, 3000);
    }
    // Keep independent hover, pointer and focus locks so releasing one cannot hide an active control.
    hold(reason, active) {
      if (active) this.locks.add(reason); else this.locks.delete(reason);
      this.activity();
    }
  }
  return { AutoHide };
});
