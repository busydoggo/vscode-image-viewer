'use strict';
// Exercise geometric directions independently of the detector's partition templates.
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../media/core');
const Demosaic = require('../media/demosaic');
const rays = [[1,0], [1,1], [0,1], [-1,1], [-1,0], [-1,-1], [0,-1], [1,-1]];
const permutations = s => s.length === 1 ? [s] : [...s].flatMap((v, i) => permutations(s.slice(0, i) + s.slice(i + 1)).map(rest => v + rest));
function wedge(angle, span, inverted = false) {
  const a = rays[angle], b = rays[(angle + span) % 8];
  return (x, y) => {
    const dx = x - 23.5, dy = y - 23.5;
    // Keep the finite polygon away from image borders so every geometric
    // vertex has raw evidence on both sides, including the clipping corners.
    const inside = x >= 8 && x < 40 && y >= 8 && y < 40
      && a[0] * dy - a[1] * dx >= 0 && b[0] * dy - b[1] * dx <= 0;
    return inside !== inverted ? [180,110,70] : [16,16,16];
  };
}
function input(pattern, scene, depth = 8) {
  const config = { ...Core.defaults(), width: 48, height: 48, pattern, bitDepth: depth, containerBits: depth === 8 ? 8 : 16 };
  const bytes = Buffer.alloc(48 * 48 * config.containerBits / 8), peak = 2 ** depth - 1;
  for (let y = 0; y < 48; y++) for (let x = 0; x < 48; x++) {
    const channel = pattern[(y % 2) * 2 + x % 2];
    const value = Math.round((channel === 'I' ? (17 * x + 21 * y) % 256 : scene(x, y)['RGB'.indexOf(channel)]) * peak / 255);
    if (depth === 8) bytes[y * 48 + x] = value; else bytes.writeUInt16LE(value, (y * 48 + x) * 2);
  }
  return { config, bytes };
}
function compare(frame, scene, label) {
  let sum = 0, maximum = 0;
  // Include the complete image in the error budget; diagonal edges farther
  // from the vertex still use the existing directional interpolation.
  for (let y = 0; y < 48; y++) for (let x = 0; x < 48; x++) {
    const i = (y * 48 + x) * 4, expected = scene(x, y);
    assert.equal(frame.rgba[i + 3], 255);
    for (let k = 0; k < 3; k++) {
      const error = Math.abs(frame.rgba[i + k] - expected[k]);
      sum += error; maximum = Math.max(maximum, error);
      if (x >= 20 && x < 28 && y >= 20 && y < 28) assert.ok(error <= 1, `${label}: corner (${x},${y}) ${'RGB'[k]} error ${error}`);
    }
  }
  assert.ok(sum / (48 * 48 * 3) <= 1.5, `${label}: full-frame MAE ${sum / (48 * 48 * 3)}`);
  assert.ok(maximum <= 100, `${label}: full-frame maximum error ${maximum}`);
}
for (const pattern of ['RGGB', 'BGGR', 'GRBG', 'GBRG', ...permutations('RGBI')]) {
  test(`${pattern}: 45/90/135-degree corners in all eight directions`, () => {
    for (let angle = 0; angle < 8; angle++) for (let span = 1; span <= 3; span++) {
      const scene = wedge(angle, span), { config, bytes } = input(pattern, scene);
      const frame = Core.decode(bytes, config);
      compare(frame, scene, `${pattern} ${angle * 45}/${span * 45}`);
      // Every measured visible channel must survive the geometric fit intact.
      for (let y = 0; y < 48; y++) for (let x = 0; x < 48; x++) {
        const k = 'RGB'.indexOf(pattern[(y % 2) * 2 + x % 2]);
        if (k >= 0) assert.equal(frame.rgba[(y * 48 + x) * 4 + k], bytes[y * 48 + x]);
      }
    }
  });
}

test('rotated corners support high bit depths and reversed contrast without using IR values', () => {
  for (const pattern of ['RGGB', 'RGBI']) for (const depth of [12, 16]) for (const span of [1, 2, 3]) {
    const scene = wedge(1, span, true), { config, bytes } = input(pattern, scene, depth);
    const frame = Core.decode(bytes, config);
    compare(frame, scene, `${pattern} ${depth} reversed ${span * 45}`);
    if (pattern.includes('I')) {
      const changed = Buffer.from(bytes);
      for (let y = 1; y < 48; y += 2) for (let x = 1; x < 48; x += 2) changed.writeUInt16LE(0, (y * 48 + x) * 2);
      assert.deepEqual(Core.decode(changed, config).rgba, frame.rgba);
    }
  }
});

test('rotated corners honor uniform coefficients and retain measured samples', () => {
  const coefficients = structuredClone(Demosaic.defaults);
  for (const group of Object.values(coefficients.directions)) for (const level of group.levels) level.uniform = 1;
  for (const pattern of ['RGGB', 'RGBI']) {
    const scene = wedge(1, 2), { config, bytes } = input(pattern, scene);
    const normal = Core.decode(bytes, config), uniform = Core.decode(bytes, config, coefficients);
    let cornerDifference = 0;
    for (let y = 20; y < 28; y++) for (let x = 20; x < 28; x++) {
      const i = y * 48 + x, k = 'RGB'.indexOf(pattern[(y % 2) * 2 + x % 2]);
      if (k >= 0) assert.equal(uniform.rgba[i * 4 + k], bytes[i]);
      for (let j = 0; j < 3; j++) cornerDifference += Math.abs(normal.rgba[i * 4 + j] - uniform.rgba[i * 4 + j]);
    }
    assert.ok(cornerDifference > 100, `${pattern}: uniform policy must bypass corner sharpening`);
  }
});

test('transposing oblique corners and their CFA phases preserves the reconstruction', () => {
  // Competing fits and diagonal equality cases must not depend on scan direction.
  for (const pattern of ['RGGB', 'BGGR', 'GRBG', 'GBRG', 'RGBI', 'IRGB', 'BIRG', 'GBIR']) {
    const transposedPattern = pattern[0] + pattern[2] + pattern[1] + pattern[3];
    for (const span of [1, 2, 3]) {
      const scene = wedge(1, span), a = input(pattern, scene), b = input(transposedPattern, (x, y) => scene(y, x));
      const normal = Core.decode(a.bytes, a.config), transposed = Core.decode(b.bytes, b.config);
      for (let y = 0; y < 48; y++) for (let x = 0; x < 48; x++) for (let k = 0; k < 3; k++) {
        assert.ok(Math.abs(normal.rgba[(y * 48 + x) * 4 + k] - transposed.rgba[(x * 48 + y) * 4 + k]) <= 1,
          `${pattern} ${span * 45} degrees (${x},${y}) ${'RGB'[k]}`);
      }
    }
  }
});

test('independent direction coefficients transpose with oblique corner geometry', () => {
  // Asymmetric policies expose a tie resolved by scan order even when equal
  // default coefficients would conceal it. Transposition maps angle to 90-angle.
  const coefficients = structuredClone(Demosaic.defaults);
  for (const [angle, group] of Object.entries(coefficients.directions)) {
    for (const level of group.levels) level.uniform = 0.1 + Number(angle) / 450;
  }
  const transposedCoefficients = structuredClone(coefficients);
  for (const angle of Object.keys(coefficients.directions)) transposedCoefficients.directions[angle] = coefficients.directions[(450 - Number(angle)) % 360];
  for (const pattern of ['RGGB', 'RGBI']) for (const span of [1, 2, 3]) {
    const scene = wedge(1, span), a = input(pattern, scene);
    const b = input(pattern[0] + pattern[2] + pattern[1] + pattern[3], (x, y) => scene(y, x));
    const normal = Core.decode(a.bytes, a.config, coefficients), transposed = Core.decode(b.bytes, b.config, transposedCoefficients);
    for (let y = 20; y < 28; y++) for (let x = 20; x < 28; x++) for (let k = 0; k < 3; k++) {
      assert.ok(Math.abs(normal.rgba[(y * 48 + x) * 4 + k] - transposed.rgba[(x * 48 + y) * 4 + k]) <= 1,
        `${pattern} ${span * 45} degrees (${x},${y}) ${'RGB'[k]}`);
    }
  }
});
