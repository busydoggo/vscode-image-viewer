'use strict';
// Keep runtime catalogs, localized manifest URLs and generated schema annotations in agreement.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const I18n = require('../media/i18n');
const Core = require('../media/core');
const { Decoder } = require('../src/decoder');
const { generate, manifestKeys, localizeSchema } = require('../scripts/localize');
const root = path.join(__dirname, '..');
const en = require('../locales/en.json'), zh = require('../locales/zh-cn.json');
const placeholders = text => [...text.matchAll(/\{([a-zA-Z][\w]*)\}/g)].map(match => match[1]).sort();

test('all catalogs have the same keys and interpolation placeholders', () => {
  for (const file of fs.readdirSync(path.join(root, 'locales')).filter(name => name.endsWith('.json'))) {
    const catalog = JSON.parse(fs.readFileSync(path.join(root, 'locales', file), 'utf8'));
    assert.deepEqual(Object.keys(catalog).sort(), Object.keys(en).sort(), file);
    for (const key of Object.keys(en)) {
      assert.equal(typeof catalog[key], 'string', key);
      assert.ok(catalog[key].length, key);
      assert.deepEqual(placeholders(catalog[key]), placeholders(en[key]), `${file}: ${key}`);
    }
  }
});

test('locale resolution supports VS Code tags and English fallback', () => {
  for (const tag of ['zh-cn', 'zh-CN', 'zh_CN', 'zh', 'zh-SG', 'zh-Hans', 'zh-Hans-CN']) assert.equal(I18n.create(tag).t('field.endian'), '字节端序');
  for (const tag of ['en', 'en-US', 'en-GB', 'fr', 'zh-tw', undefined, '../../bad']) assert.equal(I18n.create(tag).t('field.endian'), 'Byte Order');
  assert.equal(I18n.create('en').t('error.integer', { min: 4, max: 32 }), 'Enter an integer from 4 to 32');
  assert.equal(I18n.create('zh-cn').t('missing.key'), 'missing.key');
});

test('webviews share translations with Node and escape HTML and script data', () => {
  const source = fs.readFileSync(path.join(root, 'media/i18n.js'), 'utf8');
  const core = fs.readFileSync(path.join(root, 'media/core.js'), 'utf8');
  for (const locale of ['en', 'zh-cn']) {
    const browser = { SensorLocale: JSON.parse(I18n.serialize(locale)), SensorDemosaicDefaults: require('../media/demosaic-defaults.json') };
    vm.runInNewContext(fs.readFileSync(path.join(root, 'media/demosaic.js'), 'utf8'), browser);
    vm.runInNewContext(source, browser);
    vm.runInNewContext(core, browser);
    assert.equal(browser.SensorI18n.t('help.matrix.1'), I18n.create(locale).t('help.matrix.1'));
    const invalid = { ...browser.SensorCore.defaults(), width: 0 };
    assert.equal(browser.SensorCore.analyze(invalid, 100).errors.width, I18n.create(locale).t('error.integer', { min: 1, max: 65536 }));
  }
  const browser = { SensorLocale: { locale: 'zh-cn', messages: {}, fallback: en } };
  vm.runInNewContext(source, browser);
  assert.equal(browser.SensorI18n.t('field.endian'), 'Byte Order');
  assert.equal(I18n.create('en').th('error.report', { message: '<img src=x onerror="alert(1)">' }), 'Image Viewer: &lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
  const previous = zh['app.name'];
  try {
    zh['app.name'] = '</script>\u2028\u2029';
    // Exercise the serializer using a sandbox catalog so production data stays intact.
    const data = { SensorLocale: { locale: 'zh-cn', messages: zh, fallback: en } };
    vm.runInNewContext(source, data);
    const serialized = data.SensorI18n.serialize('zh-cn');
    assert.ok(!serialized.includes('</script>'));
    assert.ok(!serialized.includes('\u2028'));
    assert.equal(JSON.parse(serialized).messages['app.name'], zh['app.name']);
  } finally { zh['app.name'] = previous; }
});

test('manifest translations are generated from the same catalogs', () => {
  generate(true);
  const keys = manifestKeys(require('../package.json'));
  for (const [file, catalog] of [['package.nls.json', en], ['package.nls.zh-cn.json', zh]]) {
    const generated = JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
    for (const key of keys) assert.equal(generated[key], catalog[key]);
  }
});

test('localized demosaic schemas resolve manifest URLs and preserve all validation constraints', () => {
  const template = require('../media/demosaic-schema.json');
  const keys = manifestKeys(template);
  assert.equal(keys.length, 8);
  function constraints(value) {
    if (Array.isArray(value)) return value.map(constraints);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !['title', 'description'].includes(key)).map(([key, item]) => [key, constraints(item)]));
    return value;
  }
  assert.doesNotMatch(JSON.stringify(template), /\p{Script=Han}/u);
  assert.equal(require('../package.json').contributes.jsonValidation[0].url, '%demosaic.schema.url%');
  for (const [manifestFile, catalog] of [['package.nls.json', en], ['package.nls.zh-cn.json', zh]]) {
    const url = JSON.parse(fs.readFileSync(path.join(root, manifestFile), 'utf8'))['demosaic.schema.url'];
    const schema = JSON.parse(fs.readFileSync(path.join(root, url), 'utf8'));
    assert.deepEqual(schema, localizeSchema(template, catalog));
    assert.deepEqual(constraints(schema), constraints(template));
    assert.deepEqual(manifestKeys(schema), [], 'no untranslated placeholders reach the JSON editor');
    for (const key of keys) assert.ok(JSON.stringify(schema).includes(catalog[key]), key);
    if (catalog === en) assert.doesNotMatch(JSON.stringify(schema), /\p{Script=Han}/u);
    else assert.match(schema.title, /\p{Script=Han}/u);
    assert.equal(schema.properties.regularization.minimum, 0.01);
    assert.equal(schema.properties.directions.required.length, 8);
    assert.equal(schema.additionalProperties, false);
  }
});

test('schema localization rejects missing text instead of shipping placeholders and leaves its template intact', () => {
  const template = require('../media/demosaic-schema.json'), original = structuredClone(template);
  const incomplete = { ...en }; delete incomplete['demosaic.schema.uniform'];
  assert.throws(() => localizeSchema(template, incomplete), /Missing schema translation: demosaic.schema.uniform/);
  localizeSchema(template, en); localizeSchema(template, zh);
  assert.deepEqual(template, original);
});

test('extension activation selects the VS Code language and initializes localized webviews', () => {
  const extensionFile = path.join(root, 'src/extension.js');
  const requireFromExtension = require('node:module').createRequire(extensionFile);
  try {
    for (const language of ['zh-cn', 'en', 'de']) {
      let provider;
      const noop = () => ({});
      const vscode = {
        env: { language },
        EventEmitter: class { event() {} },
        Uri: { joinPath: (...segments) => segments.join('/') },
        commands: { registerCommand: noop },
        window: {
          tabGroups: { onDidChangeTabs: noop, onDidChangeTabGroups: noop },
          createTreeView: noop, registerCustomEditorProvider: noop,
          registerWebviewViewProvider(id, value) { provider = value; return {}; }
        }
      };
      const sandbox = { module: { exports: {} }, require: name => name === 'vscode' ? vscode : requireFromExtension(name) };
      vm.runInNewContext(fs.readFileSync(extensionFile, 'utf8'), sandbox);
      sandbox.module.exports.activate({ workspaceState: { get: () => [] }, subscriptions: [], extensionUri: '/extension' });
      const view = { onDidDispose: noop, webview: { asWebviewUri: uri => uri, cspSource: 'vscode-webview:', onDidReceiveMessage: noop, postMessage: noop } };
      provider.resolveWebviewView(view);
      const locale = language === 'zh-cn' ? 'zh-cn' : 'en';
      assert.equal(I18n.getLocale(), locale);
      assert.ok(view.webview.html.includes(`<html lang="${locale}">`));
      assert.ok(view.webview.html.includes(`<title>${I18n.t('app.name')}</title>`));
      const browser = {};
      const initialization = view.webview.html.match(/<script nonce="[^"]+">(globalThis.SensorLocale = [\s\S]*?;)<\/script>/)[1];
      vm.runInNewContext(initialization, browser);
      vm.runInNewContext(fs.readFileSync(path.join(root, 'media/i18n.js'), 'utf8'), browser);
      assert.equal(browser.SensorI18n.t('field.endian'), I18n.t('field.endian'));
      assert.ok(view.webview.html.indexOf('/media/i18n.js') < view.webview.html.indexOf('/media/core.js'));
    }
  } finally { I18n.setLocale('en'); }
});

test('runtime translation keys exist and UI strings stay outside implementation files', () => {
  for (const directory of ['media', 'src']) for (const name of fs.readdirSync(path.join(root, directory)).filter(name => name.endsWith('.js'))) {
    const source = fs.readFileSync(path.join(root, directory, name), 'utf8');
    assert.doesNotMatch(source, /\p{Script=Han}/u, `${directory}/${name}`);
    for (const match of source.matchAll(/\b(?:t|th)\('([^']+)'/g)) assert.ok(Object.hasOwn(en, match[1]), `${name}: ${match[1]}`);
  }
});

test('core validation and decoder worker errors follow the requested language', async () => {
  const decoder = new Decoder();
  try {
    for (const locale of ['en', 'zh-cn']) {
      I18n.setLocale(locale);
      const c = { ...Core.defaults(), width: 0 };
      const expected = I18n.t('error.integer', { min: 1, max: 65536 });
      assert.equal(Core.analyze(c, 16).errors.width, expected);
      await assert.rejects(decoder.decode({ config: c, bytes: Buffer.alloc(16), locale }), error => error.message === expected);
    }
  } finally { decoder.dispose(); I18n.setLocale('en'); }
});
