'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');
const { test } = require('node:test');

function checkRendering() {
  const check = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  const cells = [...boardEl.children];
  const tiles = cells.map((cell) => cell.firstElementChild);
  check(cells.length === 16, 'The board must have 16 cells');
  check(tiles.every((tile) => tile && tile.classList.contains('tile')),
    'Each cell must retain one tile element');

  const assertStableBoard = () => {
    check(boardEl.children.length === 16, 'The cell count must remain constant');
    cells.forEach((cell, index) => {
      check(boardEl.children[index] === cell, 'Cells must not be recreated or reordered');
      check(cell.children.length === 1 && cell.firstElementChild === tiles[index],
        'Tile elements must be reused, including when a cell is empty');
      const value = state.grid[Math.floor(index / 4)][index % 4];
      check(tiles[index].textContent === (value ? String(value) : ''),
        'Tile labels must match the grid');
      check(tiles[index].hidden === !value, 'Empty tiles must be hidden');
      check(tiles[index].className === (value ? `tile tile-${value}` : 'tile'),
        'Tile colors must match the current value without stale classes');
    });
  };
  assertStableBoard();
  check(tiles.filter((tile) => !tile.hidden).length === 2,
    'A new game must display two starting tiles');
  check(undoBtn.disabled, 'Undo must be disabled at the start');

  state.grid = [
    [2, 4, 8, 16],
    [32, 64, 128, 256],
    [512, 1024, 2048, 0],
    [0, 0, 0, 0],
  ];
  state.newTile = null;

  // Fail on synchronous geometry reads, even if a future read happens on a detached tile.
  const originalCreateElement = document.createElement;
  const originalRect = Element.prototype.getBoundingClientRect;
  const geometry = new Map();
  for (const name of ['offsetWidth', 'offsetHeight', 'clientWidth', 'clientHeight']) {
    geometry.set(name, Object.getOwnPropertyDescriptor(HTMLElement.prototype, name));
    Object.defineProperty(HTMLElement.prototype, name, {
      configurable: true,
      get() { throw new Error(`Rendering must not read ${name}`); },
    });
  }
  Element.prototype.getBoundingClientRect = () => {
    throw new Error('Rendering must not read element bounds');
  };
  document.createElement = () => {
    throw new Error('Rendering must not create new elements');
  };

  try {
    performance.mark('render-start');
    render();
    performance.mark('render-end');
    assertStableBoard();
    const unchangedAnimation = tiles[0].getAnimations()[0];
    check(unchangedAnimation, 'A changed tile must have a pop animation');
    check(unchangedAnimation.effect.getTiming().duration === 150,
      'Changed tiles must retain the pop animation duration');

    const observer = new MutationObserver(() => {});
    observer.observe(boardEl, { subtree: true, childList: true, attributes: true, characterData: true });
    render();
    check(observer.takeRecords().length === 0, 'Unchanged rendering must not mutate the board');
    check(tiles[0].getAnimations()[0] === unchangedAnimation,
      'Unchanged tiles must not restart animations');
    observer.disconnect();

    state.grid[0][1] = 8;
    state.grid[2][2] = 0;
    state.grid[3][3] = 4;
    state.newTile = { r: 3, c: 3 };
    state.score = 24;
    state.best = 48;
    state.history = [{ grid: emptyGrid() }];
    render();
    assertStableBoard();
    check(tiles[0].getAnimations()[0] === unchangedAnimation,
      'Updating another tile must not replay an unchanged tile animation');
    check(tiles[10].getAnimations().length === 0, 'Clearing a tile must cancel its animation');
    check(getComputedStyle(tiles[10]).display === 'none', 'Empty tiles must not be visible');
    const spawnAnimation = tiles[15].getAnimations()[0];
    check(spawnAnimation.effect.getTiming().duration === 200,
      'A spawned tile must use the appear animation duration');
    check(spawnAnimation.effect.getKeyframes()[0].transform === 'scale(0)',
      'A spawned tile must grow from zero');
    check(scoreEl.textContent === '24' && bestEl.textContent === '48',
      'Score and best score displays must still update');
    check(!undoBtn.disabled, 'Undo must be enabled when history is available');
    check(state.newTile === null, 'A spawn marker must be consumed after rendering');
    render();
    check(tiles[15].getAnimations()[0] === spawnAnimation,
      'Rendering again must not replay the spawn animation');

    state.newTile = { r: 3, c: 3 };
    render();
    check(tiles[15].getAnimations()[0] !== spawnAnimation,
      'A new tile must animate even if its value matches the previous occupant');

    Math.random = () => 0;
    newBtn.click();
    assertStableBoard();
    const initialGrid = JSON.stringify(state.grid);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    assertStableBoard();
    check(JSON.stringify(state.grid) !== initialGrid, 'Keyboard moves must still update the grid');
    undoBtn.click();
    assertStableBoard();
    check(JSON.stringify(state.grid) === initialGrid, 'Undo must restore the displayed board');
    check(undoBtn.disabled, 'Undo must be disabled after restoring the last move');
    showMessage('Game over', false);
    retryBtn.click();
    assertStableBoard();
    check(messageEl.classList.contains('hidden'), 'Retry must dismiss the game-over message');
    for (let i = 0; i < 40; i++) {
      move(['down', 'right', 'up', 'left'][i % 4]);
      assertStableBoard();
      if (state.over) newGame();
    }
    newGame();
    assertStableBoard();
    performance.mark('repeated-render-start');
    for (let i = 0; i < 40; i++) {
      state.grid = Array.from({ length: 4 }, () => Array(4).fill(i % 2 ? 2 : 4));
      render();
    }
    performance.mark('repeated-render-end');
    assertStableBoard();
  } finally {
    document.createElement = originalCreateElement;
    Element.prototype.getBoundingClientRect = originalRect;
    for (const [name, descriptor] of geometry) {
      if (descriptor) Object.defineProperty(HTMLElement.prototype, name, descriptor);
      else delete HTMLElement.prototype[name];
    }
  }

  state.grid = emptyGrid();
  state.grid[0] = [2, 128, 512, 1024];
  render();
  for (const animation of boardEl.getAnimations({ subtree: true })) animation.finish();
  const widths = [460, 320, 288, 460];
  for (const width of widths) {
    boardEl.style.width = `${width}px`;
    boardEl.style.height = `${width}px`;
    const cellWidth = cells[0].getBoundingClientRect().width;
    for (let i = 0; i < 4; i++) {
      const fontSize = parseFloat(getComputedStyle(tiles[i]).fontSize);
      const expected = cellWidth < 80 ? cellWidth * 0.45 : (i === 1 || i === 2 ? 38.4 : 48);
      check(Math.abs(fontSize - expected) < 0.1,
        `Tile ${i} at board width ${width} must resize using CSS, got ${fontSize}, expected ${expected}`);
      check(tiles[i].style.fontSize === '', 'Tile sizes must not use JavaScript inline styles');
    }
  }
  assertStableBoard();
  return { persistentCells: cells.length, persistentTiles: tiles.length, responsiveWidths: widths };
}

test('Chromium reuses the board without layout reads or replaying unchanged tile animations', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'merge-2048-rendering-'));
  try {
    const html = readFileSync(join(__dirname, 'index.html'), 'utf8');
    const source = readFileSync(join(__dirname, 'game.js'), 'utf8');
    const css = readFileSync(join(__dirname, 'style.css'), 'utf8');
    const page = html
      .replace(/<link[^>]+style\.css[^>]*>/, `<style>${css}</style>`)
      .replace('<script src="game.js"></script>', `
        <pre id="result"></pre>
        <script>
          window.addEventListener('error', (event) => {
            document.getElementById('result').textContent = JSON.stringify({ error: event.message });
          });
        </script>
        <script>${source}</script>
        <script>
          try {
            document.getElementById('result').textContent =
              JSON.stringify((${checkRendering.toString()})());
          } catch (error) {
            document.getElementById('result').textContent = JSON.stringify({ error: error.message });
          }
        </script>
      `);
    const file = join(directory, 'rendering.html');
    const traceFile = join(directory, 'trace.json');
    writeFileSync(file, page);
    const browser = spawnSync(process.env.CHROMIUM || 'chromium', [
      '--headless', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
      '--trace-startup=devtools.timeline,blink.user_timing', '--trace-startup-format=json',
      `--trace-startup-file=${traceFile}`,
      `--user-data-dir=${join(directory, 'profile')}`, '--dump-dom', pathToFileURL(file).href,
    ], { encoding: 'utf8', timeout: 60000, maxBuffer: 2 * 1024 * 1024 });
    assert.ifError(browser.error);
    assert.equal(browser.status, 0, browser.stderr);
    const match = browser.stdout.match(/<pre id="result">([^<]+)<\/pre>/);
    assert.ok(match, `Chromium did not return rendering results: ${browser.stderr}`);
    const result = JSON.parse(match[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
    assert.equal(result.error, undefined, result.error);
    const { traceEvents } = JSON.parse(readFileSync(traceFile, 'utf8'));
    for (const prefix of ['render', 'repeated-render']) {
      const start = traceEvents.find((event) => event.name === `${prefix}-start`);
      const end = traceEvents.find((event) => event.name === `${prefix}-end`);
      assert.ok(start && end, 'Chromium must record the measured renders');
      const layouts = traceEvents.filter((event) => event.name === 'Layout'
        && event.pid === start.pid && event.tid === start.tid
        && event.ts >= start.ts && event.ts <= end.ts);
      assert.equal(layouts.length, 0, 'Rendering must not force synchronous layout');
    }
    assert.ok(traceEvents.some((event) => event.name === 'Layout'),
      'The trace must capture layouts elsewhere in the test');
    result.synchronousLayouts = 0;
    t.diagnostic(JSON.stringify(result));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
