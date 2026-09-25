'use strict';
const { deflateSync } = require('node:zlib');
const table = new Uint32Array(256);
for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c; }
function crc32(data) { let c = 0xffffffff; for (const b of data) c = table[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, bytes) {
  const body = Buffer.concat([Buffer.from(type), bytes]);
  const size = Buffer.alloc(4), crc = Buffer.alloc(4); size.writeUInt32BE(bytes.length); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([size, body, crc]);
}
function encodePng(width, height, rgba) {
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  const pitch = width * 4, rows = Buffer.alloc((pitch + 1) * height);
  const pixels = Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength);
  for (let y = 0; y < height; y++) pixels.copy(rows, y * (pitch + 1) + 1, y * pitch, (y + 1) * pitch);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows, { level: 3 })), chunk('IEND', Buffer.alloc(0))]);
}
module.exports = { encodePng, crc32 };
