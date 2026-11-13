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
  const press = (target, code) => target.dispatchEvent(
    new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true }),
  );

  run('controls, canvases, and the initial dialog expose descriptive names', () => {
    check(startBtn.getAttribute('aria-label') === 'Start game', 'Start needs a descriptive name');
    check(pauseBtn.getAttribute('aria-label') === 'Pause game', 'Pause needs a descriptive name');
    check(restartBtn.getAttribute('aria-label') === 'Restart game', 'Restart needs a descriptive name');
    check(pauseBtn.disabled, 'Pause must be unavailable before starting');
    check(canvas.getAttribute('role') === 'img', 'Board must expose its image role');
    check(canvas.getAttribute('aria-label') === 'Block Drop game board', 'Board needs a name');
    check(canvas.tabIndex === 0, 'Board must be keyboard focusable');
    const instructions = document.getElementById(canvas.getAttribute('aria-describedby'));
    check(instructions && instructions.textContent.includes('Hard drop'), 'Board needs instructions');
    check(nextCanvas.getAttribute('role') === 'img', 'Preview must expose its image role');
    check(Boolean(nextCanvas.getAttribute('aria-label')), 'Preview needs an initial name');
    check(overlay.getAttribute('role') === 'dialog', 'Overlay needs a dialog role');
    check(overlay.getAttribute('aria-labelledby') === overlayTitle.id, 'Dialog needs its title');
    check(overlay.getAttribute('aria-describedby') === overlayText.id, 'Dialog needs its description');
  });

  run('pause, resume, game over, and restart retain useful names and focus', () => {
    startBtn.click();
    check(document.activeElement === canvas, 'Starting must focus the board');
    check(!pauseBtn.disabled, 'Pause must become available');
    check(nextCanvas.getAttribute('aria-label') === `Next piece: ${state.nextType}`,
      'Preview name must match the next piece');
    press(canvas, 'KeyP');
    check(state.paused && !overlay.classList.contains('hidden'), 'P must show the pause dialog');
    check(document.activeElement === startBtn, 'Pause must focus the dialog action');
    check(startBtn.getAttribute('aria-label') === 'Resume game', 'Dialog action must be named Resume');
    check(pauseBtn.getAttribute('aria-label') === 'Resume game', 'Pause control must be named Resume');
    const pausedState = JSON.stringify({ board: state.board, piece: state.piece, score: state.score });
    press(startBtn, 'Space');
    check(JSON.stringify({ board: state.board, piece: state.piece, score: state.score }) === pausedState,
      'Space on the dialog action must not hard-drop the piece');
    startBtn.click();
    check(!state.paused && overlay.classList.contains('hidden'), 'Resume must hide the dialog');
    check(document.activeElement === canvas, 'Resume must return focus to the board');
    check(pauseBtn.getAttribute('aria-label') === 'Pause game', 'Resume must restore the pause name');
    restartBtn.focus();
    const before = JSON.stringify(state.piece);
    press(restartBtn, 'Space');
    check(JSON.stringify(state.piece) === before, 'Space on Restart must not hard-drop the piece');
    endGame();
    check(document.activeElement === startBtn, 'Game over must focus the dialog action');
    check(startBtn.getAttribute('aria-label') === 'Restart game', 'Game-over action needs a restart name');
    check(overlayTitle.textContent === 'Game over', 'Dialog title must describe game over');
    check(pauseBtn.disabled, 'Pause must be unavailable after game over');
    startBtn.click();
    check(!state.over && document.activeElement === canvas, 'Restart must focus a fresh game');
    check(!pauseBtn.disabled, 'Restart must enable pausing again');
  });

  run('stats announce labelled changes, including hard drops, without frame-by-frame noise', () => {
    startGame();
    const stats = scoreEl.closest('[role="status"]');
    check(stats && stats.contains(linesEl) && stats.contains(levelEl), 'All stats need a status region');
    check(stats.getAttribute('aria-live') === 'polite', 'Stats must be announced politely');
    check(stats.getAttribute('aria-atomic') === 'true', 'Stats must include labels and values');
    const mutations = new MutationObserver(() => {});
    mutations.observe(stats, { childList: true, characterData: true, subtree: true });
    updateStats();
    draw();
    check(mutations.takeRecords().length === 0, 'Unchanged stats and frames must stay quiet');
    state.board = createBoard();
    state.piece = createPiece('O');
    hardDrop();
    check(state.score > 0 && scoreEl.textContent === state.score.toLocaleString(),
      'A hard drop must update the visible and announced score even without clearing a line');
    check(mutations.takeRecords().length > 0, 'Changed score must update the live region');
    state.board = createBoard();
    state.board[ROWS - 1].fill('I');
    state.lines = 9;
    clearLines();
    check(linesEl.textContent === '10' && levelEl.textContent === '2', 'Clearing a line must update lines and level');
    check(mutations.takeRecords().length > 0, 'Line and level changes must update the live region');
    const text = stats.textContent.replace(/\s+/g, ' ');
    check(text.includes('Score') && text.includes('Lines') && text.includes('Level'),
      'Stats announcements need the score, lines, and level labels');
    updateStats();
    check(mutations.takeRecords().length === 0, 'Unchanged values must not be re-announced');
    startGame();
    check(scoreEl.textContent === '0' && linesEl.textContent === '0' && levelEl.textContent === '1',
      'Restart must reset all announced stats');
    check(mutations.takeRecords().length > 0, 'Reset stats must be announced');
    mutations.disconnect();
  });

  return results;
}

test('Block Drop accessibility in Chromium', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'block-drop-accessibility-'));
  try {
    const html = readFileSync(join(__dirname, 'index.html'), 'utf8');
    const css = readFileSync(join(__dirname, 'style.css'), 'utf8');
    const source = readFileSync(join(__dirname, 'game.js'), 'utf8');
    const page = html
      .replace('<link rel="stylesheet" href="style.css">', `<style>${css}</style>`)
      .replace('<script src="game.js"></script>', `
        <pre id="result"></pre>
        <script>window.requestAnimationFrame = () => 0;</script>
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
    assert.equal(results.length, 3);
    for (const result of results) {
      await t.test(result.name, () => assert.equal(result.error, undefined, result.error));
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
