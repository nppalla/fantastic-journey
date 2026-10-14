'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');

async function checkAccessibility() {
  const game = document.querySelector('iframe').contentWindow;
  const doc = game.document;
  const board = doc.getElementById('board');
  const score = doc.getElementById('score');
  const status = doc.getElementById('game-status');
  const results = [];

  function check(condition, message) {
    if (!condition) throw new Error(message);
  }

  async function run(name, action) {
    try {
      await action();
      results.push({ name });
    } catch (error) {
      results.push({ name, error: error.stack });
    }
  }

  function setGame(grid, value = 0) {
    game.eval(`
      state.grid = ${JSON.stringify(grid)};
      state.score = ${value};
      state.best = ${value};
      state.won = false;
      state.keepPlaying = false;
      state.over = false;
      state.history = [];
      state.newTile = null;
      hideMessage();
      render();
    `);
  }

  function luminance(rgb) {
    return rgb.map((value) => {
      value /= 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    }).reduce((sum, value, i) => sum + value * [0.2126, 0.7152, 0.0722][i], 0);
  }

  function contrast(element, background = element, brightness = 1) {
    const foreground = game.getComputedStyle(element).color;
    const fill = game.getComputedStyle(background).backgroundColor;
    const colors = [foreground, fill].map((color) => {
      const channels = color.match(/[\d.]+/g).map(Number);
      check(channels.length === 3 || channels[3] === 1, `Expected opaque color: ${color}`);
      return luminance(channels.slice(0, 3).map((value) => Math.min(255, value * brightness)));
    }).sort((a, b) => a - b);
    const ratio = (colors[1] + 0.05) / (colors[0] + 0.05);
    check(ratio >= 4.5, `${element.className || element.id}: contrast ${ratio.toFixed(2)}:1 is below 4.5:1`);
  }

  await run('board exposes labeled rows, columns, values, and empty cells', () => {
    setGame([[2, 0, 4, 0], [0, 8, 0, 0], [0, 0, 16, 0], [0, 0, 0, 32]]);
    check(board.getAttribute('role') === 'grid', 'Board must be a grid');
    check(board.getAttribute('aria-label') === '2048 game board', 'Board needs an accessible name');
    check(board.getAttribute('aria-rowcount') === '4', 'Board needs four rows');
    check(board.getAttribute('aria-colcount') === '4', 'Board needs four columns');
    const instructions = doc.getElementById(board.getAttribute('aria-describedby'));
    check(instructions && instructions.textContent.includes('arrow keys'), 'Board must reference keyboard instructions');
    check(board.children.length === 4, 'Board must contain four rows');
    Array.from(board.children).forEach((row, r) => {
      check(row.getAttribute('role') === 'row', `Row ${r + 1} needs row semantics`);
      check(row.getAttribute('aria-rowindex') === String(r + 1), 'Row index must be one-based');
      check(row.children.length === 4, 'Each row must contain four cells');
      Array.from(row.children).forEach((cell, c) => {
        const value = game.eval(`state.grid[${r}][${c}]`);
        check(cell.getAttribute('role') === 'gridcell', 'Cells need gridcell semantics');
        check(cell.getAttribute('aria-colindex') === String(c + 1), 'Column index must be one-based');
        check(cell.getAttribute('aria-label') === `Row ${r + 1}, column ${c + 1}: ${value || 'empty'}`, 'Cell label must describe its current position and value');
        const tile = cell.querySelector('.tile');
        check(!tile || tile.getAttribute('aria-hidden') === 'true', 'Hide duplicate visual tile text from screen readers');
      });
    });
  });

  await run('every defined tile meets 4.5:1 computed text contrast', () => {
    const values = [2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048, 0, 0, 0, 0, 0];
    setGame(Array.from({ length: 4 }, (_, r) => values.slice(r * 4, r * 4 + 4)));
    const tiles = board.querySelectorAll('.tile');
    check(tiles.length === 11, 'All eleven tile colors must be checked');
    tiles.forEach((tile) => {
      contrast(tile);
      check(parseFloat(game.getComputedStyle(tile).fontSize) > 0, 'Tile text must remain visible');
    });
  });

  await run('scores and buttons meet 4.5:1 contrast, including button hover', () => {
    doc.querySelectorAll('.score-box').forEach((box) => {
      Array.from(box.children).forEach((label) => contrast(label, box));
    });
    const hoverRule = Array.from(doc.styleSheets[0].cssRules).find((rule) => rule.selectorText === '.btn:hover');
    check(hoverRule, 'Hover styling must be checked');
    const match = hoverRule.style.filter.match(/^brightness\(([\d.]+)\)$/);
    check(match, 'Expected the existing brightness hover effect');
    doc.querySelectorAll('.btn').forEach((button) => {
      contrast(button);
      contrast(button, button, Number(match[1]));
    });
  });

  await run('semantic rows preserve the four-by-four layout on desktop and mobile', () => {
    for (const width of [520, 320]) {
      document.querySelector('iframe').style.width = `${width}px`;
      const rect = board.getBoundingClientRect();
      const positions = Array.from(board.querySelectorAll('.cell'), (cell) => cell.getBoundingClientRect());
      check(positions.length === 16, 'The board must still have sixteen cells');
      check(new Set(positions.map((cell) => Math.round(cell.x))).size === 4, 'Cells must occupy four columns');
      check(new Set(positions.map((cell) => Math.round(cell.y))).size === 4, 'Cells must occupy four rows');
      check(positions.every((cell) => cell.width > 0 && cell.height > 0 && cell.left >= rect.left && cell.right <= rect.right && cell.top >= rect.top && cell.bottom <= rect.bottom), 'Cells must remain inside the board');
    }
  });

  await run('board receives keyboard focus and keeps it after an arrow-key move', () => {
    setGame([[0, 2, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]);
    game.Math.random = () => 0;
    check(board.tabIndex === 0, 'Board must be keyboard focusable');
    board.focus();
    check(doc.activeElement === board, 'Board must accept focus');
    board.dispatchEvent(new game.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    check(game.eval('state.grid[0][0]') === 2, 'Arrow keys must still move tiles');
    check(doc.activeElement === board, 'Rendering must preserve board focus');
    check(board.querySelector('.cell').getAttribute('aria-label') === 'Row 1, column 1: 2', 'Cell descriptions must update after movement');
  });

  await run('score updates are polite, atomic, labeled, and not repeated for unchanged scores', async () => {
    const region = score.parentElement;
    check(region.getAttribute('role') === 'status', 'Score needs status semantics');
    check(region.getAttribute('aria-live') === 'polite', 'Score announcements must be polite');
    check(region.getAttribute('aria-atomic') === 'true', 'Announce the score together with its label');
    check(region.querySelector('.label').textContent === 'Score', 'Score announcements need context');
    let mutations = 0;
    const observer = new game.MutationObserver((records) => { mutations += records.length; });
    observer.observe(region, { childList: true, subtree: true, characterData: true });
    try {
      game.eval('state.score = 12; render();');
      await Promise.resolve();
      check(score.textContent === '12' && mutations > 0, 'Changed scores must update the live region');
      mutations = 0;
      game.eval('render();');
      await Promise.resolve();
      check(mutations === 0, 'Unchanged scores must not cause live-region updates');
    } finally {
      observer.disconnect();
    }
  });

  await run('merges still update score, best, and accessible tile labels', () => {
    setGame([[2, 2, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]);
    game.eval("move('left');");
    check(score.textContent === '4', 'The merge must still score four points');
    check(doc.getElementById('best').textContent === '4', 'The best score must still update');
    check(board.querySelector('.cell').getAttribute('aria-label') === 'Row 1, column 1: 4', 'The merged tile must have an updated accessible value');
  });

  await run('undo restores the labeled board and announces the action', () => {
    doc.getElementById('undo-btn').click();
    const cells = board.querySelectorAll('.cell');
    check(cells[0].getAttribute('aria-label') === 'Row 1, column 1: 2', 'Undo must restore the first tile');
    check(cells[1].getAttribute('aria-label') === 'Row 1, column 2: 2', 'Undo must restore the second tile');
    check(status.textContent === 'Move undone.', 'Undo must announce its action');
    check(doc.getElementById('undo-btn').disabled, 'Undo availability must still reflect history');
  });

  await run('persistent game status announces wins, continuation, and losses', () => {
    check(status.getAttribute('role') === 'status' && status.getAttribute('aria-live') === 'polite' && status.getAttribute('aria-atomic') === 'true', 'Game status must be an atomic polite live region');
    check(game.getComputedStyle(status).display !== 'none', 'The game live region must stay in the accessibility tree');
    check(game.getComputedStyle(status).visibility !== 'hidden', 'The game live region must not be hidden from screen readers');
    game.eval("showMessage('You win!', true);");
    check(status.textContent.includes('You win!') && status.textContent.includes('Keep going'), 'Wins must announce the continuation action');
    check(!doc.getElementById('continue-btn').hidden, 'Winning must still expose Keep going');
    doc.getElementById('continue-btn').click();
    check(status.textContent === 'Keep playing to reach a higher tile.', 'Continuation must announce the new state');
    check(game.eval('state.keepPlaying'), 'Continuation must still update game state');
    game.eval("showMessage('Game over', false);");
    check(status.textContent.includes('Game over') && status.textContent.includes('Try again'), 'Losses must announce the retry action');
    check(doc.getElementById('continue-btn').hidden, 'Losing must still hide Keep going');
  });

  await run('retry and new-game controls reset score, board labels, and status', () => {
    for (const id of ['retry-btn', 'new-btn']) {
      game.eval('state.score = 20; render();');
      doc.getElementById(id).click();
      check(score.textContent === '0', 'New games must reset the score');
      check(board.querySelectorAll('.tile').length === 2, 'New games must still start with two tiles');
      check(board.querySelectorAll('[role="gridcell"]').length === 16, 'New games must preserve board semantics');
      check(status.textContent === 'New game started.', 'New games must announce the reset');
      check(doc.getElementById('message').classList.contains('hidden'), 'New games must hide the previous outcome');
    }
  });

  document.getElementById('results').textContent = btoa(JSON.stringify(results));
}

test('Merge 2048 accessibility in Chromium', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'merge2048-accessibility-'));
  try {
    const gameUrl = pathToFileURL(join(__dirname, 'index.html')).href;
    const fixture = join(directory, 'checks.html');
    writeFileSync(fixture, `<!doctype html><html><body>
      <iframe src="${gameUrl}" style="width:520px;height:900px"></iframe>
      <pre id="results"></pre>
      <script>window.addEventListener('load', ${checkAccessibility.toString()});</script>
      </body></html>`);
    const browser = spawnSync(process.env.CHROMIUM_BIN || 'chromium', [
      '--headless', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
      '--allow-file-access-from-files', '--no-first-run', '--no-default-browser-check',
      `--user-data-dir=${join(directory, 'profile')}`, '--dump-dom',
      '--virtual-time-budget=5000', pathToFileURL(fixture).href,
    ], { encoding: 'utf8', timeout: 30000, maxBuffer: 2 * 1024 * 1024 });
    assert.ifError(browser.error);
    assert.equal(browser.status, 0, browser.stderr);
    const match = browser.stdout.match(/<pre id="results">([A-Za-z0-9+/=]+)<\/pre>/);
    assert.ok(match, `Browser checks did not complete:\n${browser.stderr}\n${browser.stdout}`);
    const results = JSON.parse(Buffer.from(match[1], 'base64').toString('utf8'));
    assert.equal(results.length, 10, 'Every browser check must report a result');
    for (const result of results) {
      await t.test(result.name, () => {
        assert.equal(result.error, undefined, result.error);
      });
    }
    const css = readFileSync(join(__dirname, 'style.css'), 'utf8');
    const tileValues = Array.from(css.matchAll(/\.tile-(\d+)\s*\{/g), (match) => Number(match[1]));
    assert.deepEqual(tileValues, [2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048], 'Contrast checks must cover every tile palette entry');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
