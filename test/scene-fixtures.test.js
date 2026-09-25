'use strict';
// Check synthetic reference provenance, deterministic packing and filename-based decoding together.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const Core = require('../media/core');
const { readRgbPng } = require('../scripts/png-rgb');
const { mosaic } = require('../scripts/scene-fixtures');
const { encodePng } = require('../src/png');
const manifest = require('../fixtures/scenes.json');
const directory = path.join(__dirname, '../fixtures');

test('explicit CFA filenames select bit depth, packing, phase and byte order without affecting ordinary RAW defaults', () => {
  for (const file of manifest.entries.filter(entry => entry.kind === 'CFA')) {
    const c = Core.defaults('/a/640x480/' + file.file);
    for (const key of ['width', 'height', 'pattern', 'bitDepth', 'containerBits', 'endian', 'alignment', 'gamma']) assert.equal(c[key], file[key], `${file.file}: ${key}`);
  }
  const c = Core.defaults('sample-BAYER-GBRG-12BIT-IN16-MSB-BE-17X19.RAW');
  assert.equal(c.pattern, 'GBRG'); assert.equal(c.alignment, 'msb'); assert.equal(c.endian, 'big');
  assert.equal(Core.defaults('ordinary-1536x1024.raw').bitDepth, 8);
  assert.equal(Core.defaults('sample-bayer-rggb-12bit-in16-lsb-le-17x19.png').bitDepth, 8);
});

test('fixture PNG reader retains known RGB pixels and rejects corrupted or transparent inputs', () => {
  const rgba = Uint8ClampedArray.from([12, 34, 56, 255, 78, 90, 123, 255, 145, 167, 189, 255, 201, 222, 244, 255]);
  const png = encodePng(2, 2, rgba), decoded = readRgbPng(png);
  assert.equal(decoded.width, 2); assert.equal(decoded.height, 2);
  assert.deepEqual([...decoded.rgb], [12, 34, 56, 78, 90, 123, 145, 167, 189, 201, 222, 244]);
  const corrupted = Buffer.from(png); corrupted[20] ^= 1;
  assert.throws(() => readRgbPng(corrupted), /checksum/);
  rgba[3] = 0; assert.throws(() => readRgbPng(encodePng(2, 2, rgba)), /opaque/);
});

test('12-bit packed fixtures restart at every odd-width row and match unpacked samples', () => {
  const rgb = Buffer.from(Array.from({ length: 3 * 5 * 3 }, (_, i) => (i * 47) % 256));
  const image = { width: 3, height: 5, rgb };
  for (const pattern of ['RGGB', 'BGGR', 'GRBG', 'GBRG']) for (const bits of [12, 16]) {
    const bytes = mosaic(image, pattern, 12, bits), c = { ...Core.defaults(), width: 3, height: 5, pattern, bitDepth: 12, containerBits: bits };
    const info = Core.analyze(c, bytes.length), read = Core.sampleReader(bytes, c);
    assert.equal(info.requiredBytes, Math.ceil(3 * bits / 8) * 5);
    for (let y = 0; y < 5; y++) for (let x = 0; x < 3; x++) {
      const channel = 'RGB'.indexOf(pattern[(y % 2) * 2 + x % 2]);
      assert.equal(read(info.planes[0], x, y), Math.round(rgb[(y * 3 + x) * 3 + channel] * 4095 / 255));
    }
  }
});

for (const scene of ['traffic', 'wildlife', 'football']) {
  test(`${scene}: actual 12/16-bit CFA files match reference pixels, metadata and checksums`, () => {
    const reference = manifest.entries.find(entry => entry.scene === scene && entry.kind === 'reference');
    const png = fs.readFileSync(path.join(directory, reference.file)), image = readRgbPng(png);
    assert.equal(createHash('sha256').update(png).digest('hex'), reference.sha256);
    assert.equal(image.width, 1536); assert.equal(image.height, 1024);
    const files = manifest.entries.filter(entry => entry.scene === scene && entry.kind === 'CFA');
    assert.equal(files.length, 3);
    for (const file of files) {
      const bytes = fs.readFileSync(path.join(directory, file.file)), c = Core.defaults(file.file), info = Core.analyze(c, bytes.length);
      assert.equal(info.valid, true); assert.equal(info.trailingBytes, 0); assert.equal(bytes.length, file.bytes);
      assert.equal(info.planes[0].pitch, file.rowPitch); assert.equal(Core.sequence(c, bytes.length).frameCount, 1);
      assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256);
      const read = Core.sampleReader(bytes, c), peak = 2 ** c.bitDepth - 1;
      let nonzeroLowBits = 0, bright = 0;
      for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
        const channel = 'RGB'.indexOf(c.pattern[(y % 2) * 2 + x % 2]);
        const expected = Math.round(image.rgb[(y * c.width + x) * 3 + channel] * peak / 255);
        const value = read(info.planes[0], x, y);
        if (value !== expected) assert.fail(`${file.file} (${x},${y}): ${value} != ${expected}`);
        if (value % 2 ** (c.bitDepth - 8)) nonzeroLowBits++;
        if (value > 255) bright++;
      }
      assert.ok(nonzeroLowBits > 10000); assert.ok(bright > 10000, 'files contain high-bit-depth sample values');
    }
    // Decode a real, non-uniform scene at full size, retaining measured samples.
    const file = files.find(file => file.bitDepth === 16), bytes = fs.readFileSync(path.join(directory, file.file));
    const c = Core.defaults(file.file), decoded = Core.decode(bytes, c);
    let error = 0;
    for (let y = 4; y < c.height - 4; y++) for (let x = 4; x < c.width - 4; x++) {
      const i = y * c.width + x, channel = 'RGB'.indexOf(c.pattern[(y % 2) * 2 + x % 2]);
      assert.equal(decoded.rgba[i * 4 + channel], image.rgb[i * 3 + channel]);
      for (let k = 0; k < 3; k++) error += Math.abs(decoded.rgba[i * 4 + k] - image.rgb[i * 3 + k]);
    }
    assert.ok(error / ((c.width - 8) * (c.height - 8) * 3) < 10, 'decoded colors remain close to the reference');
  });
}
