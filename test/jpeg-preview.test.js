'use strict';
// Compare every pixel with independent references, including borders and unmodified regions.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { readRgbPng } = require('../scripts/png-rgb');
const { restore, restoreAsync } = require('../media/jpeg-preview');
const root = path.join(__dirname, '..');
function read(name) {
  const { width, height, rgb } = readRgbPng(fs.readFileSync(path.join(root, name)));
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) { rgba.set(rgb.subarray(i * 3, i * 3 + 3), i * 4); rgba[i * 4 + 3] = 255; }
  return { width, height, rgba };
}
function error(a, b) {
  let sum = 0, max = 0;
  for (let i = 0; i < a.length; i++) {
    if (i % 4 === 3) { assert.equal(a[i], b[i], 'alpha is unchanged'); continue; }
    const value = Math.abs(a[i] - b[i]); sum += value; max = Math.max(max, value);
  }
  return { mae: sum / (a.length / 4 * 3), max };
}
function Y(data, i) { return .299 * data[i] + .587 * data[i + 1] + .114 * data[i + 2]; }
function verifyLuma(source, output) {
  for (let i = 0; i < source.length; i += 4) assert.ok(Math.abs(Y(source, i) - Y(output, i)) <= .501, 'decoded luminance is preserved within RGB8 rounding');
}
for (const [name, source, reference, hashKey] of [
  ['bars', 'color-bars-jpeg-decoded.png', 'color-bars.png', 'barsSourceSha256'],
  ['corners', 'colorchecker-jpeg-decoded.png', 'colorchecker24-reference.png', 'chartSourceSha256']
]) test(`independent JPEG ${name} decode improves against the entire PNG reference`, () => {
  const metadata = require('./fixtures/jpeg-decoded.json');
  const original = fs.readFileSync(path.join(root, 'fixtures', name === 'bars' ? 'color-bars.jpg' : reference));
  assert.equal(createHash('sha256').update(original).digest('hex'), metadata[hashKey], 'regenerate the decode snapshot if its source changes');
  const input = read('test/fixtures/' + source), ref = read('fixtures/' + reference), before = input.rgba.slice();
  const output = restore(input.rgba, input.width, input.height);
  assert.deepEqual(input.rgba, before, 'the original decode remains available for comparison');
  const baseline = error(input.rgba, ref.rgba), improved = error(output, ref.rgba);
  assert.ok(improved.mae < baseline.mae * .65, JSON.stringify({ baseline, improved }));
  assert.ok(improved.max <= baseline.max, JSON.stringify({ baseline, improved }));
  verifyLuma(input.rgba, output);
  if (name === 'bars') {
    let worst = 0;
    for (let y = 0; y < input.height; y++) for (const x of [159, 160]) for (let c = 0; c < 3; c++) {
      const i = (y * input.width + x) * 4 + c; worst = Math.max(worst, Math.abs(output[i] - ref.rgba[i]));
    }
    assert.ok(worst <= 3, `columns 159/160: maximum RGB8 error ${worst}`);
  }
});
function fixture(shape, width = 48, height = 48) {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) rgba.set([...(shape(x, y) ? [40, 180, 60] : [180, 50, 160]), 255], (y * width + x) * 4);
  return { width, height, rgba };
}
function leak({ rgba, width, height }) {
  // Known separable chroma blur preserves full-resolution luma, like chroma upsampling at an edge.
  const result = rgba.slice(), weights = [1, 2, 1];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4, luma = Y(rgba, i); let red = 0, blue = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const j = (Math.max(0, Math.min(height - 1, y + dy)) * width + Math.max(0, Math.min(width - 1, x + dx))) * 4;
      const weight = weights[dx + 1] * weights[dy + 1] / 16, L = Y(rgba, j);
      red += weight * (rgba[j] - L); blue += weight * (rgba[j + 2] - L);
    }
    result.set([luma + red, luma - (.299 * red + .114 * blue) / .587, luma + blue, 255], i);
  }
  return result;
}
for (let angle = 0; angle < 360; angle += 45) test(`gradient and corner evidence at ${angle} degrees improves the whole image`, () => {
  const radians = angle * Math.PI / 180, c = Math.cos(radians), s = Math.sin(radians);
  const ref = fixture((x, y) => { const u = (x - 23.5) * c + (y - 23.5) * s, v = -(x - 23.5) * s + (y - 23.5) * c; return u >= 0 && v >= 0; });
  const decoded = leak(ref), output = restore(decoded, ref.width, ref.height);
  const before = error(decoded, ref.rgba), after = error(output, ref.rgba);
  assert.ok(after.mae < before.mae * .65, JSON.stringify({ before, after }));
  assert.ok(after.max <= before.max); verifyLuma(decoded, output);
});
test('clean corners, smooth color ramps, fine texture, transparency and tiny images remain unchanged', () => {
  const clean = fixture((x, y) => x >= 24 && y >= 24);
  const texture = fixture((x, y) => (x + y) % 2);
  const ramp = clean.rgba.map((v, i) => i % 4 === 3 ? 255 : 50 + Math.floor(i / 4) % 48);
  const transparent = leak(clean); for (let i = 3; i < transparent.length; i += 4) transparent[i] = 128;
  for (const source of [clean.rgba, texture.rgba, ramp, transparent]) assert.deepEqual(restore(source, 48, 48), source);
  assert.deepEqual(restore(Uint8ClampedArray.of(12, 24, 48, 255), 1, 1), Uint8ClampedArray.of(12, 24, 48, 255));
});
test('row batching matches synchronous repair and cancels stale file/toggle work', async () => {
  const input = read('test/fixtures/color-bars-jpeg-decoded.png');
  const output = await restoreAsync(input.rgba, input.width, input.height, () => true, async () => {});
  assert.deepEqual(output, restore(input.rgba, input.width, input.height));
  let current = true, yields = 0;
  assert.equal(await restoreAsync(input.rgba, input.width, input.height, () => current, async () => { current = false; yields++; }), null);
  assert.equal(yields, 1);
});
test('ambiguous equal-luminance colors and unsupported textured neighborhoods are not guessed', () => {
  const ref = fixture((x, y) => x >= 24 && y >= 24);
  // Different chroma with the same luminance supplies no reliable side-of-edge evidence.
  for (let i = 0; i < ref.rgba.length; i += 4) if (ref.rgba[i] === 180) ref.rgba.set([180, 110, 53], i);
  const ambiguous = leak(ref);
  assert.deepEqual(restore(ambiguous, 48, 48), ambiguous);
  // A deterministic high-frequency image exercises every pixel without flat support plateaus.
  const texture = ref.rgba.slice();
  for (let y = 0; y < 48; y++) for (let x = 0; x < 48; x++) for (let c = 0; c < 3; c++) texture[(y * 48 + x) * 4 + c] = 30 + ((x * 37 + y * 61 + c * 43) % 190);
  assert.deepEqual(restore(texture, 48, 48), texture);
});
