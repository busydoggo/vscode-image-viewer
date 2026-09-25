'use strict';
// Exercise the actual worker protocol and viewer message handler, including delayed image loads.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Core = require('../media/core');
const { Decoder } = require('../src/decoder');
const { encodePng } = require('../src/png');

for (const pattern of ['RGGB', 'BGGR', 'GRBG', 'GBRG', 'RGBI']) {
  test(`${pattern}: preview arrives before final and final pixels match the original decoder`, async () => {
    const decoder = new Decoder();
    const config = { ...Core.defaults(), width: 32, height: 24, pattern, display: pattern === 'RGBI' ? 'side' : 'rgb' };
    const bytes = Uint8Array.from({ length: 32 * 24 }, (_, i) => (i * 31 + Math.floor(i / 32) * 19) % 256);
    const stages = [];
    try {
      const final = await decoder.decode({ bytes, config }, preview => {
        assert.equal(decoder.decoding, true, 'draft does not settle the pending request');
        assert.equal(preview.width, config.width * (config.display === 'side' ? 2 : 1));
        assert.equal(preview.height, config.height);
        stages.push(preview);
      });
      assert.equal(stages.length, 1);
      assert.notEqual(stages[0].image, final.image);
      assert.equal(decoder.decoding, false);
      const expected = Core.decode(bytes, config);
      assert.equal(final.image, 'data:image/png;base64,' + encodePng(expected.width, expected.height, expected.rgba).toString('base64'));
      assert.equal((await decoder.inspect(final.frameId, 3, 4)).pixel.value, bytes[4 * 32 + 3]);
    } finally { decoder.dispose(); }
  });
}
test('direct YUV and IR-only output skip duplicate previews; opt-out remains one result', async () => {
  const decoder = new Decoder();
  try {
    for (const config of [{ ...Core.defaults(), format: 'YUV', subsampling: '400' }, { ...Core.defaults(), pattern: 'RGBI', display: 'ir' }]) {
      config.width = 4; config.height = 4;
      let drafts = 0;
      await decoder.decode({ bytes: new Uint8Array(16), config }, () => drafts++);
      assert.equal(drafts, 0);
    }
    const result = await decoder.decode({ bytes: new Uint8Array(16), config: { ...Core.defaults(), width: 4, height: 4 } });
    assert.equal(result.preview, undefined);
  } finally { decoder.dispose(); }
});
test('cancelling after the draft rejects the final and stops further preview callbacks', async () => {
  const decoder = new Decoder(); let calls = 0;
  await assert.rejects(decoder.decode({ bytes: new Uint8Array(128 * 128), config: { ...Core.defaults(), width: 128, height: 128, pattern: 'RGBI' } }, () => {
    calls++; decoder.dispose();
  }));
  assert.equal(calls, 1); assert.equal(decoder.closed, true); assert.equal(decoder.pending.size, 0);
});

function viewer() {
  const elements = new Map(), images = [], draws = [], presentations = [];
  const node = () => ({ hidden: false, style: {}, setAttribute(key, value) { this[key] = value; }, blur() {} });
  const sandbox = {
    window: { addEventListener: (_, handler) => { sandbox.receive = data => handler({ data }); } },
    $: id => { if (!elements.has(id)) elements.set(id, node()); return elements.get(id); },
    vscode: { postMessage() {} }, t: key => key,
    generation: 0, valid: false, fitMode: false, displayedRevision: 0,
    canvas: { ...node(), width: 32, height: 24 }, scaledCanvas: node(),
    ctx: { drawImage: image => draws.push(image) }, SensorCore: Core,
    jpegRepair: node(), jpegPaint: 0, presentationRevision: 0,
    player: { canPresent: () => true, present: (...args) => presentations.push(args), reset() {} },
    clearPixel() {}, message() {}, fit() { throw new Error('Same-size replacement must retain manual zoom/pan'); }, layout() {},
    Image: class { constructor() { this.naturalWidth = 32; this.naturalHeight = 24; images.push(this); } }
  };
  const source = fs.readFileSync(path.join(__dirname, '../media/viewer.js'), 'utf8');
  vm.runInNewContext(source.slice(source.indexOf('function setViewerStatus('), source.indexOf("const toolbar =")), sandbox);
  vm.runInNewContext(source.slice(source.lastIndexOf("window.addEventListener('message'")), sandbox);
  return { sandbox, images, draws, presentations, elements };
}
test('viewer displays draft immediately, keeps playback pending and replaces without resetting the view', () => {
  const h = viewer(), data = { type: 'image', kind: 'CFA', revision: 7, requestId: 4, sequence: { frame: 2 } };
  h.sandbox.receive({ ...data, preview: true }); h.images[0].onload();
  assert.equal(h.draws.length, 1); assert.equal(h.presentations.length, 0);
  assert.equal(h.sandbox.rawPixels, false, 'raw queries wait until worker is available');
  assert.equal(h.elements.get('status').textContent, 'status.refining');
  assert.equal(h.elements.get('status')['data-refining'], 'true');
  h.sandbox.receive(data); h.images[1].onload();
  assert.equal(h.draws.length, 2); assert.equal(h.presentations.length, 1);
  assert.equal(h.sandbox.rawPixels, true); assert.equal(h.elements.get('status').textContent, 'status.readOnly');
  assert.equal(h.elements.get('status')['data-refining'], 'false');
});
test('late draft image loads cannot overwrite final images or a newly loading revision', () => {
  const h = viewer(), data = { type: 'image', kind: 'CFA', revision: 7 };
  h.sandbox.receive({ ...data, preview: true });
  h.sandbox.receive(data); h.images[1].onload(); h.images[0].onload();
  assert.deepEqual(h.draws, [h.images[1]]);
  h.sandbox.receive({ ...data, preview: true });
  h.sandbox.receive({ type: 'loading', preserveImage: true }); h.images[2].onload();
  assert.equal(h.draws.length, 1);
});
