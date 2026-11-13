'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');
const { test } = require('node:test');

function checkAccessibility() {
  const results = [];
  const check = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  const run = (name, callback) => {
    try {
      callback();
      results.push({ name });
    } catch (error) {
      results.push({ name, error: error.message });
    }
  };
  const luminance = (color) => {
    const channels = color.match(/[\d.]+/g).slice(0, 3).map((value) => {
      const channel = Number(value) / 255;
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  const contrast = (element, background = element) => {
    const foreground = luminance(getComputedStyle(element).color);
    const backdrop = luminance(getComputedStyle(background).backgroundColor);
    return (Math.max(foreground, backdrop) + 0.05) / (Math.min(foreground, backdrop) + 0.05);
  };

  run('all themed tiles and score/button text meet 4.5:1 contrast', () => {
    const values = Array.from({ length: 11 }, (_, i) => 2 ** (i + 1));
    state.grid = emptyGrid();
    values.forEach((value, i) => { state.grid[Math.floor(i / SIZE)][i % SIZE] = value; });
    render();
    for (const tile of boardEl.querySelectorAll('.tile')) {
      check(parseFloat(getComputedStyle(tile).fontSize) > 0, `Tile ${tile.textContent} text must be visible`);
      const ratio = contrast(tile);
      check(ratio >= 4.5, `Tile ${tile.textContent} contrast is ${ratio.toFixed(2)}:1`);
    }
    for (const box of document.querySelectorAll('.score-box')) {
      for (const text of box.children) {
        check(contrast(text, box) >= 4.5, `${text.textContent} score text has low contrast`);
      }
    }
    for (const button of document.querySelectorAll('.btn')) {
      check(contrast(button) >= 4.5, `${button.textContent} button has low contrast`);
    }
  });

  run('the board exposes four rows and sixteen positional cells without changing layout', () => {
    check(boardEl.getAttribute('role') === 'table', 'Board must expose a read-only table');
    check(boardEl.getAttribute('aria-label') === '2048 game board', 'Board must have a name');
    check(boardEl.getAttribute('aria-rowcount') === '4', 'Board must declare four rows');
    check(boardEl.getAttribute('aria-colcount') === '4', 'Board must declare four columns');
    const instructions = document.getElementById(boardEl.getAttribute('aria-describedby'));
    check(instructions && instructions.textContent.includes('arrow keys'), 'Board must reference instructions');
    const rows = boardEl.querySelectorAll(':scope > [role="row"]');
    check(rows.length === SIZE, 'Board must contain four semantic rows');
    const tops = new Set();
    const lefts = new Set();
    rows.forEach((row, r) => {
      check(row.getAttribute('aria-rowindex') === String(r + 1), 'Row index must be one-based');
      const cells = row.querySelectorAll(':scope > [role="cell"]');
      check(cells.length === SIZE, 'Each row must contain four semantic cells');
      cells.forEach((cell, c) => {
        check(cell.getAttribute('aria-colindex') === String(c + 1), 'Column index must be one-based');
        const label = `Row ${r + 1}, column ${c + 1}: ${state.grid[r][c] || 'empty'}`;
        check(cell.getAttribute('aria-label') === label, `Cell must be labelled "${label}"`);
        const rect = cell.getBoundingClientRect();
        check(rect.width > 0 && rect.height > 0, 'Cells must remain visible');
        tops.add(rect.top);
        lefts.add(rect.left);
      });
    });
    check(tops.size === SIZE && lefts.size === SIZE, 'Board must retain its four-by-four visual grid');
  });

  run('score changes are announced with context, but unchanged renders stay quiet', () => {
    newGame();
    state.grid = emptyGrid();
    state.grid[0] = [2, 2, 0, 0];
    render();
    const status = scoreEl.closest('[role="status"]');
    check(status, 'Score needs a status region');
    check(status.getAttribute('aria-live') === 'polite', 'Score announcements must be polite');
    check(status.getAttribute('aria-atomic') === 'true', 'Score announcement must include its label');
    const mutations = new MutationObserver(() => {});
    mutations.observe(status, { childList: true, characterData: true, subtree: true });
    boardEl.focus();
    check(document.activeElement === boardEl, 'Board must be keyboard focusable');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    check(state.score === 4 && scoreEl.textContent === '4', 'A keyboard merge must update the score');
    check(status.textContent.replace(/\s+/g, ' ').trim() === 'Score 4', 'Announcement needs label and value');
    check(mutations.takeRecords().length > 0, 'A changed score must update the live region');
    render();
    check(mutations.takeRecords().length === 0, 'An unchanged score must not trigger an announcement');
    check(document.activeElement === boardEl, 'Rendering must preserve board focus');
    undoBtn.click();
    const restored = Array.from(boardEl.querySelectorAll('[role="cell"]'));
    check(restored.length === 16, 'Undo must retain board semantics');
    restored.forEach((cell, i) => {
      const r = Math.floor(i / SIZE);
      const c = i % SIZE;
      const value = r === 0 && c < 2 ? 2 : 'empty';
      check(cell.getAttribute('aria-label') === `Row ${r + 1}, column ${c + 1}: ${value}`,
        'Undo must restore the accessible tile labels');
    });
    newBtn.click();
    check(scoreEl.textContent === '0', 'New game must reset the visible score');
    check(mutations.takeRecords().length > 0, 'A score reset must update the live region');
    mutations.disconnect();
    check(boardEl.querySelectorAll('[role="cell"]').length === 16, 'New game must retain board semantics');
    check(boardEl.querySelectorAll('.tile').length === 2, 'New game must still start with two tiles');
    check(undoBtn.disabled, 'New game must still clear undo history');
  });

  run('win and game-over messages use a persistent live region', () => {
    const status = document.getElementById('game-status');
    check(status && status.getAttribute('role') === 'status', 'Game messages need a status region');
    check(status.getAttribute('aria-live') === 'polite', 'Game messages must be polite');
    check(status.getAttribute('aria-atomic') === 'true', 'Game messages must be read in full');
    check(!status.closest('.message'), 'Status region must not be hidden with the overlay');
    check(getComputedStyle(status).display !== 'none', 'Status region must stay in the accessibility tree');
    showMessage('You win!', true);
    check(status.textContent === 'You win!' && !continueBtn.hidden, 'Win must be announced and allow continuing');
    continueBtn.click();
    check(status.textContent === '' && state.keepPlaying, 'Continuing must clear the message');
    showMessage('Game over', false);
    check(status.textContent === 'Game over' && continueBtn.hidden, 'Game over must be announced');
    retryBtn.click();
    check(status.textContent === '' && messageEl.classList.contains('hidden'), 'Retry must clear the message');
  });

  run('dismissing an overlay returns focus from its hidden action to the board', () => {
    newGame();
    newBtn.focus();
    newBtn.click();
    check(document.activeElement === newBtn, 'Toolbar actions must retain their own focus');
    showMessage('You win!', true);
    continueBtn.focus();
    continueBtn.click();
    check(document.activeElement === boardEl, 'Keep going must return focus to the board');
    check(messageEl.classList.contains('hidden'), 'Keep going must hide the overlay');
    showMessage('Game over', false);
    retryBtn.focus();
    retryBtn.click();
    check(document.activeElement === boardEl, 'Try again must return focus to the board');
    check(boardEl.querySelectorAll('.tile').length === 2, 'Try again must start a fresh game');
    newBtn.focus();
    showMessage('You win!', true);
    newBtn.click();
    check(document.activeElement === newBtn, 'Hiding an overlay must not steal focus from the toolbar');
  });

  return results;
}

test('Merge 2048 accessibility in Chromium', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'merge-2048-accessibility-'));
  try {
    const html = readFileSync(join(__dirname, 'index.html'), 'utf8');
    const css = readFileSync(join(__dirname, 'style.css'), 'utf8');
    const source = readFileSync(join(__dirname, 'game.js'), 'utf8');
    const page = html
      .replace('<link rel="stylesheet" href="style.css">', `<style>${css}</style>`)
      .replace('<script src="game.js"></script>', `
        <pre id="result"></pre>
        <script>${source}</script>
        <script>
          document.getElementById('result').textContent =
            JSON.stringify((${checkAccessibility.toString()})());
        </script>
      `);
    const file = join(directory, 'accessibility.html');
    writeFileSync(file, page);
    const browser = spawnSync(process.env.CHROMIUM || 'chromium', [
      '--headless', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
      `--user-data-dir=${join(directory, 'profile')}`, '--dump-dom', pathToFileURL(file).href,
    ], { encoding: 'utf8', timeout: 60000, maxBuffer: 2 * 1024 * 1024 });
    assert.ifError(browser.error);
    assert.equal(browser.status, 0, browser.stderr);
    const match = browser.stdout.match(/<pre id="result">([^<]+)<\/pre>/);
    assert.ok(match, `Chromium did not return accessibility results: ${browser.stderr}`);
    const results = JSON.parse(match[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
    assert.equal(results.length, 5);
    for (const result of results) {
      await t.test(result.name, () => assert.equal(result.error, undefined, result.error));
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
