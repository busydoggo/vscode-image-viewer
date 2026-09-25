'use strict';
const I18n = SensorI18n;
const { t } = I18n;
const vscode = acquireVsCodeApi();
const Core = SensorCore;
const app = document.getElementById('app');
let entry;
let timer;
let pending = {};
const fields = {};
const groups = {};

function element(tag, className, text) { const el = document.createElement(tag); if (className) el.className = className; if (text !== undefined) el.textContent = text; return el; }
const empty = element('div', 'empty-inspector');
empty.append(element('span', 'eyebrow', t('app.eyebrow')), element('h2', '', t('empty.title')), element('p', 'muted', t('empty.hint')));
app.append(empty);
const content = element('main'); content.hidden = true; app.append(content);
const meta = element('dl', 'metadata'); content.append(meta);
const sizeInfo = element('div', 'size-info'); sizeInfo.setAttribute('aria-live', 'polite'); content.append(sizeInfo);
const fileError = element('p', 'field-error'); content.append(fileError);
const encodedNote = element('p', 'callout', t('encoded.hint')); content.append(encodedNote);
const form = element('form'); form.addEventListener('submit', e => e.preventDefault()); content.append(form);

function section(id, title, subtitle) {
  const s = element('section', 'property-section'); s.id = id;
  s.append(element('h3', '', title)); if (subtitle) s.append(element('p', 'muted section-note', subtitle));
  form.append(s); groups[id] = s; return s;
}
function field(parent, key, title, type, options, hint) {
  const row = element('div', 'field'); const label = element('label', '', title); label.htmlFor = key; row.append(label);
  const input = element(type === 'select' ? 'select' : 'input'); input.id = key; input.name = key;
  if (type === 'select') for (const option of options) { const [value, label] = Array.isArray(option) ? option : [option, option]; const o = element('option', '', label); o.value = value; input.append(o); }
  else { input.type = type; if (type === 'number') { input.step = ['alpha', 'gamma', 'exposure'].includes(key) ? '0.1' : '1'; input.min = ['width', 'height'].includes(key) ? '1' : key === 'bitDepth' ? '4' : key === 'exposure' ? '-10' : '0'; if (key === 'bitDepth') input.max = '32'; } }
  row.append(input); const error = element('span', 'field-error'); error.id = key + '-error'; error.setAttribute('aria-live', 'polite'); row.append(error); input.setAttribute('aria-describedby', error.id);
  if (hint) row.append(element('span', 'field-hint', hint));
  parent.append(row); fields[key] = { row, label, input, error };
  input.addEventListener(type === 'select' ? 'change' : 'input', () => change(key, type === 'number' ? (input.value === '' ? null : Number(input.value)) : input.value));
  return row;
}
// Share delayed, keyboard-accessible help between compact inline fields without shifting the form.
function fieldHelp(key, paragraphs) {
  const { label, input } = fields[key];
  const tooltip = element('div', 'field-tooltip'); tooltip.id = key + '-help'; tooltip.role = 'tooltip'; tooltip.hidden = true;
  for (const text of paragraphs) tooltip.append(element('p', '', text));
  document.body.append(tooltip);
  label.classList.add('help-label'); label.tabIndex = 0;
  label.setAttribute('aria-describedby', tooltip.id);
  input.setAttribute('aria-describedby', `${input.getAttribute('aria-describedby')} ${tooltip.id}`);
  let showTimer, hideTimer;
  function hide() { clearTimeout(showTimer); clearTimeout(hideTimer); tooltip.hidden = true; }
  function schedule() {
    hide();
    showTimer = setTimeout(() => {
      if (!label.getClientRects().length) return;
      const anchor = label.getBoundingClientRect(), margin = 8, gap = 6;
      const viewportWidth = document.documentElement.clientWidth;
      const below = Math.max(0, window.innerHeight - anchor.bottom - gap - margin);
      const above = Math.max(0, anchor.top - gap - margin);
      tooltip.style.maxWidth = `${Math.max(0, viewportWidth - margin * 2)}px`;
      tooltip.style.maxHeight = `${Math.max(below, above)}px`; tooltip.hidden = false;
      const bounds = tooltip.getBoundingClientRect();
      tooltip.style.left = `${Math.max(margin, Math.min(anchor.left, viewportWidth - bounds.width - margin))}px`;
      tooltip.style.top = `${below >= bounds.height ? anchor.bottom + gap : Math.max(margin, anchor.top - gap - bounds.height)}px`;
    }, 1000);
  }
  function leave() { clearTimeout(showTimer); hideTimer = setTimeout(hide, 150); }
  label.addEventListener('mouseenter', schedule); label.addEventListener('mouseleave', leave);
  label.addEventListener('focus', schedule); label.addEventListener('blur', hide);
  tooltip.addEventListener('mouseenter', () => clearTimeout(hideTimer)); tooltip.addEventListener('mouseleave', hide);
  document.addEventListener('keydown', event => { if (event.key === 'Escape') hide(); });
  window.addEventListener('resize', hide);
  document.addEventListener('scroll', event => { if (!tooltip.contains(event.target)) hide(); }, true);
  document.addEventListener('visibilitychange', () => { if (document.hidden) hide(); });
  return hide;
}
const source = section('source', t('section.source'));
field(source, 'format', t('field.format'), 'select', [['CFA', 'CFA / RAW'], ['YUV', 'YUV']]).classList.add('field-inline');
const presetRow = element('div', 'field field-inline'); const presetLabel = element('label', '', t('field.cfaPreset')); presetLabel.htmlFor = 'cfaPreset';
const cfaPreset = element('select'); cfaPreset.id = 'cfaPreset';
for (const v of ['RGGB', 'BGGR', 'GRBG', 'GBRG', 'RGBI', 'GRIB', 'BIRG', 'IBRG', 'custom']) { const o = element('option', '', v === 'custom' ? t('cfa.custom') : v); o.value = v; cfaPreset.append(o); }
presetRow.append(presetLabel, cfaPreset); source.append(presetRow);
cfaPreset.addEventListener('change', () => { if (cfaPreset.value !== 'custom') patch({ pattern: cfaPreset.value }); });
field(source, 'offset', t('field.offset'), 'number').classList.add('field-inline');
const hideOffsetHelp = fieldHelp('offset', [
  t('help.offset.1'),
  t('help.offset.2'),
  t('help.offset.3'),
  t('help.offset.4')
]);
const dimensions = element('div', 'field-grid'); source.append(dimensions);
field(dimensions, 'width', t('field.width'), 'number'); field(dimensions, 'height', t('field.height'), 'number');


const yuv = section('yuv', t('section.yuv'));
// Use the decoder's presets so displayed names and inferred file settings agree.
const { yuvPresets, yuvPresetConfig } = Core;
const yuvPresetRow = element('div', 'field field-inline'); const ypLabel = element('label', '', t('field.yuvPreset')); ypLabel.htmlFor = 'yuvPreset';
const yp = element('select'); yp.id = 'yuvPreset';
for (const v of ['custom', ...Object.keys(yuvPresets)]) { const o = element('option', '', v === 'custom' ? t('yuv.custom') : v); o.value = v; yp.append(o); }
yuvPresetRow.append(ypLabel, yp); yuv.append(yuvPresetRow);
yp.addEventListener('change', () => { if (yuvPresets[yp.value]) change('yuvPreset', yp.value); else update(); });
field(yuv, 'yuvPlanes', t('field.planes'), 'select', [['yuv', t('planes.yuv')], ['y', t('planes.y')], ['uv', t('planes.uv')]]).classList.add('field-inline');
const yuvHint = element('p', 'field-hint'); yuv.append(yuvHint);
field(yuv, 'subsampling', t('field.subsampling'), 'select', [['400', t('subsampling.luma')], ['420', '4:2:0'], ['422', '4:2:2'], ['444', '4:4:4']]).classList.add('field-inline');
field(yuv, 'matrix', t('field.matrix'), 'select', [['601', 'BT.601'], ['709', 'BT.709'], ['2020', 'BT.2020']]).classList.add('field-inline');
const hideMatrixHelp = fieldHelp('matrix', [
  t('help.matrix.1'),
  t('help.matrix.2'),
  t('help.matrix.3'),
  t('help.matrix.4')
]);
field(yuv, 'range', t('field.range'), 'select', [['limited', t('range.limited')], ['full', t('range.full')]]).classList.add('field-inline');
const hideRangeHelp = fieldHelp('range', [
  t('help.range.1'),
  t('help.range.2'),
  t('help.range.3'),
  t('help.range.4'),
  t('help.range.5')
]);

function layoutName(layout, planes) {
  const orders = { 'planar-uv': 'U → V', 'planar-vu': 'V → U', 'semi-uv': 'UVUV', 'semi-vu': 'VUVU' };
  if (!orders[layout]) return t('layout.packed', { order: layout });
  return t(layout.startsWith('planar') ? 'layout.planar' : 'layout.semi', { order: (planes === 'uv' ? '' : 'Y → ') + orders[layout] });
}
field(yuv, 'layout', t('field.layout'), 'select', []).classList.add('field-inline');

const packing = section('packing', t('section.packing'));
field(packing, 'bitDepth', t('field.bitDepth'), 'number').classList.add('field-inline');
field(packing, 'containerBits', t('field.containerBits'), 'select', [['0', t('container.auto')], ...Array.from({ length: 29 }, (_, i) => i + 4).map(bits => [String(bits), `${bits} bit`])]).classList.add('field-inline');
const hideBitDepthHelp = fieldHelp('bitDepth', [t('help.bitDepth.1'), t('help.bitDepth.2'), t('help.bitDepth.3')]);
const hideContainerHelp = fieldHelp('containerBits', [t('help.containerBits.1'), t('help.containerBits.2'), t('help.containerBits.3'), t('help.containerBits.4')]);
field(packing, 'alignment', t('field.alignment'), 'select', [['lsb', t('alignment.lsb')], ['msb', t('alignment.msb')]]).classList.add('field-inline');
const hideAlignmentHelp = fieldHelp('alignment', [t('help.alignment.1'), t('help.alignment.2'), t('help.alignment.3')]);
field(packing, 'endian', t('field.endian'), 'select', [['little', t('endian.little')], ['big', t('endian.big')]]).classList.add('field-inline');
field(packing, 'chromaPitch', t('field.chromaPitch'), 'number', null, t('hint.chromaPitch'));

const tone = section('tone', t('section.tone'));
const levels = element('div', 'field-grid'); tone.append(levels);
field(levels, 'black', t('field.black'), 'number'); field(levels, 'white', t('field.white'), 'number', null, t('hint.white'));
field(tone, 'exposure', t('field.exposure'), 'number'); field(tone, 'gamma', t('field.gamma'), 'number');
tone.append(element('p', 'muted section-note', t('hint.tone')));

function change(key, value) {
  if (key === 'containerBits') value = Number(value);
  // A container edit must preserve storage: clearing its packed hint breaks a later return to Auto.
  const values = key === 'yuvPreset' ? yuvPresetConfig(value) : { [key]: value };
  if (key === 'yuvPlanes') {
    if (value === 'y') Object.assign(values, { subsampling: '400', layout: 'planar-uv', yuvDisplay: 'luma' });
    else if (value === 'uv') Object.assign(values, { subsampling: entry.config.subsampling === '400' ? '420' : entry.config.subsampling, yuvDisplay: 'chroma' });
  }
  const next = { ...entry.config, ...values };
  if (['subsampling', 'yuvPlanes', 'yuvPreset'].includes(key)) {
    if (!Core.yuvLayouts(next).includes(next.layout)) values.layout = Core.yuvLayouts(next)[0];
    if (!Core.yuvDisplays(next).includes(next.yuvDisplay)) values.yuvDisplay = Core.yuvDisplays(next)[0];
  }
  patch(values);
}
// Update controls immediately, then coalesce rapid edits into one host message.
function patch(values) {
  if (!entry) return;
  Object.assign(entry.config, values); Object.assign(pending, values); update();
  clearTimeout(timer);
  const id = entry.id;
  timer = setTimeout(() => { const values = pending; pending = {}; vscode.postMessage({ type: 'patch', id, patch: values }); }, 200);
}
function flush() { if (entry && Object.keys(pending).length) vscode.postMessage({ type: 'patch', id: entry.id, patch: pending }); clearTimeout(timer); pending = {}; }
function update() {
  const c = entry.config, binary = entry.kind === 'BINARY';
  fileError.textContent = entry.error || ''; fileError.hidden = !entry.error;
  meta.replaceChildren();
  for (const [key, value] of [[t('meta.size'), `${I18n.number(entry.size)} B`], [t('meta.dimensions'), binary ? `${c.width} × ${c.height}` : entry.metadata ? `${entry.metadata.width} × ${entry.metadata.height}` : t('status.reading')]]) { meta.append(element('dt', '', key), element('dd', '', value)); }
  form.hidden = !binary; encodedNote.hidden = binary; sizeInfo.hidden = !binary;
  if (!binary) return;
  presetRow.hidden = c.format !== 'CFA';
  groups.yuv.hidden = c.format !== 'YUV';
  if (groups.yuv.hidden) { hideMatrixHelp(); hideRangeHelp(); }
  // Alignment is relevant only when the container has padding beyond the meaningful pixel bits.
  fields.alignment.row.hidden = !(Core.containerBits(c) > c.bitDepth);
  if (fields.alignment.row.hidden) hideAlignmentHelp();
  for (const option of fields.containerBits.input.options) option.disabled = Number(option.value) !== 0 && Number(option.value) < c.bitDepth;
  fields.chromaPitch.row.hidden = c.format !== 'YUV' || c.subsampling === '400' || !(c.layout.startsWith('planar') || c.layout.startsWith('semi'));
  fields.layout.row.hidden = c.subsampling === '400';
  fields.subsampling.row.hidden = yuvPresetRow.hidden = c.yuvPlanes === 'y';
  fields.black.row.hidden = fields.white.row.hidden = c.format !== 'CFA';
  const allowed = Core.yuvLayouts(c);
  if ([...fields.layout.input.options].map(o => o.value).join() !== allowed.join()) {
    fields.layout.input.replaceChildren();
    for (const layout of allowed) { const o = element('option', '', layoutName(layout, c.yuvPlanes)); o.value = layout; fields.layout.input.append(o); }
  }
  for (const option of fields.layout.input.options) {
    option.textContent = layoutName(option.value, c.yuvPlanes);
  }
  for (const option of fields.subsampling.input.options) option.disabled = c.yuvPlanes === 'uv' && option.value === '400';
  for (const option of yp.options) option.disabled = c.yuvPlanes === 'uv' && yuvPresets[option.value] && !/^(planar|semi)-/.test(yuvPresets[option.value].layout);
  // Derive the selected preset from the full configuration; any mismatch becomes Custom.
  yp.value = Object.keys(yuvPresets).find(name => allowed.includes(yuvPresets[name].layout) && Object.entries(yuvPresetConfig(name)).every(([key, value]) => (key === 'containerBits' ? Core.containerBits(c) : key === 'storage' ? 'unpacked' : c[key]) === value)) || 'custom';
  const hints = [];
  if (c.yuvPlanes === 'uv') hints.push(t('hint.uvDimensions'));
  if (c.yuvDisplay === 'chroma') hints.push(t('hint.chromaPreview'));
  yuvHint.textContent = hints.join(' '); yuvHint.hidden = !hints.length;
  const info = Core.analyze(c, entry.size);
  const sequence = Core.sequence(c, entry.size);
  for (const [key, f] of Object.entries(fields)) {
    // Preserve the literal Auto value (0), including for packed data, when host state is echoed back.
    if (document.activeElement !== f.input) f.input.value = c[key] ?? '';
    f.error.textContent = info.errors[key] || ''; f.error.hidden = !info.errors[key]; f.input.setAttribute('aria-invalid', String(!!info.errors[key]));
  }
  sizeInfo.classList.toggle('invalid', !info.valid);
  sizeInfo.textContent = sequence.enabled
    ? t('size.sequence', { count: I18n.number(sequence.frameCount), bytes: I18n.number(sequence.frameBytes) }) + (sequence.remainderBytes ? t('size.partialTail', { bytes: I18n.number(sequence.remainderBytes) }) : '')
    : info.requiredBytes ? t('size.read', { required: I18n.number(info.requiredBytes), available: I18n.number(info.availableBytes) }) + (info.trailingBytes ? t('size.tail', { bytes: I18n.number(info.trailingBytes) }) : '') : t('status.parameters');
  cfaPreset.value = [...cfaPreset.options].some(o => o.value === Core.cleanPattern(c.pattern)) ? Core.cleanPattern(c.pattern) : 'custom';
}
window.addEventListener('message', event => {
  const message = event.data; if (message.type !== 'state') return;
  if (entry?.id !== message.entry?.id) { hideOffsetHelp(); hideMatrixHelp(); hideRangeHelp(); hideBitDepthHelp(); hideContainerHelp(); hideAlignmentHelp(); flush(); if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); }
  entry = message.entry;
  empty.hidden = !!entry; content.hidden = !entry;
  if (entry) { Object.assign(entry.config, pending); update(); }
});
vscode.postMessage({ type: 'ready' });

let lastActivitySent = -Infinity;
function reportActivity() {
  const now = performance.now();
  if (now - lastActivitySent >= 150) { lastActivitySent = now; vscode.postMessage({ type: 'activity' }); }
}
for (const type of ['pointermove', 'pointerdown', 'wheel', 'keydown']) document.addEventListener(type, reportActivity, { passive: true });
