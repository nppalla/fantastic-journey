'use strict';

const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
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
  check(canvas.width === 300 * ratio && canvas.height === 600 * ratio,
    'Board backing store must match the device pixel ratio');
  check(nextCanvas.width === 120 * ratio && nextCanvas.height === 120 * ratio,
    'Preview backing store must match the device pixel ratio');
  check(canvas.getBoundingClientRect().width === 300 && nextCanvas.getBoundingClientRect().width === 120,
    'Backing-store scaling must preserve the CSS layout');
  const gridX = Math.round(30 * ratio);
  const gridY = Math.round(15 * ratio);
  const grid = ctx.getImageData(gridX - 1, gridY, 3, 1).data;
  check(grid[3] === 0 && grid[7] > 0 && grid[11] === 0,
    'Grid lines must occupy exactly one device pixel');
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
    devicePixelRatio: ratio,
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

for (const ratio of [1, 1.25, 2]) {
  test(`Chromium at DPR ${ratio} preserves sharp artwork within the frame budget`, (t) => {
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
        `--force-device-scale-factor=${ratio}`,
        `--user-data-dir=${join(directory, 'profile')}`, '--dump-dom', pathToFileURL(file).href,
      ], { encoding: 'utf8', timeout: 60000, maxBuffer: 2 * 1024 * 1024 });
      assert.ifError(browser.error);
      assert.equal(browser.status, 0, browser.stderr);
      const match = browser.stdout.match(/<pre id="result">([^<]+)<\/pre>/);
      assert.ok(match, `Chromium did not return rendering results: ${browser.stderr}`);
      const result = JSON.parse(match[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
      assert.equal(result.error, undefined, result.error);
      assert.equal(result.devicePixelRatio, ratio);
      t.diagnostic(JSON.stringify(result));
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
}

test('Chromium exposes accessible game state and supports native keyboard controls and scale changes',
  { timeout: 60000 }, async () => {
    const directory = mkdtempSync(join(tmpdir(), 'block-drop-accessibility-'));
    const html = readFileSync(join(__dirname, 'index.html'), 'utf8');
    const css = readFileSync(join(__dirname, 'style.css'), 'utf8');
    const source = readFileSync(join(__dirname, 'game.js'), 'utf8');
    const file = join(directory, 'game.html');
    writeFileSync(file, html
      .replace(/<link[^>]+style\.css[^>]*>/, `<style>${css}</style>`)
      .replace('<script src="game.js"></script>', `
        <script>
          window.requestAnimationFrame = () => 0;
          ${source}
        </script>
      `));
    const browser = spawn(process.env.CHROMIUM || 'chromium', [
      '--headless', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
      '--remote-debugging-pipe', '--force-device-scale-factor=1',
      `--user-data-dir=${join(directory, 'profile')}`, 'about:blank',
    ], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
    const requests = new Map();
    let id = 0;
    let buffer = '';
    let loaded;
    const load = new Promise((resolve) => { loaded = resolve; });
    const closed = new Promise((resolve) => browser.once('close', resolve));
    const failRequests = (error) => {
      for (const request of requests.values()) request.reject(error);
      requests.clear();
    };
    browser.on('error', failRequests);
    browser.on('close', (code) => failRequests(new Error(`Chromium exited with code ${code}`)));
    browser.stderr.resume();
    browser.stdio[4].on('data', (chunk) => {
      buffer += chunk;
      let end;
      while ((end = buffer.indexOf('\0')) !== -1) {
        const message = JSON.parse(buffer.slice(0, end));
        buffer = buffer.slice(end + 1);
        if (message.method === 'Page.loadEventFired') loaded();
        const request = requests.get(message.id);
        if (!request) continue;
        requests.delete(message.id);
        if (message.error) request.reject(new Error(JSON.stringify(message.error)));
        else request.resolve(message.result);
      }
    });
    const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
      requests.set(++id, { resolve, reject });
      browser.stdio[3].write(`${JSON.stringify({ id, method, params, sessionId })}\0`);
    });

    try {
      const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
      const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
      const command = (method, params) => send(method, params, sessionId);
      const evaluate = async (expression) => {
        const result = await command('Runtime.evaluate', {
          expression, returnByValue: true, awaitPromise: true,
        });
        assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails));
        return result.result.value;
      };
      const tree = async () => (await command('Accessibility.getFullAXTree')).nodes.filter((node) => !node.ignored);
      const hasNode = (nodes, role, name) =>
        nodes.some((node) => node.role.value === role && node.name?.value === name);
      const press = async (key, code, windowsVirtualKeyCode) => {
        const text = key === 'Enter' ? '\r' : key;
        await command('Input.dispatchKeyEvent', {
          type: 'keyDown', key, code, windowsVirtualKeyCode, text, unmodifiedText: text,
        });
        await command('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode });
      };

      await command('Page.enable');
      await command('Accessibility.enable');
      await command('Page.navigate', { url: pathToFileURL(file).href });
      await load;
      await command('Page.bringToFront');
      let nodes = await tree();
      assert.equal(hasNode(nodes, 'button', 'Start game'), true);
      assert.equal(hasNode(nodes, 'button', 'Pause game'), true);
      assert.equal(hasNode(nodes, 'button', 'Restart game'), true);
      assert.equal(hasNode(nodes, 'image', 'Block Drop game board'), true);
      assert.equal(hasNode(nodes, 'image', 'Next piece preview'), true);
      const dialog = nodes.find((node) => node.role.value === 'dialog');
      assert.equal(dialog.name.value, 'Block Drop');
      assert.equal(dialog.description.value, 'Clear lines. Survive. Climb the levels.');
      const status = nodes.find((node) => node.role.value === 'status');
      assert.equal(status.properties.find((property) => property.name === 'live').value.value, 'polite');
      assert.equal(status.properties.find((property) => property.name === 'atomic').value.value, true);
      assert.equal(await evaluate('document.activeElement.id'), 'start-btn');

      await press('Enter', 'Enter', 13);
      assert.equal(await evaluate('document.activeElement.id'), 'board');
      assert.equal((await tree()).some((node) => node.role.value === 'dialog'), false);
      await evaluate('pauseBtn.focus()');
      await press(' ', 'Space', 32);
      assert.equal(await evaluate('state.paused'), true);
      assert.equal(await evaluate('state.score'), 0);
      assert.equal(await evaluate('document.activeElement.id'), 'start-btn');
      nodes = await tree();
      assert.equal(hasNode(nodes, 'button', 'Resume game'), true);
      assert.equal(hasNode(nodes, 'dialog', 'Paused'), true);
      await press('Enter', 'Enter', 13);
      assert.equal(await evaluate('state.paused'), false);
      assert.equal(await evaluate('document.activeElement.id'), 'board');
      await evaluate('state.piece = createPiece("O")');
      await press(' ', 'Space', 32);
      assert.equal(await evaluate('scoreEl.textContent'), '36');
      await evaluate('state.lines = 9; state.board[ROWS - 1].fill("I"); clearLines()');
      nodes = await tree();
      for (const text of ['Score', '136', 'Lines', '10', 'Level', '2']) {
        assert.equal(hasNode(nodes, 'StaticText', text), true, `Missing accessible stat: ${text}`);
      }
      assert.equal(await evaluate(`(() => {
        const observer = new MutationObserver(() => {});
        observer.observe(document.querySelector('.stats'), { subtree: true, childList: true });
        updateStats();
        const count = observer.takeRecords().length;
        observer.disconnect();
        return count;
      })()`), 0);

      await evaluate('window.savedBoard = state.board; window.savedPiece = state.piece; draw()');
      for (const ratio of [2, 1.25, 1]) {
        await command('Emulation.setDeviceMetricsOverride', {
          width: 800 + ratio * 100, height: 900, deviceScaleFactor: ratio, mobile: false,
        });
        assert.equal(await evaluate(`(async () => {
          for (let i = 0; i < 200; i++) {
            if (canvas.width === 300 * ${ratio}) return true;
            await new Promise((resolve) => setTimeout(resolve, 5));
          }
          return false;
        })()`), true, `Actual display-scale changes must refresh backing stores: ${
          JSON.stringify(await evaluate('[window.devicePixelRatio, pixelRatio, canvas.width, resolutionQuery.matches, innerWidth]'))
        }`);
        assert.deepEqual(await evaluate(`[
          canvas.width, canvas.height, nextCanvas.width, nextCanvas.height,
          canvas.getBoundingClientRect().width, nextCanvas.getBoundingClientRect().width,
          state.board === window.savedBoard, state.piece === window.savedPiece, state.score,
        ]`), [300 * ratio, 600 * ratio, 120 * ratio, 120 * ratio, 300, 120, true, true, 136]);
      }
      await evaluate('endGame()');
      nodes = await tree();
      assert.equal(hasNode(nodes, 'dialog', 'Game over'), true);
      assert.equal(hasNode(nodes, 'button', 'Play again'), true);
      assert.equal(await evaluate('document.activeElement.id'), 'start-btn');
      await press('Enter', 'Enter', 13);
      assert.equal(await evaluate('state.over'), false);
      await evaluate('state.score = 123; spawnParticles(19); restartBtn.focus()');
      await press(' ', 'Space', 32);
      assert.equal(await evaluate('state.score'), 0);
      assert.equal(await evaluate('state.particles.length'), 0);
      assert.equal(await evaluate('document.activeElement.id'), 'board');
    } finally {
      browser.kill();
      await closed;
      rmSync(directory, { recursive: true, force: true });
    }
  });
