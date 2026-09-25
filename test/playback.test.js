'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { inflateSync } = require('node:zlib');
const Core = require('../media/core');
const Player = require('../media/playback');
const { Decoder } = require('../src/decoder');
const cfa = { ...Core.defaults(), width: 4, height: 4, offset: 8 };

test('browser timer functions are not invoked with the player as their receiver', async () => {
  const vm = require('node:vm');
  const source = await fs.readFile(path.join(__dirname, '../media/playback.js'), 'utf8');
  const browser = {
    performance: { now: () => 0 },
    setTimeout: function () { assert.notEqual(this?.constructor?.name, 'SequencePlayer'); return 1; },
    clearTimeout: function () { assert.notEqual(this?.constructor?.name, 'SequencePlayer'); }
  };
  vm.runInNewContext(source, browser);
  const player = new browser.SequencePlayer({ request() {} });
  player.reset({ enabled: true, frameCount: 3, frame: 1 }); player.play(); player.pause();
});

test('timeline appears strictly above two frames, after the base offset', () => {
  for (const [bytes, enabled, count, remainder] of [[0, false, 0, 0], [16, false, 1, 0], [31, false, 1, 15], [32, false, 2, 0], [33, true, 2, 1], [48, true, 3, 0]]) {
    const seq = Core.sequence(cfa, 8 + bytes);
    assert.equal(seq.enabled, enabled); assert.equal(seq.frameCount, count); assert.equal(seq.remainderBytes, remainder);
  }
});
test('frame offsets include full YUV planes, row padding and bit packing', () => {
  const c = { ...cfa, format: 'YUV', width: 3, height: 3, bitDepth: 10, storage: 'packed', layout: 'semi-uv', rowPitch: 8, chromaPitch: 8 };
  const seq = Core.sequence(c, 8 + 40 * 9 + 7, 5);
  assert.equal(seq.frameBytes, 40); assert.equal(seq.frameCount, 9); assert.equal(seq.readOffset, 168); assert.equal(seq.remainderBytes, 7);
  assert.equal(Core.sequence(c, 8 + 120, 9).frame, 3);
  assert.equal(Core.sequence({ ...c, width: 0 }, 1e6).enabled, false);
  assert.equal(Core.sequence({ ...c, offset: 2e6 }, 1e6).enabled, false);
});
function harness() {
  let time = 0, serial = 0;
  const jobs = new Map(), requests = [];
  const player = new Player({
    now: () => time,
    setTimer: (fn, delay) => { const id = ++serial; jobs.set(id, { fn, at: time + delay }); return id; },
    clearTimer: id => jobs.delete(id),
    request: (frame, id) => requests.push({ frame, id })
  });
  const info = { enabled: true, frameCount: 5, frame: 1, fps: 10 };
  player.reset(info);
  function advance(ms) {
    const end = time + ms;
    for (;;) {
      const next = [...jobs].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > end) break;
      time = next[1].at; jobs.delete(next[0]); next[1].fn();
    }
    time = end;
  }
  function present() { const request = requests.at(-1); player.present({ ...info, fps: player.fps, frame: request.frame }, request.id); }
  return { player, requests, advance, present, info };
}
test('play, pause and resume obey FPS and retain the current frame', () => {
  const h = harness(); h.player.play(); h.advance(99); assert.equal(h.requests.length, 0);
  h.advance(1); assert.equal(h.requests[0].frame, 2); h.present(); h.player.pause(); h.advance(1000);
  assert.equal(h.requests.length, 1); assert.equal(h.player.frame, 2);
  h.player.play(); h.advance(100); assert.equal(h.requests.at(-1).frame, 3);
});
test('slow decoding applies backpressure and rapid seeks keep only the latest target', () => {
  const h = harness(); h.player.play(); h.advance(100); h.advance(10000);
  assert.equal(h.requests.length, 1);
  h.player.seek(3); h.player.seek(4); h.player.seek(5); assert.equal(h.player.playing, false);
  h.present(); assert.deepEqual(h.requests.map(r => r.frame), [2, 5]);
  h.present(); assert.equal(h.player.frame, 5); assert.equal(h.player.pending, null);
});
test('rapid frame stepping accumulates and reverses while a frame is decoding, without passing boundaries', () => {
  const h = harness();
  assert.equal(h.player.step(-1), false); assert.equal(h.requests.length, 0);
  h.player.step(1); h.player.step(1); h.player.step(1);
  assert.equal(h.player.stepFrame, 4); assert.deepEqual(h.requests.map(r => r.frame), [2]);
  h.player.step(-1); h.present(); h.present(); assert.equal(h.player.frame, 3);
  h.player.step(1); h.player.step(1); assert.equal(h.player.stepFrame, 5);
  assert.equal(h.player.step(1), false); h.present(); h.present(); assert.equal(h.player.frame, 5);
});
test('stepping while playing is relative to the displayed frame and cancels playback', () => {
  const h = harness(); h.player.seek(3); h.present(); h.player.play(); h.advance(100);
  assert.equal(h.player.pending.frame, 4); assert.equal(h.player.frame, 3);
  h.player.step(-1); assert.equal(h.player.playing, false); h.present(); h.present();
  assert.equal(h.player.frame, 2); const count = h.requests.length; h.advance(1000); assert.equal(h.requests.length, count);
});
test('playback ends at the final frame and replay starts from frame one', () => {
  const h = harness(); h.player.play();
  for (let i = 2; i <= 5; i++) { h.advance(100); h.present(); }
  assert.equal(h.player.playing, false); h.advance(1000); assert.equal(h.requests.length, 4);
  h.player.play(); assert.equal(h.requests.at(-1).frame, 1); assert.equal(h.player.playing, true);
});
test('FPS changes reschedule immediately and reject invalid input', () => {
  const h = harness(); h.player.play(); assert.equal(h.player.setFps(20), true);
  h.advance(49); assert.equal(h.requests.length, 0); h.advance(1); assert.equal(h.requests.length, 1);
  for (const fps of [0, -1, 121, NaN, Infinity]) assert.equal(h.player.setFps(fps), false);
  for (const frame of [0, -1, 6, 1.5, NaN]) assert.equal(h.player.seek(frame), false);
  assert.equal(h.player.setFps(29.97), true);
});
test('reset invalidates pending seeks and timers; stale responses cannot replace newer requests', () => {
  const h = harness(); h.player.seek(5); const old = h.requests[0];
  h.player.reset({ ...h.info, frameCount: 3 }); h.player.seek(2);
  assert.equal(h.player.present({ ...h.info, frame: 5 }, old.id), false);
  assert.equal(h.player.frame, 1);
  h.player.reset(); h.advance(10000); assert.equal(h.player.enabled, false); assert.equal(h.player.playing, false);
});
function firstPixel(image) {
  const png = Buffer.from(image.split(',')[1], 'base64'); let offset = 8;
  while (offset < png.length) {
    const len = png.readUInt32BE(offset), type = png.toString('ascii', offset + 4, offset + 8);
    if (type === 'IDAT') return [...inflateSync(png.subarray(offset + 8, offset + 8 + len)).subarray(1, 4)];
    offset += 12 + len;
  }
}
test('persistent worker seeks distinct RAW and YUV frames without reading header or partial tail', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sensor-sequence-')); const decoder = new Decoder();
  try {
    for (const format of ['CFA', 'YUV']) {
      const config = { ...Core.defaults(), format, width: 4, height: 4, offset: 7, subsampling: '400', range: 'full' };
      const file = path.join(dir, format); await fs.writeFile(file, Buffer.concat([Buffer.alloc(7, 77), ...[20, 80, 160, 240].map(v => Buffer.alloc(16, v)), Buffer.alloc(3, 123)]));
      for (const [frame, value] of [[4, 240], [2, 80], [1, 20], [3, 160]]) {
        const seq = Core.sequence(config, 74, frame);
        const result = await decoder.decode({ path: file, config, length: seq.frameBytes, readOffset: seq.readOffset });
        assert.deepEqual(firstPixel(result.image), [value, value, value]);
      }
    }
    assert.equal(decoder.nextId, 8);
  } finally { decoder.dispose(); await fs.rm(dir, { recursive: true }); }
});
