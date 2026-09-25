'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const Core = require('../media/core');
const { Decoder } = require('../src/decoder');

function writeRow(bytes, start, samples, c) {
  const bits = c.storage === 'packed' ? c.bitDepth : Math.ceil(c.bitDepth / 8) * 8;
  for (let x = 0; x < samples.length; x++) {
    let value = samples[x];
    if (c.storage !== 'packed') {
      if (c.alignment === 'msb') value *= 2 ** (bits - c.bitDepth);
      for (let b = 0; b < bits / 8; b++) {
        bytes[start + x * bits / 8 + (c.endian === 'little' ? b : bits / 8 - b - 1)] = value % 256;
        value = Math.floor(value / 256);
      }
    } else for (let b = 0; b < bits; b++) {
      const bit = x * bits + b, source = c.endian === 'little' ? b : bits - b - 1;
      const mask = 1 << (c.endian === 'little' ? bit % 8 : 7 - bit % 8);
      if (Math.floor(value / 2 ** source) % 2) bytes[start + Math.floor(bit / 8)] |= mask;
      else bytes[start + Math.floor(bit / 8)] &= ~mask;
    }
  }
}

test('CFA inspection preserves 4–32 bit samples and 2x2 RGB-IR array phase before tone mapping', () => {
  for (let bitDepth = 4; bitDepth <= 32; bitDepth++) for (const storage of ['packed', 'unpacked']) for (const endian of ['little', 'big']) for (const alignment of ['lsb', 'msb']) {
    const c = { ...Core.defaults(), width: 5, height: 3, bitDepth, storage, endian, alignment, rowPitch: 24,
      pattern: 'RG / IB', exposure: 3, gamma: 2, black: 1, display: 'ir' };
    const info = Core.analyze(c, 72), bytes = Buffer.alloc(info.requiredBytes, 0xaa);
    const value = (x, y) => [0, 2 ** bitDepth - 1, 3, 2 ** (bitDepth - 1), 7][(x + y) % 5];
    for (let y = 0; y < c.height; y++) writeRow(bytes, y * c.rowPitch, Array.from({ length: c.width }, (_, x) => value(x, y)), c);
    const read = Core.pixelReader(bytes, c);
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
      assert.deepEqual(read(x, y), { format: 'CFA', channel: ['RG', 'IB'][y % 2][x % 2], value: value(x, y) });
    }
    for (const point of [[-1, 0], [0, -1], [5, 0], [0, 3], [0.5, 0], [NaN, 0]]) assert.equal(read(...point), null);
  }
});

for (const subsampling of ['400', '420', '422', '444']) for (const layout of Core.layouts[subsampling]) {
  test(`pixel inspection locates Y/U/V for ${subsampling} ${layout} with odd dimensions and padding`, () => {
    for (const bitDepth of [4, 10, 32]) for (const storage of ['packed', 'unpacked']) for (const endian of ['little', 'big']) {
      const c = { ...Core.defaults('frame.yuv'), width: 3, height: 3, subsampling, layout, bitDepth, storage, endian, rowPitch: 40, chromaPitch: 24, yuvDisplay: 'luma' };
      const info = Core.analyze(c, 1e6), bytes = Buffer.alloc(info.requiredBytes, 0xee), peak = 2 ** bitDepth - 1;
      const Y = (x, y) => (x + y * 3) % (peak + 1), U = (x, y) => peak - x - y * 2, V = (x, y) => 2 ** (bitDepth - 1) + x + y;
      for (const plane of info.planes) for (let y = 0; y < plane.rows; y++) {
        const samples = Array.from({ length: plane.samples }, (_, x) => {
          if (plane.name === 'Y') return Y(x, y);
          if (plane.name === 'U') return U(x, y);
          if (plane.name === 'V') return V(x, y);
          if (plane.name === 'UV') return (layout === 'semi-uv' ? x % 2 === 0 : x % 2 !== 0) ? U(Math.floor(x / 2), y) : V(Math.floor(x / 2), y);
          if (subsampling === '444') return ({ Y, U, V })[layout[x % 3]](Math.floor(x / 3), y);
          const pair = Math.floor(x / 4), pixels = {
            YUYV: [Y(pair * 2, y), U(pair, y), Y(pair * 2 + 1, y), V(pair, y)],
            UYVY: [U(pair, y), Y(pair * 2, y), V(pair, y), Y(pair * 2 + 1, y)],
            YVYU: [Y(pair * 2, y), V(pair, y), Y(pair * 2 + 1, y), U(pair, y)],
            VYUY: [V(pair, y), Y(pair * 2, y), U(pair, y), Y(pair * 2 + 1, y)]
          };
          return pixels[layout][x % 4];
        });
        writeRow(bytes, plane.offset + plane.pitch * y, samples, c);
      }
      const read = Core.pixelReader(bytes, c);
      for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) {
        const cx = subsampling === '444' ? x : Math.floor(x / 2), cy = subsampling === '420' ? Math.floor(y / 2) : y;
        assert.deepEqual(read(x, y), { format: 'YUV', y: Y(x, y), u: subsampling === '400' ? null : U(cx, cy), v: subsampling === '400' ? null : V(cx, cy) });
      }
      if (info.planes.length > 1) {
        const uv = Core.pixelReader(bytes.subarray(info.planes[1].offset), { ...c, yuvPlanes: 'uv', yuvDisplay: 'chroma' });
        assert.deepEqual(uv(2, 2), { ...read(2, 2), y: null });
      }
    }
  });
}

test('worker samples the decoded snapshot and rejects stale frame IDs after offset/frame changes', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sensor-pixel-')), decoder = new Decoder();
  try {
    const file = path.join(dir, 'capture.raw'), c = { ...Core.defaults(), width: 2, height: 2, bitDepth: 32, offset: 7 };
    const bytes = Buffer.alloc(7 + 16 * 2 + 3, 0xab);
    for (let i = 0; i < 4; i++) { bytes.writeUInt32LE(4294967295 - i, 7 + i * 4); bytes.writeUInt32LE(1000 + i, 23 + i * 4); }
    await fs.writeFile(file, bytes);
    const first = await decoder.decode({ path: file, config: c, length: 16, readOffset: 7 });
    await fs.writeFile(file, Buffer.alloc(bytes.length));
    const query = decoder.inspect(first.frameId, 1, 0);
    assert.equal(decoder.decoding, false, 'pixel queries must not cause playback to cancel its worker');
    assert.deepEqual((await query).pixel, { format: 'CFA', channel: 'G', value: 4294967294 });
    await fs.writeFile(file, bytes);
    const second = await decoder.decode({ path: file, config: c, length: 16, readOffset: 23 });
    assert.equal((await decoder.inspect(first.frameId, 1, 0)).pixel, null);
    assert.deepEqual((await decoder.inspect(second.frameId, 1, 1)).pixel, { format: 'CFA', channel: 'B', value: 1003 });
    assert.equal((await decoder.inspect(second.frameId, -1, 0)).pixel, null);
  } finally { decoder.dispose(); await fs.rm(dir, { recursive: true }); }
});

test('IR-only worker inspects the original IR sample for each reduced image pixel', async () => {
  const decoder = new Decoder();
  try {
    for (const pattern of ['RGBI', 'GRIB', 'BIRG', 'IBRG']) {
      const c = { ...Core.defaults(), width: 4, height: 4, pattern, display: 'ir' };
      const bytes = Buffer.from(Array.from({ length: 16 }, (_, i) => i * 10));
      const frame = await decoder.decode({ bytes, config: c });
      assert.equal(frame.width, 2); assert.equal(frame.height, 2);
      const index = pattern.indexOf('I');
      assert.deepEqual((await decoder.inspect(frame.frameId, 1, 1)).pixel,
        { format: 'CFA', channel: 'I', value: bytes[(2 + Math.floor(index / 2)) * 4 + 2 + index % 2] });
      assert.equal((await decoder.inspect(frame.frameId, 2, 0)).pixel, null);
    }
  } finally { decoder.dispose(); }
});
