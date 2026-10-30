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
  const ratio = window.devicePixelRatio;
  for (const [target, width, height] of [[canvas, 300, 600], [nextCanvas, 120, 120]]) {
    check(target.width === Math.round(width * ratio) && target.height === Math.round(height * ratio),
      'Canvas backing stores must match the device pixel ratio');
    const bounds = target.getBoundingClientRect();
    check(bounds.width === width && bounds.height === height, 'Canvas CSS sizes must stay unchanged');
    check(target.getContext('2d').getTransform().a === target.width / width,
      'Canvas drawing must use logical coordinates');
    check(target.getAttribute('role') === 'img' && target.getAttribute('aria-label'),
      'Both canvases must have accessible image labels');
  }
  ctx.clearRect(0, 0, BOARD_WIDTH, BOARD_HEIGHT);
  drawGrid();
  const gridX = Math.round(BLOCK * ratio);
  const gridPixels = ctx.getImageData(gridX - 1, Math.round(15 * ratio), 3, 1).data;
  check(gridPixels[3] === 0 && gridPixels[7] > 0 && gridPixels[11] === 0,
    'Grid lines must align to a single backing-store pixel');

  const stats = document.querySelector('.stats');
  check(stats.getAttribute('role') === 'status' && stats.getAttribute('aria-live') === 'polite'
    && stats.getAttribute('aria-atomic') === 'true', 'Statistics must be announced as one polite status');
  check(startBtn.getAttribute('aria-label') === 'Start game', 'Start control must have a meaningful name');
  check(restartBtn.getAttribute('aria-label') === 'Restart game', 'Restart control must have a meaningful name');
  check(pauseBtn.disabled, 'Pause must be disabled until a game starts');
  check(overlay.getAttribute('role') === 'dialog'
    && overlay.getAttribute('aria-labelledby') === overlayTitle.id
    && overlay.getAttribute('aria-describedby') === overlayText.id,
  'The overlay must expose a named and described dialog');
  check(canvas.getAttribute('aria-describedby') === 'game-controls',
    'Board users must be able to discover the keyboard controls');
  startBtn.focus();
  startBtn.click();
  check(document.activeElement === canvas && getComputedStyle(overlay).display === 'none',
    'Starting must move focus out of the hidden dialog and onto the board');
  check(nextCanvas.getAttribute('aria-label') === `Next piece: ${state.nextType}`,
    'The preview must identify the next piece');
  pauseBtn.click();
  check(startBtn.getAttribute('aria-label') === 'Resume game'
    && pauseBtn.getAttribute('aria-label') === 'Resume game'
    && document.activeElement === startBtn && getComputedStyle(overlay).display !== 'none',
  'Pausing must expose a resume dialog and focus its action');
  const space = new KeyboardEvent('keydown', { code: 'Space', bubbles: true, cancelable: true });
  startBtn.dispatchEvent(space);
  check(!space.defaultPrevented && state.score === 0,
    'Game input must not consume Space when a button needs native activation');
  startBtn.click();
  check(document.activeElement === canvas && pauseBtn.getAttribute('aria-label') === 'Pause game',
    'Resuming must restore board focus and the pause control name');

  const observer = new MutationObserver(() => {});
  observer.observe(stats, { childList: true, subtree: true, characterData: true });
  state.lines = 9;
  state.board[19].fill('I');
  clearLines();
  check(scoreEl.textContent === '100' && linesEl.textContent === '10' && levelEl.textContent === '2'
    && observer.takeRecords().length > 0, 'Line clears must update the live score, lines, and level');
  state.piece = createPiece('O');
  hardDrop();
  check(scoreEl.textContent === '136' && observer.takeRecords().length > 0,
    'Hard drops without line clears must also update the live statistics');
  observer.disconnect();
  endGame();
  check(startBtn.getAttribute('aria-label') === 'Restart game' && pauseBtn.disabled
    && document.activeElement === startBtn && overlayText.textContent === 'Final score: 136',
  'Game over must expose a focused restart dialog with the final score');
  startBtn.click();

  const firstFrame = pendingFrames.keys().next().value;
  for (let i = 0; i < 10; i++) startGame();
  check(pendingFrames.size === 1, 'Ten restarts must retain exactly one pending frame');
  check(pendingFrames.has(firstFrame), 'Restarts must reuse the pending frame, including ID zero');
  const callback = [...pendingFrames.values()][0];
  pendingFrames.clear();
  let draws = 0;
  const originalDraw = draw;
  draw = () => { draws++; originalDraw(); };
  callback(performance.now());
  draw = originalDraw;
  check(draws === 1 && pendingFrames.size === 1, 'Each frame must update and draw once');

  state.board = createBoard().map((row, y) => row.map((_, x) => 'IJLOSTZ'[(x + y) % 7]));
  state.piece = createPiece('T');
  state.piece.y = 5;
  blockSprites.clear();
  let gradients = 0;
  const originalGradient = CanvasRenderingContext2D.prototype.createLinearGradient;
  CanvasRenderingContext2D.prototype.createLinearGradient = function (...args) {
    gradients++;
    return originalGradient.apply(this, args);
  };

  const measure = () => {
    const start = performance.now();
    draw();
    ctx.getImageData(0, 0, canvas.width, canvas.height);
    return performance.now() - start;
  };
  const cold = measure();
  for (const type of 'IJLOSTZ') {
    state.nextType = type;
    drawNext();
  }
  const warmedGradients = gradients;
  for (let i = 0; i < 20; i++) measure();
  const timings = Array.from({ length: 160 }, measure).sort((a, b) => a - b);
  check(gradients === warmedGradients, 'Warmed board drawing must not create gradients');
  for (const type of 'IJLOSTZ') {
    state.nextType = type;
    drawNext();
  }
  check(gradients === warmedGradients, 'Warmed preview drawing must not create gradients');
  CanvasRenderingContext2D.prototype.createLinearGradient = originalGradient;

  const cachedDrawBlock = drawBlock;
  const originalDrawBlock = (context, px, py, color, size, alpha = 1) => {
    px = Math.round(px * ratio) / ratio;
    py = Math.round(py * ratio) / ratio;
    const gradient = context.createLinearGradient(px, py, px + size, py + size);
    gradient.addColorStop(0, lighten(color, 0.35));
    gradient.addColorStop(1, color);
    context.save();
    context.globalAlpha = alpha;
    context.shadowColor = color;
    context.shadowBlur = 12 * ratio;
    context.fillStyle = gradient;
    context.beginPath();
    context.roundRect(px + 1, py + 1, size - 2, size - 2, 5);
    context.fill();
    context.restore();
  };
  const compareArtwork = (context, target, render) => {
    render();
    const cached = context.getImageData(0, 0, target.width, target.height).data;
    drawBlock = originalDrawBlock;
    try {
      render();
      const original = context.getImageData(0, 0, target.width, target.height).data;
      let difference = 0;
      for (let i = 0; i < cached.length; i++) difference += Math.abs(cached[i] - original[i]);
      return difference / cached.length;
    } finally {
      drawBlock = cachedDrawBlock;
    }
  };
  const channelDifference = compareArtwork(ctx, canvas, draw);
  check(channelDifference < 1,
    `Cached blocks must preserve the original dense-board artwork (difference ${channelDifference})`);

  drawBlock = originalDrawBlock;
  for (let i = 0; i < 10; i++) measure();
  const originalTimings = Array.from({ length: 80 }, measure).sort((a, b) => a - b);
  drawBlock = cachedDrawBlock;
  const p95 = timings[Math.floor(timings.length * 0.95)];
  check(p95 < 16, `Warmed full-board drawing p95 was ${p95.toFixed(2)} ms, expected below 16 ms`);

  state.board = createBoard();
  state.piece = createPiece('O');
  state.piece.y = 1;
  const ghostDifference = compareArtwork(ctx, canvas, draw);
  check(ghostDifference < 1, 'Cached blocks must preserve separate active and translucent ghost pieces');
  const previewDifferences = [...'IJLOSTZ'].map((type) => {
    state.nextType = type;
    return compareArtwork(nextCtx, nextCanvas, drawNext);
  });
  check(previewDifferences.every((difference) => difference < 1),
    'Cached blocks must preserve every next-piece preview');

  return {
    coldMs: cold,
    meanMs: timings.reduce((sum, time) => sum + time, 0) / timings.length,
    p95Ms: p95,
    originalMeanMs: originalTimings.reduce((sum, time) => sum + time, 0) / originalTimings.length,
    originalP95Ms: originalTimings[Math.floor(originalTimings.length * 0.95)],
    meanChannelDifference: channelDifference,
    ghostChannelDifference: ghostDifference,
    maxPreviewChannelDifference: Math.max(...previewDifferences),
  };
}

for (const ratio of [1, 1.25, 2]) test(`Chromium at DPR ${ratio} preserves artwork and accessibility`, (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'block-drop-rendering-'));
  try {
    const html = readFileSync(join(__dirname, 'index.html'), 'utf8');
    const css = readFileSync(join(__dirname, 'style.css'), 'utf8');
    const source = readFileSync(join(__dirname, 'game.js'), 'utf8');
    const harness = `
      const pendingFrames = new Map();
      let frameId = -1;
      window.requestAnimationFrame = (callback) => {
        pendingFrames.set(++frameId, callback);
        return frameId;
      };
      window.cancelAnimationFrame = (id) => pendingFrames.delete(id);
      window.addEventListener('error', (event) => {
        document.getElementById('result').textContent = JSON.stringify({ error: event.message });
      });
    `;
    const page = html
      .replace(/<link[^>]+style\.css[^>]*>/, `<style>${css}</style>`)
      .replace('<script src="game.js"></script>', `
        <pre id="result"></pre>
        <script>${harness}</script>
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
    writeFileSync(file, page);
    const browser = spawnSync(process.env.CHROMIUM || 'chromium', [
      '--headless', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
      `--force-device-scale-factor=${ratio}`,
      `--user-data-dir=${join(directory, 'profile')}`, '--dump-dom', pathToFileURL(file).href,
    ], { encoding: 'utf8', timeout: 60000, maxBuffer: 2 * 1024 * 1024 });
    assert.ifError(browser.error);
    assert.equal(browser.status, 0, browser.stderr);
    const match = browser.stdout.match(/<pre id="result">([^<]+)<\/pre>/);
    assert.ok(match, `Chromium did not return rendering results: ${browser.stderr}`);
    const result = JSON.parse(match[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
    assert.equal(result.error, undefined, result.error);
    t.diagnostic(JSON.stringify(result));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
