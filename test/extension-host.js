'use strict';
const vscode = require('vscode');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
async function until(check, label) {
  const start = Date.now();
  while (Date.now() - start < 20000) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 100)); }
  throw new Error(`Timed out: ${label}`);
}
async function run() {
  // Read the published identity from the manifest so renaming does not break host checks.
  const manifest = require('../package.json');
  const extension = vscode.extensions.getExtension(`${manifest.publisher}.${manifest.name}`); assert.ok(extension);
  const api = await extension.activate();
  const commands = await vscode.commands.getCommands();
  for (const command of ['sensorViewer.import', 'sensorViewer.open', 'sensorViewer.inspector.focus', 'workbench.view.extension.sensor-properties']) assert.ok(commands.includes(command), command);
  const checked = [], defaultEditorChecks = [];
  for (const name of ['color-bars.png', 'color-bars.jpg', 'bayer-rggb-320x240.raw', 'nv12-320x240.yuv', 'offset16-320x240.bin', 'luma-320x240.y', 'chroma-320x240.uv', 'sequence-rggb-320x240.raw', 'sequence-i420-320x240.yuv']) {
    const uri = vscode.Uri.file(path.join(__dirname, '../fixtures', name));
    if (/\.(raw|y|yuv|uv)$/i.test(name)) {
      await vscode.commands.executeCommand('vscode.open', uri, { preview: false });
      defaultEditorChecks.push(name);
    } else await vscode.commands.executeCommand('sensorViewer.open', uri);
    await until(() => api.getEntries().find(e => e.id === uri.toString())?.metadata?.width === 320, name);
    const entry = api.getEntries().find(e => e.id === uri.toString()); assert.equal(entry.error, undefined); assert.equal(entry.metadata.height, 240);
    if (name.startsWith('sequence-')) { assert.equal(entry.sequence.enabled, true); assert.equal(entry.sequence.frameCount, 24); assert.equal(entry.sequence.frame, 1); }
    if (name.endsWith('.y')) { assert.equal(entry.config.yuvPlanes, 'y'); assert.equal(entry.validation.requiredBytes, 320 * 240); }
    if (name.endsWith('.uv')) { assert.equal(entry.config.yuvPlanes, 'uv'); assert.equal(entry.validation.requiredBytes, 320 * 240 / 2); }
    checked.push(name);
  }
  const tabs = vscode.window.tabGroups.all.flatMap(group => group.tabs).filter(tab => tab.input instanceof vscode.TabInputCustom && tab.input.viewType === 'sensorViewer.image');
  assert.equal(tabs.length, 9);
  const imageUri = vscode.Uri.file(path.join(__dirname, '../fixtures/sequence-i420-320x240.yuv'));
  const isImageActive = () => api.getActiveEntry()?.id === imageUri.toString();
  await until(isImageActive, 'properties follow the selected image');
  await vscode.commands.executeCommand('sensorViewer.inspector.focus');
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(isImageActive(), true, 'inspector focus must preserve image properties');

  await until(() => api.isPropertiesVisible(), 'image properties are visible');
  await vscode.commands.executeCommand('sensorViewer.properties');
  await until(() => !api.isPropertiesVisible(), 'properties command hides the secondary sidebar');
  assert.equal(isImageActive(), true, 'hiding the sidebar keeps the image selected');
  await vscode.commands.executeCommand('sensorViewer.properties');
  await until(() => api.isPropertiesVisible(), 'properties command reopens the secondary sidebar');
  await vscode.commands.executeCommand('workbench.action.nextAuxiliaryBarView');
  await until(() => !api.isPropertiesVisible(), 'another secondary sidebar container is selected');
  await vscode.commands.executeCommand('sensorViewer.properties');
  await until(() => api.isPropertiesVisible(), 'properties command switches from another container to image properties');

  const text = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(__dirname, '../README.md')));
  await vscode.window.showTextDocument(text, { preview: false });
  await until(() => api.getActiveEntry() === null, 'text editor clears image properties');
  await vscode.commands.executeCommand('sensorViewer.open', imageUri);
  await until(isImageActive, 'returning to the image restores properties');

  const other = vscode.window.createWebviewPanel('sensorViewer.test.other', 'Other editor', vscode.ViewColumn.Active, {});
  await until(() => api.getActiveEntry() === null, 'another webview clears image properties');
  other.dispose();
  await until(isImageActive, 'closing another webview restores image properties');

  await vscode.window.showTextDocument(text, { viewColumn: vscode.ViewColumn.Beside, preview: false });
  await until(() => api.getActiveEntry() === null, 'active text split clears properties while an image remains visible');
  assert.ok(vscode.window.tabGroups.all.some(group => group.activeTab?.input instanceof vscode.TabInputCustom));
  await vscode.commands.executeCommand('workbench.action.focusFirstEditorGroup');
  await until(isImageActive, 'focusing the image split restores its properties');
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  await until(() => api.getActiveEntry() === null, 'closing all editors clears properties');
  assert.equal(api.getEntries().length, 9, 'clearing properties preserves the imported file list');
  await fs.mkdir(path.join(__dirname, '../test-results'), { recursive: true });
  await fs.writeFile(path.join(__dirname, '../test-results/extension-host.json'), JSON.stringify({ status: 'passed', vscode: vscode.version, checked, defaultEditorChecks, customEditorTabs: tabs.length, propertyToggleChecks: ['hide', 'reopen', 'switch from another container'], activeEditorChecks: ['inspector focus', 'text editor', 'other webview', 'split groups', 'restore image', 'close all editors'] }, null, 2));
  console.log('Extension host smoke tests passed:', checked.join(', '));
}
module.exports = { run };
