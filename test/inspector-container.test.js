'use strict';
// Exercise the real inspector event handler so Auto cannot silently erase packed storage metadata.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Core = require('../media/core');
const I18n = require('../media/i18n');
const { readRange } = require('../src/io');
const os = require('node:os');

// Run the actual inspector and its select change handler with a minimal DOM.
function inspector(name, size) {
  const elements = [], messages = [], timers = new Map(); let timerId = 0;
  class Element {
    constructor() { this.children = []; this.listeners = {}; this.attributes = {}; this.classList = { add() {}, toggle() {} }; }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    setAttribute(key, value) { this.attributes[key] = value; }
    getAttribute(key) { return this.attributes[key]; }
    addEventListener(type, handler) { (this.listeners[type] ||= []).push(handler); }
    fire(type, event = {}) { for (const handler of this.listeners[type] || []) handler(event); }
    get options() { return this.children; }
    set value(value) { this._value = String(value); }
    get value() { return this._value; }
    blur() { document.activeElement = null; }
  }
  const app = new Element(), window = new Element();
  const document = Object.assign(new Element(), { body: new Element(), getElementById: () => app, createElement: () => { const el = new Element(); elements.push(el); return el; } });
  const context = { SensorCore: Core, SensorI18n: I18n, window, document, HTMLElement: Element,
    acquireVsCodeApi: () => ({ postMessage: m => messages.push(structuredClone(m)) }),
    setTimeout: fn => { timers.set(++timerId, fn); return timerId; }, clearTimeout: id => timers.delete(id) };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../media/inspector.js'), 'utf8'), context);
  const entry = { id: name, name, kind: 'BINARY', size, config: Core.defaults(name) };
  const receive = () => window.fire('message', { data: { type: 'state', entry: structuredClone(entry) } });
  receive();
  return { entry, select(value) {
    const select = elements.find(el => el.id === 'containerBits');
    document.activeElement = select; select.value = value; select.fire('change');
    for (const [id, fn] of [...timers]) { timers.delete(id); fn(); }
    const patch = messages.filter(m => m.type === 'patch').at(-1).patch;
    Object.assign(entry.config, patch);
    document.activeElement = null; receive();
    assert.equal(select.value, String(value), 'selected Auto remains Auto after host state and blur');
    return entry.config;
  } };
}

test('container Auto preserves packed frame boundaries and decoded pixels after explicit selections', async t => {
  const width = 32, height = 24, frames = 240, frameBytes = width * height * 12 / 8;
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'sensor-packed-sequence-'));
  t.after(() => fs.promises.rm(directory, { recursive: true, force: true }));
  const name = `sequence-bayer-rggb-12bit-packed-le-${width}x${height}.raw`, file = path.join(directory, name);
  const data = Buffer.alloc(frames * frameBytes);
  const sample = (frame, index) => (frame * 17 + index * 13) % 4096;
  for (let frame = 0; frame < frames; frame++) for (let i = 0; i < width * height; i += 2) {
    const a = sample(frame, i), b = sample(frame, i + 1), offset = frame * frameBytes + i * 3 / 2;
    data[offset] = a & 255; data[offset + 1] = (a >> 8) | ((b & 15) << 4); data[offset + 2] = b >> 4;
  }
  await fs.promises.writeFile(file, data);
  const baseline = Core.defaults(name), ui = inspector(name, data.length);
  for (const value of [0, 16, 0, 12, 0]) {
    const config = ui.select(value), seq = Core.sequence(config, data.length, frames);
    assert.equal(config.storage, 'packed');
    if (value === 16) { assert.equal(Core.containerBits(config), 16); continue; }
    assert.equal(Core.containerBits(config), 12);
    assert.equal(seq.frameCount, frames); assert.equal(seq.frameBytes, frameBytes);
    assert.equal(seq.readOffset, (frames - 1) * frameBytes);
  }
  for (const frame of [1, 121, 240]) {
    const seq = Core.sequence(ui.entry.config, data.length, frame);
    const bytes = await readRange(file, seq.readOffset, seq.frameBytes);
    const read = Core.pixelReader(bytes, ui.entry.config);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) assert.equal(read(x, y).value, sample(frame - 1, y * width + x));
    assert.deepEqual(Core.decode(bytes, ui.entry.config).rgba, Core.decode(bytes, baseline).rgba);
  }
});

test('unpacked files still round up in Auto and explicit non-byte containers remain authoritative', () => {
  const ui = inspector('BGGR_12bit_in16_4x4.raw', 32);
  for (const value of [0, 12, 0]) {
    const config = ui.select(value);
    assert.equal(config.storage, 'unpacked');
    assert.equal(Core.containerBits(config), value === 12 ? 12 : 16);
  }
  const narrow = inspector('8bit-in10-4x4.raw', 20);
  assert.equal(Core.containerBits(narrow.select(10)), 10);
});
