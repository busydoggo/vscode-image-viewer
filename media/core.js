(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./i18n'), require('./demosaic'));
  else root.SensorCore = factory(root.SensorI18n, root.SensorDemosaic);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (I18n, Demosaic) {
  'use strict';
  const { t } = I18n;
  const MAX_PIXELS = 32 * 1024 * 1024;
  const MAX_BYTES = 256 * 1024 * 1024;
  const layouts = {
    '400': ['planar-uv'],
    '420': ['planar-uv', 'planar-vu', 'semi-uv', 'semi-vu'],
    '422': ['planar-uv', 'planar-vu', 'semi-uv', 'semi-vu', 'YUYV', 'UYVY', 'YVYU', 'VYUY'],
    '444': ['planar-uv', 'planar-vu', 'semi-uv', 'semi-vu', 'YUV', 'YVU', 'UYV', 'UVY', 'VYU', 'VUY']
  };
  // Filename inference and the inspector share preset values to avoid divergent decoding.
  const yuvPresetDefaults = { bitDepth: 8, containerBits: 8, storage: 'unpacked', endian: 'little', alignment: 'lsb', rowPitch: 0, chromaPitch: 0 };
  const yuvPresets = {
    I420: { subsampling: '420', layout: 'planar-uv' }, YV12: { subsampling: '420', layout: 'planar-vu' },
    NV12: { subsampling: '420', layout: 'semi-uv' }, NV21: { subsampling: '420', layout: 'semi-vu' },
    I422: { subsampling: '422', layout: 'planar-uv' }, NV16: { subsampling: '422', layout: 'semi-uv' }, NV61: { subsampling: '422', layout: 'semi-vu' },
    YUYV: { subsampling: '422', layout: 'YUYV' }, UYVY: { subsampling: '422', layout: 'UYVY' },
    I444: { subsampling: '444', layout: 'planar-uv' }, NV24: { subsampling: '444', layout: 'semi-uv' }, NV42: { subsampling: '444', layout: 'semi-vu' },
    P010: { subsampling: '420', layout: 'semi-uv', bitDepth: 10, containerBits: 16, alignment: 'msb' },
    P012: { subsampling: '420', layout: 'semi-uv', bitDepth: 12, containerBits: 16, alignment: 'msb' },
    P016: { subsampling: '420', layout: 'semi-uv', bitDepth: 16, containerBits: 16, alignment: 'msb' }
  };
  function yuvPresetConfig(name) { return { ...yuvPresetDefaults, ...yuvPresets[name] }; }
  function extension(name) { const base = name.split(/[\\/]/).pop(); const dot = base.lastIndexOf('.'); return dot > 0 ? base.slice(dot + 1).toLowerCase() : ''; }
  function kind(name) { const ext = extension(name); return ext === 'png' ? 'PNG' : ['jpg', 'jpeg'].includes(ext) ? 'JPEG' : 'BINARY'; }
  // Build a fresh configuration; callers cache it only for the current VS Code session.
  function defaults(name = '') {
    const ext = extension(name);
    const config = {
      format: ['yuv', 'y', 'uv'].includes(ext) ? 'YUV' : 'CFA',
      width: 640, height: 480, offset: 0, bitDepth: 8, containerBits: 0,
      storage: 'unpacked', endian: 'little', alignment: 'lsb',
      rowPitch: 0, chromaPitch: 0, pattern: 'RGGB',
      display: 'rgb', alpha: 0.5, black: 0, white: 0, gamma: 1, exposure: 0,
      subsampling: ext === 'y' ? '400' : '420', layout: ext === 'uv' ? 'semi-uv' : 'planar-uv', matrix: '709', range: 'limited',
      yuvPlanes: ext === 'y' ? 'y' : ext === 'uv' ? 'uv' : 'yuv',
      yuvDisplay: ext === 'y' ? 'luma' : ext === 'uv' ? 'chroma' : 'rgb'
    };
    return Object.assign(config, filenameHints(name));
  }
  // Only explicit, delimited basename tags are interpreted. Repeated conflicting
  // values leave that field at its default; directories never supply metadata.
  function filenameHints(name) {
    if (kind(name) !== 'BINARY') return {};
    const base = name.split(/[\\/]/).pop();
    const stem = extension(name) ? base.slice(0, base.lastIndexOf('.')) : base;
    const hints = {};
    // Delimit tags before case-insensitive matching so ordinary words cannot supply hints.
    function tagged(expression) { return new RegExp('(?:^|[^a-z0-9])(?:' + expression + ')(?=$|[^a-z0-9])', 'gi'); }
    function matches(expression, convert = m => m[1].toLowerCase(), source = stem) {
      return [...source.matchAll(tagged(expression))].map(convert);
    }
    function unique(values) { const set = new Set(values); return set.size === 1 ? [...set][0] : undefined; }
    function field(key, expression, convert) {
      const value = unique(matches(expression, convert));
      if (value !== undefined) hints[key] = value;
    }
    const dimensions = unique(matches('(\\d{1,5})[x×](\\d{1,5})', m => `${Number(m[1])}x${Number(m[2])}`));
    if (dimensions) [hints.width, hints.height] = dimensions.split('x').map(Number);
    // Presets establish defaults first; explicit precision, container and order tags override them.
    const preset = unique(matches('(' + Object.keys(yuvPresets).join('|') + ')', m => m[1].toUpperCase()));
    if (preset) Object.assign(hints, yuvPresetConfig(preset));
    field('pattern', '(?:bayer[-_ ]?|cfa[-_ ]?|pattern[-_ =]?)?([rgbi]{4})(?:\\d{1,2})?', m => m[1].toUpperCase());
    if (hints.pattern && !['R', 'G', 'B'].every(c => hints.pattern.includes(c))) delete hints.pattern;
    const formats = matches('(cfa|bayer|rgbir|rgb-ir|yuv)', m => m[1].toLowerCase() === 'yuv' ? 'YUV' : 'CFA');
    if (preset) formats.push('YUV');
    if (hints.pattern) formats.push('CFA');
    const format = unique(formats);
    if (format) hints.format = format;
    // RAW12 describes precision, not MIPI RAW12 packing.
    const containerTag = '(?:in|container(?:bits)?)[-_ =]?(\\d{1,2})(?:[-_ ]?bits?)?';
    // Hide container tags before scanning depth: container-16-bit must not imply 16-bit pixels.
    const depthStem = stem.replace(tagged(containerTag), ' ');
    const depths = [
      ...matches('(\\d{1,2})[-_ ]?(?:bits?|bpp)', m => Number(m[1]), depthStem),
      ...matches('(?:raw|bitdepth|depth)[-_ =]?(\\d{1,2})', m => Number(m[1])),
      ...matches('(?:bayer[-_ ]?|cfa[-_ ]?)?[rgbi]{4}(\\d{1,2})', m => Number(m[1]))
    ];
    const depth = unique(depths);
    if (depth !== undefined) hints.bitDepth = depth;
    field('containerBits', containerTag, m => Number(m[1]));
    field('storage', '(packed|unpacked)');
    if (hints.storage === 'packed' && !matches(containerTag).length) {
      hints.containerBits = hints.bitDepth ?? 8;
    }
    field('endian', '(le|be|little[-_ ]?endian|big[-_ ]?endian)', m => /^(le|little)/i.test(m[1]) ? 'little' : 'big');
    field('alignment', '(lsb|msb)');
    field('offset', '(?:offset|readoffset)[-_ =]?(\\d+)', m => Number(m[1]));
    field('rowPitch', '(?:pitch|rowpitch|ypitch)[-_ =]?(\\d+)', m => Number(m[1]));
    field('chromaPitch', '(?:chromapitch|uvpitch)[-_ =]?(\\d+)', m => Number(m[1]));
    field('matrix', 'bt[-_. ]?(601|709|2020)');
    field('range', '(full|limited)(?:[-_ ]?range)?');
    // Plane-only extensions remain plane-only even with a named preset.
    const ext = extension(name);
    if (ext === 'y' || ext === 'uv') {
      hints.format = 'YUV';
      if (ext === 'y') Object.assign(hints, { subsampling: '400', layout: 'planar-uv' });
      else if (hints.layout && !/^(planar|semi)-/.test(hints.layout)) hints.layout = 'semi-uv';
    }
    return hints;
  }
  function yuvLayouts(c) {
    const allowed = layouts[c.subsampling] || [];
    return c.yuvPlanes === 'uv' ? allowed.filter(layout => layout.startsWith('planar') || layout.startsWith('semi')) : allowed;
  }
  function yuvDisplays(c) {
    return c.yuvPlanes === 'uv' ? ['chroma'] : c.yuvPlanes === 'y' || c.subsampling === '400' ? ['rgb', 'luma'] : ['rgb', 'luma', 'chroma'];
  }
  function cleanPattern(s) { return typeof s === 'string' ? s.toUpperCase().replace(/[\s,;/|]/g, '') : ''; }
  // Zero means Auto: preserve packed precision, otherwise round up to a whole byte.
  // Any explicit container width overrides the legacy packing hint.
  function containerBits(c) { return c.containerBits == null || c.containerBits === 0 ? (c.storage === 'packed' ? c.bitDepth : Math.ceil(c.bitDepth / 8) * 8) : c.containerBits; }
  function isRgbir(c) { return cleanPattern(c.pattern).includes('I'); }
  function sequence(c, fileSize, current = 1) {
    const info = analyze(c, fileSize);
    const frameBytes = info.valid ? info.requiredBytes : 0;
    const frameCount = frameBytes ? Math.floor(info.availableBytes / frameBytes) : 0;
    // Keep exactly two frames in single-image mode; partial tails never become complete frames.
    const enabled = frameCount >= 2 && info.availableBytes > frameBytes * 2;
    const frame = Math.max(1, Math.min(Number.isSafeInteger(current) ? current : 1, enabled ? frameCount : 1));
    return { enabled, frameCount, frameBytes, frame, readOffset: c.offset + (frame - 1) * frameBytes,
      remainderBytes: frameBytes ? info.availableBytes % frameBytes : 0 };
  }
  function analyze(c, fileSize) {
    const errors = {};
    function integer(key, min, max) {
      if (!Number.isSafeInteger(c[key]) || c[key] < min || c[key] > max) errors[key] = t('error.integer', { min, max });
    }
    function choice(key, options) { if (!options.includes(c[key])) errors[key] = t('error.choice'); }
    integer('width', 1, 65536); integer('height', 1, 65536); integer('offset', 0, Number.MAX_SAFE_INTEGER);
    integer('bitDepth', 4, 32); integer('rowPitch', 0, MAX_BYTES); integer('chromaPitch', 0, MAX_BYTES);
    choice('format', ['CFA', 'YUV']); choice('storage', ['unpacked', 'packed']);
    choice('endian', ['little', 'big']); choice('alignment', ['lsb', 'msb']);
    {
      if (c.containerBits != null && c.containerBits !== 0 && (!Number.isInteger(c.containerBits) || c.containerBits < 4 || c.containerBits > 32)) errors.containerBits = t('error.containerSize');
      else if (containerBits(c) < c.bitDepth) errors.containerBits = t('error.containerDepth', { depth: c.bitDepth });
    }
    if (c.width * c.height > MAX_PIXELS) errors.width = t('error.maxPixels');
    for (const [key, lo, hi] of [['gamma', 0.1, 5], ['exposure', -10, 10], ['alpha', 0, 1], ['black', 0, 2 ** 32 - 1], ['white', 0, 2 ** 32 - 1]]) {
      if (!Number.isFinite(c[key]) || c[key] < lo || c[key] > hi) errors[key] = t('error.range', { min: lo, max: hi });
    }
    const peak = 2 ** c.bitDepth - 1;
    if (c.format === 'CFA') {
      if (c.black >= (c.white || peak) || (c.white || peak) > peak) errors.white = t('error.white');
      choice('display', ['rgb', 'ir', 'blend', 'side']);
      const pattern = cleanPattern(c.pattern);
      if (pattern.length !== 4 || /[^RGBI]/.test(pattern) || !['R', 'G', 'B'].every(v => pattern.includes(v))) {
        errors.pattern = t('error.pattern');
      }
    } else {
      choice('yuvPlanes', ['yuv', 'y', 'uv']); choice('yuvDisplay', yuvDisplays(c));
      choice('subsampling', Object.keys(layouts));
      if (c.yuvPlanes === 'uv' && c.subsampling === '400') errors.subsampling = t('error.uvSampling');
      if (c.yuvPlanes === 'y' && c.subsampling !== '400') errors.subsampling = t('error.ySampling');
      choice('layout', yuvLayouts(c));
      choice('matrix', ['601', '709', '2020']); choice('range', ['full', 'limited']);
    }
    if (Object.keys(errors).length) return { valid: false, errors, requiredBytes: 0, availableBytes: Math.max(0, fileSize - (c.offset || 0)), planes: [] };
    const bits = containerBits(c);
    const planes = [];
    let requiredBytes = 0;
    // Each pitch is measured in bytes and includes padding; packed rows restart on byte boundaries.
    function plane(name, samples, rows, pitchKey) {
      const minimum = Math.ceil(samples * bits / 8);
      const pitch = c[pitchKey] || minimum;
      if (pitch < minimum) errors[pitchKey] = t('error.pitch', { minimum });
      const p = { name, samples, rows, pitch, offset: requiredBytes };
      planes.push(p); requiredBytes += pitch * rows;
      return p;
    }
    let cw = c.width, ch = c.height;
    if (c.format === 'CFA') plane('CFA', c.width, c.height, 'rowPitch');
    else {
      cw = c.subsampling === '444' ? c.width : Math.ceil(c.width / 2);
      ch = c.subsampling === '420' ? Math.ceil(c.height / 2) : c.height;
      if (c.subsampling === '400') plane('Y', c.width, c.height, 'rowPitch');
      else if (c.layout.startsWith('planar')) {
        if (c.yuvPlanes !== 'uv') plane('Y', c.width, c.height, 'rowPitch');
        for (const channel of c.layout.endsWith('uv') ? ['U', 'V'] : ['V', 'U']) plane(channel, cw, ch, 'chromaPitch');
      } else if (c.layout.startsWith('semi')) {
        if (c.yuvPlanes !== 'uv') plane('Y', c.width, c.height, 'rowPitch');
        plane('UV', cw * 2, ch, 'chromaPitch');
      } else plane('packed', c.subsampling === '422' ? cw * 4 : c.width * 3, c.height, 'rowPitch');
    }
    if (requiredBytes > MAX_BYTES) errors.width = t('error.maxBytes');
    const availableBytes = Math.max(0, fileSize - c.offset);
    if (c.offset > fileSize) errors.offset = t('error.offset', { size: fileSize });
    else if (requiredBytes > availableBytes) {
      const message = t('error.size', { required: I18n.number(requiredBytes), available: I18n.number(availableBytes) });
      errors.width = message; errors.height = message;
    }
    return { valid: !Object.keys(errors).length, errors, requiredBytes, availableBytes, trailingBytes: Math.max(0, availableBytes - requiredBytes), planes, bits, cw, ch };
  }
  // Packed samples restart at each row; row-end padding bits are ignored.
  function sampleReader(bytes, c) {
    const bits = c.bitDepth, peak = 2 ** bits, storedBits = containerBits(c), container = storedBits / 8;
    return function (plane, x, y) {
      const base = plane.offset + y * plane.pitch;
      if (storedBits % 8 === 0) {
        let value = 0;
        if (c.endian === 'little') for (let b = container - 1; b >= 0; b--) value = value * 256 + bytes[base + x * container + b];
        else for (let b = 0; b < container; b++) value = value * 256 + bytes[base + x * container + b];
        return c.alignment === 'msb' ? Math.floor(value / 2 ** (container * 8 - bits)) : value % peak;
      }
      let position = x * storedBits, remaining = storedBits, value = 0, shift = 0;
      while (remaining) {
        const bit = position % 8, take = Math.min(8 - bit, remaining), byte = bytes[base + Math.floor(position / 8)];
        if (c.endian === 'little') { value += ((byte >> bit) & (2 ** take - 1)) * 2 ** shift; shift += take; }
        else value = value * 2 ** take + ((byte >> (8 - bit - take)) & (2 ** take - 1));
        position += take; remaining -= take;
      }
      // Alignment selects meaningful bits inside the container independently of stream endianness.
      return c.alignment === 'msb' ? Math.floor(value / 2 ** (storedBits - bits)) : value % peak;
    };
  }
  const clamp = x => Math.max(0, Math.min(255, Math.round(x)));
  // Inspect the stored samples before demosaicing, color conversion or display adjustments.
  function pixelReader(bytes, c, info = analyze(c, c.offset + bytes.length)) {
    if (!info.valid) throw new Error(Object.values(info.errors)[0]);
    const read = sampleReader(bytes, c), p = Object.fromEntries(info.planes.map(v => [v.name, v]));
    const pattern = cleanPattern(c.pattern), order = c.layout;
    const ys = [...order].map((v, i) => v === 'Y' ? i : -1).filter(i => i >= 0);
    return (x, y) => {
      if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= c.width || y >= c.height) return null;
      if (c.format === 'CFA') return { format: 'CFA', channel: pattern[(y % 2) * 2 + x % 2], value: read(p.CFA, x, y) };
      const cx = c.subsampling === '444' ? x : Math.floor(x / 2), cy = c.subsampling === '420' ? Math.floor(y / 2) : y;
      let yy = p.Y ? read(p.Y, x, y) : null, u = null, v = null;
      if (p.U) { u = read(p.U, cx, cy); v = read(p.V, cx, cy); }
      else if (p.UV) {
        const uv = order === 'semi-uv'; u = read(p.UV, cx * 2 + (uv ? 0 : 1), cy); v = read(p.UV, cx * 2 + (uv ? 1 : 0), cy);
      } else if (p.packed) {
        const base = c.subsampling === '422' ? cx * 4 : x * 3;
        yy = read(p.packed, base + (c.subsampling === '422' ? ys[x % 2] : order.indexOf('Y')), y);
        u = read(p.packed, base + order.indexOf('U'), y); v = read(p.packed, base + order.indexOf('V'), y);
      }
      return { format: 'YUV', y: yy, u, v };
    };
  }
  // Boundary normals cover the four unoriented lines at 45-degree spacing;
  // region polarity supplies all eight rays and 45/90/135-degree corners.
  // Half-pixel anchors preserve the axis model's pixel-cell convention. Both
  // diagonal tie assignments are tested against samples, not chosen by order.
  const cornerPartitions = (() => {
    const normals = [[1, 0], [1, 1], [0, 1], [-1, 1]], models = [];
    for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++) {
      if (a === 0 && b === 2) continue;
      const diagonalA = a % 2, diagonalB = b % 2;
      for (let ta = 0; ta <= diagonalA; ta++) for (let tb = 0; tb <= diagonalB; tb++) {
        const region = (x, y) => {
          const u = normals[a][0] * (2 * x + 1) + normals[a][1] * (2 * y + 1);
          const v = normals[b][0] * (2 * x + 1) + normals[b][1] * (2 * y + 1);
          return Number(u > 0 || (u === 0 && ta)) + 2 * Number(v > 0 || (v === 0 && tb));
        };
        const mask = [];
        for (let y = -6; y < 6; y++) for (let x = -6; x < 6; x++) mask.push(region(x, y));
        models.push({ region, mask });
      }
    }
    return models;
  })();
  function directionalCornerFits(raw, width, pattern, bx, by, tolerance) {
    const samples = [], levels = [[], [], []];
    // A two-color plateau has at most two levels per visible channel. Reject
    // gradients/noisy texture once a third level appears, before testing geometry.
    for (let dy = -6; dy < 6; dy++) for (let dx = -6; dx < 6; dx++) {
      const x = bx + dx, y = by + dy, k = 'RGB'.indexOf(pattern[(y % 2) * 2 + x % 2]);
      const value = raw[y * width + x];
      samples.push({ k, value, dx, dy });
      if (k < 0) continue;
      if (!levels[k].some(level => Math.abs(level - value) <= tolerance)) {
        if (levels[k].length === 2) return [];
        levels[k].push(value);
      }
    }
    if (levels.filter(values => values.length === 2 && Math.abs(values[0] - values[1]) > 8 * tolerance).length < 2) return [];
    const fits = [];
    for (const model of cornerPartitions) {
      const low = Array(12).fill(Infinity), high = Array(12).fill(-Infinity), sum = Array(12).fill(0), count = Array(12).fill(0);
      let valid = true;
      for (let i = 0; i < samples.length; i++) {
        const { k, value } = samples[i];
        if (k < 0) continue;
        const slot = model.mask[i] * 3 + k;
        low[slot] = Math.min(low[slot], value); high[slot] = Math.max(high[slot], value);
        if (high[slot] - low[slot] > tolerance) { valid = false; break; }
        sum[slot] += value; count[slot]++;
      }
      // Narrow sectors still need repeated measurements of every visible color.
      if (!valid || count.some(n => n < 2)) continue;
      const colors = Array.from({ length: 4 }, (_, q) => sum.slice(q * 3, q * 3 + 3).map((v, k) => v / count[q * 3 + k]));
      const foreground = colors.findIndex((color, q) => {
        const others = colors.filter((_, i) => i !== q);
        return others.slice(1).every(other => other.every((v, k) => Math.abs(v - others[0][k]) <= tolerance))
          && color.filter((v, k) => Math.abs(v - others[0][k]) > 8 * tolerance).length >= 2;
      });
      if (foreground < 0) continue;
      // Evaluate policy from a foreground point near the vertex, so a narrow
      // wedge cannot be missed merely because the anchor lies in its background.
      let nearest = Infinity, anchors = [];
      for (let i = 0; i < samples.length; i++) if (model.mask[i] === foreground) {
        const p = samples[i], distance = (p.dx + .5) ** 2 + (p.dy + .5) ** 2;
        if (distance < nearest) { nearest = distance; anchors = []; }
        if (distance === nearest) anchors.push({ x: bx + p.dx, y: by + p.dy });
      }
      fits.push({ colors, region: (x, y) => model.region(x - bx, y - by), anchors });
    }
    return fits;
  }
  // A straight-edge gradient is ambiguous where two edges meet. Validate
  // axis-aligned corners in four 4x4 quadrants first, then try oblique sectors
  // with a larger sample window. Three regions must share one background.
  // This uses sensor data only, without knowledge of chart colors or geometry.
  function cfaCorners(raw, width, height, pattern, sampleStep, coefficients) {
    const corners = new Map(), tolerance = Math.max(2 * sampleStep, 1e-7);
    const rgbir = pattern.includes('I'), first = rgbir ? -2 : -1, last = rgbir ? 1 : 0;
    const channel = (x, y) => 'RGB'.indexOf(pattern[(y % 2) * 2 + x % 2]);
    const close = (a, b) => a.every((value, k) => Math.abs(value - b[k]) <= tolerance);
    function quadrant(x, y) {
      const low = [Infinity, Infinity, Infinity], high = [-Infinity, -Infinity, -Infinity];
      const sum = [0, 0, 0], count = [0, 0, 0];
      for (let yy = y; yy < y + 4; yy++) for (let xx = x; xx < x + 4; xx++) {
        const k = channel(xx, yy), value = raw[yy * width + xx];
        // Infrared is independent of visible color and cannot validate an RGB plateau.
        if (k < 0) continue;
        low[k] = Math.min(low[k], value); high[k] = Math.max(high[k], value);
        if (high[k] - low[k] > tolerance) return null;
        sum[k] += value; count[k]++;
      }
      return sum.map((value, k) => value / count[k]);
    }
    function record(bx, by, regions, region, anchors = [{ x: bx, y: by }], radius = rgbir ? 4 : 3) {
      // Use the validated visible-color model for policy selection, including
      // corners whose anchor happens to be an IR pixel in the original mosaic.
      // Equally near foreground sites share their strongest directions; taking
      // the first site would bias independently configured direction groups.
      const edges = anchors.map(anchor => Demosaic.detect((x, y) => regions[region(x, y)], anchor.x, anchor.y));
      const strength = Math.max(...edges.map(edge => edge.strength));
      const directions = [...new Set(edges.filter(edge => strength - edge.strength <= 1e-7).flatMap(edge => edge.directions))];
      const edge = { strength, directions };
      const policy = Demosaic.strategy(coefficients, edge), mix = (1 - policy.uniform) * Math.min(1, policy.edgePower);
      // An IR corner has no direct RGB evidence and can admit adjacent fits.
      // Break those ties using the original 2x2 cell, as for straight RGB-IR
      // edges; equal-priority conflicts remain unresolved, independent of scan order.
      const priority = rgbir ? Number(bx % 2 === 0) + Number(by % 2 === 0) : 0;
      // RGB-IR resampling and residual transport extend the affected stencil
      // by one pixel. Stay within the quadrants already validated from raw data.
      for (let y = by - radius; y < by + radius; y++) for (let x = bx - radius; x < bx + radius; x++) {
        const i = y * width + x, color = regions[region(x, y)];
        const previous = corners.get(i);
        if (!previous || priority > previous.priority) corners.set(i, { color, mix, priority, count: 1 });
        else if (priority === previous.priority && previous.color) {
          if (!close(previous.color, color)) previous.color = null;
          else {
            // Compatible geometric fits also share their coefficient policy,
            // rather than retaining the first model's direction-dependent mix.
            const count = previous.count + 1;
            previous.color = color.map((v, k) => (previous.color[k] * previous.count + v) / count);
            previous.mix = (previous.mix * previous.count + mix) / count;
            previous.count = count;
          }
        }
      }
    }
    function rotated(bx, by) {
      if (bx < 6 || by < 6 || bx + 6 > width || by + 6 > height) return;
      // A diagonal stencil has a larger axis-aligned footprint. Correct an
      // 8x8 area while keeping the entire correction inside its 12x12 evidence.
      for (const fit of directionalCornerFits(raw, width, pattern, bx, by, tolerance)) record(bx, by, fit.colors, fit.region, fit.anchors, 4);
    }
    for (let by = 4; by <= height - 4; by++) for (let bx = 4; bx <= width - 4; bx++) {
      // Reject flat areas and single edges before fitting any quadrant model.
      let crossing = false;
      // Search one extra visible phase around IR anchors: the immediately
      // adjacent corner pixel may be I and provide no visible edge evidence.
      for (let dy = first; dy <= last && !crossing; dy++) for (let dx = first; dx <= last; dx++) {
        if (channel(bx + dx, by + dy) < 0) continue;
        const i = (by + dy) * width + bx + dx;
        // Include the center: both endpoints can be background at an acute
        // tip, so an endpoint-only gradient would miss a genuine corner.
        if (Math.max(Math.abs(raw[i] - raw[i - 2]), Math.abs(raw[i] - raw[i + 2])) > 8 * tolerance
          && Math.max(Math.abs(raw[i] - raw[i - 2 * width]), Math.abs(raw[i] - raw[i + 2 * width])) > 8 * tolerance) crossing = true;
      }
      if (!crossing) continue;
      const regions = [];
      for (let q = 0; q < 4; q++) {
        const color = quadrant(bx + (q % 2 ? 0 : -4), by + (q >= 2 ? 0 : -4));
        if (!color) break;
        regions.push(color);
      }
      if (regions.length !== 4) { rotated(bx, by); continue; }
      const foreground = regions.findIndex((color, q) => {
        const others = regions.filter((_, k) => k !== q);
        return close(others[0], others[1]) && close(others[0], others[2])
          && color.filter((value, k) => Math.abs(value - others[0][k]) > 8 * tolerance).length >= 2;
      });
      if (foreground < 0) { rotated(bx, by); continue; }
      record(bx, by, regions, (x, y) => Number(x >= bx) + 2 * Number(y >= by));
    }
    return corners;
  }
  // Apply corner evidence after reconstruction so later resampling/residual
  // stages cannot blur it again. Original measured channels stay untouched.
  function cornerInterpolator(initial, corners, width, pattern) {
    return (x, y, channel) => {
      const value = initial(x, y, channel), corner = corners.get(y * width + x);
      if (!corner?.color || pattern[(y % 2) * 2 + x % 2] === channel) return value;
      return value + corner.mix * (corner.color['RGB'.indexOf(channel)] - value);
    };
  }
  // Hamilton-Adams directional green reconstruction (section 3), followed by
  // cross-channel edge-weighted color differences. Independently implemented:
  // https://www.ipol.im/pub/art/2021/358/
  // The refinement uses the intra/inter-channel edge-preservation principle of
  // https://doi.org/10.1007/s10851-024-01204-y, not its full iterative optimizer.
  // Only Bayer layouts have the alternating green samples this method requires.
  function bayerInterpolator(raw, width, height, pattern, sampleStep, coefficients, sampleConfidence) {
    const corners = cfaCorners(raw, width, height, pattern, sampleStep, coefficients);
    const green = new Float32Array(raw.length);
    const sampleFloor = Math.max(sampleStep, 1e-7), regularizer = coefficients.regularization * sampleFloor ** 2;
    // Reflect about the outer sample: unlike clamping, this preserves CFA parity.
    // The caller uses the general interpolator for one-row/one-column images.
    function reflect(value, size) {
      while (value < 0 || value >= size) value = value < 0 ? -value : 2 * (size - 1) - value;
      return value;
    }
    const index = (x, y) => reflect(y, height) * width + reflect(x, width);
    const sample = (x, y) => raw[index(x, y)];
    const channelAt = (x, y) => pattern[(y % 2) * 2 + x % 2];
    // Treat floating-point roundoff as a tie rather than introducing a direction bias.
    const choose = (a, b, da, db) => Math.abs(da - db) <= 1e-7 ? (a + b) / 2 : da < db ? a : b;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = y * width + x, center = raw[i];
      if (channelAt(x, y) === 'G') { green[i] = center; continue; }
      const left = raw[index(x - 1, y)], right = raw[index(x + 1, y)];
      const top = raw[index(x, y - 1)], bottom = raw[index(x, y + 1)];
      const curvatureH = 2 * center - raw[index(x - 2, y)] - raw[index(x + 2, y)];
      const curvatureV = 2 * center - raw[index(x, y - 2)] - raw[index(x, y + 2)];
      const gradientH = Math.abs(left - right) + Math.abs(curvatureH);
      const gradientV = Math.abs(top - bottom) + Math.abs(curvatureV);
      const h = (left + right) / 2 + curvatureH / 4, v = (top + bottom) / 2 + curvatureV / 4;
      const edge = Demosaic.detect(sample, x, y);
      edge.strength = Math.max(edge.strength, gradientH, gradientV);
      const policy = Demosaic.strategy(coefficients, edge);
      const wh = 1 + policy.tangentBias * Demosaic.alignment(edge, 1, 0);
      const wv = 1 + policy.tangentBias * Demosaic.alignment(edge, 0, 1);
      const directed = choose(h, v, gradientH / wh, gradientV / wv);
      green[i] = directed + policy.uniform * ((h + v) / 2 - directed);
    }
    if ((coefficients.antiAlias || Demosaic.defaults.antiAlias).enabled) {
      // Protect the complete downstream stencil around evidence-backed corners.
      const protectedPixels = new Uint8Array(raw.length);
      for (const i of corners.keys()) {
        const x = i % width, y = Math.floor(i / width);
        for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) protectedPixels[index(x + dx, y + dy)] = 1;
      }
      Demosaic.stabilizeGreen(raw, width, height, pattern, green, sampleStep, protectedPixels, coefficients, sampleConfidence);
    }
    function initial(x, y, channel) {
      const i = y * width + x, measured = channelAt(x, y);
      if (channel === measured) return raw[i];
      if (channel === 'G') return green[i];
      const center = green[i];
      if (measured === 'G') {
        const horizontal = pattern[(y % 2) * 2 + (1 - x % 2)] === channel;
        const a = index(x - (horizontal ? 1 : 0), y - (horizontal ? 0 : 1));
        const b = index(x + (horizontal ? 1 : 0), y + (horizontal ? 0 : 1));
        return center + ((raw[a] - green[a]) + (raw[b] - green[b])) / 2;
      }
      const nw = index(x - 1, y - 1), se = index(x + 1, y + 1);
      const ne = index(x + 1, y - 1), sw = index(x - 1, y + 1);
      const curvatureP = 2 * center - green[nw] - green[se];
      const curvatureN = 2 * center - green[ne] - green[sw];
      return choose((raw[nw] + raw[se] + curvatureP) / 2, (raw[ne] + raw[sw] + curvatureN) / 2,
        Math.abs(raw[nw] - raw[se]) + Math.abs(curvatureP), Math.abs(raw[ne] - raw[sw]) + Math.abs(curvatureN));
    }
    // Frozen first-pass guides avoid scan-order feedback. Keep only three rows
    // of each chroma guide, since refinement visits immediate CFA neighbors.
    const guides = { R: new Float32Array(width * 3), B: new Float32Array(width * 3) };
    const guideRows = [-1, -1, -1];
    function prepareRow(y) {
      const slot = y % 3;
      if (guideRows[slot] === y) return;
      for (let x = 0; x < width; x++) {
        guides.R[slot * width + x] = initial(x, y, 'R');
        guides.B[slot * width + x] = initial(x, y, 'B');
      }
      guideRows[slot] = y;
    }
    function refine(x, y, channel) {
      const i = y * width + x, measured = channelAt(x, y);
      if (channel === measured) return raw[i];
      if (channel === 'G') return green[i];
      prepareRow(y);
      const other = guides[channel === 'R' ? 'B' : 'R'];
      const center = green[i], anchor = other[(y % 3) * width + x];
      const horizontal = pattern[(y % 2) * 2 + (1 - x % 2)] === channel;
      function edgeConfidence(dx, dy) {
        const a = index(x - dx, y - dy), b = index(x + dx, y + dy);
        const aa = index(x - 3 * dx, y - 3 * dy), bb = index(x + 3 * dx, y + 3 * dy);
        const da = raw[a] - green[a], db = raw[b] - green[b];
        const jump = Math.abs(da - db);
        const variation = Math.abs(da - (raw[aa] - green[aa])) + Math.abs(db - (raw[bb] - green[bb]));
        // Sharpen only a supported discontinuity, not a smooth color ramp or texture.
        return Math.max(0, (jump - coefficients.variationPenalty * variation) / (jump + variation + sampleFloor));
      }
      const confidence = measured === 'G' ? edgeConfidence(horizontal ? 1 : 0, horizontal ? 0 : 1)
        : Math.max(edgeConfidence(1, 1), edgeConfidence(1, -1));
      const baseline = guides[channel][(y % 3) * width + x];
      if (!confidence) return baseline;
      const edge = Demosaic.detect((xx, yy) => {
        const j = index(xx, yy);
        // A vector avoids cancellation between opposite color changes. The
        // other chroma guide detects boundaries absent from the measured phase.
        return [raw[j], green[j], initial(reflect(xx, width), reflect(yy, height), channel === 'R' ? 'B' : 'R')];
      }, x, y);
      const policy = Demosaic.strategy(coefficients, edge);
      let sum = 0, weights = 0;
      const candidates = [];
      function add(dx, dy) {
        const xx = reflect(x + dx, width), yy = reflect(y + dy, height), j = yy * width + xx;
        prepareRow(yy);
        // Use G and the OTHER chroma channel to avoid reinforcing the missing
        // channel's own blurred estimate. This also detects constant-G color edges.
        const dg = center - green[j], dc = anchor - other[(yy % 3) * width + xx];
        // The sample-step floor keeps flat/ambiguous regions balanced and finite.
        const weight = Math.pow(regularizer / (regularizer + dg * dg + dc * dc), policy.edgePower)
          * (1 + policy.tangentBias * Demosaic.alignment(edge, dx, dy));
        candidates.push({ weight, value: raw[j] - green[j] });
        weights += weight;
      }
      if (measured === 'G') {
        if (horizontal) { add(-1, 0); add(1, 0); } else { add(0, -1); add(0, 1); }
      } else { add(-1, -1); add(1, 1); add(1, -1); add(-1, 1); }
      for (const candidate of candidates) sum += ((1 - policy.uniform) * candidate.weight / weights + policy.uniform / candidates.length) * candidate.value;
      return baseline + confidence * (center + sum - baseline);
    }
    return cornerInterpolator(refine, corners, width, pattern);
  }
  // Each RGB-IR channel has one sample per 2x2 tile. Interpolate on its
  // original lattice, clamping to that channel's phase at the image borders.
  // When a candidate value is supplied, limit it to the local measured range.
  function rgbirLatticeReader(raw, width, height, pattern) {
    const phase = Object.fromEntries([...pattern].map((channel, i) => [channel, [i % 2, Math.floor(i / 2)]]));
    return function (channel, x, y, candidate) {
      const [px, py] = phase[channel];
      if (px >= width || py >= height) return 0;
      const lastX = px + 2 * Math.floor((width - 1 - px) / 2), lastY = py + 2 * Math.floor((height - 1 - py) / 2);
      const ax = Math.max(px, Math.min(lastX, px + 2 * Math.floor((x - px) / 2)));
      const ay = Math.max(py, Math.min(lastY, py + 2 * Math.floor((y - py) / 2)));
      const bx = Math.min(lastX, ax + 2), by = Math.min(lastY, ay + 2);
      const wx = Math.max(0, Math.min(1, (x - ax) / 2)), wy = Math.max(0, Math.min(1, (y - ay) / 2));
      const topLeft = raw[ay * width + ax], topRight = raw[ay * width + bx];
      const bottomLeft = raw[by * width + ax], bottomRight = raw[by * width + bx];
      if (candidate !== undefined) {
        // On a sample row/column, zero-weight corners must not widen the range.
        const right = wx ? topRight : topLeft, bottom = wy ? bottomLeft : topLeft;
        const diagonal = wy ? (wx ? bottomRight : bottomLeft) : right;
        return Math.max(Math.min(topLeft, right, bottom, diagonal), Math.min(Math.max(topLeft, right, bottom, diagonal), candidate));
      }
      const top = topLeft * (1 - wx) + topRight * wx;
      const bottom = bottomLeft * (1 - wx) + bottomRight * wx;
      return top * (1 - wy) + bottom * wy;
    };
  }
  // Resampling onto Bayer can blur a chroma-only edge. Restoring just the
  // measured pixels leaves alternating raw/interpolated rows. Propagate the
  // reconstruction residual on the ORIGINAL visible-channel lattices so both
  // row phases agree, without smoothing or moving the measured samples.
  function rgbirResidualInterpolator(initial, raw, width, height, pattern) {
    // Freeze residuals before applying them, so reconstruction does not depend on scan order.
    const residual = new Float32Array(raw.length);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const channel = pattern[(y % 2) * 2 + x % 2];
      if (channel !== 'I') residual[y * width + x] = raw[y * width + x] - initial(x, y, channel);
    }
    const read = rgbirLatticeReader(residual, width, height, pattern);
    const bounded = rgbirLatticeReader(raw, width, height, pattern);
    // A transported residual can overshoot even when the initial estimate is
    // already correct. Enforce the original samples' local range to avoid
    // bright/dark bands on the two sides of an edge.
    return (x, y, channel) => bounded(channel, x, y, initial(x, y, channel) + read(channel, x, y));
  }
  // At a sharp, straight edge, an unmeasured chroma position may have no
  // evidence favoring either side. Avoid inventing a third-color band by
  // assigning a tied estimate to its original 2x2 sample cell. This is a
  // reconstruction convention, not proof of the sub-cell edge position.
  function rgbirEdgeInterpolator(initial, raw, width, height, pattern, sampleStep, coefficients) {
    const read = rgbirLatticeReader(raw, width, height, pattern);
    const floor = Math.max(sampleStep, 1e-7);
    const color = (x, y) => ['R', 'G', 'B'].map(channel => read(channel, x, y));
    const distance = (a, b) => Math.hypot(...a.map((value, i) => value - b[i]));
    return function (x, y, channel) {
      const value = initial(x, y, channel), phase = pattern.indexOf(channel);
      const proposals = [];
      for (const [dx, dy, position, parity, size] of [[1, 0, x, phase % 2, width], [0, 1, y, Math.floor(phase / 2), height]]) {
        // A measured coordinate already anchors this axis; border extensions
        // cannot establish flat plateaus on both sides of an unknown edge.
        if (position % 2 === parity || position < 3 || position + 3 >= size) continue;
        const a = read(channel, x - dx, y - dy), b = read(channel, x + dx, y + dy);
        // Share confidence across RGB: independent channel thresholds can make
        // a weak red edge flicker between rows beside a strong blue edge.
        const left = color(x - dx, y - dy), right = color(x + dx, y + dy);
        const jump = distance(left, right), channelJump = Math.abs(b - a);
        const variation = distance(left, color(x - 3 * dx, y - 3 * dy))
          + distance(right, color(x + 3 * dx, y + 3 * dy));
        if (jump <= coefficients.variationPenalty * variation + 4 * floor) continue;
        // Require a stable tangent neighborhood. Diagonals, corners and fine
        // textures retain directional Bayer/residual interpolation instead.
        let stable = true;
        for (const step of [-2, 2]) {
          const xx = x - dy * step, yy = y + dx * step;
          if (distance(color(xx - dx, yy - dy), left)
            + distance(color(xx + dx, yy + dy), right) > jump / 4) stable = false;
        }
        if (!stable) continue;
        // Keep a well-supported side; only central/ambiguous estimates use
        // sample-cell ownership. The same rule applies to both edge polarities.
        const target = Math.abs(value - (a + b) / 2) <= channelJump / 4
          ? (position % 2 ? a : b) : (Math.abs(value - a) < Math.abs(value - b) ? a : b);
        const edge = Demosaic.detect(color, x, y);
        const policy = Demosaic.strategy(coefficients, edge);
        const confidence = Math.max(0, 1 - coefficients.variationPenalty * variation / jump);
        const mix = confidence * (1 - policy.uniform) * Math.min(1, policy.edgePower);
        proposals.push(value + mix * (target - value));
      }
      if (!proposals.length) return value;
      // Conflicting axis proposals imply an unresolved corner; do not choose
      // an axis merely because it happened to be visited first.
      if (proposals.length === 2 && Math.abs(proposals[0] - proposals[1]) > 2 * floor) return value;
      return read(channel, x, y, proposals.reduce((sum, v) => sum + v, 0) / proposals.length);
    };
  }
  // Reconstruct visible green independently of IR, then resample the visible
  // channels onto a Bayer lattice anchored at the original red phase. RGBI is
  // not Bayer after I -> G alone: its blue phase also needs spatial resampling.
  function rgbirBayer(raw, width, height, pattern, sampleStep, coefficients) {
    const phase = Object.fromEntries([...pattern].map((channel, i) => [channel, [i % 2, Math.floor(i / 2)]]));
    const floor = Math.max(sampleStep, 1e-7);
    // Clamp to the requested channel's parity, never to an adjacent channel at an image edge.
    function axis(position, start, size) {
      if (start >= size) return [];
      const last = start + 2 * Math.floor((size - 1 - start) / 2);
      const a = Math.max(start, Math.min(last, start + 2 * Math.floor((position - start) / 2)));
      const b = Math.min(last, a + 2), mix = Math.max(0, Math.min(1, (position - a) / 2));
      return a === b || mix === 0 ? [[a, 1]] : [[a, 1 - mix], [b, mix]];
    }
    function candidates(channel, x, y) {
      const [px, py] = phase[channel], result = [];
      for (const [yy, wy] of axis(y, py, height)) for (const [xx, wx] of axis(x, px, width)) {
        if (wx * wy) result.push({ x: xx, y: yy, weight: wx * wy, value: raw[yy * width + xx] });
      }
      return result;
    }
    const linear = rgbirLatticeReader(raw, width, height, pattern);
    function guided(channel, x, y, guides) {
      const points = candidates(channel, x, y);
      if (points.length < 2) return points[0]?.value || 0;
      // Compare visible-channel guides only; IR intensity must never steer visible color weights.
      const distances = points.map(() => 0);
      for (const guide of guides) {
        const center = guide(x, y), values = points.map(p => guide(p.x, p.y));
        const span = Math.max(...values) - Math.min(...values);
        if (span <= 2 * floor) continue;
        // A guide halfway between both sides cannot locate this edge. Avoid
        // letting such blurred guides drown out another channel's exact edge.
        const nearest = Math.min(...values.map(v => Math.abs(v - center)));
        const confidence = Math.max(0, 1 - 2 * nearest / span);
        for (let i = 0; i < points.length; i++) distances[i] += confidence * ((values[i] - center) / span) ** 2;
      }
      const edge = Demosaic.detect((xx, yy) => guides.map(guide => guide(xx, yy)), x, y);
      const policy = Demosaic.strategy(coefficients, edge);
      let sum = 0, weights = 0, baseline = 0;
      for (let i = 0; i < points.length; i++) {
        const p = points[i], tangent = 1 + policy.tangentBias * Demosaic.alignment(edge, p.x - x, p.y - y);
        const weight = p.weight * tangent / (0.001 * coefficients.regularization + distances[i]) ** policy.edgePower;
        sum += p.value * weight; weights += weight; baseline += p.weight * p.value;
      }
      return policy.uniform * baseline + (1 - policy.uniform) * sum / weights;
    }
    // Finish green everywhere before resampling chroma, including green at original IR positions.
    const green = new Float32Array(raw.length);
    const visibleGuides = ['R', 'B'].map(channel => (x, y) => linear(channel, x, y));
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) green[y * width + x] = guided('G', x, y, visibleGuides);
    const greenAt = (x, y) => green[Math.max(0, Math.min(height - 1, y)) * width + Math.max(0, Math.min(width - 1, x))];
    // Anchor the virtual Bayer tile at R and resample B when the original tile is not Bayer-compatible.
    const bayerPattern = ['RGGB', 'GRBG', 'GBRG', 'BGGR'][pattern.indexOf('R')];
    const mosaic = new Float32Array(raw.length), confidence = new Uint8Array(raw.length);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const channel = bayerPattern[(y % 2) * 2 + x % 2];
      // A reconstructed virtual sample cannot carry the same evidence as an original measurement.
      confidence[y * width + x] = Number(pattern[(y % 2) * 2 + x % 2] === channel);
      mosaic[y * width + x] = channel === 'G' ? greenAt(x, y)
        : guided(channel, x, y, [greenAt, (xx, yy) => linear(channel === 'R' ? 'B' : 'R', xx, yy)]);
    }
    return { raw: mosaic, pattern: bayerPattern, confidence };
  }
  function decode(bytes, c, coefficients, { preview = false } = {}) {
    const info = analyze(c, c.offset + bytes.length);
    if (!info.valid) throw new Error(Object.values(info.errors)[0]);
    // IR-only output reads one original IR sample per complete 2x2 tile, with no demosaicing.
    if (c.format === 'CFA' && isRgbir(c) && c.display === 'ir') {
      const width = Math.floor(c.width / 2), height = Math.floor(c.height / 2);
      if (!width || !height) throw new Error(t('error.irDimensions'));
      const rgba = new Uint8ClampedArray(width * height * 4), read = sampleReader(bytes, c);
      const index = cleanPattern(c.pattern).indexOf('I'), dx = index % 2, dy = Math.floor(index / 2);
      const white = c.white || 2 ** c.bitDepth - 1;
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const value = (read(info.planes[0], x * 2 + dx, y * 2 + dy) - c.black) / (white - c.black);
        const gray = clamp(255 * Math.pow(Math.max(0, Math.min(1, value * 2 ** c.exposure)), 1 / c.gamma));
        const i = (y * width + x) * 4;
        rgba[i] = rgba[i + 1] = rgba[i + 2] = gray; rgba[i + 3] = 255;
      }
      return { width, height, rgba, info };
    }
    const side = c.format === 'CFA' && isRgbir(c) && c.display === 'side';
    const width = c.width * (side ? 2 : 1), height = c.height;
    const rgba = new Uint8ClampedArray(width * height * 4), read = sampleReader(bytes, c);
    const peak = 2 ** c.bitDepth - 1;
    const gain = 2 ** c.exposure, invGamma = 1 / c.gamma;
    const tone = v => clamp(255 * Math.pow(Math.max(0, Math.min(1, v * gain)), invGamma));
    function put(x, y, r, g, b) { const i = (y * width + x) * 4; rgba[i] = r; rgba[i + 1] = g; rgba[i + 2] = b; rgba[i + 3] = 255; }
    if (c.format === 'YUV') {
      const p = Object.fromEntries(info.planes.map(v => [v.name, v]));
      const [kr, kb] = c.matrix === '601' ? [0.299, 0.114] : c.matrix === '2020' ? [0.2627, 0.0593] : [0.2126, 0.0722];
      const kg = 1 - kr - kb, scale = 2 ** (c.bitDepth - 8);
      for (let y = 0; y < height; y++) for (let x = 0; x < c.width; x++) {
        let yy = 0, u = 2 ** (c.bitDepth - 1), v = u;
        const cx = c.subsampling === '444' ? x : Math.floor(x / 2), cy = c.subsampling === '420' ? Math.floor(y / 2) : y;
        if (!p.packed) {
          if (p.Y) yy = read(p.Y, x, y);
          if (p.U) { u = read(p.U, cx, cy); v = read(p.V, cx, cy); }
          else if (p.UV) {
            const uv = c.layout === 'semi-uv'; u = read(p.UV, 2 * cx + (uv ? 0 : 1), cy); v = read(p.UV, 2 * cx + (uv ? 1 : 0), cy);
          }
        } else {
          const order = c.layout;
          if (c.subsampling === '422') {
            const base = cx * 4, ys = [...order].map((v, i) => v === 'Y' ? i : -1).filter(i => i >= 0);
            yy = read(p.packed, base + ys[x % 2], y); u = read(p.packed, base + order.indexOf('U'), y); v = read(p.packed, base + order.indexOf('V'), y);
          } else { yy = read(p.packed, x * 3 + order.indexOf('Y'), y); u = read(p.packed, x * 3 + order.indexOf('U'), y); v = read(p.packed, x * 3 + order.indexOf('V'), y); }
        }
        const luma = c.yuvDisplay === 'chroma' ? 0.5 : c.range === 'limited' ? (yy / scale - 16) / 219 : yy / peak;
        const cb = c.yuvDisplay === 'luma' ? 0 : c.range === 'limited' ? (u / scale - 128) / 224 : (u - 2 ** (c.bitDepth - 1)) / peak;
        const cr = c.yuvDisplay === 'luma' ? 0 : c.range === 'limited' ? (v / scale - 128) / 224 : (v - 2 ** (c.bitDepth - 1)) / peak;
        put(x, y, tone(luma + 2 * (1 - kr) * cr), tone(luma - 2 * kb * (1 - kb) / kg * cb - 2 * kr * (1 - kr) / kg * cr), tone(luma + 2 * (1 - kb) * cb));
      }
    } else {
      const pattern = cleanPattern(c.pattern), tw = 2, th = 2, radius = 2;
      const raw = new Float32Array(c.width * height), white = c.white || peak;
      for (let y = 0; y < height; y++) for (let x = 0; x < c.width; x++) raw[y * c.width + x] = (read(info.planes[0], x, y) - c.black) / (white - c.black);
      const rgbir = isRgbir(c), sampleStep = 1 / (white - c.black);
      const settings = Demosaic.validate(coefficients || Demosaic.defaults);
      // The temporary preview uses local sample interpolation without expensive edge/corner reconstruction.
      const visible = !preview && rgbir && c.width >= 2 && height >= 2 ? rgbirBayer(raw, c.width, height, pattern, sampleStep, settings) : { raw, pattern };
      let bayer = !preview && c.width >= 2 && height >= 2 && ['RGGB', 'BGGR', 'GRBG', 'GBRG'].includes(visible.pattern)
        ? bayerInterpolator(visible.raw, c.width, height, visible.pattern, sampleStep, settings, visible.confidence) : null;
      // Correct virtual-lattice errors before display; the correction also bounds edge overshoot.
      if (rgbir && bayer) {
        bayer = rgbirResidualInterpolator(bayer, raw, c.width, height, pattern);
        bayer = rgbirEdgeInterpolator(bayer, raw, c.width, height, pattern, sampleStep, settings);
        // Fit corners on original RGB sites, not the already resampled Bayer
        // mosaic; otherwise missing green/chroma have already mixed both sides.
        bayer = cornerInterpolator(bayer, cfaCorners(raw, c.width, height, pattern, sampleStep, settings), c.width, pattern);
      }
      const kernels = [];
      for (let py = 0; py < th; py++) for (let px = 0; px < tw; px++) {
        const entry = {};
        for (const channel of isRgbir(c) ? 'RGBI' : 'RGB') {
          const offsets = [];
          for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
            if (pattern[((py + dy + th * 2) % th) * tw + ((px + dx + tw * 2) % tw)] === channel) offsets.push({ dx, dy, d: dx * dx + dy * dy });
          }
          entry[channel] = offsets.sort((a, b) => a.d - b.d);
        }
        kernels.push(entry);
      }
      function interpolate(x, y, channel) {
        if (bayer && channel !== 'I') {
          // Preserve measured visible samples at their original sensor positions.
          if (rgbir && pattern[(y % 2) * 2 + x % 2] === channel) return raw[y * c.width + x];
          return bayer(x, y, channel);
        }
        const kernel = kernels[(y % th) * tw + x % tw][channel];
        let sum = 0, weight = 0, count = 0, last = -1;
        for (const k of kernel) {
          if (count >= 4 && k.d > last) break;
          const xx = x + k.dx, yy = y + k.dy;
          if (xx < 0 || xx >= c.width || yy < 0 || yy >= height) continue;
          if (k.d === 0) return raw[yy * c.width + xx];
          const w = 1 / k.d; sum += raw[yy * c.width + xx] * w; weight += w; count++; last = k.d;
        }
        return weight ? sum / weight : 0;
      }
      for (let y = 0; y < height; y++) for (let x = 0; x < c.width; x++) {
        let r = interpolate(x, y, 'R'), g = interpolate(x, y, 'G'), b = interpolate(x, y, 'B');
        if (isRgbir(c)) {
          const ir = interpolate(x, y, 'I');
          if (c.display === 'ir') r = g = b = ir;
          else if (c.display === 'blend') { r = r * (1 - c.alpha) + ir * c.alpha; g = g * (1 - c.alpha) + ir * c.alpha; b = b * (1 - c.alpha) + ir * c.alpha; }
          else if (side) put(x + c.width, y, tone(ir), tone(ir), tone(ir));
        }
        put(x, y, tone(r), tone(g), tone(b));
      }
    }
    return { width, height, rgba, info };
  }
  return { MAX_BYTES, MAX_PIXELS, layouts, yuvPresets, yuvPresetConfig, filenameHints, yuvLayouts, yuvDisplays, extension, kind, defaults, cleanPattern, isRgbir, containerBits, analyze, sequence, sampleReader, pixelReader, decode };
});
