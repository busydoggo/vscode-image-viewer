'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { area, rendering } = require('../media/resample');
const source = (width, height, value) => Uint8ClampedArray.from(Array.from({ length: width * height }, (_, i) => value(i % width, Math.floor(i / width))).flat());
test('area reduction removes one-pixel stripe aliasing without changing the source', () => {
  const pixels = source(96, 64, x => [x % 2 * 255, x % 2 * 255, x % 2 * 255, 255]), before = pixels.slice();
  const result = area(pixels, 96, 64, 24, 16);
  for (let i = 0; i < result.length; i += 4) assert.deepEqual([...result.slice(i, i + 4)], [128, 128, 128, 255]);
  assert.deepEqual(pixels, before);
});
test('fractional reduction integrates exact overlaps and preserves constant colors at odd borders', () => {
  const pixels = source(3, 1, x => [[0, 0, 0, 255], [120, 60, 30, 255], [240, 120, 60, 255]][x]);
  assert.deepEqual([...area(pixels, 3, 1, 2, 1)], [40, 20, 10, 255, 200, 100, 50, 255]);
  const flat = source(17, 13, () => [120, 40, 210, 255]);
  for (const [w, h] of [[1, 1], [3, 5], [16, 12]]) {
    const result = area(flat, 17, 13, w, h);
    for (let i = 0; i < result.length; i += 4) assert.deepEqual([...result.slice(i, i + 4)], [120, 40, 210, 255]);
  }
});
test('premultiplied integration prevents transparent RGB from bleeding into visible pixels', () => {
  assert.deepEqual([...area(new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 0]), 2, 1, 1, 1)], [255, 0, 0, 128]);
  assert.deepEqual([...area(new Uint8ClampedArray(16), 2, 2, 1, 1)], [0, 0, 0, 0]);
});
test('native and integer zoom preserve pixels; fractional zoom uses smooth display', () => {
  for (const zoom of [1, 2, 4, 64]) assert.equal(rendering(zoom), 'pixelated');
  for (const zoom of [.1, .5, .99, 1.1, 1.5, 2.2]) assert.equal(rendering(zoom), 'auto');
  assert.throws(() => area(new Uint8Array(16), 2, 2, 3, 1), RangeError);
  assert.throws(() => area(new Uint8Array(15), 2, 2, 1, 1), RangeError);
});
