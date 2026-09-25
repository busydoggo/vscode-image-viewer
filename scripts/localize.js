'use strict';
// locales/*.json are the source of truth for manifests and JSON schema text.
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
// The same full-string %key% syntax is used by the manifest and the schema template.
function manifestKeys(value, keys = new Set()) {
  if (typeof value === 'string') { const match = /^%([^%]+)%$/.exec(value); if (match) keys.add(match[1]); }
  else if (value && typeof value === 'object') for (const child of Object.values(value)) manifestKeys(child, keys);
  return [...keys].sort();
}
// Translate values only. Property names, references, numeric limits and validation rules stay intact.
function localizeSchema(value, catalog) {
  if (typeof value === 'string') {
    const match = /^%([^%]+)%$/.exec(value);
    if (!match) return value;
    if (typeof catalog[match[1]] !== 'string' || !catalog[match[1]]) throw new Error(`Missing schema translation: ${match[1]}`);
    return catalog[match[1]];
  }
  if (Array.isArray(value)) return value.map(item => localizeSchema(item, catalog));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, localizeSchema(item, catalog)]));
  return value;
}
function generate(check = false) {
  const keys = manifestKeys(JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')));
  const schema = JSON.parse(fs.readFileSync(path.join(root, 'media/demosaic-schema.json'), 'utf8'));
  function output(file, value) {
    const text = JSON.stringify(value, null, 2) + '\n';
    // Check mode is read-only so stale generated resources fail validation instead of being repaired silently.
    if (check) {
      if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== text) throw new Error(`${path.relative(root, file)} is stale; run npm run localize`);
    } else {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, text);
    }
  }
  for (const file of fs.readdirSync(path.join(root, 'locales')).filter(name => /^[a-z0-9-]+\.json$/.test(name))) {
    const locale = file.slice(0, -5), catalog = JSON.parse(fs.readFileSync(path.join(root, 'locales', file), 'utf8'));
    const entries = keys.map(key => { if (typeof catalog[key] !== 'string') throw new Error(`${file}: missing ${key}`); return [key, catalog[key]]; });
    // VS Code localizes this manifest URL and loads the matching pre-generated schema offline.
    const schemaUrl = `./locales/generated/demosaic-schema.${locale}.json`;
    if (catalog['demosaic.schema.url'] !== schemaUrl) throw new Error(`${file}: demosaic.schema.url must be ${schemaUrl}`);
    // Keep generated language text under locales; media contains only the structural template.
    output(path.join(root, schemaUrl), localizeSchema(schema, catalog));
    output(path.join(root, locale === 'en' ? 'package.nls.json' : `package.nls.${locale}.json`), Object.fromEntries(entries));
  }
}
if (require.main === module) { generate(process.argv.includes('--check')); console.log('Localization manifests: OK'); }
module.exports = { generate, manifestKeys, localizeSchema };
