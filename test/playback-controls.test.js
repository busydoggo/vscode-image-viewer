'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { AutoHide } = require('../media/playback-controls');
function fixture() {
  let now = 0, nextId = 0, hidden = false;
  const jobs = new Map();
  const controls = new AutoHide({ changed: value => { hidden = value; },
    setTimer: (fn, delay) => { jobs.set(++nextId, { fn, at: now + delay }); return nextId; },
    clearTimer: id => jobs.delete(id)
  });
  return { controls, get hidden() { return hidden; }, advance(ms) { now += ms; for (const [id, job] of jobs) if (job.at <= now) { jobs.delete(id); job.fn(); } } };
}
test('playback hides after three idle seconds and activity immediately restores it', () => {
  const f = fixture(); f.controls.setEnabled(true); f.advance(2999); assert.equal(f.hidden, false);
  f.advance(1); assert.equal(f.hidden, true); f.controls.activity(); assert.equal(f.hidden, false);
  f.advance(2500); f.controls.activity(); f.advance(2999); assert.equal(f.hidden, false);
  f.advance(1); assert.equal(f.hidden, true);
});
test('decoded frames do not restart the idle timer or reveal hidden playback', () => {
  const f = fixture(); f.controls.setEnabled(true);
  for (let i = 0; i < 30; i++) { f.controls.setEnabled(true); f.advance(100); }
  assert.equal(f.hidden, true); f.controls.setEnabled(true); assert.equal(f.hidden, true);
});
test('dragging or editing holds playback open, with a new timeout after release', () => {
  const f = fixture(); f.controls.setEnabled(true); f.controls.hold('pointer', true);
  f.advance(5000); assert.equal(f.hidden, false); f.controls.hold('focus', true); f.controls.hold('pointer', false);
  f.advance(5000); assert.equal(f.hidden, false); f.controls.hold('focus', false);
  f.advance(2999); assert.equal(f.hidden, false); f.advance(1); assert.equal(f.hidden, true);
});
test('single images cannot be awakened and new sequences start visible', () => {
  const f = fixture(); f.controls.setEnabled(true); f.advance(2000); f.controls.setEnabled(false);
  f.controls.activity(); f.advance(5000); assert.equal(f.hidden, false); assert.equal(f.controls.enabled, false);
  f.controls.setEnabled(true); assert.equal(f.hidden, false); f.advance(3000); assert.equal(f.hidden, true);
});

test('hover keeps playback visible after dragging ends, then gives three seconds after leaving', () => {
  const f = fixture(); f.controls.setEnabled(true); f.controls.hold('hover', true);
  f.advance(10000); assert.equal(f.hidden, false);
  f.controls.hold('pointer', true); f.controls.hold('pointer', false);
  f.controls.setEnabled(true); f.advance(10000); assert.equal(f.hidden, false);
  f.controls.hold('hover', false); f.advance(2999); assert.equal(f.hidden, false);
  f.advance(1); assert.equal(f.hidden, true);
  f.controls.hold('hover', true); assert.equal(f.hidden, false);
});
