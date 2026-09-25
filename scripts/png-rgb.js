'use strict';
// Fixture-generation input only: losslessly read non-interlaced RGB/RGBA8 PNGs.
const { inflateSync } = require('node:zlib');
const { crc32 } = require('../src/png');
function readRgbPng(bytes) {
  if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('Expected PNG');
  let width, height, channels, ended = false;
  const data = [];
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = bytes.readUInt32BE(offset), end = offset + 12 + length;
    if (end > bytes.length) throw new Error('Truncated PNG chunk');
    const type = bytes.toString('ascii', offset + 4, offset + 8), chunk = bytes.subarray(offset + 8, end - 4);
    if (crc32(bytes.subarray(offset + 4, end - 4)) !== bytes.readUInt32BE(end - 4)) throw new Error('PNG checksum mismatch');
    if (type === 'IHDR') {
      if (offset !== 8 || length !== 13) throw new Error('Invalid PNG header');
      width = chunk.readUInt32BE(0); height = chunk.readUInt32BE(4);
      channels = chunk[9] === 2 ? 3 : chunk[9] === 6 ? 4 : 0;
      if (!width || !height || width * height > 16 * 1024 * 1024 || chunk[8] !== 8 || !channels || chunk[10] || chunk[11] || chunk[12]) throw new Error('Expected non-interlaced RGB/RGBA8 PNG, at most 16 MP');
    } else if (type === 'IDAT') data.push(chunk);
    else if (type === 'IEND') { ended = true; break; }
    offset = end;
  }
  if (!ended || !channels || !data.length) throw new Error('Incomplete PNG');
  const pitch = width * channels, expected = (pitch + 1) * height;
  // Bound decompression by the validated dimensions before reconstructing PNG scanlines.
  const filtered = inflateSync(Buffer.concat(data), { maxOutputLength: expected });
  if (filtered.length !== expected) throw new Error('Invalid PNG pixel length');
  const samples = Buffer.alloc(pitch * height), rgb = Buffer.alloc(width * height * 3);
  function paeth(a, b, c) {
    const p = a + b - c, da = Math.abs(p - a), db = Math.abs(p - b), dc = Math.abs(p - c);
    return da <= db && da <= dc ? a : db <= dc ? b : c;
  }
  for (let y = 0; y < height; y++) {
    const filter = filtered[y * (pitch + 1)];
    if (filter > 4) throw new Error('Invalid PNG filter');
    for (let x = 0; x < pitch; x++) {
      const i = y * pitch + x, a = x >= channels ? samples[i - channels] : 0;
      const b = y ? samples[i - pitch] : 0, c = y && x >= channels ? samples[i - pitch - channels] : 0;
      samples[i] = filtered[y * (pitch + 1) + 1 + x] + [0, a, b, Math.floor((a + b) / 2), paeth(a, b, c)][filter];
    }
  }
  for (let i = 0; i < width * height; i++) {
    if (channels === 4 && samples[i * 4 + 3] !== 255) throw new Error('Fixture references must be opaque');
    samples.copy(rgb, i * 3, i * channels, i * channels + 3);
  }
  return { width, height, rgb };
}
module.exports = { readRgbPng };
