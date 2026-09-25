(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./demosaic-defaults.json'));
  else root.SensorDemosaic = factory(root.SensorDemosaicDefaults);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (defaults) {
  'use strict';
  // Image coordinates: clockwise from +X. Opposite rays remain independent.
  const rays = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  // Reject incomplete strategies before a hot reload can replace the last valid configuration.
  function validate(config) {
    function keys(value, allowed, name) {
      if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !allowed.includes(k)) || allowed.some(k => !Object.hasOwn(value, k))) throw new Error(name);
    }
    function number(value, min, max, name) {
      if (!Number.isFinite(value) || value < min || value > max) throw new Error(name);
    }
    // Older saved coefficient files inherit the new refinement defaults.
    const { antiAlias, ...required } = config;
    keys(required, ['version', 'regularization', 'variationPenalty', 'directions'], 'config');
    if (antiAlias !== undefined) {
      keys(antiAlias, ['enabled', 'greenThreshold', 'chromaThreshold', 'directionFloor', 'directionSpan', 'syntheticWeight'], 'antiAlias');
      if (typeof antiAlias.enabled !== 'boolean') throw new Error('antiAlias.enabled');
      for (const key of ['greenThreshold', 'chromaThreshold', 'directionFloor', 'syntheticWeight']) number(antiAlias[key], 0, 1, `antiAlias.${key} [0, 1]`);
      number(antiAlias.directionSpan, .01, 1, 'antiAlias.directionSpan [0.01, 1]');
    }
    if (config.version !== 1) throw new Error('version = 1');
    number(config.regularization, .01, 100, 'regularization [0.01, 100]');
    number(config.variationPenalty, 0, 10, 'variationPenalty [0, 10]');
    keys(config.directions, rays.map((_, i) => String(i * 45)), 'directions: 0, 45, …, 315');
    for (const [angle, group] of Object.entries(config.directions)) {
      keys(group, ['levels'], `directions.${angle}`);
      if (!Array.isArray(group.levels) || group.levels.length < 2 || group.levels.length > 16) throw new Error(`${angle}.levels: 2–16`);
      let previous = -1;
      for (const [i, level] of group.levels.entries()) {
        keys(level, ['strength', 'uniform', 'edgePower', 'tangentBias'], `${angle}.levels.${i}`);
        number(level.strength, 0, 4, `${angle}.${i}.strength [0, 4]`);
        if (level.strength <= previous || (i === 0 && level.strength !== 0)) throw new Error(`${angle}.strength: 0 < …`);
        previous = level.strength;
        number(level.uniform, 0, 1, `${angle}.${i}.uniform [0, 1]`);
        number(level.edgePower, 0, 4, `${angle}.${i}.edgePower [0, 4]`);
        number(level.tangentBias, 0, 4, `${angle}.${i}.tangentBias [0, 4]`);
      }
    }
    return config;
  }
  // Compare only like CFA phases, two pixels apart. Never interpret the R/G/B
  // filter differences themselves as spatial gradients. Normalize diagonal length.
  function detect(sample, x, y) {
    const center = sample(x, y), gradients = rays.map(([dx, dy]) => {
      const next = sample(x + 2 * dx, y + 2 * dy);
      const difference = Array.isArray(center) ? Math.hypot(...center.map((v, i) => next[i] - v)) : Math.abs(next - center);
      return difference / Math.hypot(dx, dy);
    });
    const strength = Math.max(...gradients);
    // Preserve ties (e.g. corners); selecting the first ray would introduce bias.
    const directions = gradients.map((v, i) => strength - v <= 1e-7 ? i : -1).filter(i => i >= 0);
    return { strength, directions };
  }
  // Blend neighboring strength levels continuously, then average equally strong directions.
  function strategy(config, edge) {
    const result = { uniform: 0, edgePower: 0, tangentBias: 0 };
    for (const direction of edge.directions) {
      const levels = config.directions[String(direction * 45)].levels;
      let a = levels[0], b = a;
      for (const level of levels) { b = level; if (level.strength >= edge.strength) break; a = level; }
      const mix = a === b ? 0 : Math.min(1, (edge.strength - a.strength) / (b.strength - a.strength));
      for (const key of Object.keys(result)) result[key] += (a[key] + mix * (b[key] - a[key])) / edge.directions.length;
    }
    return result;
  }
  // A gradient points across an edge; candidates along its tangent receive the highest score.
  function alignment(edge, dx, dy) {
    let cross = 0;
    for (const direction of edge.directions) {
      const [gx, gy] = rays[direction];
      cross += ((gx * dx + gy * dy) ** 2) / ((gx * gx + gy * gy) * (dx * dx + dy * dy));
    }
    return 1 - cross / edge.directions.length;
  }
  // Stabilize Hamilton-Adams candidates using local color-difference consistency.
  // Related to GBTF's directional residual propagation (IPOL 2021/358, section 4).
  // This is a bounded preview refinement, not the full iterative ARI algorithm.
  function refineGreenTile(raw, width, height, pattern, green, sampleStep, protectedPixels, coefficients, sampleConfidence) {
    const settings = coefficients.antiAlias || defaults.antiAlias;
    const n = raw.length, horizontal = new Float32Array(n), vertical = new Float32Array(n);
    const gh = new Float32Array(n), gv = new Float32Array(n);
    function reflect(x, size) { while (x < 0 || x >= size) x = x < 0 ? -x : 2 * (size - 1) - x; return x; }
    const at = (x, y) => reflect(y, height) * width + reflect(x, width);
    const isGreen = (x, y) => pattern[(y % 2) * 2 + x % 2] === 'G';
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = y * width + x, c = raw[i], sign = isGreen(x, y) ? -1 : 1;
      horizontal[i] = sign * ((raw[at(x - 1, y)] + raw[at(x + 1, y)]) / 2 + (2 * c - raw[at(x - 2, y)] - raw[at(x + 2, y)]) / 4 - c);
      vertical[i] = sign * ((raw[at(x, y - 1)] + raw[at(x, y + 1)]) / 2 + (2 * c - raw[at(x, y - 2)] - raw[at(x, y + 2)]) / 4 - c);
    }
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = y * width + x;
      gh[i] = Math.abs(horizontal[at(x - 1, y)] - horizontal[at(x + 1, y)]);
      gv[i] = Math.abs(vertical[at(x, y - 1)] - vertical[at(x, y + 1)]);
    }
    // Opposite visible-channel transitions are chromatic boundaries, not shared luminance edges.
    // Compare measured CFA phases in neighboring tiles; never infer this guard from repaired RGB.
    const phase = Object.fromEntries(['R', 'B'].map(c => [c, pattern.indexOf(c)]));
    const cell = (x, y, p) => raw[at(x + p % 2, y + Math.floor(p / 2))];
    const conflicts = new Uint8Array(n);
    for (let y = 0; y < height; y += 2) for (let x = 0; x < width; x += 2) {
      const r = cell(x, y, phase.R), b = cell(x, y, phase.B);
      for (const [dx, dy] of rays) {
        const xx = x + 2 * dx, yy = y + 2 * dy;
        const dr = cell(xx, yy, phase.R) - r, db = cell(xx, yy, phase.B) - b;
        if (dr * db < 0 && Math.min(Math.abs(dr), Math.abs(db)) > settings.chromaThreshold) {
          for (let sy = -2; sy < 4; sy++) for (let sx = -2; sx < 4; sx++) conflicts[at(x + sx, y + sy)] = 1;
          break;
        }
      }
    }
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      if (isGreen(x, y)) continue;
      const i = y * width + x;
      // Keep exact plateaus, smooth ramps and already-supported corner neighborhoods intact.
      if (sampleConfidence && !sampleConfidence[i] || conflicts[i] || protectedPixels?.[i] || Math.abs(horizontal[i] - vertical[i]) < settings.greenThreshold) continue;
      const dh = Math.abs(raw[at(x - 1, y)] - raw[at(x + 1, y)]) + Math.abs(2 * raw[i] - raw[at(x - 2, y)] - raw[at(x + 2, y)]);
      const dv = Math.abs(raw[at(x, y - 1)] - raw[at(x, y + 1)]) + Math.abs(2 * raw[i] - raw[at(x, y - 2)] - raw[at(x, y + 2)]);
      if (Math.min(dh, dv) <= sampleStep * 2) continue;
      let h = 0, v = 0;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const j = at(x + dx, y + dy), confidence = sampleConfidence && !sampleConfidence[j] ? settings.syntheticWeight : 1;
        h += confidence * gh[j]; v += confidence * gv[j];
      }
      const floor = Math.max(sampleStep, 1 / 65535);
      const wh = 1 / (floor * floor + h * h), wv = 1 / (floor * floor + v * v);
      const candidate = raw[i] + (wh * horizontal[i] + wv * vertical[i]) / (wh + wv);
      const edge = detect((xx, yy) => raw[at(xx, yy)], x, y);
      edge.strength = Math.max(edge.strength, dh, dv);
      const policy = strategy(coefficients, edge);
      const confidence = Math.max(0, Math.min(1, (Math.abs(h - v) / (h + v + floor) - settings.directionFloor) / settings.directionSpan));
      green[i] += confidence * (1 - policy.uniform) * (candidate - green[i]);
    }
    return green;
  }
  // Bound temporary storage independently of sensor resolution. An even halo preserves CFA phase.
  // Only raw samples guide the filter, so processing tiles cannot feed earlier output into later ones.
  function stabilizeGreen(raw, width, height, pattern, green, sampleStep, protectedPixels, coefficients, sampleConfidence) {
    const tile = 256, halo = 8;
    if (width <= tile && height <= tile) return refineGreenTile(raw, width, height, pattern, green, sampleStep, protectedPixels, coefficients, sampleConfidence);
    function reflect(x, size) { while (x < 0 || x >= size) x = x < 0 ? -x : 2 * (size - 1) - x; return x; }
    for (let top = 0; top < height; top += tile) for (let left = 0; left < width; left += tile) {
      const w = Math.min(tile, width - left), h = Math.min(tile, height - top), tw = w + 2 * halo, th = h + 2 * halo;
      const samples = new Float32Array(tw * th), values = new Float32Array(tw * th), protectedTile = new Uint8Array(tw * th);
      const confidence = sampleConfidence && new Uint8Array(tw * th);
      for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
        const i = reflect(top + y - halo, height) * width + reflect(left + x - halo, width), j = y * tw + x;
        samples[j] = raw[i]; values[j] = green[i]; protectedTile[j] = protectedPixels[i];
        if (confidence) confidence[j] = sampleConfidence[i];
      }
      refineGreenTile(samples, tw, th, pattern, values, sampleStep, protectedTile, coefficients, confidence);
      for (let y = 0; y < h; y++) green.set(values.subarray((y + halo) * tw + halo, (y + halo) * tw + halo + w), (top + y) * width + left);
    }
    return green;
  }
  return { defaults, validate, detect, strategy, alignment, stabilizeGreen };
});
