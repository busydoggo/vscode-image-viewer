(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.JpegPreview = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  // Eight rays let a corner borrow evidence from its interior, not just from opposite sides.
  const directions = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  const luminance = (data, i) => .299 * data[i] + .587 * data[i + 1] + .114 * data[i + 2];

  function processor(source, width, height) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || source.length !== width * height * 4) throw new Error('Invalid JPEG preview dimensions');
    // Read only the frozen decoded image so scan order cannot move or grow a repaired edge.
    const output = new Uint8ClampedArray(source);
    function sample(x, y) {
      if (x < 0 || y < 0 || x >= width || y >= height) return null;
      const i = (y * width + x) * 4;
      if (source[i + 3] !== 255) return null;
      const Y = luminance(source, i);
      return [Y, source[i] - Y, source[i + 2] - Y];
    }
    function rows(start, end) {
      for (let y = start; y < Math.min(end, height); y++) for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        if (source[i + 3] !== 255) continue;
        const Y = luminance(source, i);
        let gradient = 0;
        for (const [dx, dy] of directions) {
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && nx < width && ny >= 0 && ny < height) gradient = Math.max(gradient, Math.abs(Y - luminance(source, (ny * width + nx) * 4)));
        }
        // Smooth ramps and edges without a reliable luminance cue retain the decoder output.
        if (gradient < 5) continue;
        const red = source[i] - Y, blue = source[i + 2] - Y, anchors = [];
        for (const [dx, dy] of directions) {
          const a = sample(x + dx * 2, y + dy * 2), b = sample(x + dx * 3, y + dy * 3);
          if (!a || !b || a.some((value, c) => Math.abs(value - b[c]) > 3)) continue;
          // A flat ray alone can occur inside texture. Require a small two-dimensional plateau too.
          const low = b.slice(), high = b.slice(); let stable = true;
          for (let oy = -1; oy <= 1 && stable; oy++) for (let ox = -1; ox <= 1 && stable; ox++) {
            const p = sample(x + dx * 3 + ox, y + dy * 3 + oy);
            if (!p) continue;
            for (let c = 0; c < 3; c++) { low[c] = Math.min(low[c], p[c]); high[c] = Math.max(high[c], p[c]); if (high[c] - low[c] > 3) stable = false; }
          }
          if (!stable) continue;
          anchors.push(a.map((value, c) => (value + b[c]) / 2));
        }
        let proposal, conflict = false;
        for (const own of anchors) {
          if (Math.abs(own[0] - Y) > 3) continue;
          for (const other of anchors) {
            if (Math.abs(other[0] - Y) < 5 || Math.abs(own[0] - Y) * 3 > Math.abs(other[0] - Y)) continue;
            const dr = other[1] - own[1], db = other[2] - own[2], span = dr * dr + db * db;
            if (span < 16 * 16) continue;
            const mix = ((red - own[1]) * dr + (blue - own[2]) * db) / span;
            // Accept only a small, coherent leak toward the other region's chroma.
            if (mix < .08 || mix > .45 || Math.abs(red - own[1] - mix * dr) > 2.5 || Math.abs(blue - own[2] - mix * db) > 2.5) continue;
            if (proposal && (Math.abs(proposal[0] - own[1]) > 4 || Math.abs(proposal[1] - own[2]) > 4)) conflict = true;
            if (!proposal) proposal = [own[1], own[2], 1];
            else { const n = ++proposal[2]; proposal[0] += (own[1] - proposal[0]) / n; proposal[1] += (own[2] - proposal[1]) / n; }
          }
        }
        if (!proposal || conflict) continue;
        // Preserve decoded luminance and alpha; reject clipping instead of creating a color halo.
        const rgb = [Y + proposal[0], Y - (.299 * proposal[0] + .114 * proposal[1]) / .587, Y + proposal[1]];
        if (rgb.some(value => value < 0 || value > 255)) continue;
        for (let c = 0; c < 3; c++) output[i + c] = Math.round(rgb[c]);
      }
    }
    return { output, rows };
  }
  function restore(source, width, height) {
    const work = processor(source, width, height); work.rows(0, height); return work.output;
  }
  async function restoreAsync(source, width, height, isCurrent = () => true, yieldTask = () => new Promise(resolve => setTimeout(resolve, 0))) {
    const work = processor(source, width, height), batch = Math.max(1, Math.floor(16384 / width));
    // Yield between bounded row batches so file switches and the comparison button stay responsive.
    for (let y = 0; y < height; y += batch) {
      if (!isCurrent()) return null;
      work.rows(y, y + batch);
      await yieldTask();
    }
    return isCurrent() ? work.output : null;
  }
  return { processor, restore, restoreAsync };
});
