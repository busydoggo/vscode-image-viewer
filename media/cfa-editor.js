(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CfaEditor = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const valid = value => /^[RGBI]$/.test(value);
  // Accept one character per cell and normalize ASCII channel letters before validation.
  function normalize(value) { return ([...String(value)][0] || '').replace(/[a-z]/g, char => char.toUpperCase()); }

  function create({ document, container, t, onChange }) {
    let sourcePattern, sourceId;
    const cells = [];
    const heading = document.createElement('span'); heading.id = 'pattern-label'; heading.className = 'field-label'; heading.textContent = t('field.pattern');
    const grid = document.createElement('div'); grid.className = 'mosaic'; grid.setAttribute('role', 'group'); grid.setAttribute('aria-labelledby', heading.id);
    const hint = document.createElement('span'); hint.id = 'pattern-hint'; hint.className = 'field-hint'; hint.textContent = t('hint.pattern');
    const error = document.createElement('span'); error.id = 'pattern-error'; error.className = 'field-error'; error.setAttribute('aria-live', 'polite'); error.hidden = true;
    container.append(heading, grid, hint, error);

    function style(cell, flash) {
      const invalid = !valid(cell.value);
      cell.className = 'cfa-cell' + (invalid ? ' cfa-cell-invalid' : ' mosaic-' + cell.value);
      cell.setAttribute('aria-invalid', String(invalid));
      if (invalid && flash) {
        // Restart a previous warning, without replacing the focused input.
        void cell.offsetWidth;
        cell.classList.add('cfa-cell-warning');
      }
    }
    function commit(cell) {
      cell.value = normalize(cell.value);
      style(cell, true);
      // A placeholder preserves an invalid/empty cell's position in the 2×2 tile.
      sourcePattern = cells.map(input => valid(input.value) ? input.value : '?').join('');
      onChange(sourcePattern);
      cell.select();
    }
    for (let index = 0; index < 4; index++) {
      const cell = document.createElement('input');
      cell.type = 'text'; cell.id = `pattern-${index}`; cell.maxLength = 1;
      cell.autocomplete = 'off'; cell.spellcheck = false; cell.setAttribute('autocapitalize', 'characters');
      cell.setAttribute('aria-label', t('cfa.cell', { row: Math.floor(index / 2) + 1, column: index % 2 + 1 }));
      cell.setAttribute('aria-describedby', `${hint.id} ${error.id}`);
      // Wait for IME composition to finish before applying one-character normalization.
      let composing = false;
      cell.addEventListener('compositionstart', () => { composing = true; });
      cell.addEventListener('compositionend', () => { composing = false; commit(cell); });
      cell.addEventListener('input', event => { if (!composing && !event.isComposing) commit(cell); });
      cell.addEventListener('focus', () => cell.select());
      cell.addEventListener('click', () => cell.select());
      cell.addEventListener('paste', event => {
        if (!event.clipboardData) return;
        event.preventDefault(); cell.value = normalize(event.clipboardData.getData('text')); commit(cell);
      });
      // End the temporary flash but retain the dashed invalid state until the input is corrected.
      cell.addEventListener('animationend', event => {
        if (event.animationName === 'cfa-invalid-flash') cell.classList.remove('cfa-cell-warning');
      });
      cells.push(cell); grid.append(cell);
    }
    return {
      // Ignore a same-file state echo so typing does not reset selection or restart warnings.
      setPattern(pattern, id) {
        if (sourcePattern === pattern && sourceId === id) return;
        sourcePattern = pattern; sourceId = id;
        const values = [...String(pattern || '').toUpperCase().replace(/[\s,;/|]/g, '')];
        cells.forEach((cell, index) => { cell.value = normalize(values[index] || ''); style(cell, false); });
      },
      setError(message) { error.textContent = message || ''; error.hidden = !message; grid.setAttribute('aria-invalid', String(!!message)); grid.setAttribute('data-tooltip', message || hint.textContent); }
    };
  }
  return { create, normalize };
});
