'use strict';
// Generate exact color patches numerically, without photographic lighting or compression artifacts.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { encodePng } = require('../src/png');
const { mosaic } = require('./scene-fixtures');
const Core = require('../media/core');
const source = 'https://babelcolor.com/index_htm_files/RGB%20Coordinates%20of%20the%20Macbeth%20ColorChecker.pdf';
// Table 2, ColorChecker 2005, sRGB (GMB) column; row-major Classic 24 ordering.
const colors = [
  [115,82,68], [194,150,130], [98,122,157], [87,108,67], [133,128,177], [103,189,170],
  [214,126,44], [80,91,166], [193,90,99], [94,60,108], [157,188,64], [224,163,46],
  [56,61,150], [70,148,73], [175,54,60], [231,199,31], [187,86,149], [8,133,161],
  [243,243,242], [200,200,200], [160,160,160], [122,122,121], [85,85,85], [52,52,52]
];
const geometry = { columns: 6, rows: 4, patchSize: 88, gap: 16, width: 640, height: 432, background: [16,16,16] };
function reference() {
  const { width, height, patchSize, gap, background } = geometry;
  const rgb = Buffer.alloc(width * height * 3), rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const col = Math.floor((x - gap) / (patchSize + gap)), row = Math.floor((y - gap) / (patchSize + gap));
    const inside = col >= 0 && col < 6 && row >= 0 && row < 4
      && (x - gap) % (patchSize + gap) < patchSize && (y - gap) % (patchSize + gap) < patchSize;
    const color = inside ? colors[row * 6 + col] : background, i = y * width + x;
    rgb.set(color, i * 3); rgba.set([...color, 255], i * 4);
  }
  return { width, height, rgb, rgba };
}
function generate(directory = path.join(__dirname, '../fixtures')) {
  fs.mkdirSync(directory, { recursive: true });
  const image = reference(), entries = [], referenceFile = 'colorchecker24-reference.png';
  function save(file, bytes, metadata) {
    fs.writeFileSync(path.join(directory, file), bytes);
    entries.push({ file, ...metadata, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  save(referenceFile, encodePng(image.width, image.height, image.rgba), { kind: 'reference', width: image.width, height: image.height });
  for (const pattern of ['RGGB', 'RGBI']) for (const [bitDepth, containerBits, suffix] of [
    [12,16,'12bit-in16-lsb-le'], [12,12,'12bit-packed-le'], [16,16,'16bit-in16-lsb-le']
  ]) {
    const name = pattern === 'RGBI' ? 'rgbir-rgbi' : 'bayer-rggb';
    const file = `colorchecker24-${name}-${suffix}-${image.width}x${image.height}.raw`;
    const bytes = mosaic(image, pattern, bitDepth, containerBits, 128);
    const config = Core.defaults(file), info = Core.analyze(config, bytes.length);
    // Keep each RAW self-describing so first-open inference works without fixture overrides.
    if (!info.valid || info.requiredBytes !== bytes.length || config.pattern !== pattern || config.bitDepth !== bitDepth || Core.containerBits(config) !== containerBits) throw new Error(`Invalid fixture: ${file}`);
    save(file, bytes, { kind: 'CFA', reference: referenceFile, width: image.width, height: image.height,
      pattern, bitDepth, containerBits, endian: 'little', alignment: 'lsb', gamma: 1, rowPitch: info.planes[0].pitch });
  }
  fs.writeFileSync(path.join(directory, 'colorchecker24.json'), JSON.stringify({ version: 1, source,
    palette: 'ColorChecker 2005, Table 2, sRGB (GMB), RGB8 display-referred values',
    origin: 'Synthetic preview fixture, not a sensor capture or a certified calibration target.',
    geometry, colors, ir8: 128, entries }, null, 2) + '\n');
  console.log('Created ColorChecker 24 reference and six Bayer/RGB-IR RAW fixtures.');
  return entries;
}
if (require.main === module) generate();
module.exports = { generate, reference, colors, geometry };
