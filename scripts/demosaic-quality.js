'use strict';
// Deterministic full-frame reconstruction benchmark. References never depend on decoder output.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const Core = require('../media/core');
const { mosaic } = require('./scene-fixtures');
const { readRgbPng } = require('./png-rgb');
const { encodePng } = require('../src/png');
const directory = path.join(__dirname, '../test-results/demosaic-quality');
function synthetic(name, width = 160, height = 128) {
  const rgb = Buffer.alloc(width * height * 3);
  // Integrate over the sensor pixel footprint; hard point samples would alias before demosaicing.
  const scene = (x, y) => {
    const u = x - width / 2, v = y - height / 2;
    if (name.startsWith('slant')) {
      const angle = Number(name.split('-')[1]) * Math.PI / 180;
      return Array(3).fill(u * Math.cos(angle) + v * Math.sin(angle) > .37 ? 220 : 30);
    }
    if (name === 'arcs') return Array(3).fill(Math.sin(Math.hypot(u, v) * .65) > .15 ? 210 : 40);
    if (name === 'fabric') {
      const light = 125 + 42 * Math.sin(x * 1.18 + y * .27) + 35 * Math.sin(y * .91 - x * .23);
      return [light + 18 * Math.sin(y * .09), light, light - 20 * Math.sin(x * .08)];
    }
    if (name === 'color-slant') return u + .43 * v > .3 ? [220, 95, 45] : [25, 145, 210];
    if (name === 'thin-lines') return Array(3).fill(Math.abs(Math.sin((u + .32 * v) * .27)) < .18 ? 225 : 35);
    return [55 + x * .65, 45 + y * .9, 35 + (x + y) * .45];
  };
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const sums = [0, 0, 0];
    for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) {
      const color = scene(x + (sx + .5) / 4, y + (sy + .5) / 4);
      for (let k = 0; k < 3; k++) sums[k] += color[k];
    }
    for (let k = 0; k < 3; k++) rgb[(y * width + x) * 3 + k] = Math.round(sums[k] / 16);
  }
  return { width, height, rgb };
}
function* cases(full = true) {
  const names = ['slant-7', 'slant-22', 'slant-45', 'slant-67', 'slant-83', 'arcs', 'fabric', 'color-slant', 'thin-lines', 'ramp'];
  for (const name of names) for (const pattern of ['RGGB', 'BGGR', 'GRBG', 'GBRG', 'RGBI']) {
    const bitDepth = pattern === 'BGGR' || pattern === 'RGBI' ? 16 : 12;
    yield { name: `${name}-${pattern}`, image: synthetic(name), pattern, bitDepth, containerBits: 16 };
  }
  if (full) for (const name of ['traffic', 'wildlife', 'football', 'colorchecker24']) {
    const image = readRgbPng(fs.readFileSync(path.join(__dirname, `../fixtures/${name}-reference.png`)));
    for (const pattern of ['RGGB', 'RGBI']) yield { name: `${name}-${pattern}`, image, pattern, bitDepth: 12, containerBits: 16 };
  }
}
function metrics(image, rgba) {
  const { width, height, rgb } = image;
  let absolute = 0, squared = 0, max = 0, edgeError = 0, edgeCount = 0, chroma = 0, grayChroma = 0, grayCount = 0, zipper = 0, pairs = 0;
  const luma = i => (rgb[i * 3] + 2 * rgb[i * 3 + 1] + rgb[i * 3 + 2]) / 4;
  for (let i = 0; i < width * height; i++) {
    const x = i % width, y = Math.floor(i / width), errors = [0, 0, 0];
    const edge = (x > 0 && Math.abs(luma(i) - luma(i - 1)) > 12) || (y > 0 && Math.abs(luma(i) - luma(i - width)) > 12)
      || (x + 1 < width && Math.abs(luma(i) - luma(i + 1)) > 12) || (y + 1 < height && Math.abs(luma(i) - luma(i + width)) > 12);
    for (let k = 0; k < 3; k++) {
      const d = rgba[i * 4 + k] - rgb[i * 3 + k]; errors[k] = d;
      absolute += Math.abs(d); squared += d * d; max = Math.max(max, Math.abs(d));
      if (edge) edgeError += Math.abs(d);
    }
    if (edge) edgeCount++;
    chroma += (Math.abs(errors[0] - errors[1]) + Math.abs(errors[2] - errors[1])) / 2;
    if (Math.max(...rgb.subarray(i * 3, i * 3 + 3)) - Math.min(...rgb.subarray(i * 3, i * 3 + 3)) <= 2) {
      grayChroma += Math.max(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]) - Math.min(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]); grayCount++;
    }
    // Adjacent chroma-error variation is a zipper proxy, not a perceptual quality score.
    for (const j of [x + 1 < width ? i + 1 : -1, y + 1 < height ? i + width : -1]) if (j >= 0) {
      for (const k of [0, 2]) zipper += Math.abs((errors[k] - errors[1]) - ((rgba[j * 4 + k] - rgba[j * 4 + 1]) - (rgb[j * 3 + k] - rgb[j * 3 + 1])));
      pairs += 2;
    }
  }
  const pixels = width * height;
  return { mae: absolute / (pixels * 3), psnr: squared ? 10 * Math.log10(255 ** 2 / (squared / (pixels * 3))) : null,
    max, edgeMae: edgeCount ? edgeError / (edgeCount * 3) : 0, chromaMae: chroma / pixels,
    grayFalseColor: grayCount ? grayChroma / grayCount : 0, zipper: zipper / pairs, pixels, edgePixels: edgeCount };
}
function rgba(image) { const a = new Uint8Array(image.width * image.height * 4); for (let i = 0; i < image.width * image.height; i++) { a.set(image.rgb.subarray(i * 3, i * 3 + 3), i * 4); a[i * 4 + 3] = 255; } return a; }
async function run() {
  const mode = process.argv[2] || 'after', full = !process.argv.includes('--quick');
  const folder = path.join(directory, mode); fs.mkdirSync(folder, { recursive: true });
  const results = [];
  for (const item of cases(full)) {
    const { image, pattern, bitDepth, containerBits, name } = item;
    const config = { ...Core.defaults(), width: image.width, height: image.height, pattern, bitDepth, containerBits, gamma: 1 };
    const bytes = mosaic(image, pattern, bitDepth, containerBits), start = performance.now();
    const coefficients = structuredClone(require('../media/demosaic-defaults.json'));
    if (mode === 'baseline' && coefficients.antiAlias) coefficients.antiAlias.enabled = false;
    const frame = Core.decode(bytes, config, coefficients), milliseconds = performance.now() - start;
    const record = { name, pattern, bitDepth, milliseconds, sourceSha256: createHash('sha256').update(image.rgb).digest('hex'), ...metrics(image, frame.rgba) };
    results.push(record);
    fs.writeFileSync(path.join(folder, `${name}.png`), encodePng(image.width, image.height, frame.rgba));
    if (!fs.existsSync(path.join(directory, `${name}-reference.png`))) fs.writeFileSync(path.join(directory, `${name}-reference.png`), encodePng(image.width, image.height, rgba(image)));
    console.log(`${name}: MAE ${record.mae.toFixed(3)}, edge ${record.edgeMae.toFixed(3)}, chroma ${record.chromaMae.toFixed(3)}, ${milliseconds.toFixed(0)} ms`);
  }
  fs.writeFileSync(path.join(folder, 'metrics.json'), JSON.stringify({ mode, node: process.version, platform: `${process.platform}/${process.arch}`, timestamp: new Date().toISOString(), results }, null, 2) + '\n');
}
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { synthetic, cases, metrics, rgba };
