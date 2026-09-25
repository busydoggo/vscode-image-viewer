'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { readRgbPng } = require('./png-rgb');
const Core = require('../media/core');
const scenes = [
  { id: 'traffic', pattern: 'RGGB' },
  { id: 'wildlife', pattern: 'BGGR' },
  { id: 'football', pattern: 'GRBG' }
];
// Suffixes describe the actual sample precision, container width, alignment and byte order.
const variants = [
  { bitDepth: 12, containerBits: 16, suffix: '12bit-in16-lsb-le' },
  { bitDepth: 12, containerBits: 12, suffix: '12bit-packed-le' },
  { bitDepth: 16, containerBits: 16, suffix: '16bit-in16-lsb-le' }
];
function mosaic({ width, height, rgb }, pattern, bitDepth, containerBits, ir = 128) {
  const pitch = Math.ceil(width * containerBits / 8), bytes = Buffer.alloc(pitch * height), peak = 2 ** bitDepth - 1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const channel = 'RGB'.indexOf(pattern[(y % 2) * 2 + x % 2]);
    // Display-referred synthetic samples; no invented sensor precision or noise.
    // RGB cannot specify infrared reflectance; RGB-IR fixtures use an explicit synthetic IR level.
    const sample = pattern[(y % 2) * 2 + x % 2] === 'I' ? ir : rgb[(y * width + x) * 3 + channel];
    const value = Math.round(sample * peak / 255);
    if (containerBits === 16) bytes.writeUInt16LE(value, y * pitch + x * 2);
    else {
      const position = x * 12, offset = y * pitch + Math.floor(position / 8), shift = position % 8;
      bytes[offset] |= (value << shift) & 255;
      bytes[offset + 1] |= (value >> (8 - shift)) & 255;
    }
  }
  return bytes;
}
function generate(directory = path.join(__dirname, '../fixtures')) {
  const entries = [];
  for (const scene of scenes) {
    const reference = `${scene.id}-reference.png`, source = fs.readFileSync(path.join(directory, reference));
    const image = readRgbPng(source), { width, height } = image;
    entries.push({ file: reference, scene: scene.id, kind: 'reference', width, height, sha256: createHash('sha256').update(source).digest('hex') });
    for (const variant of variants) {
      const file = `${scene.id}-bayer-${scene.pattern.toLowerCase()}-${variant.suffix}-${width}x${height}.raw`;
      const bytes = mosaic(image, scene.pattern, variant.bitDepth, variant.containerBits);
      fs.writeFileSync(path.join(directory, file), bytes);
      entries.push({ file, reference, scene: scene.id, kind: 'CFA', width, height, pattern: scene.pattern,
        bitDepth: variant.bitDepth, containerBits: variant.containerBits, endian: 'little', alignment: 'lsb', gamma: 1,
        rowPitch: Math.ceil(width * variant.containerBits / 8), bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex') });
      // Verify generated filenames remain sufficient to decode each fixture on first open.
      const config = Core.defaults(file), info = Core.analyze(config, bytes.length);
      if (!info.valid || info.requiredBytes !== bytes.length || config.bitDepth !== variant.bitDepth || config.pattern !== scene.pattern) throw new Error(`Filename settings do not match ${file}`);
    }
  }
  fs.writeFileSync(path.join(directory, 'scenes.json'), JSON.stringify({ version: 1, origin: 'AI-generated RGB8 references, synthetically mosaiced; not native sensor captures.', entries }, null, 2) + '\n');
  console.log(`Created ${scenes.length * variants.length} complex-scene CFA fixtures and scenes.json.`);
  return entries;
}
if (require.main === module) generate();
module.exports = { generate, mosaic };
