(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    const fs = require('node:fs'), path = require('node:path');
    const directory = path.join(__dirname, '../locales');
    // Only top-level catalog JSON files are messages; generated schema subdirectories are excluded.
    const catalogs = Object.fromEntries(fs.readdirSync(directory).filter(name => /^[a-z0-9-]+\.json$/.test(name)).map(name => [name.slice(0, -5), JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'))]));
    module.exports = factory(catalogs, 'en');
  } else {
    const data = root.SensorLocale;
    root.SensorI18n = factory({ en: data.fallback, [data.locale]: data.messages }, data.locale);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (catalogs, initialLocale) {
  'use strict';
  // Normalize VS Code language tags and keep unsupported locales on the English fallback.
  function resolveLocale(language) {
    const tag = String(language || 'en').toLowerCase().replace(/_/g, '-');
    if (Object.hasOwn(catalogs, tag)) return tag;
    if (tag === 'zh' || tag === 'zh-sg' || tag.startsWith('zh-hans')) return Object.hasOwn(catalogs, 'zh-cn') ? 'zh-cn' : 'en';
    const base = tag.split('-')[0];
    return Object.hasOwn(catalogs, base) ? base : 'en';
  }
  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  }
  function create(language) {
    const locale = resolveLocale(language);
    function t(key, args = {}) {
      // Fall back per key so an incomplete translation cannot blank a label or error message.
      const value = catalogs[locale]?.[key] ?? catalogs.en?.[key] ?? key;
      return value.replace(/\{([a-zA-Z][\w]*)\}/g, (match, name) => Object.hasOwn(args, name) ? String(args[name]) : match);
    }
    return { locale, t, th: (key, args) => escapeHtml(t(key, args)), number: value => Number(value).toLocaleString(locale) };
  }
  let current = create(initialLocale);
  return {
    create, resolveLocale, escapeHtml,
    setLocale(language) { current = create(language); return current.locale; },
    getLocale: () => current.locale,
    t: (key, args) => current.t(key, args),
    th: (key, args) => current.th(key, args),
    number: value => current.number(value),
    // Keep translations inert when embedding them in a nonced webview script.
    serialize(language) {
      const locale = resolveLocale(language);
      return JSON.stringify({ locale, messages: catalogs[locale], fallback: catalogs.en }).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
    }
  };
});
