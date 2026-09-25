'use strict';
// Verify cross-view session state while ensuring restarts retain file membership but discard old parameters.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

test('toolbar edits remain in their session entry and synchronize with inspector presets and other views', async () => {
  let editor, inspectorProvider, inspectorMessage, saved, coefficientBytes, saveCoefficients, openedDocument;
  const decodeJobs = [], deferred = [];
  let deferDecode = false;
  const file = path.join(__dirname, '../src/extension.js'), load = createRequire(file);
  const noop = () => ({}), tick = () => new Promise(resolve => setImmediate(resolve));
  const uri = name => ({ path: '/images/' + name, fsPath: '/images/' + name, scheme: 'file', toString: () => 'file:///images/' + name });
  class TabInputCustom { constructor(value) { this.uri = value; this.viewType = 'sensorViewer.image'; } }
  const tabs = { activeTabGroup: {}, onDidChangeTabs: noop, onDidChangeTabGroups: noop };
  const vscode = {
    env: { language: 'en' }, EventEmitter: class { fire() {} event() {} }, TabInputCustom,
    Uri: { joinPath: (...parts) => parts.join('/') }, FileType: { Directory: 2 }, RelativePattern: class {}, ViewColumn: { Beside: 2 },
    workspace: {
      fs: {
        stat: async uri => { if (typeof uri === 'string' && !coefficientBytes) throw Object.assign(new Error('missing'), { code: 'FileNotFound' }); return { size: 16, type: 1 }; },
        readFile: async () => { if (!coefficientBytes) throw Object.assign(new Error('missing'), { code: 'FileNotFound' }); return coefficientBytes; },
        createDirectory: async () => {}, writeFile: async (_, bytes) => { coefficientBytes = bytes; }
      },
      openTextDocument: async uri => ({ uri }),
      onDidSaveTextDocument: fn => { saveCoefficients = fn; return {}; },
      createFileSystemWatcher: () => ({ onDidChange: noop, onDidCreate: noop, onDidDelete: noop })
    },
    commands: { registerCommand: noop, executeCommand: async () => {} },
    window: {
      tabGroups: tabs, createTreeView: noop,
      showTextDocument: async document => { openedDocument = document; },
      showErrorMessage: message => { throw new Error(message); },
      registerCustomEditorProvider(id, value) { editor = value; return {}; },
      registerWebviewViewProvider(id, value) { inspectorProvider = value; return {}; }
    }
  };
  class Decoder {
    async decode(job, onPreview) {
      decodeJobs.push(job);
      const result = { image: 'data:image/png;base64,', width: job.config.width, height: job.config.height, frameId: 1 };
      if (deferDecode) return new Promise(resolve => deferred.push({ preview: () => onPreview({ ...result, preview: true }), finish: () => resolve(result) }));
      return result;
    }
    dispose() { this.closed = true; }
  }
  const sandbox = { module: { exports: {} }, require: name => name === 'vscode' ? vscode : name === './decoder' ? { Decoder } : load(name) };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), sandbox);
  const api = sandbox.module.exports.activate({ extensionUri: '/extension', globalStorageUri: '/user-settings', subscriptions: [], workspaceState: { get: () => [], update: async (key, value) => { saved = value; } } });
  const inspectorStates = [];
  inspectorProvider.resolveWebviewView({ onDidDispose: noop, webview: {
    asWebviewUri: value => value, cspSource: 'webview:',
    onDidReceiveMessage(handler) { inspectorMessage = handler; }, postMessage(message) { inspectorStates.push(structuredClone(message)); }
  } });
  function open(value) {
    const document = editor.openCustomDocument(value), messages = [];
    let receive;
    tabs.activeTabGroup.activeTab = { input: new TabInputCustom(value) };
    const panel = { visible: true, onDidDispose: noop, onDidChangeViewState: noop, webview: {
      asWebviewUri: value => value, cspSource: 'webview:',
      onDidReceiveMessage(handler) { receive = handler; }, postMessage(message) { messages.push(structuredClone(message)); }
    } };
    editor.resolveCustomEditor(document, panel);
    return { messages, receive, html: panel.webview.html };
  }
  const a = uri('a-4x4.raw'), b = uri('b-4x4.raw');
  const first = open(a), second = open(a), other = open(b);
  first.receive({ type: 'ready' }); await tick();
  first.receive({ type: 'coefficients' }); await tick();
  assert.equal(openedDocument.uri, '/user-settings/demosaic-coefficients.json');
  const coefficients = JSON.parse(coefficientBytes); coefficients.regularization = 3;
  coefficientBytes = Buffer.from(JSON.stringify(coefficients));
  const before = decodeJobs.length;
  saveCoefficients(openedDocument); await tick();
  assert.equal(decodeJobs.length, before + 2, 'saving refreshes both open image entries');
  assert.ok(decodeJobs.slice(before).every(job => job.coefficients.regularization === 3));
  inspectorMessage({ type: 'activity' });
  assert.equal(first.messages.at(-1).type, 'activity');
  assert.equal(other.messages.at(-1).type, 'activity');
  const count = first.messages.length;
  first.receive({ type: 'activity' });
  assert.equal(second.messages.at(-1).type, 'activity');
  assert.equal(first.messages.length, count, 'activity is not echoed back to its source');

  assert.ok(first.html.includes('/media/cfa-editor.js'));
  assert.equal(first.messages.find(message => message.type === 'state').entry.config.pattern, 'RGGB');
  first.receive({ type: 'patch', id: a.toString(), patch: { pattern: 'RGIB', width: 99 } }); await tick();
  assert.equal(api.getEntries().find(entry => entry.id === a.toString()).config.pattern, 'RGIB');
  assert.equal(api.getEntries().find(entry => entry.id === a.toString()).config.width, 4);
  assert.equal(api.getEntries().find(entry => entry.id === b.toString()).config.pattern, 'RGGB');
  assert.equal(second.messages.filter(message => message.type === 'state').at(-1).entry.config.pattern, 'RGIB');
  assert.equal(api.getEntries().find(entry => entry.id === a.toString()).config.pattern, 'RGIB');
  assert.equal(inspectorStates.at(-1).entry.id, b.toString());
  first.receive({ type: 'patch', id: b.toString(), patch: { pattern: 'RGBI' } }); await tick();
  assert.equal(api.getEntries().find(entry => entry.id === b.toString()).config.pattern, 'RGGB');
  first.receive({ type: 'patch', id: a.toString(), patch: { display: 'blend', width: 99 } }); await tick();
  assert.equal(api.getEntries().find(entry => entry.id === a.toString()).config.display, 'blend');
  first.receive({ type: 'patch', id: a.toString(), patch: { alpha: 0.75 } }); await tick();
  assert.equal(api.getEntries().find(entry => entry.id === a.toString()).config.alpha, 0.75);
  assert.equal(second.messages.filter(message => message.type === 'state').at(-1).entry.config.alpha, 0.75);
  for (const alpha of [-0.1, 1.1, '0.5', NaN]) {
    first.receive({ type: 'patch', id: a.toString(), patch: { alpha } }); await tick();
    assert.equal(api.getEntries().find(entry => entry.id === a.toString()).config.alpha, 0.75);
  }
  for (const alpha of [0, 1]) {
    first.receive({ type: 'patch', id: a.toString(), patch: { alpha } }); await tick();
    assert.equal(api.getEntries().find(entry => entry.id === a.toString()).config.alpha, alpha);
  }

  assert.equal(second.messages.filter(message => message.type === 'state').at(-1).entry.config.display, 'blend');
  assert.equal(api.getEntries().find(entry => entry.id === a.toString()).config.width, 4);
  first.receive({ type: 'patch', id: a.toString(), patch: { display: 'invalid' } }); await tick();
  assert.equal(api.getEntries().find(entry => entry.id === a.toString()).config.display, 'blend');
  inspectorMessage({ type: 'patch', id: a.toString(), patch: { pattern: 'BGGR' } }); await tick();
  assert.equal(first.messages.filter(message => message.type === 'state').at(-1).entry.config.pattern, 'BGGR');
  other.receive({ type: 'patch', id: b.toString(), patch: { pattern: 'R?GB' } }); await tick();
  assert.ok(other.messages.some(message => message.type === 'invalid'));
  assert.equal(inspectorStates.at(-1).entry.config.pattern, 'R?GB');
  inspectorMessage({ type: 'patch', id: b.toString(), patch: { format: 'YUV' } }); await tick();
  other.receive({ type: 'patch', id: b.toString(), patch: { pattern: 'RGBI' } }); await tick();
  assert.equal(api.getEntries().find(entry => entry.id === b.toString()).config.pattern, 'R?GB');
  other.receive({ type: 'patch', id: b.toString(), patch: { yuvDisplay: 'luma' } }); await tick();
  assert.equal(inspectorStates.at(-1).entry.config.yuvDisplay, 'luma');
  assert.equal(api.getEntries().find(entry => entry.id === b.toString()).config.yuvDisplay, 'luma');
  other.receive({ type: 'patch', id: b.toString(), patch: { yuvDisplay: 'ir' } }); await tick();
  assert.equal(api.getEntries().find(entry => entry.id === b.toString()).config.yuvDisplay, 'luma');
  inspectorMessage({ type: 'patch', id: b.toString(), patch: { yuvPlanes: 'y', yuvDisplay: 'luma' } }); await tick();
  other.receive({ type: 'patch', id: b.toString(), patch: { yuvDisplay: 'chroma' } }); await tick();
  assert.equal(api.getEntries().find(entry => entry.id === b.toString()).config.yuvDisplay, 'luma');
  inspectorMessage({ type: 'patch', id: b.toString(), patch: { chromaPitch: 8 } }); await tick();
  assert.equal(api.getEntries().find(entry => entry.id === b.toString()).config.chromaPitch, 8);
  assert.equal(other.messages.filter(message => message.type === 'state').at(-1).entry.config.chromaPitch, 8);
  const reopened = open(a);
  assert.equal(api.getEntries().find(entry => entry.id === a.toString()).config.pattern, 'BGGR');
  reopened.receive({ type: 'ready' }); await tick();
  assert.equal(reopened.messages.find(message => message.type === 'state').entry.config.pattern, 'BGGR');
  assert.ok(saved.every(entry => Object.keys(entry).join() === 'uri'));

  // Deliver both stages of an obsolete decode after a newer refresh has started.
  deferDecode = true;
  first.receive({ type: 'refresh' }); await tick();
  first.receive({ type: 'refresh' }); await tick();
  const imagesBefore = first.messages.filter(message => message.type === 'image').length;
  deferred[0].preview(); deferred[0].finish(); await tick();
  assert.equal(first.messages.filter(message => message.type === 'image').length, imagesBefore);
  deferred[1].preview();
  assert.equal(first.messages.at(-1).preview, true);
  const previewRevision = first.messages.at(-1).revision;
  deferred[1].finish(); await tick();
  const images = first.messages.filter(message => message.type === 'image');
  assert.equal(images.length, imagesBefore + 2);
  assert.equal(images.at(-1).revision, previewRevision);
  assert.equal(images.at(-1).preview, undefined);


});

test('activation discards old settings and legacy pitch fields while restoring the file list', async () => {
  const file = path.join(__dirname, '../src/extension.js'), load = createRequire(file);
  const noop = () => ({}), commands = new Map();
  const uri = value => ({ path: new URL(value).pathname, fsPath: new URL(value).pathname, toString: () => value });
  const original = [
    { uri: 'file:///images/legacy-4x4.raw', config: { rowStride: 8 }, expected: [0, 0, 16] },
    { uri: 'file:///images/legacy-4x4.yuv', config: { rowStride: 8, chromaStride: 4 }, expected: [0, 0, 24] },
    { uri: 'file:///images/automatic-4x4.yuv', config: { rowStride: 8, chromaStride: 4, rowPitch: 0, chromaPitch: 0 }, expected: [0, 0, 24] },
    { uri: 'file:///images/current-4x4.yuv', config: { rowPitch: 8, chromaPitch: 6 }, expected: [0, 0, 24] }
  ];
  let saved;
  const vscode = {
    env: { language: 'en' }, EventEmitter: class { fire() {} event() {} }, Uri: { parse: uri },
    commands: { registerCommand: (name, handler) => { commands.set(name, handler); return {}; }, executeCommand: async () => {} },
    window: {
      tabGroups: { onDidChangeTabs: noop, onDidChangeTabGroups: noop }, createTreeView: noop,
      registerCustomEditorProvider: noop, registerWebviewViewProvider: noop
    }
  };
  const sandbox = { module: { exports: {} }, require: name => name === 'vscode' ? vscode : load(name) };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), sandbox);
  const api = sandbox.module.exports.activate({ extensionUri: '/extension', subscriptions: [], workspaceState: {
    get: () => original, update: async (key, value) => { saved = value; }
  } });
  for (const item of original) {
    const entry = api.getEntries().find(entry => entry.id === item.uri);
    assert.equal(entry.config.rowPitch, item.expected[0]);
    assert.equal(entry.config.chromaPitch, item.expected[1]);
    assert.equal(entry.validation.requiredBytes, item.expected[2]);
  }
  assert.deepEqual(structuredClone(saved), original.map(item => ({ uri: item.uri })), 'old configurations are cleared during activation');
  await commands.get('sensorViewer.open')(uri(original[0].uri));
  assert.deepEqual(structuredClone(saved), original.map(item => ({ uri: item.uri })));

});

test('restarting the extension restores inferred properties instead of stale manual settings', async () => {
  const file = path.join(__dirname, '../src/extension.js'), load = createRequire(file);
  const noop = () => ({}), commands = new Map();
  const uri = value => ({ path: new URL(value).pathname, fsPath: new URL(value).pathname, toString: () => value });
  let editor, saved = [];
  const vscode = {
    env: { language: 'en' }, EventEmitter: class { fire() {} event() {} }, Uri: { parse: uri },
    commands: { registerCommand: (name, handler) => { commands.set(name, handler); return {}; }, executeCommand: async () => {} },
    window: {
      tabGroups: { onDidChangeTabs: noop, onDidChangeTabGroups: noop }, createTreeView: noop,
      registerCustomEditorProvider: (_, provider) => { editor = provider; return {}; }, registerWebviewViewProvider: noop
    }
  };
  function activate() {
    const sandbox = { module: { exports: {} }, require: name => name === 'vscode' ? vscode : load(name) };
    vm.runInNewContext(fs.readFileSync(file, 'utf8'), sandbox);
    return sandbox.module.exports.activate({ extensionUri: '/extension', subscriptions: [], workspaceState: {
      get: () => structuredClone(saved), update: async (key, value) => { saved = structuredClone(value); }
    } });
  }
  let api = activate();
  const a = uri('file:///images/BGGR_32X24_12BIT_IN16_MSB_BE_OFFSET16.RAW');
  const b = uri('file:///images/NV12_64X48.YUV');
  editor.openCustomDocument(a);
  await commands.get('sensorViewer.open')(b);
  const config = api.getEntries().find(e => e.id === a.toString()).config;
  assert.equal(config.pattern, 'BGGR'); assert.equal(config.bitDepth, 12);
  assert.equal(config.width, 32); assert.equal(config.height, 24);
  assert.equal(config.containerBits, 16); assert.equal(config.alignment, 'msb');
  assert.equal(config.endian, 'big'); assert.equal(config.offset, 16);
  assert.equal(api.getEntries().find(e => e.id === b.toString()).config.layout, 'semi-uv');
  const manual = { ...config, pattern: 'RGBI', bitDepth: 8, width: 16, height: 12, containerBits: 0, alignment: 'lsb', endian: 'little', offset: 0 };
  saved.find(e => e.uri === a.toString()).config = manual;
  saved.find(e => e.uri === a.toString()).fps = 60;
  api = activate();
  editor.openCustomDocument(a);
  await commands.get('sensorViewer.open')(a);
  assert.deepEqual(structuredClone(api.getEntries().find(e => e.id === a.toString()).config), config);
  assert.equal(api.getEntries().find(e => e.id === a.toString()).sequence.fps, 24);
  assert.deepEqual(saved.find(e => e.uri === a.toString()), { uri: a.toString() });
  assert.equal(api.getEntries().length, 2);
});
