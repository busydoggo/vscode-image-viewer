'use strict';
const I18n = require('../media/i18n');
const { t } = I18n;
const fs = require('node:fs/promises');

// Read only the requested frame range; a short read reports concurrent file truncation.
async function readRange(path, offset, length) {
  const file = await fs.open(path, 'r');
  try {
    const bytes = Buffer.alloc(length);
    let read = 0;
    while (read < length) {
      const result = await file.read(bytes, read, length - read, offset + read);
      if (!result.bytesRead) throw new Error(t('file.changed'));
      read += result.bytesRead;
    }
    return bytes;
  } finally { await file.close(); }
}
module.exports = { readRange };
