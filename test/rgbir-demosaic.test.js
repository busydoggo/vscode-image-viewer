'use strict';
// Guard visible-channel reconstruction, original sample preservation and both row/column edge artifacts.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Core = require('../media/core');
const D = require('../media/demosaic');
const { Decoder } = require('../src/decoder');
const rgbaAt = (frame, x, y) => [...frame.rgba.slice((y * frame.width + x) * 4, (y * frame.width + x) * 4 + 3)];
const fixture = 'rgbir-rgbi-320x240.raw';
const bytes = fs.readFileSync(path.join(__dirname, '../fixtures', fixture));
const config = Core.defaults(fixture);
function permutations(s) { return s.length === 1 ? [s] : [...s].flatMap((v, i) => permutations(s.slice(0, i) + s.slice(i + 1)).map(rest => v + rest)); }

function mosaic(pattern, width, height, bitDepth = 8) {
  const c = { ...Core.defaults(), pattern, width, height, bitDepth, containerBits: bitDepth === 8 ? 8 : 16, rowPitch: width * (bitDepth === 8 ? 1 : 2) + 4 };
  const data = Buffer.alloc(c.rowPitch * height, 0xab), peak = 2 ** bitDepth - 1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const channel = pattern[(y % 2) * 2 + x % 2], value = Math.round(({ R: 200, G: 100, B: 40, I: (17 * x + 43 * y) % 256 }[channel]) / 255 * peak);
    if (bitDepth === 8) data[y * c.rowPitch + x] = value;
    else data.writeUInt16LE(value, y * c.rowPitch + x * 2);
  }
  return { c, data };
}

test('RGB-IR reconstructs flat visible colors for every tile permutation without leaking IR into green', () => {
  for (const pattern of permutations('RGBI')) for (const depth of [8, 12, 16]) {
    const { c, data } = mosaic(pattern, 7, 9, depth), untouched = Buffer.from(data), f = Core.decode(data, c);
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) assert.deepEqual(rgbaAt(f, x, y), [200, 100, 40], `${pattern}, ${depth}, ${x},${y}`);
    assert.deepEqual(data, untouched, 'Bayer reconstruction must not overwrite the input buffer');
  }
});

test('the actual RGBI fixture suppresses zippering at color boundaries after Bayer reconstruction', () => {
  const frame = Core.decode(bytes, config);
  const colors = [[235,235,235], [235,220,40], [25,210,210], [40,200,65], [210,55,190], [225,55,45], [35,65,205], [20,20,25]];
  let error = 0, focus = 0;
  for (let boundary = 40; boundary < 320; boundary += 40) for (let y = 4; y < 236; y++) for (let x = boundary - 3; x <= boundary + 2; x++) {
    const expected = colors[Math.floor(x / 40)].map(v => Math.round(v * (0.35 + y / 240 * 0.65)));
    for (const [channel, value] of rgbaAt(frame, x, y).entries()) {
      const difference = Math.abs(value - expected[channel]); error += difference;
      if (boundary === 80) { focus += difference; assert.ok(difference <= 4, `boundary 80 at ${x},${y}, channel ${channel}`); }
    }
  }
  // The old four-neighbor RGBI interpolation measured 9.4713 RGB8 MAE here.
  assert.ok(focus / (232 * 6 * 3) < 0.5);
  assert.ok(error / (7 * 232 * 6 * 3) < 1);
  const read = Core.pixelReader(bytes, config);
  for (let y = 0; y < config.height; y++) for (let x = 0; x < config.width; x++) {
    const sample = read(x, y);
    assert.equal(sample.channel, 'RGBI'[(y % 2) * 2 + x % 2]);
    assert.equal(sample.value, bytes[y * config.width + x]);
    if (sample.channel !== 'I') assert.equal(rgbaAt(frame, x, y)['RGB'.indexOf(sample.channel)], sample.value);
  }
});

test('RGBI columns 198–200 have consistent row phases at the constant-green blue edge', () => {
  const frame = Core.decode(bytes, config);
  for (let y = 4; y < 235; y++) for (let x = 196; x <= 202; x++) {
    const a = rgbaAt(frame, x, y), b = rgbaAt(frame, x, y + 1);
    // The reference has a slow vertical brightness ramp, not alternating rows.
    // Before residual correction, adjacent rows jumped by up to 36 RGB8 levels.
    assert.ok(a.every((value, k) => Math.abs(value - b[k]) <= 2), `zipper at ${x},${y}: ${a} -> ${b}`);
    if (x === 198 || x === 200) {
      const blue = Math.round((x < 200 ? 190 : 45) * (0.35 + y / 240 * 0.65));
      assert.ok(Math.abs(a[2] - blue) <= 1, `sample-aligned blue edge at ${x},${y}`);
    }
  }
});

test('RGBI columns 192–202 have no overshoot or intermediate-color stripe', () => {
  const frame = Core.decode(bytes, config);
  for (let y = 4; y < 236; y++) for (let x = 192; x <= 202; x++) {
    const actual = rgbaAt(frame, x, y);
    const left = [210, 55, 190].map(v => Math.round(v * (0.35 + y / 240 * 0.65)));
    const right = [225, 55, 45].map(v => Math.round(v * (0.35 + y / 240 * 0.65)));
    for (let k = 0; k < 3; k++) {
      // Column 199 belongs to the left sample cell under the sharp-edge convention.
      assert.ok(Math.abs(actual[k] - (x < 200 ? left : right)[k]) <= 1, `band at ${x},${y}, channel ${k}`);
    }
    if (x < 202) assert.ok(rgbaAt(frame, x + 1, y)[2] <= actual[2] + 2, `blue overshoot at ${x},${y}`);
  }
});

test('ambiguous straight RGB-IR edges follow sample cells for either polarity and axis', () => {
  for (const vertical of [true, false]) for (const reverse of [false, true]) {
    // R/B share one axis phase; moving this constant-green edge by one pixel
    // produces identical raw data. The result is a convention, not recovered detail.
    const pattern = vertical ? 'RGBI' : 'RBGI';
    const c = { ...Core.defaults(), pattern, width: 32, height: 32 };
    const colors = reverse ? [[225, 55, 45], [210, 55, 190]] : [[210, 55, 190], [225, 55, 45]];
    const data = [15, 16].map(boundary => Buffer.from(Array.from({ length: 1024 }, (_, i) => {
      const x = i % 32, y = Math.floor(i / 32), channel = pattern[(y % 2) * 2 + x % 2];
      return channel === 'I' ? (x * 17 + y * 21) % 256 : colors[Number((vertical ? x : y) >= boundary)]['RGB'.indexOf(channel)];
    })));
    assert.deepEqual(data[0], data[1], 'sub-cell edge location is unobservable');
    const frame = Core.decode(data[0], c);
    for (let y = 4; y < 28; y++) for (let x = 4; x < 28; x++) {
      assert.deepEqual(rgbaAt(frame, x, y), colors[Number((vertical ? x : y) >= 16)], `${pattern}, reversed ${reverse}, ${x},${y}`);
    }
  }
});

test('RGB-IR edge ownership preserves continuous color ramps', () => {
  // A gradient has no flat plateaus; snapping it to sample cells would create bands.
  const color = (x, y) => [40 + 3 * x + 2 * y, 30 + 2 * x + y, 220 - 2 * x - 2 * y];
  for (const pattern of permutations('RGBI')) {
    const c = { ...Core.defaults(), pattern, width: 32, height: 32 };
    const data = Buffer.from(Array.from({ length: 1024 }, (_, i) => {
      const x = i % 32, y = Math.floor(i / 32), channel = pattern[(y % 2) * 2 + x % 2];
      return channel === 'I' ? (x * 17 + y * 21) % 256 : color(x, y)['RGB'.indexOf(channel)];
    }));
    const frame = Core.decode(data, c);
    for (let y = 4; y < 28; y++) for (let x = 4; x < 28; x++) {
      const expected = color(x, y);
      assert.ok(rgbaAt(frame, x, y).every((value, k) => Math.abs(value - expected[k]) <= 1), `${pattern}, ${x},${y}`);
    }
  }
});

test('RGB-IR reconstructs complete cell-aligned rectangles for all tile permutations and contrast polarities', () => {
  // Check the whole image against an independent synthetic scene, including
  // all four corners, original measured sites and every IR phase placement.
  for (const pattern of permutations('RGBI')) for (const reverse of [false, true]) {
    const c = { ...Core.defaults(), pattern, width: 36, height: 36 };
    const colors = reverse ? [[220,190,160], [25,50,75]] : [[16,16,16], [115,82,68]];
    const scene = (x, y) => colors[Number(x >= 10 && x < 22 && y >= 10 && y < 24)];
    const data = Buffer.from(Array.from({ length: c.width * c.height }, (_, i) => {
      const x = i % c.width, y = Math.floor(i / c.width), channel = pattern[(y % 2) * 2 + x % 2];
      return channel === 'I' ? (x * 17 + y * 21) % 256 : scene(x, y)['RGB'.indexOf(channel)];
    }));
    const frame = Core.decode(data, c), changedIr = Buffer.from(data);
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
      const expected = scene(x, y), actual = rgbaAt(frame, x, y), channel = pattern[(y % 2) * 2 + x % 2];
      assert.ok(actual.every((v, k) => Math.abs(v - expected[k]) <= 1), `${pattern}, reversed ${reverse}, (${x},${y}): ${actual} != ${expected}`);
      if (channel === 'I') changedIr[y * c.width + x] ^= 255;
      else assert.equal(actual['RGB'.indexOf(channel)], data[y * c.width + x]);
    }
    assert.deepEqual(Core.decode(changedIr, c).rgba, frame.rgba, 'IR variation cannot change visible corner confidence or colors');
  }
});

test('an RGB-IR corner without a visible sample uses the cell convention and honors coefficient settings', () => {
  const c = { ...Core.defaults(), pattern: 'RGBI', width: 32, height: 32 };
  const inside = [115,82,68], outside = [16,16,16];
  // Changing the RGB truth at the I site (15,15) leaves the raw bytes identical.
  // This explicitly documents the ambiguity instead of claiming exact recovery.
  const inputs = [false, true].map(cutCorner => Buffer.from(Array.from({ length: 1024 }, (_, i) => {
    const x = i % 32, y = Math.floor(i / 32), channel = c.pattern[(y % 2) * 2 + x % 2];
    const color = x < 16 && y < 16 && !(cutCorner && x === 15 && y === 15) ? inside : outside;
    return channel === 'I' ? (x * 17 + y * 21) % 256 : color['RGB'.indexOf(channel)];
  })));
  assert.deepEqual(inputs[0], inputs[1]);
  const frame = Core.decode(inputs[0], c);
  assert.deepEqual(rgbaAt(frame, 15, 15), inside);
  const coefficients = structuredClone(D.defaults);
  for (const group of Object.values(coefficients.directions)) for (const level of group.levels) level.uniform = 1;
  assert.notDeepEqual(rgbaAt(Core.decode(inputs[0], c, coefficients), 15, 15), inside);
  const side = Core.decode(inputs[0], { ...c, display: 'side' });
  assert.deepEqual(Core.decode(inputs[0], { ...c, display: 'blend', alpha: 0 }).rgba, frame.rgba);
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) assert.deepEqual(rgbaAt(side, x, y), rgbaAt(frame, x, y));
});

test('RGB-IR interpolation stays within each original sample cell on textured data', () => {
  for (const pattern of permutations('RGBI')) for (const bitDepth of [8, 12, 16]) {
    const width = 9, height = 11, peak = 2 ** bitDepth - 1;
    const c = { ...Core.defaults(), pattern, width, height, bitDepth, containerBits: bitDepth === 8 ? 8 : 16 };
    const data = Buffer.alloc(width * height * c.containerBits / 8), samples = [];
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = y * width + x, value = Math.round(((x * 29 + y * 53 + x * y * 7) % 256) / 255 * peak);
      samples[i] = value / peak * 255;
      if (bitDepth === 8) data[i] = value; else data.writeUInt16LE(value, i * 2);
    }
    const frame = Core.decode(data, c);
    for (const [k, channel] of [...'RGB'].entries()) {
      const phase = pattern.indexOf(channel);
      for (let sy = Math.floor(phase / 2); sy + 2 < height; sy += 2) for (let sx = phase % 2; sx + 2 < width; sx += 2) {
        const corners = [samples[sy * width + sx], samples[sy * width + sx + 2], samples[(sy + 2) * width + sx], samples[(sy + 2) * width + sx + 2]];
        for (let y = sy; y <= sy + 2; y++) for (let x = sx; x <= sx + 2; x++) {
          const value = rgbaAt(frame, x, y)[k];
          assert.ok(value >= Math.floor(Math.min(...corners)) && value <= Math.ceil(Math.max(...corners)), `${pattern}, ${bitDepth} bit, ${channel}, ${x},${y}`);
        }
      }
    }
  }
});

test('chroma-only edges do not alternate across row or column phases for any RGB-IR tile', () => {
  for (const pattern of permutations('RGBI')) for (const vertical of [true, false]) for (const boundary of [15, 16]) for (const bitDepth of [8, 12, 16]) {
    const c = { ...Core.defaults(), pattern, width: 32, height: 32, bitDepth, containerBits: bitDepth === 8 ? 8 : 16 };
    const data = Buffer.alloc(1024 * c.containerBits / 8), peak = 2 ** bitDepth - 1;
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
      const channel = pattern[(y % 2) * 2 + x % 2];
      const color = (vertical ? x : y) < boundary ? [210, 55, 190] : [225, 55, 45];
      const value = Math.round((channel === 'I' ? (x * 17 + y * 21) % 256 : color['RGB'.indexOf(channel)]) / 255 * peak);
      if (bitDepth === 8) data[y * 32 + x] = value;
      else data.writeUInt16LE(value, (y * 32 + x) * 2);
    }
    const frame = Core.decode(data, c);
    for (let y = 4; y < 27; y++) for (let x = 4; x < 27; x++) {
      const a = rgbaAt(frame, x, y), b = rgbaAt(frame, x + (vertical ? 0 : 1), y + (vertical ? 1 : 0));
      assert.ok(a.every((value, k) => Math.abs(value - b[k]) <= 1), `${pattern}, ${bitDepth} bit, ${vertical ? 'vertical' : 'horizontal'}, boundary ${boundary}, ${x},${y}`);
    }
  }
});

test('original IR survives RGB reconstruction and side/blend use the same reconstructed RGB', () => {
  const visible = Core.decode(bytes, config), altered = Buffer.from(bytes);
  for (let y = 1; y < config.height; y += 2) for (let x = 1; x < config.width; x += 2) altered[y * config.width + x] ^= 255;
  assert.deepEqual(Core.decode(altered, config).rgba, visible.rgba, 'visible RGB never reads IR as green');
  const ir = Core.decode(bytes, { ...config, display: 'ir' });
  assert.equal(ir.width, 160); assert.equal(ir.height, 120);
  for (let y = 0; y < ir.height; y++) for (let x = 0; x < ir.width; x++) assert.deepEqual(rgbaAt(ir, x, y), Array(3).fill(bytes[(2 * y + 1) * 320 + 2 * x + 1]));
  const side = Core.decode(bytes, { ...config, display: 'side' });
  const blend0 = Core.decode(bytes, { ...config, display: 'blend', alpha: 0 });
  const blend1 = Core.decode(bytes, { ...config, display: 'blend', alpha: 1 });
  assert.deepEqual(blend0.rgba, visible.rgba);
  for (let y = 0; y < config.height; y++) for (let x = 0; x < config.width; x++) {
    assert.deepEqual(rgbaAt(side, x, y), rgbaAt(visible, x, y));
    assert.deepEqual(rgbaAt(side, x + config.width, y), rgbaAt(blend1, x, y));
  }
});

test('RGB-IR Bayer reconstruction respects custom coefficients in both core and worker', async () => {
  const coefficients = structuredClone(D.defaults);
  for (const group of Object.values(coefficients.directions)) for (const level of group.levels) { level.uniform = 1; level.tangentBias = 0; }
  const normal = Core.decode(bytes, config), changed = Core.decode(bytes, config, coefficients);
  assert.notDeepEqual(normal.rgba, changed.rgba);
  const worker = new Decoder();
  try {
    const a = await worker.decode({ bytes, config });
    const b = await worker.decode({ bytes, config, coefficients });
    assert.notEqual(a.image, b.image); assert.equal(a.width, 320); assert.equal(a.height, 240);
  } finally { worker.dispose(); }
});
