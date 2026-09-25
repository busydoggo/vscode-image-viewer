'use strict';
const I18n = require('../media/i18n');
const { t } = I18n;
const { Worker } = require('node:worker_threads');
const path = require('node:path');

// Reuse a worker during playback instead of starting a thread for every frame.
class Decoder {
  constructor() {
    this.nextId = 0;
    this.pending = new Map();
    this.worker = new Worker(path.join(__dirname, 'decoder-worker.js'));
    this.worker.on('message', ({ id, ...result }) => {
      const job = this.pending.get(id); if (!job) return;
      // Preview messages leave the decode pending until the final reconstruction arrives.
      if (result.preview) { job.onPreview?.(result); return; }
      this.pending.delete(id);
      if (result.error) job.reject(new Error(result.error)); else job.resolve(result);
    });
    this.worker.on('error', error => this.fail(error));
    this.worker.on('exit', code => this.fail(new Error(t('decoder.exit', { code }))));
  }
  fail(error) { for (const job of this.pending.values()) job.reject(error); this.pending.clear(); this.closed = true; }
  get decoding() { return [...this.pending.values()].some(job => job.type === 'decode'); }
  decode(job, onPreview) { return this.request('decode', { ...job, progressive: !!onPreview }, onPreview); }
  inspect(frameId, x, y) { return this.request('inspect', { frameId, x, y }); }
  request(type, job, onPreview) {
    if (this.closed) return Promise.reject(new Error(t('decoder.closed')));
    return new Promise((resolve, reject) => { const id = ++this.nextId; this.pending.set(id, { resolve, reject, type, onPreview }); this.worker.postMessage({ id, type, locale: I18n.getLocale(), ...job }); });
  }
  dispose() { this.fail(new Error(t('decoder.cancelled'))); void this.worker.terminate(); }
}
module.exports = { Decoder };
