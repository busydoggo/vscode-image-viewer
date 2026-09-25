'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { inflateSync } = require('node:zlib');
const { Worker } = require('node:worker_threads');
const Core = require('../media/core');
require('../media/i18n').setLocale('zh-cn');
const { readRange } = require('../src/io');
const { encodePng, crc32 } = require('../src/png');
function config(values = {}) { return { ...Core.defaults(), width: 4, height: 4, ...values }; }
function rgb(frame, x = 0, y = 0) { return [...frame.rgba.slice((y * frame.width + x) * 4, (y * frame.width + x) * 4 + 3)]; }
function pack(samples, bits, endian, packed, alignment = 'lsb') {
  const width = packed ? bits : Math.ceil(bits / 8) * 8;
  const bytes = Buffer.alloc(Math.ceil(samples.length * width / 8));
  for (let i = 0; i < samples.length; i++) {
    if (packed) {
      for (let j = 0; j < bits; j++) {
        const pos = i * bits + j, source = endian === 'little' ? j : bits - 1 - j;
        if (Math.floor(samples[i] / 2 ** source) % 2) bytes[Math.floor(pos / 8)] |= 1 << (endian === 'little' ? pos % 8 : 7 - pos % 8);
      }
    } else {
      let value = samples[i] * (alignment === 'msb' ? 2 ** (width - bits) : 1);
      for (let b = 0; b < width / 8; b++) { bytes[i * width / 8 + (endian === 'little' ? b : width / 8 - 1 - b)] = value % 256; value = Math.floor(value / 256); }
    }
  }
  return bytes;
}
test('file classification is case-insensitive and suffix-based', () => {
  assert.equal(Core.kind('a.PNG'), 'PNG'); assert.equal(Core.kind('a.jpg'), 'JPEG'); assert.equal(Core.kind('a.JPEG'), 'JPEG');
  assert.equal(Core.kind('a.png.raw'), 'BINARY'); assert.equal(Core.extension('/path/a'), ''); assert.equal(Core.extension('.hidden'), '');
  assert.equal(Core.defaults('frame-1920x1080.raw').width, 1920);
});
test('byte budget accounts for offset, truncation, padding and incomplete frames', () => {
  let c = config({ offset: 8 });
  assert.equal(Core.analyze(c, 40).requiredBytes, 16); assert.equal(Core.analyze(c, 40).trailingBytes, 16);
  assert.match(Core.analyze(c, 23).errors.width, /尺寸超过文件大小/);
  assert.match(Core.analyze(c, 7).errors.offset, /Offset/);
  c = config({ bitDepth: 10, storage: 'packed', width: 3, height: 2 });
  assert.equal(Core.analyze(c, 8).requiredBytes, 8);
  assert.equal(Core.analyze({ ...c, rowPitch: 8 }, 16).requiredBytes, 16);
  assert.match(Core.analyze({ ...c, rowPitch: 2 }, 16).errors.rowPitch, /至少/);
  assert.equal(Core.analyze(config({ width: 0 }), 100).valid, false);
  assert.equal(Core.analyze(config({ height: null }), 100).valid, false);
  assert.equal(Core.analyze(config({ width: 65536, height: 65536 }), 100).valid, false);
});
for (let bitDepth = 4; bitDepth <= 32; bitDepth++) for (const endian of ['little', 'big']) for (const storage of ['unpacked', 'packed']) {
  test(`${bitDepth}-bit ${endian} ${storage} roundtrip without 32-bit overflow`, () => {
    const max = 2 ** bitDepth - 1, samples = [0, 1, Math.floor(max / 3), max - 1, max];
    for (const alignment of storage === 'unpacked' ? ['lsb', 'msb'] : ['lsb']) {
      const c = config({ bitDepth, endian, storage, alignment }); const bytes = pack(samples, bitDepth, endian, storage === 'packed', alignment);
      const read = Core.sampleReader(bytes, c), plane = { offset: 0, pitch: bytes.length };
      assert.deepEqual(samples.map((_, x) => read(plane, x, 0)), samples);
    }
  });
}
function yuvFixture(c) {
  const info = Core.analyze(c, 1e9), values = { Y: 81, U: 90, V: 240 }, bytes = Buffer.alloc(info.requiredBytes, 255);
  for (const p of info.planes) for (let y = 0; y < p.rows; y++) {
    const samples = Array.from({ length: p.samples }, (_, x) => values[p.name === 'UV' ? (c.layout === 'semi-uv' ? 'UV' : 'VU')[x % 2] : p.name === 'packed' ? c.layout[x % c.layout.length] : p.name]);
    pack(samples, c.bitDepth, c.endian, c.storage === 'packed', c.alignment).copy(bytes, p.offset + y * p.pitch);
  }
  return bytes;
}
for (const subsampling of ['420', '422', '444']) for (const layout of Core.layouts[subsampling]) {
  test(`YUV ${subsampling} ${layout} matches BT.601 red reference, including odd dimensions and padding`, () => {
    const c = config({ format: 'YUV', width: 3, height: 3, matrix: '601', subsampling, layout, rowPitch: 16, chromaPitch: 16 });
    const result = Core.decode(yuvFixture(c), c);
    for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) assert.deepEqual(rgb(result, x, y), [254, 0, 0]);
  });
}
test('YUV420 plane dimensions and semi-planar pitch use ceil chroma sizes', () => {
  const c = config({ format: 'YUV', width: 3, height: 3 });
  assert.equal(Core.analyze(c, 100).requiredBytes, 17);
  assert.equal(Core.analyze({ ...c, layout: 'semi-uv' }, 100).requiredBytes, 17);
  assert.equal(Core.analyze({ ...c, layout: 'semi-uv', bitDepth: 10, storage: 'packed' }, 100).requiredBytes, 22);
  assert.equal(Core.analyze({ ...c, subsampling: '420', layout: 'YUYV' }, 100).valid, false);
});
test('YUV400 supports every depth with full and limited ranges', () => {
  for (let bitDepth = 4; bitDepth <= 32; bitDepth++) for (const storage of ['packed', 'unpacked']) {
    const c = config({ format: 'YUV', subsampling: '400', width: 2, height: 1, bitDepth, storage, range: 'full' });
    const bytes = pack([0, 2 ** bitDepth - 1], bitDepth, 'little', storage === 'packed');
    const result = Core.decode(bytes, c); assert.deepEqual(rgb(result), [0, 0, 0]); assert.deepEqual(rgb(result, 1), [255, 255, 255]);
  }
  const c = config({ format: 'YUV', subsampling: '400', width: 2, height: 1 });
  const result = Core.decode(Buffer.from([16, 235]), c); assert.deepEqual(rgb(result), [0, 0, 0]); assert.deepEqual(rgb(result, 1), [255, 255, 255]);
});
test('standalone Y and UV suffixes select the matching input planes', () => {
  for (const suffix of ['y', 'Y', 'uv', 'UV']) {
    const c = Core.defaults(`frame-3x3.${suffix}`), uv = suffix.toLowerCase() === 'uv';
    assert.equal(c.format, 'YUV'); assert.equal(c.yuvPlanes, uv ? 'uv' : 'y');
    assert.equal(c.yuvDisplay, uv ? 'chroma' : 'luma');
    assert.equal(Core.analyze(c, 100).requiredBytes, uv ? 8 : 9);
  }
});
for (const subsampling of ['420', '422', '444']) for (const layout of Core.layouts[subsampling]) {
  test(`YUV ${subsampling} ${layout} isolates luma and chroma without changing frame size`, () => {
    const c = config({ format: 'YUV', width: 3, height: 3, matrix: '601', subsampling, layout, rowPitch: 16, chromaPitch: 16 });
    const bytes = yuvFixture(c), gray = Core.decode(bytes, { ...c, yuvDisplay: 'luma' });
    const color = Core.decode(bytes, { ...c, yuvDisplay: 'chroma' });
    for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) {
      assert.deepEqual(rgb(gray, x, y), [76, 76, 76]);
      assert.deepEqual(rgb(color, x, y), [255, 51, 51]);
    }
    const base = Core.sequence(c, bytes.length * 3 + 1, 3);
    for (const yuvDisplay of ['luma', 'chroma']) assert.deepEqual(Core.sequence({ ...c, yuvDisplay }, bytes.length * 3 + 1, 3), base);
    const changedY = Buffer.from(bytes), info = Core.analyze(c, bytes.length);
    for (const p of info.planes) for (let y = 0; y < p.rows; y++) for (let x = 0; x < p.samples; x++) {
      if (p.name === 'Y' || p.name === 'packed' && layout[x % layout.length] === 'Y') changedY[p.offset + y * p.pitch + x] = 235;
    }
    assert.deepEqual(Core.decode(changedY, { ...c, yuvDisplay: 'chroma' }).rgba, color.rgba);
  });
}
test('standalone UV planes match complete YUV chroma across packing, orders, pitches and depths', () => {
  for (const subsampling of ['420', '422', '444']) for (const layout of ['planar-uv', 'planar-vu', 'semi-uv', 'semi-vu']) {
    for (const bitDepth of [4, 8, 10, 16, 24, 32]) for (const storage of ['packed', 'unpacked']) for (const endian of ['little', 'big']) {
      const c = config({ format: 'YUV', width: 3, height: 3, subsampling, layout, bitDepth, storage, endian, rowPitch: 24, chromaPitch: 24, yuvDisplay: 'chroma', range: 'full' });
      const info = Core.analyze(c, 1e9), bytes = Buffer.alloc(info.requiredBytes, 0xaa);
      const middle = 2 ** (bitDepth - 1), values = { Y: 0, U: middle + Math.floor(middle / 4), V: middle - Math.floor(middle / 4) };
      for (const p of info.planes) for (let y = 0; y < p.rows; y++) {
        const samples = Array.from({ length: p.samples }, (_, x) => values[p.name === 'UV' ? (layout === 'semi-uv' ? 'UV' : 'VU')[x % 2] : p.name]);
        pack(samples, bitDepth, endian, storage === 'packed').copy(bytes, p.offset + y * p.pitch);
      }
      const uv = { ...c, yuvPlanes: 'uv' }, uvBytes = bytes.subarray(info.planes[1].offset);
      assert.deepEqual(Core.decode(uvBytes, uv).rgba, Core.decode(bytes, c).rgba);
      const budget = Core.analyze(uv, uvBytes.length);
      assert.equal(budget.requiredBytes, uvBytes.length); assert.equal(budget.planes[0].offset, 0);
      assert.equal(Core.analyze(uv, uvBytes.length - 1).valid, false);
      const seq = Core.sequence({ ...uv, offset: 16 }, 16 + uvBytes.length * 3 + 1, 3);
      assert.equal(seq.frameCount, 3); assert.equal(seq.readOffset, 16 + 2 * uvBytes.length); assert.equal(seq.remainderBytes, 1);
    }
  }
});
test('standalone Y preserves luma and rejects unavailable channel modes', () => {
  const y = { ...Core.defaults('2x1.y'), range: 'full' };
  const frame = Core.decode(Buffer.from([0, 255]), y);
  assert.deepEqual(rgb(frame), [0, 0, 0]); assert.deepEqual(rgb(frame, 1), [255, 255, 255]);
  assert.equal(Core.analyze({ ...y, yuvDisplay: 'chroma' }, 2).valid, false);
  assert.equal(Core.analyze({ ...y, subsampling: '420' }, 3).valid, false);
  const uv = Core.defaults('2x2.uv');
  for (const invalid of [{ subsampling: '400' }, { layout: 'YUYV', subsampling: '422' }, { yuvDisplay: 'rgb' }, { yuvPlanes: 'unknown' }]) {
    assert.equal(Core.analyze({ ...uv, ...invalid }, 100).valid, false);
  }
  assert.deepEqual(rgb(Core.decode(Buffer.from([128, 128]), uv)), [128, 128, 128]);
});
test('P010 uses high aligned little endian 16-bit containers', () => {
  const c = config({ format: 'YUV', width: 2, height: 2, layout: 'semi-uv', bitDepth: 10, alignment: 'msb' });
  const bytes = Buffer.from([0, 16, 0, 235, 0, 16, 0, 235, 0, 128, 0, 128]);
  const frame = Core.decode(bytes, c); assert.deepEqual(rgb(frame, 0), [0, 0, 0]); assert.deepEqual(rgb(frame, 1), [255, 255, 255]);
});
test('CFA reconstructs all Bayer permutations at edges and preserves measured colors', () => {
  for (const pattern of ['RGGB', 'BGGR', 'GRBG', 'GBRG', 'RBGG', 'GGRB']) {
    const c = config({ pattern }); const bytes = Buffer.from(Array.from({ length: 16 }, (_, i) => ({ R: 220, G: 120, B: 30 })[pattern[Math.floor(i / 4) % 2 * 2 + i % 2]]));
    const result = Core.decode(bytes, c);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) assert.deepEqual(rgb(result, x, y), [220, 120, 30]);
  }
});
test('sensor mode follows the array even when obsolete sensor settings disagree', () => {
  assert.equal(Object.hasOwn(Core.defaults(), 'cfaType'), false);
  const bytes = Buffer.from([200, 100, 200, 100, 40, 160, 40, 160, 200, 100, 200, 100, 40, 160, 40, 160]);
  const ir = config({ pattern: 'r g / b i', cfaType: 'bayer', display: 'side' });
  assert.equal(Core.isRgbir(ir), true);
  assert.equal(Core.analyze(ir, 16).valid, true);
  assert.equal(Core.decode(bytes, ir).width, 8);
  const cfa = { ...ir, pattern: 'RGGB', cfaType: 'rgbir' };
  assert.equal(Core.isRgbir(cfa), false);
  assert.equal(Core.analyze(cfa, 16).valid, true);
  assert.equal(Core.decode(bytes, cfa).width, 4);
  for (const pattern of ['IIII', 'RGII', 'RGB?', 'RGB']) assert.equal(Core.analyze({ ...ir, pattern }, 16).valid, false);
});
test('fixed 2x2 RGB-IR tile and RGB/IR/blend/side views', () => {
  const c = config({ pattern: 'R G / B I' });
  const bytes = Buffer.from(Array.from({ length: 16 }, (_, i) => ({ R: 200, G: 100, B: 40, I: 160 })['RGBI'[Math.floor(i / 4) % 2 * 2 + i % 2]]));
  assert.deepEqual(rgb(Core.decode(bytes, c)), [200, 100, 40]);
  assert.deepEqual(rgb(Core.decode(bytes, { ...c, display: 'ir' })), [160, 160, 160]);
  assert.deepEqual(rgb(Core.decode(bytes, { ...c, display: 'blend', alpha: 0.5 })), [180, 130, 100]);
  const side = Core.decode(bytes, { ...c, display: 'side' }); assert.equal(side.width, 8); assert.deepEqual(rgb(side, 4), [160, 160, 160]);
  assert.equal(Core.analyze({ ...c, pattern: 'RGBIRGBIRGBIRGBR' }, 16).valid, false);
});
test('CFA accepts only four-sample patterns and ignores obsolete tile dimensions', () => {
  assert.equal(Object.hasOwn(Core.defaults(), 'tileWidth'), false);
  assert.equal(Object.hasOwn(Core.defaults(), 'tileHeight'), false);
  for (const pattern of ['RG / GB', 'BG / GR', 'GR / BG', 'GB / RG']) assert.equal(Core.analyze(config({ pattern }), 16).valid, true);
  for (const pattern of ['', 'RGB', 'RGGBR', 'RGGBRGGB', 'RGBIRGBIRGBIRGBI']) {
    const c = config({ pattern, tileWidth: 4, tileHeight: 4 });
    assert.match(Core.analyze(c, 16).errors.pattern, /2×2/);
    assert.throws(() => Core.decode(Buffer.alloc(16), c), /2×2/);
  }
  const c = config(), legacy = { ...c, tileWidth: 4, tileHeight: 8 }, bytes = Buffer.from(Array.from({ length: 16 }, (_, i) => i * 10));
  assert.deepEqual(Core.decode(bytes, legacy), Core.decode(bytes, c));
  const read = Core.pixelReader(bytes, legacy);
  assert.deepEqual(read(2, 2), { format: 'CFA', channel: 'R', value: 100 });
  assert.deepEqual(read(3, 3), { format: 'CFA', channel: 'B', value: 150 });
});
test('PNG encoder emits correct pixel bytes, checksums and dimensions', () => {
  const pixels = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255]); const png = encodePng(2, 1, pixels);
  assert.deepEqual([...png.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  let offset = 8;
  while (offset < png.length) {
    const length = png.readUInt32BE(offset), type = png.toString('ascii', offset + 4, offset + 8);
    assert.equal(crc32(png.subarray(offset + 4, offset + 8 + length)), png.readUInt32BE(offset + 8 + length));
    if (type === 'IDAT') assert.deepEqual([...inflateSync(png.subarray(offset + 8, offset + 8 + length))], [0, ...pixels]);
    offset += length + 12;
  }
});
test('seek-based reads and worker decode skip headers and trailers', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sensor-test-'));
  try {
    const file = path.join(dir, 'frame.raw'); await fs.writeFile(file, Buffer.from([99, 99, 0, 255, 99, 99]));
    assert.deepEqual([...await readRange(file, 2, 2)], [0, 255]);
    await assert.rejects(readRange(file, 4, 3), /尺寸发生变化/);
    const result = await new Promise((resolve, reject) => {
      const worker = new Worker(path.join(__dirname, '../src/decoder-worker.js'), { workerData: { path: file, length: 2, config: config({ format: 'YUV', subsampling: '400', range: 'full', width: 2, height: 1, offset: 2 }) } });
      worker.once('message', resolve); worker.once('error', reject);
    });
    assert.equal(result.width, 2); assert.match(result.image, /^data:image\/png;base64,/); assert.equal(result.error, undefined);
  } finally { await fs.rm(dir, { recursive: true }); }
});

test('IR-only extracts native samples at half resolution for every IR position', () => {
  for (const pattern of ['RGBI', 'GRIB', 'BIRG', 'IBRG']) {
    const c = config({ width: 6, height: 4, pattern, display: 'ir' });
    const bytes = Buffer.from(Array.from({ length: 24 }, (_, i) => i * 10));
    const frame = Core.decode(bytes, c), index = pattern.indexOf('I');
    assert.equal(frame.width, 3); assert.equal(frame.height, 2);
    for (let y = 0; y < 2; y++) for (let x = 0; x < 3; x++) {
      const value = bytes[(2 * y + Math.floor(index / 2)) * 6 + 2 * x + index % 2];
      assert.deepEqual(rgb(frame, x, y), [value, value, value]);
    }
    assert.equal(Core.decode(bytes, { ...c, display: 'rgb' }).width, 6);
    const adjusted = Core.decode(bytes, { ...c, exposure: -1 });
    assert.deepEqual(rgb(adjusted), rgb(frame).map(v => Math.round(v / 2)));
  }
  const odd = Core.decode(Buffer.alloc(25, 80), config({ width: 5, height: 5, pattern: 'RGBI', display: 'ir' }));
  assert.equal(odd.width, 2); assert.equal(odd.height, 2);
});

test('explicit containers determine pitch, sample alignment and sequence size', () => {
  for (const containerBits of [8, 16, 24, 32]) for (const endian of ['little', 'big']) for (const alignment of ['lsb', 'msb']) {
    const bitDepth = containerBits === 8 ? 8 : 10;
    const c = config({ width: 2, height: 2, bitDepth, containerBits, endian, alignment });
    const size = containerBits / 8, bytes = Buffer.alloc(size * 4);
    const values = [0, 1, 127, 2 ** bitDepth - 1];
    values.forEach((value, i) => {
      const stored = alignment === 'msb' ? value * 2 ** (containerBits - bitDepth) : value;
      if (endian === 'little') bytes.writeUIntLE(stored, i * size, size);
      else bytes.writeUIntBE(stored, i * size, size);
    });
    const info = Core.analyze(c, bytes.length);
    assert.equal(info.valid, true); assert.equal(info.requiredBytes, bytes.length);
    assert.equal(info.planes[0].pitch, size * 2);
    const read = Core.pixelReader(bytes, c);
    values.forEach((value, i) => assert.equal(read(i % 2, Math.floor(i / 2)).value, value));
    assert.equal(Core.decode(bytes, c).rgba.length, 16);
    const seq = Core.sequence(c, bytes.length * 3, 2);
    assert.equal(seq.frameCount, 3); assert.equal(seq.readOffset, bytes.length);
  }
});
test('container validation rejects insufficient or non-byte sizes and keeps packed/legacy behavior', () => {
  for (const containerBits of [8, 12, 33, -1, 16.5, '16']) {
    const c = config({ bitDepth: 16, containerBits });
    assert.ok(Core.analyze(c, 1024).errors.containerBits);
    assert.throws(() => Core.decode(Buffer.alloc(1024), c));
  }
  assert.equal(Core.analyze(config({ bitDepth: 16, containerBits: 16 }), 32).valid, true);
  const legacy = config({ bitDepth: 12 }); delete legacy.containerBits;
  assert.equal(Core.analyze(legacy, 32).requiredBytes, 32);
  assert.equal(Core.analyze(config({ bitDepth: 12, containerBits: 0, storage: 'packed' }), 24).requiredBytes, 24);
});
test('YUV container sizes control all plane offsets and raw samples', () => {
  for (const layout of ['planar-uv', 'semi-uv', 'YUYV']) {
    const c = config({ format: 'YUV', subsampling: '422', layout, bitDepth: 8, containerBits: 32 });
    const info = Core.analyze(c, 128);
    assert.equal(info.valid, true); assert.equal(info.requiredBytes, 128);
    const bytes = Buffer.alloc(128);
    for (let i = 0; i < bytes.length; i += 4) bytes.writeUInt32LE(128, i);
    assert.deepEqual(Core.pixelReader(bytes, c)(3, 3), { format: 'YUV', y: 128, u: 128, v: 128 });
    assert.equal(Core.decode(bytes, c).rgba.length, 64);
  }
});

test('container width alone determines bit packing and supports padding within non-byte containers', () => {
  for (const containerBits of [10, 12, 14, 20]) for (const bitDepth of [8, containerBits]) for (const endian of ['little', 'big']) for (const alignment of ['lsb', 'msb']) {
    const values = [1, 37, 2 ** bitDepth - 1];
    const stored = values.map(v => alignment === 'msb' ? v * 2 ** (containerBits - bitDepth) : v);
    const row = pack(stored, containerBits, endian, true);
    const bytes = Buffer.concat([row, row]);
    const c = config({ width: 3, height: 2, containerBits, bitDepth, endian, alignment });
    const info = Core.analyze(c, bytes.length);
    assert.equal(info.valid, true); assert.equal(info.requiredBytes, bytes.length);
    const read = Core.pixelReader(bytes, c);
    for (let y = 0; y < 2; y++) for (let x = 0; x < 3; x++) assert.equal(read(x, y).value, values[x]);
    assert.equal(Core.analyze({ ...c, storage: 'packed' }, bytes.length).requiredBytes, bytes.length);
  }
  const c = config({ bitDepth: 10, containerBits: 16, storage: 'packed' });
  assert.equal(Core.analyze(c, 32).requiredBytes, 32, 'explicit container overrides legacy storage');
});

for (const [endian, direct, shifted] of [
  ['little', '000400c83fff00120000', '00100020fffc03480000'],
  ['big', '00001200ff3fc8000400', '00004803fcff20001000']
]) {
  test(`8-bit pixels in 10-bit containers: direct and << 2 storage decode identically (${endian})`, () => {
    // Fixed byte fixtures, independent of the pack helper: four 10-bit slots per row.
    const samples = [0, 1, 128, 255, 255, 128, 1, 0];
    const baseline = config({ width: 4, height: 2, bitDepth: 8, containerBits: 8 });
    const expected = Core.decode(Buffer.from(samples), baseline);
    const frames = [];
    for (const [alignment, hex, shift] of [['lsb', direct, 0], ['msb', shifted, 2]]) {
      const c = { ...baseline, containerBits: 10, endian, alignment };
      const bytes = Buffer.from(hex, 'hex'), info = Core.analyze(c, bytes.length);
      assert.equal(info.valid, true);
      assert.equal(info.planes[0].pitch, 5);
      assert.equal(info.requiredBytes, 10);
      const read = Core.pixelReader(bytes, c);
      const stored = Core.pixelReader(bytes, { ...c, bitDepth: 10 });
      for (let i = 0; i < samples.length; i++) {
        assert.equal(stored(i % 4, Math.floor(i / 4)).value, samples[i] << shift);
        assert.equal(read(i % 4, Math.floor(i / 4)).value, samples[i]);
      }
      const frame = Core.decode(bytes, c);
      assert.equal(frame.width, 4); assert.equal(frame.height, 2);
      assert.deepEqual(frame.rgba, expected.rgba);
      frames.push(frame);
    }
    assert.deepEqual(frames[0].rgba, frames[1].rgba);
  });
}
