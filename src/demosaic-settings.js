'use strict';
const Demosaic = require('../media/demosaic');
const { t } = require('../media/i18n');

function createSettings(vscode, context, onChange, report) {
  // Global storage keeps user coefficients separate from generated resources and extension updates.
  const uri = context.globalStorageUri && vscode.Uri.joinPath(context.globalStorageUri, 'demosaic-coefficients.json');
  let current = Demosaic.defaults, serialized = JSON.stringify(current), disposed = false, queue = Promise.resolve();
  const missing = error => error.code === 'FileNotFound' || error.code === 'ENOENT';
  function reload() {
    // Save and filesystem events may overlap; serialize reloads to preserve their ordering.
    queue = queue.then(async () => {
      if (!uri || disposed) return;
      try {
        let next;
        try { next = JSON.parse(Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8')); }
        catch (error) { if (missing(error)) next = Demosaic.defaults; else throw error; }
        // Commit only complete, valid settings; malformed edits leave the current preview usable.
        Demosaic.validate(next);
        const text = JSON.stringify(next);
        if (!disposed && text !== serialized) { current = next; serialized = text; onChange(); }
      } catch (error) {
        if (!disposed) report(new Error(t('demosaic.invalid', { detail: error.message })));
      }
    });
    return queue;
  }
  const ready = reload();
  if (uri) {
    const matches = value => value.toString() === uri.toString();
    context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(document => { if (matches(document.uri)) void reload(); }));
    const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(context.globalStorageUri, 'demosaic-coefficients.json'));
    context.subscriptions.push(watcher, watcher.onDidChange(reload), watcher.onDidCreate(reload), watcher.onDidDelete(reload));
  }
  context.subscriptions.push({ dispose() { disposed = true; } });
  return {
    ready,
    get: () => current,
    async edit() {
      await ready;
      await vscode.workspace.fs.createDirectory(context.globalStorageUri);
      // Create defaults only when absent; opening the editor must not overwrite user work.
      try { await vscode.workspace.fs.stat(uri); }
      catch (error) {
        if (!missing(error)) throw error;
        await vscode.workspace.fs.writeFile(uri, Buffer.from(JSON.stringify(Demosaic.defaults, null, 2) + '\n'));
      }
      const document = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.Beside, preview: false });
    }
  };
}
module.exports = { createSettings };
