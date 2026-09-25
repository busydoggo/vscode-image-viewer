'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Core = require('../media/core');
const patterns = ['RGGB', 'BGGR', 'GRBG', 'GBRG'];
const rgb = (frame, x, y) => Array.from(frame.rgba.slice((y * frame.width + x) * 4, (y * frame.width + x) * 4 + 3));
function mosaic(width, height, pattern, scene) {
  const bytes = Buffer.alloc(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    bytes[y * width + x] = scene(x, y)['RGB'.indexOf(pattern[(y % 2) * 2 + x % 2])];
  }
  return Core.decode(bytes, { ...Core.defaults(), width, height, pattern });
}

test('Bayer follows horizontal and vertical gray edges for every phase and edge parity', () => {
  for (const pattern of patterns) for (const vertical of [true, false]) for (const boundary of [31, 32]) {
    const scene = (x, y) => Array(3).fill((vertical ? x : y) < boundary ? 32 : 224);
    const frame = mosaic(64, 64, pattern, scene);
    for (let y = 4; y < 60; y++) for (let x = 4; x < 60; x++) {
      assert.deepEqual(rgb(frame, x, y), scene(x, y), `${pattern}, ${vertical}, ${boundary}, (${x},${y})`);
    }
  }
});

test('diagonal edge error and false color stay below the previous distance-weighted interpolation', () => {
  for (const pattern of patterns) for (const rising of [true, false]) {
    const scene = (x, y) => Array(3).fill((rising ? x < y : x + y < 64) ? 32 : 224);
    const frame = mosaic(64, 64, pattern, scene);
    let error = 0, falseColor = 0, count = 0;
    for (let y = 4; y < 60; y++) for (let x = 4; x < 60; x++) {
      const values = rgb(frame, x, y), expected = scene(x, y)[0];
      error += values.reduce((sum, value) => sum + Math.abs(value - expected), 0);
      falseColor += Math.max(...values) - Math.min(...values); count++;
    }
    // The original RGGB interpolator measured MAE 2.58 and false color 4.71.
    assert.ok(error / (count * 3) < 1.7, `${pattern}: diagonal reconstruction error`);
    assert.ok(falseColor / count < 3.3, `${pattern}: diagonal false color`);
  }
});

test('the actual color-bar fixture suppresses zippering and cross-edge color mixing', () => {
  const c = Core.defaults('bayer-rggb-320x240.raw');
  const bytes = fs.readFileSync(path.join(__dirname, '../fixtures/bayer-rggb-320x240.raw'));
  const frame = Core.decode(bytes, c);
  const scene = (x, y) => (x < 80 ? [235, 220, 40] : [25, 210, 210]).map(v => Math.round(v * (0.35 + y / 240 * 0.65)));
  let error = 0;
  for (let y = 4; y < 236; y++) for (let x = 77; x <= 82; x++) {
    const expected = scene(x, y), actual = rgb(frame, x, y);
    for (let k = 0; k < 3; k++) {
      error += Math.abs(actual[k] - expected[k]);
      assert.ok(Math.abs(actual[k] - expected[k]) <= 4, `(${x},${y}), channel ${k}`);
    }
  }
  // Distance-weighted: 9.262; unweighted HA/color differences: 7.214 RGB8 MAE.
  assert.ok(error / (232 * 6 * 3) < 0.5);
  assert.deepEqual(rgb(frame, 78, 120), [159, 149, 27]);
  assert.deepEqual(rgb(frame, 78, 121), [159, 149, 27]);
});

test('color-edge weights work for every Bayer phase, orientation and edge parity, including constant green', () => {
  const edges = [
    [[235, 220, 40], [25, 210, 210]],
    [[210, 120, 30], [30, 120, 210]],
    [[50, 20, 100], [50, 200, 100]]
  ];
  for (const pattern of patterns) for (const vertical of [true, false]) for (const boundary of [15, 16]) for (const colors of edges) {
    const scene = (x, y) => colors[(vertical ? x : y) < boundary ? 0 : 1];
    const frame = mosaic(32, 32, pattern, scene);
    for (let y = 4; y < 28; y++) for (let x = 4; x < 28; x++) {
      const expected = scene(x, y), actual = rgb(frame, x, y);
      assert.ok(actual.every((v, k) => Math.abs(v - expected[k]) <= 1), `${pattern}, ${vertical}, ${boundary}, (${x},${y})`);
    }
  }
});

test('unsupported single-channel boundaries stay balanced rather than inventing an edge location', () => {
  for (const pattern of patterns) {
    const scene = (x, y) => [x < 16 ? 40 : 220, 100, 80];
    const frame = mosaic(32, 32, pattern, scene), redX = pattern.indexOf('R') % 2;
    const transitionX = redX ? 16 : 15;
    for (let y = 4; y < 28; y++) assert.deepEqual(rgb(frame, transitionX, y), [130, 100, 80]);
  }
});

test('Bayer preserves all four rectangle corners across phases, boundary parities and contrast polarities', () => {
  // Independent rectangles prevent a fixture-coordinate or palette-specific fix.
  for (const pattern of patterns) for (const left of [11, 12]) for (const top of [11, 12]) for (const reverse of [false, true]) {
    const colors = reverse ? [[220,190,160], [25,50,75]] : [[16,16,16], [115,82,68]];
    const scene = (x, y) => colors[Number(x >= left && x < left + 13 && y >= top && y < top + 15)];
    const frame = mosaic(40, 40, pattern, scene);
    for (let y = 4; y < 36; y++) for (let x = 4; x < 36; x++) {
      const expected = scene(x, y), actual = rgb(frame, x, y);
      assert.ok(actual.every((v, k) => Math.abs(v - expected[k]) <= 1), `${pattern}, ${left},${top}, reversed ${reverse}, (${x},${y}): ${actual} != ${expected}`);
    }
  }
});

test('uniform interpolation policy disables the sharp corner reconstruction', () => {
  // The corner path must honor the same editable strategy as straight-edge reconstruction.
  const D = require('../media/demosaic'), coefficients = structuredClone(D.defaults);
  for (const group of Object.values(coefficients.directions)) for (const level of group.levels) level.uniform = 1;
  const c = { ...Core.defaults(), width: 32, height: 32, pattern: 'RGGB' };
  const bytes = Buffer.from(Array.from({ length: 1024 }, (_, i) => {
    const x = i % 32, y = Math.floor(i / 32), color = x < 16 && y < 16 ? [115,82,68] : [16,16,16];
    return color['RGB'.indexOf(c.pattern[(y % 2) * 2 + x % 2])];
  }));
  assert.deepEqual(rgb(Core.decode(bytes, c), 15, 15), [115,82,68]);
  assert.notDeepEqual(rgb(Core.decode(bytes, c, coefficients), 15, 15), [115,82,68]);
});

test('edge confidence protects smooth luminance and chroma textures from aggressive weighting', () => {
  const scenes = [
    // Recorded unweighted HA/color-difference MAE, in the order of `patterns`.
    { baseline: [0.287415, 0.377764, 0.213754, 0.123938], tolerance: 0.01,
      scene: (x, y) => [60 + x + Math.floor(y / 2), 80 + Math.floor(x / 2) + y, 40 + x + y] },
    { baseline: [0.733525, 0.733525, 0.737671, 0.737564], tolerance: 0.01,
      scene: (x, y) => { const t = Math.round(30 * Math.sin(x * 0.6) * Math.cos(y * 0.5)); return [100 + t, 130 + t, 70 + t]; } },
    { baseline: [2.010311, 1.979167, 1.956527, 1.995324], tolerance: 0.04,
      scene: (x, y) => [128 + Math.round(40 * Math.sin(x * 0.45)), 128 + Math.round(20 * Math.cos(y * 0.35)), 128 + Math.round(40 * Math.cos((x + y) * 0.35))] }
  ];
  for (const pattern of patterns) for (const { scene, baseline, tolerance } of scenes) {
    const frame = mosaic(64, 64, pattern, scene); let error = 0;
    for (let y = 4; y < 60; y++) for (let x = 4; x < 60; x++) {
      const expected = scene(x, y);
      error += rgb(frame, x, y).reduce((sum, value, k) => sum + Math.abs(value - expected[k]), 0);
    }
    const limit = baseline[patterns.indexOf(pattern)] + tolerance;
    assert.ok(error / 9408 < limit, `${pattern}: MAE ${error / 9408}, budget ${limit}`);
  }
});

test('Bayer preserves flat colors at tiny and odd-sized borders and smooth interior gradients', () => {
  for (const pattern of patterns) for (const [width, height] of [[2, 2], [2, 7], [7, 2], [15, 13]]) {
    const frame = mosaic(width, height, pattern, () => [203, 117, 41]);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) assert.deepEqual(rgb(frame, x, y), [203, 117, 41]);
  }
  const scene = (x, y) => [30 + x * 3 + y, 50 + x + y * 2, 80 + x * 2 + y];
  for (const pattern of patterns) {
    const frame = mosaic(25, 21, pattern, scene);
    for (let y = 4; y < 17; y++) for (let x = 4; x < 21; x++) assert.deepEqual(rgb(frame, x, y), scene(x, y));
  }
});

test('transposing the mosaic and its CFA phase transposes the reconstructed image', () => {
  const scene = (x, y) => x * 2 + y < 35 ? [40 + y, 30 + x, 130] : [180, 160 - y, 50 + x];
  for (const pattern of patterns) {
    const transposedPattern = pattern[0] + pattern[2] + pattern[1] + pattern[3];
    const normal = mosaic(25, 21, pattern, scene);
    const transposed = mosaic(21, 25, transposedPattern, (x, y) => scene(y, x));
    for (let y = 0; y < 21; y++) for (let x = 0; x < 25; x++) {
      const a = rgb(normal, x, y), b = rgb(transposed, y, x);
      assert.ok(a.every((value, k) => Math.abs(value - b[k]) <= 1), `${pattern}, (${x},${y})`);
    }
  }
});

test('demosaicing preserves measured samples before tone mapping across 4–32-bit depths', () => {
  for (const pattern of patterns) for (const bitDepth of [4, 8, 10, 16, 32]) {
    const width = 9, height = 7, peak = 2 ** bitDepth - 1, size = Math.ceil(bitDepth / 8);
    const bytes = Buffer.alloc(width * height * size), samples = [];
    for (let i = 0; i < width * height; i++) {
      samples[i] = Math.floor(((i * 37) % 101) / 100 * peak);
      bytes.writeUIntLE(samples[i], i * size, size);
    }
    const c = { ...Core.defaults(), width, height, pattern, bitDepth, black: peak * 0.1, white: peak * 0.9, gamma: 1.8, exposure: -0.5 };
    const frame = Core.decode(bytes, c), inspect = Core.pixelReader(bytes, c);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = y * width + x, channel = pattern[(y % 2) * 2 + x % 2];
      const normalized = Math.fround((samples[i] - c.black) / (c.white - c.black));
      const expected = Math.round(255 * Math.pow(Math.max(0, Math.min(1, normalized * 2 ** c.exposure)), 1 / c.gamma));
      assert.equal(rgb(frame, x, y)['RGB'.indexOf(channel)], expected);
      assert.equal(inspect(x, y).value, samples[i]);
    }
  }
});

test('one-row and one-column Bayer inputs keep their measured channel without invalid reads', () => {
  for (const pattern of patterns) for (const [width, height] of [[1, 1], [1, 7], [7, 1]]) {
    const scene = () => [203, 117, 41], frame = mosaic(width, height, pattern, scene);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const channel = 'RGB'.indexOf(pattern[(y % 2) * 2 + x % 2]);
      assert.equal(rgb(frame, x, y)[channel], scene()[channel]);
      assert.equal(frame.rgba[(y * width + x) * 4 + 3], 255);
    }
  }
});
