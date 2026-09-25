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
    keys(config, ['version', 'regularization', 'variationPenalty', 'directions'], 'config');
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
  return { defaults, validate, detect, strategy, alignment };
});
