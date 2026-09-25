'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
for (const folder of ['src', 'media', 'scripts', 'test']) {
  for (const name of fs.readdirSync(folder).filter(n => n.endsWith('.js'))) {
    const result = spawnSync(process.execPath, ['--check', path.join(folder, name)], { stdio: 'inherit' });
    if (result.status) process.exit(result.status);
  }
}
const manifest = require('../package.json');
// Check generated resources without rewriting them, including each localized demosaic schema.
require('./localize').generate(true);
for (const containers of Object.values(manifest.contributes.viewsContainers)) for (const container of containers) {
  if (!fs.existsSync(container.icon) || !manifest.contributes.views[container.id]) throw new Error(`Invalid container ${container.id}`);
}
console.log('JavaScript syntax and extension manifest: OK');
