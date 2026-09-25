(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PreviewResample = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  // Exact box integration prevents undersampled line patterns from flickering at Fit zoom.
  // Work in premultiplied display RGB so transparent pixels cannot introduce dark fringes.
  function area(source, width, height, targetWidth, targetHeight) {
    if (![width, height, targetWidth, targetHeight].every(n => Number.isSafeInteger(n) && n > 0)
      || targetWidth > width || targetHeight > height || source.length !== width * height * 4) throw new RangeError('Invalid reduction dimensions');
    const result = new Uint8ClampedArray(targetWidth * targetHeight * 4);
    const scaleX = width / targetWidth, scaleY = height / targetHeight;
    const row = new Float64Array(targetWidth * 4);
    for (let y = 0; y < targetHeight; y++) {
      row.fill(0);
      const top = y * scaleY, bottom = (y + 1) * scaleY;
      for (let sy = Math.floor(top); sy < Math.min(height, Math.ceil(bottom)); sy++) {
        const wy = Math.min(bottom, sy + 1) - Math.max(top, sy);
        for (let x = 0; x < targetWidth; x++) {
          const left = x * scaleX, right = (x + 1) * scaleX, dest = x * 4;
          for (let sx = Math.floor(left); sx < Math.min(width, Math.ceil(right)); sx++) {
            const weight = wy * (Math.min(right, sx + 1) - Math.max(left, sx)), i = (sy * width + sx) * 4;
            const alphaWeight = source[i + 3] * weight;
            row[dest] += source[i] * alphaWeight; row[dest + 1] += source[i + 1] * alphaWeight; row[dest + 2] += source[i + 2] * alphaWeight;
            row[dest + 3] += alphaWeight;
          }
        }
      }
      for (let x = 0; x < targetWidth; x++) {
        const s = x * 4, d = (y * targetWidth + x) * 4, alpha = row[s + 3];
        if (alpha > 0) for (let k = 0; k < 3; k++) result[d + k] = row[s + k] / alpha;
        result[d + 3] = alpha / (scaleX * scaleY);
      }
    }
    return result;
  }
  // Pixel-exact inspection remains available at integer zoom; fractional enlargement is smooth.
  function rendering(zoom) { return zoom >= 1 && Math.abs(zoom - Math.round(zoom)) < 1e-7 ? 'pixelated' : 'auto'; }
  return { area, rendering };
});
