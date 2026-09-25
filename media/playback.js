(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SequencePlayer = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  return class SequencePlayer {
    constructor({ request, changed = () => {}, now = () => performance.now(), setTimer = (fn, delay) => setTimeout(fn, delay), clearTimer = id => clearTimeout(id) }) {
      Object.assign(this, { request, changed, now, setTimer, clearTimer });
      this.serial = 0; this.fps = 24; this.frame = 1; this.frameCount = 0; this.enabled = false; this.playing = false;
    }
    reset(info = {}) {
      this.pause(); this.pending = null; this.queued = null;
      this.configure(info); this.frame = info.frame || 1; this.changed();
    }
    configure(info) {
      this.enabled = !!info.enabled; this.frameCount = info.frameCount || 0;
      if (Number.isFinite(info.fps) && info.fps >= 0.1 && info.fps <= 120) this.fps = info.fps;
      if (!this.enabled) this.pause();
    }
    canPresent(id) { return !this.pending || id === this.pending.id; }
    // Accept only the current request and apply the most recent seek after an in-flight decode.
    present(info = {}, id) {
      if (!this.canPresent(id)) return false;
      this.configure(info); this.frame = info.frame || 1; this.pending = null;
      if (this.queued !== null && this.queued !== undefined) {
        const target = this.queued; this.queued = null;
        if (target !== this.frame) this.issue(target);
      }
      if (!this.pending) this.schedule();
      this.changed(); return true;
    }
    seek(frame) {
      if (!this.enabled || !Number.isSafeInteger(frame) || frame < 1 || frame > this.frameCount) return false;
      this.pause(); this.queued = null;
      if (this.pending) this.queued = frame;
      else if (frame !== this.frame) this.issue(frame);
      this.changed(); return true;
    }
    // Repeated step clicks advance from the queued target rather than the last rendered frame.
    get stepFrame() { return this.playing ? this.frame : this.queued ?? this.pending?.frame ?? this.frame; }
    step(direction) {
      if (direction !== -1 && direction !== 1) return false;
      return this.seek(this.stepFrame + direction);
    }
    issue(frame) {
      const id = ++this.serial;
      this.pending = { id, frame }; this.started = this.now();
      this.request(frame, id); this.changed();
    }
    play() {
      if (!this.enabled || this.playing) return;
      this.playing = true;
      if (!this.pending) {
        if (this.frame >= this.frameCount) this.issue(1);
        else { this.started = this.now(); this.schedule(); }
      }
      this.changed();
    }
    pause() { this.playing = false; this.clearTimer(this.timer); this.timer = undefined; this.changed(); }
    setFps(fps) {
      if (!Number.isFinite(fps) || fps < 0.1 || fps > 120) return false;
      this.fps = fps; this.started = this.now(); this.schedule(); this.changed(); return true;
    }
    schedule() {
      this.clearTimer(this.timer); this.timer = undefined;
      if (!this.playing || this.pending) return;
      if (this.frame >= this.frameCount) { this.pause(); return; }
      // One frame in flight. Slow decoding cannot build a queue or skip frames.
      this.timer = this.setTimer(() => { this.timer = undefined; if (this.playing) this.issue(this.frame + 1); }, Math.max(0, 1000 / this.fps - (this.now() - this.started)));
    }
  };
});
