'use strict';
const { t, th } = SensorI18n;
const vscode = acquireVsCodeApi();
const { icon } = ViewerToolbar;
function toolbarButton(id, label, help = label) {
  return `<button id="${id}" aria-label="${th(label)}" data-tooltip="${th(help)}">${icon(id)}</button>`;
}
document.getElementById('app').innerHTML = `
  <header class="viewer-toolbar">
    <div class="tools">${toolbarButton('fit', 'viewer.fit', 'viewer.fitTitle')}<span class="separator"></span>${toolbarButton('minus', 'viewer.zoomOut')}<span id="zoom">100%</span>${toolbarButton('plus', 'viewer.zoomIn')}<span class="separator"></span>${toolbarButton('refresh', 'viewer.reload')}${toolbarButton('properties', 'viewer.properties', 'viewer.propertiesTitle')}${toolbarButton('coefficients', 'viewer.coefficients', 'viewer.coefficientsTitle')}${toolbarButton('jpegRepair', 'viewer.jpegRepair', 'viewer.jpegRepairTitle')}
      <div id="toolbarAlpha" class="toolbar-alpha" hidden><label for="irAlpha" class="toolbar-icon-label" tabindex="0" aria-label="${th('field.alpha')}" data-tooltip="${th('field.alpha')} · ${th('hint.alphaPercent')}">${icon('alpha')}<span class="sr-only">${th('field.alpha')}</span></label><input id="irAlpha" type="range" min="0" max="100" step="1" value="50" data-tooltip="${th('field.alpha')} · ${th('hint.alphaPercent')}"><output id="irAlphaValue" for="irAlpha">50%</output></div>
    </div>
    <div id="toolbarDisplay" class="toolbar-display" hidden><label for="displayChannel" class="toolbar-icon-label" tabindex="0" aria-label="${th('field.display')}" data-tooltip="${th('field.display')}">${icon('display')}<span class="sr-only">${th('field.display')}</span></label><select id="displayChannel" data-tooltip="${th('field.display')}"></select></div>
    <div id="toolbarCfa" class="toolbar-cfa" hidden></div>
  </header>
  <div id="viewport" tabindex="0" aria-label="${th('viewer.canvas')}"><canvas id="canvas" hidden></canvas><div id="pixelGrid" aria-hidden="true" hidden></div><div id="pixelRulers" aria-hidden="true" hidden><canvas id="rulerX"></canvas><canvas id="rulerY"></canvas><span class="ruler-corner">X / Y</span></div><div id="message" role="status"><span class="eyebrow">${th('app.eyebrow')}</span><h2>${th('viewer.loading')}</h2></div><div id="comparison" hidden><span>RGB</span><span>IR</span></div></div>
  <section id="playback" class="playback" aria-label="${th('player.label')}" hidden>
    <div class="playback-controls">
      <button id="play" aria-label="${th('player.play')}" title="${th('player.playTitle')}">${th('player.playButton')}</button>
      <div class="timeline-navigation">
        <button id="previousFrame" class="frame-step" aria-label="${th('player.previous')}" title="${th('player.previousTitle')}">‹</button>
        <input id="timeline" type="range" min="1" max="1" step="1" value="1" aria-label="${th('player.timeline')}" title="${th('player.timelineTitle')}">
        <button id="nextFrame" class="frame-step" aria-label="${th('player.next')}" title="${th('player.nextTitle')}">›</button>
      </div>
      <div class="frame-counter"><label for="frameNumber">${th('player.frame')}</label><input id="frameNumber" type="number" min="1" step="1" value="1" aria-label="${th('player.currentFrame')}" aria-describedby="playbackError"><span id="frameTotal">/ 1</span></div>
      <div class="fps-control"><label for="fps">FPS</label><input id="fps" type="number" min="0.1" max="120" step="any" value="24" aria-label="${th('player.fps')}" aria-describedby="playbackError"></div>
    </div>
    <div id="playbackError" class="field-error" role="status"></div>
  </section>
  <footer class="viewer-footer"><span id="dimensions">—</span><span id="pixel">${th('viewer.pixelHint')}</span><span id="status">${th('status.ready')}</span></footer>`;
const $ = id => document.getElementById(id);
const toolbar = document.querySelector('.viewer-toolbar');
function toolbarInset() { return toolbar.getBoundingClientRect().height; }
let configEntry;
const toolbarAlpha = $('toolbarAlpha'), irAlpha = $('irAlpha'), irAlphaValue = $('irAlphaValue');
// Blend-only controls join the end of the left toolbar group and reuse the file's current alpha.
function updateAlpha() {
  const c = configEntry?.config;
  toolbarAlpha.hidden = !c || configEntry.kind !== 'BINARY' || c.format !== 'CFA' || !SensorCore.isRgbir(c) || c.display !== 'blend';
  if (toolbarAlpha.hidden) return;
  irAlpha.value = String(Math.round(c.alpha * 100));
  irAlphaValue.value = `${irAlpha.value}%`;
  irAlpha.setAttribute('aria-valuetext', `${irAlpha.value}%`);
}
irAlpha.addEventListener('input', () => {
  if (toolbarAlpha.hidden || !configEntry) return;
  configEntry.config.alpha = Number(irAlpha.value) / 100;
  updateAlpha();
  vscode.postMessage({ type: 'patch', id: configEntry.id, patch: { alpha: configEntry.config.alpha } });
});
const toolbarDisplay = $('toolbarDisplay'), displayChannel = $('displayChannel');
// Offer only channel modes supported by the active file's format and plane selection.
function updateDisplayChannel() {
  updateAlpha();
  const c = configEntry?.config;
  toolbarDisplay.hidden = !c || configEntry.kind !== 'BINARY' || !(c.format === 'YUV' || (c.format === 'CFA' && SensorCore.isRgbir(c)));
  if (toolbarDisplay.hidden) return;
  const yuv = c.format === 'YUV';
  const modes = yuv ? SensorCore.yuvDisplays(c) : ['rgb', 'ir', 'blend', 'side'];
  const names = { rgb: yuv ? t('display.rgb') : 'RGB', luma: t('display.luma'), chroma: t('display.chroma'), ir: t('display.ir'), blend: t('display.blend'), side: t('display.side') };
  displayChannel.replaceChildren(...modes.map(mode => {
    const option = document.createElement('option'); option.value = mode; option.textContent = names[mode]; return option;
  }));
  displayChannel.value = c[yuv ? 'yuvDisplay' : 'display'];
  displayChannel.disabled = modes.length === 1;
}
displayChannel.addEventListener('change', () => {
  if (toolbarDisplay.hidden || !configEntry) return;
  const key = configEntry.config.format === 'YUV' ? 'yuvDisplay' : 'display';
  configEntry.config[key] = displayChannel.value;
  updateAlpha();
  vscode.postMessage({ type: 'patch', id: configEntry.id, patch: { [key]: displayChannel.value } });
});
const toolbarCfa = $('toolbarCfa'); toolbarCfa.setAttribute('data-tooltip', t('hint.pattern'));
const patternEditor = CfaEditor.create({ document, container: toolbarCfa, t, onChange: pattern => {
  if (!configEntry || configEntry.kind !== 'BINARY' || configEntry.config.format !== 'CFA') return;
  configEntry.config.pattern = pattern;
  patternEditor.setError(SensorCore.analyze(configEntry.config, configEntry.size).errors.pattern);
  vscode.postMessage({ type: 'patch', id: configEntry.id, patch: { pattern } });
} });
const toolbarTips = ViewerToolbar.tooltips({ document, root: toolbar, window });
const canvas = $('canvas'), viewport = $('viewport'), ctx = canvas.getContext('2d', { willReadFrequently: true });
const jpegRepair = $('jpegRepair'); jpegRepair.hidden = true; jpegRepair.setAttribute('aria-pressed', 'true');
let jpegEnabled = true, jpegApplied = false, jpegFrame, jpegPaint = 0;
async function paintJpeg() {
  const frame = jpegFrame, paint = ++jpegPaint, revision = generation;
  if (!frame || !valid) return;
  // Every comparison starts from the original decode, never from a previously repaired preview.
  jpegApplied = false; ctx.putImageData(frame, 0, 0); clearPixel(); updatePixelStatus();
  if (!jpegEnabled) return;
  const current = () => paint === jpegPaint && revision === generation && frame === jpegFrame;
  let pixels;
  try { pixels = await JpegPreview.restoreAsync(frame.data, frame.width, frame.height, current); }
  catch (error) {
    // Keep the already displayed original if the optional preview correction cannot complete.
    if (current()) { jpegEnabled = false; jpegRepair.setAttribute('aria-pressed', 'false'); }
    console.error('JPEG preview repair failed', error); return;
  }
  if (!pixels || !current()) return;
  ctx.putImageData(new ImageData(pixels, frame.width, frame.height), 0, 0);
  jpegApplied = true; clearPixel(); updatePixelStatus();
}
jpegRepair.addEventListener('click', () => {
  jpegEnabled = !jpegEnabled; jpegRepair.setAttribute('aria-pressed', String(jpegEnabled));
  void paintJpeg();
});
const pixelGrid = $('pixelGrid'), MAX_ZOOM = 64;
let zoom = 1, panX = 0, panY = 0, fitMode = true, dragging;
let generation = 0, valid = false, side = false;
let epoch = 0;
let displayedRevision = 0, rawPixels = false, pointer, hoverTarget, pixelTimer, pixelPending, pixelSerial = 0;
const pixelHint = t('viewer.pixelHint');
function pixelText(text) { $('pixel').textContent = text; $('pixel').title = text; }
function clearPixel() { hoverTarget = undefined; clearTimeout(pixelTimer); pixelTimer = undefined; pixelText(pixelHint); }
// Throttle inspection messages and keep one outstanding query while the pointer moves.
function requestPixel() {
  if (pixelPending || pixelTimer || !hoverTarget || !rawPixels) return;
  pixelTimer = setTimeout(() => {
    pixelTimer = undefined;
    if (!hoverTarget || !rawPixels || !valid) return;
    pixelPending = hoverTarget;
    vscode.postMessage({ type: 'inspectPixel', revision: pixelPending.revision, requestId: pixelPending.id, x: pixelPending.x, y: pixelPending.y });
  }, 30);
}
function updatePixelStatus() {
  if (!valid || canvas.hidden || !pointer) { clearPixel(); return; }
  const rect = viewport.getBoundingClientRect();
  const x = Math.floor((pointer.x - rect.left - panX) / zoom), y = Math.floor((pointer.y - rect.top - panY) / zoom);
  if (pointer.x < rect.left || pointer.x >= rect.right || pointer.y < rect.top + toolbarInset() || pointer.y >= rect.bottom || x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) { clearPixel(); return; }
  const sensorX = side ? x % (canvas.width / 2) : x, key = `${displayedRevision}:${x}:${y}`;
  if (hoverTarget?.key === key) return;
  const prefix = `${side ? x >= canvas.width / 2 ? 'IR · ' : 'RGB · ' : ''}X ${sensorX}  Y ${y}  |  `;
  hoverTarget = { key, id: ++pixelSerial, revision: displayedRevision, x: sensorX, y, prefix };
  if (rawPixels) { pixelText(prefix + '…'); requestPixel(); }
  else { const p = ctx.getImageData(x, y, 1, 1).data; pixelText(prefix + `${jpegApplied ? t('viewer.previewRgb') : 'RGB8'} ${p[0]}, ${p[1]}, ${p[2]}`); }
}
const playbackBar = $('playback');
const playbackVisibility = new PlaybackControls.AutoHide({ changed: hidden => {
  playbackBar.classList.toggle('playback-idle', hidden);
  playbackBar.inert = hidden;
  playbackBar.setAttribute('aria-hidden', String(hidden));
} });
let lastActivitySent = -Infinity, keyboardActivity = false;
// Recheck hover after visibility changes; a stationary pointer must keep the playback bar open.
function syncPlaybackHover() {
  const hovering = !playbackBar.hidden && playbackBar.matches(':hover');
  if (playbackVisibility.locks.has('hover') !== hovering) playbackVisibility.hold('hover', hovering);
}
// Notify sibling webviews of activity without flooding the extension host with pointer events.
function playbackActivity() {
  playbackVisibility.activity();
  syncPlaybackHover();
  const now = performance.now();
  if (now - lastActivitySent >= 150) { lastActivitySent = now; vscode.postMessage({ type: 'activity' }); }
}
document.addEventListener('pointermove', playbackActivity, { passive: true });
document.addEventListener('pointerenter', playbackActivity, { passive: true });
document.addEventListener('wheel', playbackActivity, { passive: true });
document.addEventListener('pointerdown', () => { keyboardActivity = false; playbackActivity(); });
playbackBar.addEventListener('pointerenter', () => playbackVisibility.hold('hover', true));
playbackBar.addEventListener('pointerleave', () => playbackVisibility.hold('hover', false));
playbackBar.addEventListener('pointerdown', () => playbackVisibility.hold('pointer', true));
document.addEventListener('pointerup', () => { if (playbackVisibility.locks.has('pointer')) playbackVisibility.hold('pointer', false); });
document.addEventListener('pointercancel', () => playbackVisibility.hold('pointer', false));
document.addEventListener('keydown', () => { keyboardActivity = true; playbackActivity(); }, true);
playbackBar.addEventListener('focusin', event => playbackVisibility.hold('focus', keyboardActivity || event.target.matches('input[type="number"]')));
playbackBar.addEventListener('focusout', event => {
  if (!playbackBar.contains(event.relatedTarget)) playbackVisibility.hold('focus', false);
});
playbackBar.addEventListener('input', () => playbackVisibility.activity());
window.addEventListener('focus', playbackActivity);
window.addEventListener('blur', () => { playbackVisibility.hold('hover', false); playbackVisibility.hold('pointer', false); playbackVisibility.hold('focus', false); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) playbackVisibility.activity(); });
const player = new SequencePlayer({ request: (frame, requestId) => vscode.postMessage({ type: 'seek', frame, requestId, epoch }), changed: updatePlayback });
function updatePlayback() {
  $('playback').hidden = !player.enabled;
  playbackVisibility.setEnabled(player.enabled);
  syncPlaybackHover();
  $('play').textContent = player.playing ? t('player.pauseButton') : player.frame === player.frameCount ? t('player.replayButton') : t('player.playButton');
  $('play').setAttribute('aria-label', player.playing ? t('player.pause') : player.frame === player.frameCount ? t('player.replay') : t('player.play'));
  $('play').disabled = !valid;
  $('previousFrame').disabled = !valid || !player.enabled || player.stepFrame <= 1;
  $('nextFrame').disabled = !valid || !player.enabled || player.stepFrame >= player.frameCount;
  $('timeline').max = String(Math.max(1, player.frameCount));
  $('timeline').value = String(player.queued ?? player.pending?.frame ?? player.frame);
  $('timeline').setAttribute('aria-valuetext', t('player.progress', { frame: player.frame, total: player.frameCount }));
  $('frameNumber').max = String(player.frameCount);
  if (document.activeElement !== $('frameNumber')) $('frameNumber').value = String(player.frame);
  $('frameTotal').textContent = `/ ${player.frameCount}`;
  if (document.activeElement !== $('fps')) $('fps').value = String(player.fps);
}
function togglePlay() { if (valid) { if (player.playing) player.pause(); else player.play(); } }
$('play').onclick = togglePlay;
function stepFrame(direction) {
  if (valid && player.step(direction)) {
    $('frameNumber').setAttribute('aria-invalid', 'false'); $('playbackError').textContent = '';
  }
}
$('previousFrame').onclick = () => stepFrame(-1);
$('nextFrame').onclick = () => stepFrame(1);
$('timeline').addEventListener('input', () => { $('playbackError').textContent = ''; player.seek(Number($('timeline').value)); });
function commitFrame() {
  if (!player.seek(Number($('frameNumber').value))) {
    $('frameNumber').setAttribute('aria-invalid', 'true'); $('playbackError').textContent = t('player.frameError', { total: player.frameCount });
  } else { $('frameNumber').setAttribute('aria-invalid', 'false'); $('playbackError').textContent = ''; }
}
$('frameNumber').addEventListener('change', commitFrame);
$('frameNumber').addEventListener('keydown', event => { if (event.key === 'Enter') { commitFrame(); if ($('frameNumber').getAttribute('aria-invalid') !== 'true') $('frameNumber').blur(); } });
$('frameNumber').addEventListener('blur', updatePlayback);
function commitFps() {
  const fps = Number($('fps').value);
  if (!player.setFps(fps)) { $('fps').setAttribute('aria-invalid', 'true'); $('playbackError').textContent = t('player.fpsError'); }
  else { $('fps').setAttribute('aria-invalid', 'false'); $('playbackError').textContent = ''; vscode.postMessage({ type: 'fps', fps }); }
}
$('fps').addEventListener('change', commitFps);
$('fps').addEventListener('keydown', event => { if (event.key === 'Enter') { commitFps(); if ($('fps').getAttribute('aria-invalid') !== 'true') $('fps').blur(); } });
document.addEventListener('visibilitychange', () => { if (document.hidden) player.pause(); });
function drawRuler(target, vertical) {
  const inset = toolbarInset();
  const width = vertical ? 44 : viewport.clientWidth, height = vertical ? Math.max(0, viewport.clientHeight - inset) : 24;
  const ratio = window.devicePixelRatio || 1, c = target.getContext('2d');
  const w = Math.round(width * ratio), h = Math.round(height * ratio);
  if (target.width !== w || target.height !== h) { target.width = w; target.height = h; }
  target.style.width = `${width}px`; target.style.height = `${height}px`;
  c.setTransform(ratio, 0, 0, ratio, 0, 0); c.clearRect(0, 0, width, height);
  c.fillStyle = 'rgba(20, 24, 30, .38)'; c.fillRect(0, 0, width, height);
  c.font = '11px monospace'; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillStyle = '#fff'; c.strokeStyle = 'rgba(255, 255, 255, .75)'; c.lineWidth = 1;
  c.shadowColor = '#000'; c.shadowBlur = 2;
  const pan = vertical ? panY - inset : panX, count = vertical ? canvas.height : canvas.width, length = vertical ? height : width;
  const first = Math.max(0, Math.floor(-pan / zoom)), last = Math.min(count, Math.ceil((length - pan) / zoom));
  for (let i = first; i <= last; i++) {
    const boundary = pan + i * zoom, center = boundary + zoom / 2;
    if (boundary >= (vertical ? 24 : 44) && boundary < length) {
      c.beginPath(); if (vertical) { c.moveTo(37, boundary); c.lineTo(44, boundary); } else { c.moveTo(boundary, 18); c.lineTo(boundary, 24); } c.stroke();
    }
    if (i < count && center >= (vertical ? 32 : 62) && center < length - (vertical ? 8 : 18)) {
      const index = !vertical && side ? i % (canvas.width / 2) : i;
      c.fillText(String(index), vertical ? 20 : center, vertical ? center : 10);
    }
  }
}
function updatePixelGrid() {
  const left = Math.max(0, panX), top = Math.max(0, panY);
  const right = Math.min(viewport.clientWidth, panX + canvas.width * zoom);
  const bottom = Math.min(viewport.clientHeight, panY + canvas.height * zoom);
  pixelGrid.hidden = !valid || canvas.hidden || zoom < MAX_ZOOM || right <= left || bottom <= top;
  $('pixelRulers').hidden = pixelGrid.hidden;
  viewport.classList.toggle('pixel-mode', !pixelGrid.hidden);
  if (pixelGrid.hidden) return;
  // Keep the overlay viewport-sized while anchoring each line to a source pixel boundary.
  pixelGrid.style.left = `${left}px`; pixelGrid.style.top = `${top}px`;
  pixelGrid.style.width = `${right - left}px`; pixelGrid.style.height = `${bottom - top}px`;
  pixelGrid.style.backgroundSize = `${zoom}px ${zoom}px`;
  pixelGrid.style.backgroundPosition = `${panX - left}px ${panY - top}px`;
  drawRuler($('rulerX'), false); drawRuler($('rulerY'), true);
}
function layout() {
  canvas.style.width = `${canvas.width * zoom}px`; canvas.style.height = `${canvas.height * zoom}px`;
  canvas.style.transform = `translate(${panX}px, ${panY}px)`;
  $('zoom').textContent = `${zoom < 0.01 ? Number((zoom * 100).toPrecision(2)) : Math.round(zoom * 100)}%`;
  $('fit').setAttribute('aria-pressed', String(fitMode));
  $('fit').setAttribute('data-tooltip', t(fitMode ? 'viewer.actualTitle' : 'viewer.fitTitle'));
  updatePixelGrid();
  updatePixelStatus();
}
// The image can extend beneath the glass toolbar, but Fit reserves its occupied height.
function fit() {
  if (!valid) return;
  const inset = toolbarInset(), visibleHeight = viewport.clientHeight - inset;
  // Fit in either direction, including enlarging small images, with a 16 px gutter.
  fitMode = true; zoom = Math.min(Math.max(1, viewport.clientWidth - 32) / canvas.width, Math.max(1, visibleHeight - 32) / canvas.height, MAX_ZOOM);
  panX = (viewport.clientWidth - canvas.width * zoom) / 2; panY = inset + (visibleHeight - canvas.height * zoom) / 2; layout();
}
// Manual zoom exits Fit mode while keeping the point under the zoom anchor stationary.
function zoomAt(next, x = viewport.clientWidth / 2, y = (viewport.clientHeight + toolbarInset()) / 2) {
  if (!valid) return;
  next = Math.max(0.01, Math.min(MAX_ZOOM, next)); fitMode = false;
  panX = x - (x - panX) * next / zoom; panY = y - (y - panY) * next / zoom; zoom = next; layout();
}
function message(text, detail) {
  pixelGrid.hidden = true; $('pixelRulers').hidden = true; viewport.classList.remove('pixel-mode'); clearPixel();
  $('message').replaceChildren();
  const title = document.createElement('h2'); title.textContent = text; $('message').append(title);
  if (detail) { const p = document.createElement('p'); p.textContent = detail; $('message').append(p); }
  $('message').hidden = false;
}
// Repeated Fit clicks alternate between fitting the viewport and native 1:1 pixel size.
$('fit').onclick = () => fitMode ? zoomAt(1) : fit(); $('minus').onclick = () => zoomAt(zoom / 1.25); $('plus').onclick = () => zoomAt(zoom * 1.25);
$('properties').onclick = () => vscode.postMessage({ type: 'properties' }); $('refresh').onclick = () => vscode.postMessage({ type: 'refresh' });
$('coefficients').onclick = () => vscode.postMessage({ type: 'coefficients' });
viewport.addEventListener('wheel', e => { e.preventDefault(); const r = viewport.getBoundingClientRect(); zoomAt(zoom * Math.exp(-e.deltaY * 0.002), e.clientX - r.left, e.clientY - r.top); }, { passive: false });
viewport.addEventListener('pointerdown', e => { if (e.button !== 0 || !valid) return; dragging = { x: e.clientX, y: e.clientY, panX, panY }; viewport.setPointerCapture(e.pointerId); viewport.classList.add('dragging'); });
function stopDrag() { dragging = undefined; viewport.classList.remove('dragging'); }
viewport.addEventListener('pointerup', stopDrag); viewport.addEventListener('pointercancel', stopDrag); viewport.addEventListener('lostpointercapture', stopDrag);
viewport.addEventListener('pointermove', e => {
  pointer = { x: e.clientX, y: e.clientY };
  if (!valid) return;
  if (dragging) { fitMode = false; panX = dragging.panX + e.clientX - dragging.x; panY = dragging.panY + e.clientY - dragging.y; layout(); return; }
  updatePixelStatus();
});
viewport.addEventListener('pointerleave', () => { pointer = undefined; clearPixel(); });
viewport.addEventListener('keydown', e => { if (e.key === ' ') { e.preventDefault(); togglePlay(); } else if (e.key.toLowerCase() === 'f') fit(); else if (e.key === '1') zoomAt(1); else if (['+', '='].includes(e.key)) zoomAt(zoom * 1.25); else if (e.key === '-') zoomAt(zoom / 1.25); });
new ResizeObserver(() => { if (valid && fitMode) fit(); else { updatePixelGrid(); updatePixelStatus(); } }).observe(viewport);
window.addEventListener('message', event => {
  const data = event.data;
  if (data.type === 'activity') { playbackVisibility.activity(); return; }
  if (data.type === 'state') {
    if (configEntry?.id !== data.entry?.id || configEntry?.config.display !== data.entry?.config.display || configEntry?.config.format !== data.entry?.config.format || configEntry?.config.pattern !== data.entry?.config.pattern) toolbarTips.hide();
    configEntry = data.entry;
    updateDisplayChannel();
    toolbarCfa.hidden = !configEntry || configEntry.kind !== 'BINARY' || configEntry.config.format !== 'CFA';
    if (!toolbarCfa.hidden) {
      patternEditor.setPattern(configEntry.config.pattern, configEntry.id);
      patternEditor.setError(SensorCore.analyze(configEntry.config, configEntry.size).errors.pattern);
    }
    return;
  }
  if (data.type === 'pixel') {
    if (pixelPending?.id !== data.requestId) return;
    pixelPending = undefined;
    if (valid && hoverTarget?.id === data.requestId && displayedRevision === data.revision) {
      const p = data.pixel;
      pixelText(hoverTarget.prefix + (!p ? '—' : p.format === 'CFA' ? `${p.channel}：${p.value}` : `Y：${p.y ?? '—'}  U：${p.u ?? '—'}  V：${p.v ?? '—'}`));
    } else requestPixel();
    return;
  }
  if (data.type === 'resetPlayback') {
    generation++; player.reset(); $('playbackError').textContent = ''; clearPixel();
    for (const id of ['frameNumber', 'fps']) { $(id).setAttribute('aria-invalid', 'false'); $(id).blur(); }
  }
  if (data.type === 'pausePlayback') { player.reset(data.sequence); }
  if (data.type === 'loading') {
    generation++;
    if (data.sequence) epoch = data.sequence.epoch;
    if (data.resetPlayback) player.reset(data.sequence);
    if (!data.preserveImage || !valid) { valid = false; canvas.hidden = true; $('comparison').hidden = true; message(t('status.decoding')); }
    $('status').textContent = t('status.processing');
  }
  if (data.type === 'invalid') { generation++; valid = false; player.reset(); canvas.hidden = true; $('comparison').hidden = true; message(t('status.invalid'), data.message); $('status').textContent = t('status.adjust'); $('dimensions').textContent = '—'; }
  if (data.type !== 'image') return;
  if (!player.canPresent(data.requestId)) return;
  jpegFrame = undefined; jpegApplied = false; jpegRepair.hidden = true; jpegPaint++;
  const token = ++generation; const image = new Image();
  image.onload = () => {
    if (token !== generation) return;
    if (image.naturalWidth * image.naturalHeight > SensorCore.MAX_PIXELS * (data.display === 'side' ? 2 : 1)) { valid = false; player.reset(); canvas.hidden = true; message(t('error.previewLimit'), t('error.maxPixels')); return; }
    const changedSize = canvas.width !== image.naturalWidth || canvas.height !== image.naturalHeight;
    canvas.width = image.naturalWidth; canvas.height = image.naturalHeight; ctx.drawImage(image, 0, 0);
    valid = true; canvas.hidden = false; $('message').hidden = true;
    displayedRevision = data.revision; rawPixels = ['CFA', 'YUV'].includes(data.kind); hoverTarget = undefined;
    side = data.display === 'side'; $('comparison').hidden = !side;
    $('dimensions').textContent = `${side ? canvas.width / 2 : canvas.width} × ${canvas.height}${side ? ' · RGB | IR' : ''}`;
    $('status').textContent = t('status.readOnly');
    if (data.sequence) epoch = data.sequence.epoch;
    player.present(data.sequence, data.requestId);
    if (changedSize || fitMode) fit(); else layout();
    // Lossless PNG and sensor reconstructions retain their existing pixel-exact rendering paths.
    if (data.kind === 'JPEG') {
      jpegFrame = ctx.getImageData(0, 0, canvas.width, canvas.height); jpegRepair.hidden = false;
      void paintJpeg();
    }
    vscode.postMessage({ type: 'metadata', revision: data.revision, width: canvas.width, height: canvas.height });
  };
  image.onerror = () => { if (token !== generation) return; valid = false; player.reset(); canvas.hidden = true; message(t('error.decodeTitle'), t('error.decodeHint')); $('status').textContent = t('status.readFailed'); vscode.postMessage({ type: 'imageError', revision: data.revision }); };
  // VS Code serves file assets on a separate origin with CORS headers; opt in before canvas reads.
  image.crossOrigin = 'anonymous';
  image.src = data.source;
});
vscode.postMessage({ type: 'ready' });
