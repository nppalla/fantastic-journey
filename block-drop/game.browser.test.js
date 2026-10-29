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
  startGame();
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
    const gradient = context.createLinearGradient(px, py, px + size, py + size);
    gradient.addColorStop(0, lighten(color, 0.35));
    gradient.addColorStop(1, color);
    context.save();
    context.globalAlpha = alpha;
    context.shadowColor = color;
    context.shadowBlur = 12;
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
  check(channelDifference < 1, 'Cached blocks must preserve the original dense-board artwork');

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

test('Chromium preserves artwork and renders a dense board below the frame budget', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'block-drop-rendering-'));
  try {
    const html = readFileSync(join(__dirname, 'index.html'), 'utf8');
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
      .replace(/<link[^>]+style\.css[^>]*>/, '')
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
