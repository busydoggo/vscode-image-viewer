'use strict';
// Validate actual files, storage inference and reconstructed patch colors against the PNG reference.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const Core = require('../media/core');
const { readRgbPng } = require('../scripts/png-rgb');
const manifest = require('../fixtures/colorchecker24.json');
const directory = path.join(__dirname, '../fixtures');
const image = readRgbPng(fs.readFileSync(path.join(directory, 'colorchecker24-reference.png')));
const at = (x, y) => [...image.rgb.subarray((y * image.width + x) * 3, (y * image.width + x) * 3 + 3)];

test('IQ reference contains 24 square color patches and a descending gray row', () => {
  assert.equal(image.width, 640); assert.equal(image.height, 432);
  assert.equal(manifest.colors.length, 24);
  assert.deepEqual(manifest.colors[0], [115,82,68]);
  assert.deepEqual(manifest.colors[23], [52,52,52]);
  for (let i = 0; i < 24; i++) {
    const x = 16 + (i % 6) * 104, y = 16 + Math.floor(i / 6) * 104;
    for (const [dx, dy] of [[0,0], [87,0], [0,87], [87,87], [44,44]]) assert.deepEqual(at(x + dx, y + dy), manifest.colors[i]);
    assert.deepEqual(at(x - 1, y), [16,16,16]);
    assert.deepEqual(at(x + 88, y), [16,16,16]);
    assert.deepEqual(at(x, y - 1), [16,16,16]);
    assert.deepEqual(at(x, y + 88), [16,16,16]);
    if (i > 18) assert.ok(manifest.colors[i][0] < manifest.colors[i - 1][0]);
  }
  for (const entry of manifest.entries) {
    const data = fs.readFileSync(path.join(directory, entry.file));
    assert.equal(data.length, entry.bytes);
    assert.equal(createHash('sha256').update(data).digest('hex'), entry.sha256);
  }
});

for (const entry of manifest.entries.filter(entry => entry.kind === 'CFA')) {
  test(`${entry.file}: raw samples and preview match the color chart`, async t => {
    const bytes = fs.readFileSync(path.join(directory, entry.file));
    const config = Core.defaults(entry.file.toUpperCase()), info = Core.analyze(config, bytes.length);
    for (const key of ['width', 'height', 'pattern', 'bitDepth', 'endian', 'alignment']) assert.equal(config[key], entry[key]);
    assert.equal(Core.containerBits(config), entry.containerBits);
    assert.ok(info.valid); assert.equal(info.requiredBytes, bytes.length);
    assert.equal(Core.sequence(config, bytes.length).frameCount, 1);
    const read = Core.sampleReader(bytes, config), peak = 2 ** config.bitDepth - 1;
    // Compare every stored sample, including packed row boundaries and synthetic IR sites.
    for (let y = 0; y < config.height; y++) for (let x = 0; x < config.width; x++) {
      const channel = config.pattern[(y % 2) * 2 + x % 2];
      const sample = channel === 'I' ? 128 : image.rgb[(y * config.width + x) * 3 + 'RGB'.indexOf(channel)];
      assert.equal(read(info.planes[0], x, y), Math.round(sample * peak / 255));
    }
    const decoded = Core.decode(bytes, config);
    // Both Bayer and RGB-IR must pass the identical full-frame error budget.
    await t.test('full-frame demosaic comparison: every pixel and RGB channel, including borders', t => {
      // Validate dimensions before comparing every pixel: no corner-only ROI,
      // sampling stride, border exclusion or average-only acceptance criterion.
      assert.equal(decoded.width, image.width);
      assert.equal(decoded.height, image.height);
      assert.equal(decoded.rgba.length, image.width * image.height * 4);
      let error = 0, maximum = 0, worstPixel = 0, worstChannel = 0;
      for (let i = 0; i < image.width * image.height; i++) {
        assert.equal(decoded.rgba[i * 4 + 3], 255, `non-opaque pixel (${i % image.width},${Math.floor(i / image.width)})`);
        for (let k = 0; k < 3; k++) {
          const difference = Math.abs(decoded.rgba[i * 4 + k] - image.rgb[i * 3 + k]);
          error += difference;
          if (difference > maximum) { maximum = difference; worstPixel = i; worstChannel = k; }
        }
      }
      const mean = error / image.rgb.length;
      const location = `(${worstPixel % image.width},${Math.floor(worstPixel / image.width)}), ${'RGB'[worstChannel]}`;
      const actual = decoded.rgba[worstPixel * 4 + worstChannel], expected = image.rgb[worstPixel * 3 + worstChannel];
      t.diagnostic(`${image.width * image.height} pixels / ${image.rgb.length} RGB samples: max error ${maximum}, MAE ${mean}`);
      // The strict per-channel bound applies everywhere, including all patch
      // corners, gutters and the outer image border, in every storage variant.
      assert.ok(maximum <= 1, `full-frame max error ${maximum} > 1 at ${location}: actual ${actual}, expected ${expected}; MAE ${mean}`);
      assert.ok(mean <= 0.1, `full-frame RGB8 MAE ${mean} > 0.1; worst ${location}, error ${maximum}`);
    });
    for (let i = 0; i < 24; i++) {
      // Test all four sensor phases well inside each flat patch, away from demosaicing edges.
      const x = 60 + (i % 6) * 104, y = 60 + Math.floor(i / 6) * 104;
      for (const [dx, dy] of [[0,0], [1,0], [0,1], [1,1]]) {
        const offset = ((y + dy) * config.width + x + dx) * 4;
        assert.deepEqual([...decoded.rgba.subarray(offset, offset + 3)], manifest.colors[i]);
      }
    }
  });
}
