'use strict';
// Filename metadata must be case-insensitive, basename-scoped and independent of tag order.
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../media/core');

function expect(name, expected) {
  const actual = Core.defaults(name);
  for (const [key, value] of Object.entries(expected)) assert.equal(actual[key], value, `${name}: ${key}`);
  return actual;
}

test('filename tags are case insensitive, order independent, and scoped to the basename', () => {
  const expected = { width: 1920, height: 1080, format: 'CFA', pattern: 'BGGR', bitDepth: 12, containerBits: 16, endian: 'big', alignment: 'msb' };
  for (const name of ['Shot_BGGR_1920X1080_12BIT_IN16_MSB_BE.RAW', 'be-msb-in16-12bit-1920x1080-bggr-shot.raw', 'Shot.BgGr.1920×1080.12Bpp.Container16.MsB.BigEndian.BIN']) {
    expect('/NV12/640x480/8bit/' + name, expected);
    expect('C:\\NV12\\640x480\\8bit\\' + name, expected);
  }
});

test('CFA patterns include Bayer and RGB-IR permutations and compact precision tags', () => {
  for (const pattern of ['RGGB', 'BGGR', 'GRBG', 'GBRG', 'RGBI', 'RGIB', 'IRGB', 'BIRG']) {
    expect(`capture-${pattern.toLowerCase()}12-32x24.raw`, { pattern, bitDepth: 12 });
  }
  expect('rgbir-320x240.raw', { pattern: 'RGGB' }); // The sensor label alone does not specify a tile.
  expect('pattern=rgbi-depth=10-container=16.raw', { pattern: 'RGBI', bitDepth: 10, containerBits: 16 });
});

test('precision and container metadata stay distinct and obey the ordinary validation', () => {
  for (const tag of ['in16', 'container16bit', 'container-16-bit', 'containerbits_16']) {
    expect(`sample-12bit-${tag}-32x24.raw`, { bitDepth: 12, containerBits: 16 });
  }
  expect('raw10-packed-le.raw', { bitDepth: 10, containerBits: 10, storage: 'packed', endian: 'little' });
  expect('8BIT_IN10_MSB.raw', { bitDepth: 8, containerBits: 10, alignment: 'msb' });
  const unpacked = expect('raw12-unpacked.raw', { bitDepth: 12, storage: 'unpacked', containerBits: 0 });
  assert.equal(Core.containerBits(unpacked), 16);
  for (let bits = 4; bits <= 32; bits++) expect(`sample_${bits}bit.raw`, { bitDepth: bits });
  const bad = Core.defaults('12bit-in8-4x4.raw');
  assert.ok(Core.analyze(bad, 64).errors.containerBits);
  assert.ok(Core.analyze(Core.defaults('33bit-4x4.raw'), 128).errors.bitDepth);
});

test('YUV names use the same presets as the inspector, with explicit field overrides', () => {
  for (const name of Object.keys(Core.yuvPresets)) expect(`${name.toLowerCase()}-32x24.BIN`, { format: 'YUV', ...Core.yuvPresetConfig(name) });
  expect('P010_1920X1080_BE_LSB_OFFSET32_PITCH4096_UVPITCH2048_BT.2020_FULL.yuv', {
    format: 'YUV', bitDepth: 10, containerBits: 16, endian: 'big', alignment: 'lsb', offset: 32,
    rowPitch: 4096, chromaPitch: 2048, matrix: '2020', range: 'full'
  });
  expect('yuv-rowPitch_1024-chromaPitch_512-bt601-limited.raw', { format: 'YUV', rowPitch: 1024, chromaPitch: 512, matrix: '601', range: 'limited' });
  expect('NV12_32x24.Y', { yuvPlanes: 'y', subsampling: '400', layout: 'planar-uv' });
  expect('P012_32x24.UV', { yuvPlanes: 'uv', subsampling: '420', layout: 'semi-uv', bitDepth: 12 });
  const uv = Core.defaults('YUYV_32x24.uv');
  assert.ok(Core.analyze(uv, 10000).valid);
});

test('ordinary words, directory tags, conflicting fields and encoded image names do not supply false hints', () => {
  for (const name of ['somebggrimage-model12bit-raw123-nv123-ble-maybe.raw', '/bggr-12bit-1920x1080/file.raw', 'sample-rgbir-rggg-20260925.raw']) {
    assert.deepEqual(Core.defaults(name), Core.defaults());
  }
  expect('bggr-grbg-10bit-12bit-in10-in16-le-be-32x24-64x48.raw', { pattern: 'RGGB', bitDepth: 8, containerBits: 0, endian: 'little', width: 640, height: 480 });
  expect('bggr-BGGR-12bit-12BIT.raw', { pattern: 'BGGR', bitDepth: 12 });
  for (const ext of ['PNG', 'JPG', 'JPEG']) assert.deepEqual(Core.filenameHints(`BGGR_12bit_in16_32x24.${ext}`), {});
});
