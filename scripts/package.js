'use strict';
// A dependency-free VSIX packer (ZIP + the standard VS Code VSIX manifest).
const fs = require('node:fs');
const path = require('node:path');
const { deflateRawSync } = require('node:zlib');
const { crc32 } = require('../src/png');
const pkg = require('../package.json');
// Regenerate manifest translations and localized schemas before collecting package assets.
require('./localize').generate();
const messages = require('../package.nls.json');
const localized = value => value.replace(/^%([^%]+)%$/, (_, key) => messages[key]);
pkg.displayName = localized(pkg.displayName); pkg.description = localized(pkg.description);
const entries = [];
function add(name, bytes) { entries.push({ name, bytes: Buffer.from(bytes) }); }
function folder(dir) {
  for (const name of fs.readdirSync(dir)) { const file = path.join(dir, name); if (fs.statSync(file).isDirectory()) folder(file); else add('extension/' + file.split(path.sep).join('/'), fs.readFileSync(file)); }
}
// Recursive locale collection includes generated schemas referenced by localized manifest URLs.
for (const dir of ['src', 'media', 'locales']) folder(dir);
for (const file of fs.readdirSync('.').filter(name => /^package\.nls(?:\.[a-z0-9-]+)?\.json$/.test(name))) add('extension/' + file, fs.readFileSync(file));
for (const file of ['package.json', 'README.md', 'README.zh-CN.md', 'LICENSE']) add('extension/' + file, fs.readFileSync(file));
const xml = value => String(value).replace(/[&<>"']/g, v => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[v]);
// Include the PNG icon in VSIX metadata as well as in the extension manifest.
const iconAsset = pkg.icon ? `<Asset Type="Microsoft.VisualStudio.Services.Icons.Default" Path="extension/${xml(pkg.icon)}" Addressable="true"/>` : '';
add('[Content_Types].xml', '<?xml version="1.0" encoding="utf-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="json" ContentType="application/json"/><Default Extension="js" ContentType="application/javascript"/><Default Extension="css" ContentType="text/css"/><Default Extension="svg" ContentType="image/svg+xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="md" ContentType="text/markdown"/><Default Extension="vsixmanifest" ContentType="text/xml"/></Types>');
add('extension.vsixmanifest', `<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011"><Metadata><Identity Language="en-US" Id="${pkg.name}" Version="${pkg.version}" Publisher="${pkg.publisher}"/><DisplayName>${xml(pkg.displayName)}</DisplayName><Description xml:space="preserve">${xml(pkg.description)}</Description><Tags>${pkg.keywords.join(',')}</Tags><Categories>${pkg.categories.join(',')}</Categories><Properties><Property Id="Microsoft.VisualStudio.Code.Engine" Value="${pkg.engines.vscode}"/><Property Id="Microsoft.VisualStudio.Code.ExtensionDependencies" Value=""/><Property Id="Microsoft.VisualStudio.Code.ExtensionPack" Value=""/><Property Id="Microsoft.VisualStudio.Code.LocalizedLanguages" Value=""/></Properties><License>extension/LICENSE</License></Metadata><Installation><InstallationTarget Id="Microsoft.VisualStudio.Code"/></Installation><Dependencies/><Assets><Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true"/><Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/README.md" Addressable="true"/><Asset Type="Microsoft.VisualStudio.Services.Content.License" Path="extension/LICENSE" Addressable="true"/>${iconAsset}</Assets></PackageManifest>`);
const local = [], central = [];
let offset = 0;
for (const entry of entries) {
  const name = Buffer.from(entry.name), compressed = deflateRawSync(entry.bytes), checksum = crc32(entry.bytes);
  const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x800, 6); header.writeUInt16LE(8, 8); header.writeUInt16LE(0x21, 12);
  header.writeUInt32LE(checksum, 14); header.writeUInt32LE(compressed.length, 18); header.writeUInt32LE(entry.bytes.length, 22); header.writeUInt16LE(name.length, 26);
  local.push(header, name, compressed);
  const record = Buffer.alloc(46); record.writeUInt32LE(0x02014b50); record.writeUInt16LE(20, 4); header.copy(record, 6, 4, 30); record.writeUInt32LE(offset, 42); central.push(record, name);
  offset += header.length + name.length + compressed.length;
}
const directory = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
const output = `${pkg.name}-${pkg.version}.vsix`; fs.writeFileSync(output, Buffer.concat([...local, directory, end])); console.log(`${output}: ${entries.length} files, ${fs.statSync(output).size} bytes`);
