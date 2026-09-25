'use strict';
const fs = require('node:fs');
const { encodePng } = require('../src/png');
fs.mkdirSync('fixtures', { recursive: true });
const width = 320, height = 240, rgba = new Uint8ClampedArray(width * height * 4);
const raw = Buffer.alloc(width * height), ir = Buffer.alloc(width * height), nv12 = Buffer.alloc(width * height * 3 / 2);
const colors = [[235, 235, 235], [235, 220, 40], [25, 210, 210], [40, 200, 65], [210, 55, 190], [225, 55, 45], [35, 65, 205], [20, 20, 25]];
for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
  const i = y * width + x, rgb = colors[Math.floor(x / 40)].map(v => Math.round(v * (0.35 + y / height * 0.65)));
  rgba.set([...rgb, 255], i * 4);
  raw[i] = rgb['RGGB'[(y % 2) * 2 + x % 2] === 'R' ? 0 : 'RGGB'[(y % 2) * 2 + x % 2] === 'G' ? 1 : 2];
  const channel = 'RGBI'[(y % 2) * 2 + x % 2]; ir[i] = channel === 'I' ? Math.round((Math.sin(x / 23) * Math.cos(y / 19) + 1) * 127.5) : rgb['RGB'.indexOf(channel)];
  nv12[i] = Math.round(16 + (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) * 219 / 255);
  if (!(x % 2) && !(y % 2)) {
    const luma = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2], base = width * height + y / 2 * width + x;
    nv12[base] = Math.round(128 + (rgb[2] - luma) / (2 * (1 - 0.0722)) * 224 / 255);
    nv12[base + 1] = Math.round(128 + (rgb[0] - luma) / (2 * (1 - 0.2126)) * 224 / 255);
  }
}
fs.writeFileSync('fixtures/color-bars.png', encodePng(width, height, rgba));
fs.writeFileSync('fixtures/bayer-rggb-320x240.raw', raw);
fs.writeFileSync('fixtures/rgbir-rgbi-320x240.raw', ir);
fs.writeFileSync('fixtures/nv12-320x240.yuv', nv12);
fs.writeFileSync('fixtures/luma-320x240.y', nv12.subarray(0, width * height));
fs.writeFileSync('fixtures/chroma-320x240.uv', nv12.subarray(width * height));
fs.writeFileSync('fixtures/offset16-320x240.bin', Buffer.concat([Buffer.alloc(16, 0xab), raw, Buffer.alloc(32, 0xcd)]));
const rawFrames = [], yuvFrames = [];
for (let frame = 0; frame < 24; frame++) {
  const rawFrame = Buffer.alloc(width * height), yuvFrame = Buffer.alloc(width * height * 3 / 2, 128);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const pixel = y * width + x, shift = (x + frame * 12) % width;
    rawFrame[pixel] = raw[y * width + ((x + frame * 12) % width)];
    yuvFrame[pixel] = shift < 48 && y >= 72 && y < 168 ? 220 : 32 + Math.floor(y / 8);
  }
  rawFrames.push(rawFrame); yuvFrames.push(yuvFrame);
}
fs.writeFileSync('fixtures/sequence-rggb-320x240.raw', Buffer.concat(rawFrames));
fs.writeFileSync('fixtures/sequence-i420-320x240.yuv', Buffer.concat(yuvFrames));
console.log('Created image fixtures and 24-frame RAW/YUV sequences.');
require('./scene-fixtures').generate();
// Include the deterministic IQ chart alongside the existing bars and scene references.
require('./colorchecker-fixtures').generate();
