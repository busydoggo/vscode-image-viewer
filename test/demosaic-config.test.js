'use strict';
// Cover direction policies, coefficient hot reload and propagation from the host to worker decoding.
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../media/demosaic');
const Core = require('../media/core');
const { Decoder } = require('../src/decoder');
const { createSettings } = require('../src/demosaic-settings');
const clone = () => structuredClone(D.defaults);

test('eight 45-degree rays detect normalized gradients without selecting an arbitrary tied direction', () => {
  const rays = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  for (const [i, [dx, dy]] of rays.entries()) {
    const edge = D.detect((x, y) => x === 2 * dx && y === 2 * dy ? .5 * Math.hypot(dx, dy) : 0, 0, 0);
    assert.deepEqual(edge.directions, [i]); assert.equal(edge.strength, .5);
    assert.ok(D.alignment(edge, -dy, dx) > .999);
    assert.ok(D.alignment(edge, dx, dy) < .001);
  }
  assert.equal(D.detect(() => .5, 10, 10).directions.length, 8);
  // Opposing changes must not cancel as they would in a scalar R+G guide.
  assert.ok(D.detect((x, y) => [x / 10, -x / 10, y / 10], 0, 0).strength > 0);
});

test('each direction selects its own group and strength levels interpolate continuously', () => {
  const c = clone();
  for (let i = 0; i < 8; i++) {
    c.directions[i * 45].levels = [
      { strength: 0, uniform: 1, edgePower: 0, tangentBias: 0 },
      { strength: .5, uniform: 0, edgePower: (i + 1) / 2, tangentBias: .5 }
    ];
  }
  D.validate(c);
  for (let i = 0; i < 8; i++) {
    const weak = D.strategy(c, { directions: [i], strength: 0 });
    const middle = D.strategy(c, { directions: [i], strength: .25 });
    const strong = D.strategy(c, { directions: [i], strength: 1 });
    assert.equal(weak.uniform, 1); assert.equal(middle.uniform, .5); assert.equal(strong.uniform, 0);
    assert.equal(middle.edgePower, (i + 1) / 4); assert.equal(strong.edgePower, (i + 1) / 2);
    const near = D.strategy(c, { directions: [i], strength: .5 - 1e-9 });
    assert.ok(Math.abs(near.edgePower - strong.edgePower) < 1e-7);
  }
});

test('invalid, incomplete and unsafe coefficient configurations are rejected', () => {
  assert.equal(D.validate(D.defaults), D.defaults);
  for (const edit of [c => { c.version = 2; }, c => { delete c.directions[315]; }, c => { c.extra = 1; },
    c => { c.regularization = 0; }, c => { c.variationPenalty = NaN; },
    c => { c.directions[0].levels[1].strength = 0; }, c => { c.directions[0].levels[0].strength = .1; },
    c => { c.directions[45].levels[0].uniform = 2; }, c => { c.directions[90].levels[1].edgePower = -1; },
    c => { c.directions[135].levels[1].tangentBias = Infinity; }, c => { c.directions[180].levels = []; }]) {
    const c = clone(); edit(c); assert.throws(() => D.validate(c));
  }
});

function settingsHarness(contents) {
  let bytes = contents && Buffer.from(contents), saves, changes, creates, deletes, changed = 0, opened;
  const errors = [], context = { globalStorageUri: '/user-data/extension', subscriptions: [] };
  const missing = () => Object.assign(new Error('missing'), { code: 'FileNotFound' });
  const vscode = {
    Uri: { joinPath: (...parts) => parts.join('/') }, RelativePattern: class {}, ViewColumn: { Beside: 2 },
    workspace: {
      fs: {
        readFile: async () => { if (!bytes) throw missing(); return bytes; },
        stat: async () => { if (!bytes) throw missing(); return {}; },
        createDirectory: async () => {}, writeFile: async (_, value) => { bytes = value; }
      },
      onDidSaveTextDocument: fn => { saves = fn; return {}; },
      createFileSystemWatcher: () => ({ onDidChange: fn => { changes = fn; return {}; }, onDidCreate: fn => { creates = fn; return {}; }, onDidDelete: fn => { deletes = fn; return {}; } }),
      openTextDocument: async uri => ({ uri })
    },
    window: { showTextDocument: async (doc, options) => { opened = { doc, options }; } }
  };
  const settings = createSettings(vscode, context, () => changed++, error => errors.push(error));
  return { settings, errors, context, set: text => { bytes = text == null ? undefined : Buffer.from(text); },
    change: () => changes(), create: () => creates(), delete: () => deletes(),
    save: () => saves({ uri: '/user-data/extension/demosaic-coefficients.json' }),
    get changed() { return changed; }, get opened() { return opened; }, get bytes() { return bytes; } };
}

test('coefficient editor persists outside the extension install and reloads only valid saved changes', async () => {
  const h = settingsHarness(); await h.settings.ready; assert.deepEqual(h.settings.get(), D.defaults);
  await h.settings.edit(); assert.deepEqual(JSON.parse(h.bytes), D.defaults);
  assert.equal(h.opened.doc.uri, '/user-data/extension/demosaic-coefficients.json');
  assert.equal(h.opened.options.preview, false); assert.equal(h.opened.options.viewColumn, 2);
  const c = clone(); c.regularization = 2; h.set(JSON.stringify(c));
  h.save(); await h.change(); assert.equal(h.settings.get().regularization, 2); assert.equal(h.changed, 1);
  h.set('{broken'); await h.change(); assert.equal(h.settings.get().regularization, 2); assert.equal(h.errors.length, 1);
  c.directions[0].levels[0].uniform = -1; h.set(JSON.stringify(c)); await h.change();
  assert.equal(h.settings.get().regularization, 2); assert.equal(h.changed, 1);
  c.directions[0].levels[0].uniform = .7; h.set(JSON.stringify(c)); await h.create();
  assert.equal(h.changed, 2);
  const restored = settingsHarness(h.bytes.toString()); await restored.settings.ready;
  assert.deepEqual(restored.settings.get(), c);
  h.set(null); await h.delete(); assert.deepEqual(h.settings.get(), D.defaults);
  h.context.subscriptions.at(-1).dispose(); h.set(JSON.stringify(c)); await h.change(); assert.deepEqual(h.settings.get(), D.defaults);
});

test('invalid startup file is retained for correction, with built-in defaults active', async () => {
  const h = settingsHarness('{broken'); await h.settings.ready; await h.settings.edit();
  assert.equal(h.bytes.toString(), '{broken'); assert.deepEqual(h.settings.get(), D.defaults); assert.equal(h.errors.length, 1);
});

test('custom coefficients reach the worker and change reconstruction without changing measured samples', async () => {
  const c = { ...Core.defaults(), width: 32, height: 32 }, bytes = Buffer.alloc(1024);
  const pattern = 'RGGB', channel = { R: 0, G: 1, B: 2 };
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) bytes[y * 32 + x] = (x < 16 ? [210, 120, 30] : [30, 120, 210])[channel[pattern[(y % 2) * 2 + x % 2]]];
  const coefficients = clone();
  for (const group of Object.values(coefficients.directions)) for (const level of group.levels) { level.uniform = 1; level.tangentBias = 0; }
  const normal = Core.decode(bytes, c), custom = Core.decode(bytes, c, coefficients);
  assert.notDeepEqual(custom.rgba, normal.rgba);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) assert.equal(custom.rgba[(y * 32 + x) * 4 + channel[pattern[(y % 2) * 2 + x % 2]]], bytes[y * 32 + x]);
  const worker = new Decoder();
  try {
    const a = await worker.decode({ bytes, config: c }), b = await worker.decode({ bytes, config: c, coefficients });
    assert.notEqual(a.image, b.image);
    assert.equal(b.image, 'data:image/png;base64,' + require('../src/png').encodePng(custom.width, custom.height, custom.rgba).toString('base64'));
  } finally { worker.dispose(); }
});
