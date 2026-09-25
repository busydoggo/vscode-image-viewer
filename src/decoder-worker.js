'use strict';
const { parentPort, workerData } = require('node:worker_threads');
const I18n = require('../media/i18n');
const { decode, pixelReader, cleanPattern, isRgbir } = require('../media/core');
const { encodePng } = require('./png');
const { readRange } = require('./io');
let current;
async function run(job) {
  try {
    I18n.setLocale(job.locale);
    // Pixel queries are valid only for the frame currently retained by this worker.
    if (job.type === 'inspect') {
      parentPort.postMessage({ id: job.id, pixel: current?.frameId === job.frameId ? current.read(job.x, job.y) : null });
      return;
    }
    const bytes = job.path ? await readRange(job.path, job.readOffset ?? job.config.offset, job.length) : job.bytes;
    // Carry the current coefficient snapshot into every frame, including RGB-IR reconstruction.
    const result = decode(bytes, job.config, job.coefficients);
    const read = pixelReader(bytes, job.config, result.info);
    const irOnly = job.config.format === 'CFA' && isRgbir(job.config) && job.config.display === 'ir';
    const irIndex = cleanPattern(job.config.pattern).indexOf('I');
    // Half-resolution IR preview coordinates map back to the original 2x2 sensor tile.
    current = { frameId: job.id, read: irOnly ? (x, y) => {
      if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= result.width || y >= result.height) return null;
      return read(x * 2 + irIndex % 2, y * 2 + Math.floor(irIndex / 2));
    } : read };
    parentPort.postMessage({ id: job.id, frameId: job.id, image: 'data:image/png;base64,' + encodePng(result.width, result.height, result.rgba).toString('base64'), width: result.width, height: result.height });
  } catch (error) { parentPort.postMessage({ id: job.id, error: error.message }); }
}
if (workerData) void run(workerData);
else parentPort.on('message', job => void run(job));
