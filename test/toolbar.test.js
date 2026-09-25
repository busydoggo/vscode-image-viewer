'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { tooltips } = require('../media/toolbar');
class Element {
  constructor() { this.attrs = {}; this.events = {}; this.style = {}; this.visible = true; }
  setAttribute(key, value) { this.attrs[key] = value; }
  getAttribute(key) { return this.attrs[key] ?? null; }
  removeAttribute(key) { delete this.attrs[key]; }
  addEventListener(name, fn) { (this.events[name] ||= []).push(fn); }
  emit(name, data = {}) { for (const fn of this.events[name] || []) fn({ target: this, ...data }); }
  closest() { return this.getAttribute('data-tooltip') ? this : undefined; }
  getClientRects() { return this.visible ? [this.getBoundingClientRect()] : []; }
  getBoundingClientRect() { return { left: 280, bottom: 38, width: 120, height: 30 }; }
}
function fixture() {
  let now = 0, id = 0, tip;
  const jobs = new Map(), root = new Element(), document = new Element(), window = new Element(), button = new Element();
  root.contains = target => target === button;
  document.createElement = () => new Element(); document.body = { append: el => { tip = el; } };
  document.documentElement = { clientWidth: 320 }; window.innerHeight = 200;
  button.setAttribute('data-tooltip', 'Fit to Window (F)'); button.setAttribute('aria-describedby', 'existing-help');
  const api = tooltips({ root, document, window,
    setTimer: (fn, delay) => { jobs.set(++id, { at: now + delay, fn }); return id; },
    clearTimer: key => jobs.delete(key)
  });
  function advance(ms) { now += ms; for (const [key, job] of jobs) if (job.at <= now) { jobs.delete(key); job.fn(); } }
  return { root, document, window, button, tip, api, advance, fire: (name, args) => root.emit(name, { target: button, ...args }) };
}
test('toolbar tooltip requires two full seconds without pointer movement', () => {
  const f = fixture(); f.fire('pointerover'); f.advance(1999); assert.equal(f.tip.hidden, true);
  f.fire('pointermove', { buttons: 0 }); f.advance(1999); assert.equal(f.tip.hidden, true);
  f.advance(1); assert.equal(f.tip.hidden, false); assert.equal(f.tip.textContent, 'Fit to Window (F)');
  assert.equal(f.button.getAttribute('aria-describedby'), 'existing-help toolbar-tooltip');
  assert.equal(f.tip.style.left, '192px', 'tooltip stays within the right edge');
  f.fire('pointermove', { buttons: 0 }); assert.equal(f.tip.hidden, true);
  f.fire('pointerleave'); f.advance(2000); assert.equal(f.tip.hidden, true);
  assert.equal(f.button.getAttribute('aria-describedby'), 'existing-help');
});
test('mouse presses and dragging suppress the tooltip until released and idle', () => {
  const f = fixture(); f.fire('pointerover'); f.fire('pointerdown'); f.fire('focusin');
  f.advance(3000); assert.equal(f.tip.hidden, true);
  f.fire('pointermove', { buttons: 1 }); f.advance(3000); assert.equal(f.tip.hidden, true);
  f.document.emit('pointerup', { target: f.button }); f.advance(1999); assert.equal(f.tip.hidden, true);
  f.advance(1); assert.equal(f.tip.hidden, false);
  f.fire('input'); assert.equal(f.tip.hidden, true);
});
test('keyboard help dismisses on Escape, focus loss and window blur', () => {
  const f = fixture(); f.fire('focusin'); f.advance(2000); assert.equal(f.tip.hidden, false);
  f.document.emit('keydown', { key: 'Escape' }); f.advance(2000); assert.equal(f.tip.hidden, true);
  f.fire('focusin'); f.fire('focusout'); f.advance(2000); assert.equal(f.tip.hidden, true);
  f.fire('focusin'); f.advance(2000); f.window.emit('blur'); assert.equal(f.tip.hidden, true);
});
test('hidden controls, file switches and scrolling cannot leave stale tooltips', () => {
  const f = fixture(); f.fire('pointerover'); f.button.visible = false; f.advance(2000); assert.equal(f.tip.hidden, true);
  f.button.visible = true; f.fire('pointermove'); f.api.hide(); f.advance(2000); assert.equal(f.tip.hidden, true);
  f.fire('pointermove'); f.advance(2000); f.document.emit('scroll'); assert.equal(f.tip.hidden, true);
  f.fire('pointermove'); f.document.hidden = true; f.advance(2000); assert.equal(f.tip.hidden, true);
});
