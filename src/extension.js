'use strict';
const I18n = require('../media/i18n');
const { t } = I18n;
const vscode = require('vscode');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { Decoder } = require('./decoder');
const Core = require('../media/core');
const { createSettings } = require('./demosaic-settings');

function activate(context) {
  I18n.setLocale(vscode.env.language);
  const entries = new Map();
  const treeChanged = new vscode.EventEmitter();
  let active;
  let inspector;
  const saved = context.workspaceState.get('sensorViewer.files', []);
  const report = error => vscode.window.showErrorMessage(t('error.report', { message: error.message || error }));
  const demosaic = createSettings(vscode, context, () => {
    for (const entry of entries.values()) if (entry.views.size && Core.kind(entry.name) === 'BINARY' && entry.config.format === 'CFA') void render(entry);
  }, report);
  // Only membership survives restart. Parsing, display and FPS values belong to this session.
  function persist() {
    return context.workspaceState.update('sensorViewer.files', [...entries.values()].map(e => ({ uri: e.uri.toString() })));
  }
  // Reopening a tab reuses its edited configuration; a new activation starts from filename hints.
  function entryFor(uri) {
    const key = uri.toString();
    if (!entries.has(key)) entries.set(key, { uri, name: path.posix.basename(uri.path), config: Core.defaults(uri.path), size: 0, views: new Set(), revision: 0, epoch: 0, frame: 1, fps: 24 });
    return entries.get(key);
  }
  for (const item of saved) {
    try {
      // Restore the file list only. Each activation infers fresh per-file settings.
      entryFor(vscode.Uri.parse(item.uri));
    } catch { /* Ignore stale persisted URIs. */ }
  }
  // Remove configurations persisted by older versions, even before a file opens.
  if (saved.length) void persist().catch(report);
  function sequence(entry, frame = entry.frame) { return { ...Core.sequence(entry.config, entry.size, frame), fps: entry.fps, epoch: entry.epoch }; }
  function state(entry) {
    if (!entry) return { type: 'state', entry: null };
    return { type: 'state', entry: { id: entry.uri.toString(), name: entry.name, path: entry.uri.fsPath || entry.uri.path, size: entry.size, kind: Core.kind(entry.name), config: entry.config, metadata: entry.metadata, error: entry.error, validation: Core.kind(entry.name) === 'BINARY' ? Core.analyze(entry.config, entry.size) : null, sequence: Core.kind(entry.name) === 'BINARY' ? sequence(entry) : null } };
  }
  function updateInspector() { if (inspector) void inspector.webview.postMessage(state(active)); }
  function broadcast(entry, message) { for (const panel of entry.views) void panel.webview.postMessage(message); }
  function wakePlayback(except) {
    for (const entry of entries.values()) for (const panel of entry.views) {
      if (panel !== except && panel.visible) void panel.webview.postMessage({ type: 'activity' });
    }
  }
  if (vscode.window.onDidChangeWindowState) context.subscriptions.push(vscode.window.onDidChangeWindowState(state => { if (state.focused) wakePlayback(); }));
  // Both editing surfaces update the same entry and invalidate its previous frame interpretation.
  function applyPatch(target, patch) {
    for (const key of Object.keys(Core.defaults())) if (Object.hasOwn(patch, key)) target.config[key] = patch[key];
    target.frame = 1;
    void render(target);
  }
  async function showProperties() { await vscode.commands.executeCommand('sensorViewer.inspector.focus', { preserveFocus: true }); }
  async function toggleProperties() {
    if (inspector?.visible) await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
    else await showProperties();
  }
  function syncActiveEditor() {
    // Tabs remain active when focus moves into the inspector. Panel focus alone
    // would clear the properties while the user is trying to edit them.
    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    const entry = input instanceof vscode.TabInputCustom && input.viewType === 'sensorViewer.image'
      ? entries.get(input.uri.toString()) : undefined;
    const next = entry?.views.size ? entry : undefined;
    if (active === next) return;
    active = next;
    updateInspector();
    if (active) void showProperties().catch(report);
  }
  context.subscriptions.push(
    vscode.window.tabGroups.onDidChangeTabs(syncActiveEditor),
    vscode.window.tabGroups.onDidChangeTabGroups(syncActiveEditor)
  );
  async function render(entry, { frame = entry.frame, requestId } = {}) {
    // Revisions discard stale asynchronous results; epochs reject seeks from an obsolete layout.
    const revision = ++entry.revision;
    const resetPlayback = requestId === undefined;
    if (resetPlayback) {
      entry.epoch++;
      broadcast(entry, state(entry));
      broadcast(entry, { type: 'resetPlayback' });
    }
    if (entry.decoder?.decoding) { entry.decoder.dispose(); entry.decoder = undefined; }
    try {
      const stat = await vscode.workspace.fs.stat(entry.uri);
      if (revision !== entry.revision) return;
      if (stat.type & vscode.FileType.Directory) throw new Error(t('file.choose'));
      const sizeChanged = entry.size !== stat.size;
      entry.size = stat.size; entry.error = undefined;
      if (sizeChanged) broadcast(entry, state(entry));
      if (active === entry && (resetPlayback || sizeChanged)) updateInspector();
      const type = Core.kind(entry.name);
      if (type !== 'BINARY') {
        entry.presented = undefined;
        if (entry.size > Core.MAX_BYTES) throw new Error(t('file.encodedLimit'));
        for (const panel of entry.views) void panel.webview.postMessage({ type: 'image', source: panel.webview.asWebviewUri(entry.uri).toString() + `?v=${revision}`, name: entry.name, kind: type, revision });
        return;
      }
      const validation = Core.analyze(entry.config, entry.size);
      if (!validation.valid) { broadcast(entry, { type: 'invalid', message: Object.values(validation.errors)[0] }); return; }
      const seq = sequence(entry, frame);
      broadcast(entry, { type: 'loading', preserveImage: !resetPlayback, sequence: seq, resetPlayback });
      await demosaic.ready;
      const workerData = { config: { ...entry.config }, coefficients: demosaic.get(), length: validation.requiredBytes, readOffset: seq.readOffset };
      if (entry.uri.scheme === 'file') workerData.path = entry.uri.fsPath;
      else {
        // VS Code's virtual file system does not offer range reads.
        if (entry.size > Core.MAX_BYTES) throw new Error(t('file.virtualLimit'));
        const file = await vscode.workspace.fs.readFile(entry.uri);
        if (revision !== entry.revision) return;
        workerData.bytes = file.slice(seq.readOffset, seq.readOffset + validation.requiredBytes);
      }
      if (revision !== entry.revision) return;
      if (!entry.decoder || entry.decoder.closed) entry.decoder = new Decoder();
      const result = await entry.decoder.decode(workerData, preview => {
        // A cancelled file/layout/frame revision must never replace the newer view.
        if (revision !== entry.revision) return;
        broadcast(entry, { type: 'image', preview: true, source: preview.image, width: preview.width, height: preview.height, name: entry.name, kind: entry.config.format, display: entry.config.format === 'CFA' && Core.isRgbir(entry.config) ? entry.config.display : 'rgb', revision, sequence: { ...seq, fps: entry.fps }, requestId });
      });
      if (revision !== entry.revision) return;
      entry.frame = seq.frame;
      entry.metadata = { width: result.width, height: result.height };
      entry.presented = { revision, frameId: result.frameId, decoder: entry.decoder };
      broadcast(entry, { type: 'image', source: result.image, width: result.width, height: result.height, name: entry.name, kind: entry.config.format, display: entry.config.format === 'CFA' && Core.isRgbir(entry.config) ? entry.config.display : 'rgb', revision, sequence: { ...seq, fps: entry.fps }, requestId });
      if (active === entry && resetPlayback) updateInspector();
    } catch (error) {
      if (revision !== entry.revision) return;
      entry.error = error.message; broadcast(entry, { type: 'invalid', message: error.message });
      if (active === entry) updateInspector();
    }
  }
  async function inspectPixel(entry, panel, message) {
    const shown = entry.presented;
    let pixel = null;
    try {
      if (shown?.revision === message.revision && !shown.decoder.closed) {
        const result = await shown.decoder.inspect(shown.frameId, message.x, message.y);
        if (entry.presented === shown) pixel = result.pixel;
      }
    } catch { /* A replaced frame must never contribute samples to the new preview. */ }
    if (entry.views.has(panel)) void panel.webview.postMessage({ type: 'pixel', revision: message.revision, requestId: message.requestId, pixel });
  }
  const provider = {
    onDidChangeTreeData: treeChanged.event,
    getChildren(element) {
      if (element?.group) return [...entries.values()].filter(e => Core.extension(e.name) === element.extension);
      if (element) return [];
      const groups = [...new Set([...entries.values()].map(e => Core.extension(e.name)))];
      return groups.sort((a, b) => a.localeCompare(b)).map(extension => ({ group: true, extension }));
    },
    getTreeItem(element) {
      if (element.group) {
        const label = element.extension ? `.${element.extension.toUpperCase()}` : t('file.noExtension');
        const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.Expanded);
        item.id = 'group:' + element.extension;
        item.description = String([...entries.values()].filter(e => Core.extension(e.name) === element.extension).length);
        item.iconPath = new vscode.ThemeIcon('folder'); return item;
      }
      const item = new vscode.TreeItem(element.name);
      item.id = element.uri.toString(); item.resourceUri = element.uri; item.tooltip = element.uri.fsPath;
      item.iconPath = new vscode.ThemeIcon('file-media'); item.contextValue = 'sensorImage';
      item.command = { command: 'sensorViewer.open', title: t('file.open'), arguments: [element.uri] }; return item;
    }
  };
  context.subscriptions.push(treeChanged, vscode.window.createTreeView('sensorViewer.files', { treeDataProvider: provider }));
  const editor = {
    openCustomDocument(uri) {
      const entry = entryFor(uri); treeChanged.fire(); void persist();
      return { uri, dispose() { entry.revision++; entry.decoder?.dispose(); entry.decoder = undefined; } };
    },
    resolveCustomEditor(document, panel) {
      const entry = entryFor(document.uri); entry.views.add(panel);
      panel.webview.options = { enableScripts: true, localResourceRoots: [context.extensionUri, vscode.Uri.joinPath(entry.uri, '..')] };
      panel.webview.html = html(panel.webview, context.extensionUri, 'viewer');
      panel.onDidDispose(() => {
        entry.views.delete(panel);
        syncActiveEditor();
      });
      panel.onDidChangeViewState(() => {
        syncActiveEditor();
        if (!panel.visible) void panel.webview.postMessage({ type: 'pausePlayback', sequence: sequence(entry) });
        else void panel.webview.postMessage({ type: 'activity' });
      });
      panel.webview.onDidReceiveMessage(message => {
        if (message.type === 'activity') { wakePlayback(panel); return; }
        if (message.type === 'ready') { void render(entry); }
        else if (message.type === 'properties') void toggleProperties().catch(report);
        else if (message.type === 'coefficients') void demosaic.edit().catch(report);
        else if (message.type === 'refresh') void render(entry);
        else if (message.type === 'patch' && message.id === entry.uri.toString() && Core.kind(entry.name) === 'BINARY' && message.patch && typeof message.patch === 'object') {
          const patch = {};
          if (entry.config.format === 'CFA') {
            if (typeof message.patch.pattern === 'string' && /^[RGBI?]{4}$/.test(message.patch.pattern)) patch.pattern = message.patch.pattern;
            if (Core.isRgbir(entry.config) && ['rgb', 'ir', 'blend', 'side'].includes(message.patch.display)) patch.display = message.patch.display;
            if (Core.isRgbir(entry.config) && entry.config.display === 'blend' && Number.isFinite(message.patch.alpha) && message.patch.alpha >= 0 && message.patch.alpha <= 1) patch.alpha = message.patch.alpha;
          } else if (entry.config.format === 'YUV' && Core.yuvDisplays(entry.config).includes(message.patch.yuvDisplay)) patch.yuvDisplay = message.patch.yuvDisplay;
          if (Object.keys(patch).length) applyPatch(entry, patch);
        }
        else if (message.type === 'inspectPixel' && Number.isSafeInteger(message.requestId) && Number.isSafeInteger(message.revision) && Number.isSafeInteger(message.x) && Number.isSafeInteger(message.y)) void inspectPixel(entry, panel, message);
        else if (message.type === 'seek' && Core.kind(entry.name) === 'BINARY' && message.epoch === entry.epoch && Number.isSafeInteger(message.frame) && Number.isSafeInteger(message.requestId)) {
          const seq = sequence(entry);
          if (!seq.enabled || message.frame < 1 || message.frame > seq.frameCount) return;
          for (const other of entry.views) if (other !== panel) void other.webview.postMessage({ type: 'pausePlayback', sequence: seq });
          void render(entry, { frame: message.frame, requestId: message.requestId });
        } else if (message.type === 'fps' && Number.isFinite(message.fps) && message.fps >= 0.1 && message.fps <= 120) {
          // Playback speed is also session-local and returns to its default on activation.
          entry.fps = message.fps;
        }
        else if (message.type === 'metadata' && message.revision === entry.revision && Number.isSafeInteger(message.width) && Number.isSafeInteger(message.height)) {
          entry.metadata = { width: message.width, height: message.height }; if (active === entry && Core.kind(entry.name) !== 'BINARY') updateInspector();
        } else if (message.type === 'imageError' && message.revision === entry.revision) {
          entry.error = t('file.decodeError'); if (active === entry) updateInspector();
        }
      });
      syncActiveEditor();
    }
  };
  context.subscriptions.push(vscode.window.registerCustomEditorProvider('sensorViewer.image', editor, { webviewOptions: { retainContextWhenHidden: true }, supportsMultipleEditorsPerDocument: true }));
  context.subscriptions.push(vscode.window.registerWebviewViewProvider('sensorViewer.inspector', {
    resolveWebviewView(view) {
      inspector = view;
      view.webview.options = { enableScripts: true, localResourceRoots: [context.extensionUri] };
      view.webview.html = html(view.webview, context.extensionUri, 'inspector');
      view.onDidDispose(() => { if (inspector === view) inspector = undefined; });
      view.webview.onDidReceiveMessage(message => {
        if (message.type === 'activity') { wakePlayback(); return; }
        if (message.type === 'ready') updateInspector();
        const target = entries.get(message.id);
        if (message.type === 'patch' && target && Core.kind(target.name) === 'BINARY' && message.patch && typeof message.patch === 'object') {
          applyPatch(target, message.patch);
        }
      });
      updateInspector();
    }
  }, { webviewOptions: { retainContextWhenHidden: true } }));
  function command(id, fn) { context.subscriptions.push(vscode.commands.registerCommand(id, (...args) => Promise.resolve().then(() => fn(...args)).catch(report))); }
  command('sensorViewer.import', async () => {
    const uris = await vscode.window.showOpenDialog({ canSelectMany: true, canSelectFiles: true, canSelectFolders: false, title: t('file.importTitle'), openLabel: t('file.importButton') });
    if (!uris?.length) return;
    for (const uri of uris) entryFor(uri);
    treeChanged.fire(); await persist();
    await vscode.commands.executeCommand('workbench.view.extension.sensor-images');
    await vscode.commands.executeCommand('sensorViewer.open', uris[0]);
  });
  command('sensorViewer.open', async uri => {
    if (!uri) return vscode.commands.executeCommand('sensorViewer.import');
    entryFor(uri); treeChanged.fire(); await persist();
    await vscode.commands.executeCommand('vscode.openWith', uri, 'sensorViewer.image', { preview: false });
  });
  command('sensorViewer.remove', async entry => {
    if (!entry?.uri) return;
    const tabs = vscode.window.tabGroups.all.flatMap(group => group.tabs).filter(tab => tab.input instanceof vscode.TabInputCustom && tab.input.viewType === 'sensorViewer.image' && tab.input.uri.toString() === entry.uri.toString());
    if (tabs.length) await vscode.window.tabGroups.close(tabs);
    entries.delete(entry.uri.toString()); treeChanged.fire(); await persist();
  });
  command('sensorViewer.refresh', async () => { if (active) await render(active); });
  command('sensorViewer.properties', toggleProperties);
  command('sensorViewer.coefficients', () => demosaic.edit());
  context.subscriptions.push({ dispose() { for (const entry of entries.values()) { entry.revision++; entry.decoder?.dispose(); } } });
  // A small API is also useful to integration tests and other local extensions.
  return {
    getEntries: () => [...entries.values()].map(e => state(e).entry),
    getActiveEntry: () => state(active).entry,
    isPropertiesVisible: () => !!inspector?.visible
  };
}

function html(webview, uri, name) {
  // JPEG correction runs only in the viewer; the inspector never rewrites decoded pixels.
  const nonce = randomBytes(16).toString('hex');
  const asset = file => webview.asWebviewUri(vscode.Uri.joinPath(uri, 'media', file));
  return `<!doctype html><html lang="${I18n.getLocale()}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';"><link rel="stylesheet" href="${asset('styles.css')}"><title>${I18n.th('app.name')}</title></head><body class="${name}"><div id="app"></div><script nonce="${nonce}">globalThis.SensorLocale = ${I18n.serialize(vscode.env.language)}; globalThis.SensorDemosaicDefaults = ${JSON.stringify(require('../media/demosaic-defaults.json'))};</script><script nonce="${nonce}" src="${asset('i18n.js')}"></script><script nonce="${nonce}" src="${asset('demosaic.js')}"></script><script nonce="${nonce}" src="${asset('core.js')}"></script>${name === 'viewer' ? `<script nonce="${nonce}" src="${asset('resample.js')}"></script><script nonce="${nonce}" src="${asset('jpeg-preview.js')}"></script><script nonce="${nonce}" src="${asset('playback.js')}"></script><script nonce="${nonce}" src="${asset('playback-controls.js')}"></script><script nonce="${nonce}" src="${asset('cfa-editor.js')}"></script><script nonce="${nonce}" src="${asset('toolbar.js')}"></script>` : ''}<script nonce="${nonce}" src="${asset(name + '.js')}"></script></body></html>`;
}
module.exports = { activate };
