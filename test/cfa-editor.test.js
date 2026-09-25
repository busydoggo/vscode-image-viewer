'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { create, normalize } = require('../media/cfa-editor');
const I18n = require('../media/i18n');

class Element {
  constructor(tag) { this.tag = tag; this.children = []; this.listeners = {}; this.attributes = {}; this.className = ''; this.value = ''; }
  append(...children) { this.children.push(...children); }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(name, handler) { (this.listeners[name] ||= []).push(handler); }
  fire(name, event = {}) { for (const handler of this.listeners[name] || []) handler(event); }
  select() { this.selected = true; }
  get offsetWidth() { return 44; }
  get classList() {
    return {
      add: name => { this.className += ' ' + name; },
      remove: name => { this.className = this.className.split(' ').filter(value => value !== name).join(' '); }
    };
  }
}
function fixture(pattern = 'RGGB') {
  const container = new Element('div'), changes = [];
  const document = { createElement: tag => new Element(tag) };
  const editor = create({ document, container, t: I18n.create('en').t, onChange: value => { changes.push(value); editor.setPattern(value, 'a'); } });
  editor.setPattern(pattern, 'a');
  const grid = container.children[1], cells = grid.children;
  return { editor, cells, changes, grid, container, input(index, value) { cells[index].value = value; cells[index].fire('input'); } };
}

test('four individually labeled cells normalize lowercase and retain row-major order', () => {
  const f = fixture('R G / G B');
  assert.deepEqual(f.cells.map(cell => cell.value), ['R', 'G', 'G', 'B']);
  assert.equal(f.cells.length, 4);
  assert.equal(f.cells[3].attributes['aria-label'], 'Array row 2, column 2');
  assert.ok(f.cells.every(cell => cell.maxLength === 1));
  f.input(0, 'b');
  assert.equal(f.cells[0].value, 'B'); assert.equal(f.changes.at(-1), 'BGGB');
  assert.match(f.cells[0].className, /mosaic-B/);
  assert.equal(f.cells[0].attributes['aria-invalid'], 'false');
  assert.equal(normalize('rgb'), 'R'); assert.equal(normalize('ß'), 'ß');
});

test('invalid cells flash without losing focus or restarting on state echo, then remain marked', () => {
  const f = fixture(); const cell = f.cells[1];
  f.input(1, 'x');
  assert.equal(cell.value, 'X'); assert.equal(f.changes.at(-1), 'R?GB');
  assert.equal(cell.attributes['aria-invalid'], 'true'); assert.equal(cell.selected, true);
  assert.match(cell.className, /cfa-cell-warning/);
  f.editor.setPattern('R?GB', 'a'); assert.equal(f.cells[1], cell); assert.equal(cell.value, 'X');
  cell.fire('animationend', { animationName: 'unrelated' }); assert.match(cell.className, /cfa-cell-warning/);
  cell.fire('animationend', { animationName: 'cfa-invalid-flash' });
  assert.doesNotMatch(cell.className, /cfa-cell-warning/); assert.match(cell.className, /cfa-cell-invalid/);
  f.input(1, 'q'); assert.match(cell.className, /cfa-cell-warning/);
  f.input(1, 'g'); assert.equal(f.changes.at(-1), 'RGGB'); assert.doesNotMatch(cell.className, /invalid|warning/);
});

test('empty cells and delimiters retain their position until corrected', () => {
  const f = fixture();
  for (const value of ['', '/', ' ', ',', '中', '💡']) {
    f.input(1, value); assert.equal(f.changes.at(-1), 'R?GB');
    assert.equal(f.cells[2].value, 'G'); assert.equal(f.cells[3].value, 'B');
  }
  f.input(1, 'g'); assert.equal(f.changes.at(-1), 'RGGB');
});

test('presets and file changes reset drafts and warnings; unrelated updates preserve them', () => {
  const f = fixture(); f.input(0, 'x');
  f.editor.setPattern('RGBI', 'a'); assert.deepEqual(f.cells.map(cell => cell.value), ['R', 'G', 'B', 'I']);
  assert.ok(f.cells.every(cell => !/invalid|warning/.test(cell.className)));
  f.input(0, 'x'); f.editor.setPattern('?GBI', 'b');
  assert.equal(f.cells[0].value, '?'); assert.doesNotMatch(f.cells[0].className, /warning/);
  assert.match(f.cells[0].className, /invalid/);
});

test('paste takes one character and composition is normalized only after completion', () => {
  const f = fixture(); let prevented = false;
  f.cells[0].fire('paste', { preventDefault: () => { prevented = true; }, clipboardData: { getData: () => 'bggr' } });
  assert.equal(prevented, true); assert.equal(f.cells[0].value, 'B'); assert.equal(f.changes.at(-1), 'BGGB');
  const before = f.changes.length;
  f.cells[0].fire('compositionstart'); f.cells[0].value = 'r'; f.cells[0].fire('input', { isComposing: true });
  assert.equal(f.changes.length, before);
  f.cells[0].fire('compositionend'); assert.equal(f.cells[0].value, 'R'); assert.equal(f.changes.at(-1), 'RGGB');
  f.editor.setError('Invalid array'); assert.equal(f.grid.attributes['aria-invalid'], 'true');
  f.editor.setError(); assert.equal(f.grid.attributes['aria-invalid'], 'false');
});
