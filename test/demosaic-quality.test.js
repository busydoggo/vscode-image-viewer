'use strict';
// Compare every pixel against independent scenes, and verify measurement preservation separately.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Core = require('../media/core');
const D = require('../media/demosaic');
const { mosaic } = require('../scripts/scene-fixtures');
const { synthetic, metrics } = require('../scripts/demosaic-quality');
const { readRgbPng } = require('../scripts/png-rgb');
function decode(image, pattern, bitDepth, enabled = true, containerBits = 16, coefficients) {
  const config = { ...Core.defaults(), width: image.width, height: image.height, pattern, bitDepth, containerBits, gamma: 1 };
  const settings = coefficients || structuredClone(D.defaults); settings.antiAlias.enabled = enabled;
  return Core.decode(mosaic(image, pattern, bitDepth, containerBits), config, settings).rgba;
}
test('anti-alias refinement lowers full-frame Bayer error and zipper variation across slants and textures', () => {
  for (const pattern of ['RGGB', 'BGGR', 'GRBG', 'GBRG']) {
    let before = 0, after = 0, zipperBefore = 0, zipperAfter = 0;
    for (const name of ['slant-7', 'slant-22', 'slant-45', 'slant-67', 'slant-83', 'arcs', 'fabric', 'thin-lines', 'color-slant', 'ramp']) {
      const image = synthetic(name), a = metrics(image, decode(image, pattern, 12, false)), b = metrics(image, decode(image, pattern, 12));
      before += a.mae; after += b.mae; zipperBefore += a.zipper; zipperAfter += b.zipper;
      // Include hard cases rather than silently dropping scenes that improve less.
      assert.ok(b.mae <= a.mae * 1.015 + .003, `${pattern}/${name}: ${a.mae} -> ${b.mae}`);
      if (name === 'ramp' || name === 'color-slant') assert.equal(b.mae, a.mae);
    }
    assert.ok(after < before * .99, `${pattern}: full-frame reconstruction improvement`);
    assert.ok(zipperAfter < zipperBefore * .99, `${pattern}: chroma-error variation improvement`);
  }
});
test('natural-scene full-frame Bayer MAE, edge error and chroma error improve without excluding borders', () => {
  for (const name of ['traffic', 'wildlife', 'football']) {
    const image = readRgbPng(fs.readFileSync(path.join(__dirname, `../fixtures/${name}-reference.png`)));
    const before = metrics(image, decode(image, 'RGGB', 12, false)), after = metrics(image, decode(image, 'RGGB', 12));
    for (const key of ['mae', 'edgeMae', 'chromaMae', 'zipper']) assert.ok(after[key] < before[key], `${name}/${key}: ${before[key]} -> ${after[key]}`);
    assert.equal(after.pixels, image.width * image.height);
  }
});
test('12/16-bit Bayer and RGB-IR retain every measured visible sample and ignore IR intensity', () => {
  const image = synthetic('fabric', 64, 48);
  for (const pattern of ['RGGB', 'BGGR', 'GRBG', 'GBRG', 'RGBI', 'GRIB']) for (const bitDepth of [12, 16]) {
    const result = decode(image, pattern, bitDepth, true, bitDepth === 12 ? 12 : 16);
    for (let i = 0; i < image.width * image.height; i++) {
      const channel = 'RGB'.indexOf(pattern[(Math.floor(i / image.width) % 2) * 2 + (i % image.width) % 2]);
      if (channel >= 0) assert.equal(result[i * 4 + channel], image.rgb[i * 3 + channel], `${pattern}/${bitDepth}/${i}`);
      assert.equal(result[i * 4 + 3], 255);
    }
    if (pattern.includes('I')) {
      const config = { ...Core.defaults(), width: image.width, height: image.height, pattern, bitDepth, containerBits: 16 };
      const low = Core.decode(mosaic(image, pattern, bitDepth, 16, 0), config);
      const high = Core.decode(mosaic(image, pattern, bitDepth, 16, 255), config);
      assert.deepEqual(low.rgba, high.rgba);
    }
  }
});
test('older coefficient files inherit defaults; invalid anti-alias coefficients cannot reload', () => {
  const old = structuredClone(D.defaults); delete old.antiAlias; assert.equal(D.validate(old), old);
  const image = synthetic('fabric', 32, 24), config = { ...Core.defaults(), width: 32, height: 24, bitDepth: 12, containerBits: 16 };
  const bytes = mosaic(image, 'RGGB', 12, 16);
  assert.deepEqual(Core.decode(bytes, config, old).rgba, Core.decode(bytes, config, D.defaults).rgba);
  for (const change of [s => { s.enabled = 1; }, s => { s.greenThreshold = NaN; }, s => { s.directionSpan = 0; }, s => { s.syntheticWeight = 2; }]) {
    const settings = structuredClone(D.defaults); change(settings.antiAlias); assert.throws(() => D.validate(settings));
  }
});
test('tiled refinement does not create seams when CFA content is translated across a tile boundary', () => {
  // Shift by an even number so both the CFA phase and scene stay identical, but tile boundaries move.
  const scene = (x, y) => [110 + 60 * Math.sin(x * .8 + y * .23), 120 + 60 * Math.sin(x * .8 + y * .23), 95 + 60 * Math.sin(x * .8 + y * .23)];
  function image(width, height, shift) {
    const rgb = Buffer.alloc(width * height * 3);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) rgb.set(scene(x - shift, y - shift).map(Math.round), (y * width + x) * 3);
    return { width, height, rgb };
  }
  const a = decode(image(384, 96, 0), 'RGGB', 12), b = decode(image(448, 160, 32), 'RGGB', 12);
  for (let y = 16; y < 80; y++) for (let x = 16; x < 368; x++) for (let k = 0; k < 3; k++) {
    assert.equal(a[(y * 384 + x) * 4 + k], b[((y + 32) * 448 + x + 32) * 4 + k], `tile translation (${x},${y})/${k}`);
  }
});
