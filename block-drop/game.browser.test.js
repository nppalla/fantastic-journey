'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { readFile, mkdtemp, rm } = require('node:fs/promises');
const http = require('node:http');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const test = require('node:test');

async function openBrowser(t) {
  const assets = new Map(await Promise.all(['index.html', 'game.js', 'style.css'].map(async (name) => [
    `/${name}`, await readFile(join(__dirname, name)),
  ])));
  const server = http.createServer((request, response) => {
    const body = assets.get(request.url);
    response.writeHead(body ? 200 : 404, {
      'Content-Type': request.url.endsWith('.js') ? 'text/javascript'
        : request.url.endsWith('.css') ? 'text/css' : 'text/html',
    });
    response.end(body || 'Not found');
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const profile = await mkdtemp(join(tmpdir(), 'block-drop-browser-'));
  const browser = spawn(process.env.CHROMIUM_BIN || 'chromium', [
    '--headless', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--no-first-run', '--no-default-browser-check', '--remote-debugging-pipe',
    `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
  let errors = '';
  browser.stderr.on('data', (data) => { errors += data; });
  const exited = new Promise((resolve) => {
    browser.once('exit', resolve);
    browser.once('error', resolve);
  });
  t.after(async () => {
    if (browser.exitCode === null && browser.signalCode === null) browser.kill();
    await exited;
    await rm(profile, { recursive: true, force: true });
  });

  let nextId = 0;
  let buffer = '';
  const pending = new Map();
  const events = new Map();
  function fail(error) {
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    pending.clear();
  }
  browser.once('error', fail);
  browser.once('exit', (code) => fail(new Error(`Chromium exited (${code}): ${errors}`)));
  browser.stdio[4].on('data', (data) => {
    buffer += data.toString();
    let end;
    while ((end = buffer.indexOf('\0')) !== -1) {
      const message = JSON.parse(buffer.slice(0, end));
      buffer = buffer.slice(end + 1);
      if (message.id) {
        const request = pending.get(message.id);
        if (!request) continue;
        pending.delete(message.id);
        clearTimeout(request.timer);
        if (message.error) request.reject(new Error(JSON.stringify(message.error)));
        else request.resolve(message.result);
      } else {
        const key = `${message.sessionId}:${message.method}`;
        const resolve = events.get(key);
        if (resolve) { events.delete(key); resolve(message.params); }
      }
    }
  });
  function send(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
      const id = ++nextId;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Chromium timed out: ${method}\n${errors}`));
      }, 15000);
      pending.set(id, { resolve, reject, timer });
      browser.stdio[3].write(`${JSON.stringify({ id, method, params, sessionId })}\0`);
    });
  }

  await send('Browser.getVersion');
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Page.enable', {}, sessionId);
  await send('Accessibility.enable', {}, sessionId);
  const loaded = new Promise((resolve) => events.set(`${sessionId}:Page.loadEventFired`, resolve));
  await send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/index.html` }, sessionId);
  await loaded;
  return {
    async evaluate(expression) {
      const result = await send('Runtime.evaluate', {
        expression, returnByValue: true, awaitPromise: true,
      }, sessionId);
      assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails));
      return result.result.value;
    },
    async tree() {
      const { nodes } = await send('Accessibility.getFullAXTree', {}, sessionId);
      return nodes.filter((node) => !node.ignored);
    },
    async key(code, key, windowsVirtualKeyCode) {
      for (const type of ['keyDown', 'keyUp']) {
        await send('Input.dispatchKeyEvent', { type, code, key, windowsVirtualKeyCode }, sessionId);
      }
    },
  };
}

test('real-browser accessibility and full-board rendering', { timeout: 90000 }, async (t) => {
  const page = await openBrowser(t);
  const hasNode = (nodes, role, name) => nodes.some((node) =>
    node.role.value === role && node.name?.value === name);

  await t.test('the accessibility tree exposes names, live statistics, and dialogs', async () => {
    const tree = await page.tree();
    for (const name of ['Start game', 'Pause game', 'Restart game']) {
      assert.ok(hasNode(tree, 'button', name), name);
    }
    assert.ok(hasNode(tree, 'image', 'Block Drop game board'));
    assert.ok(hasNode(tree, 'dialog', 'Block Drop'));
    const status = tree.find((node) => node.role.value === 'status');
    assert.ok(status);
    assert.equal(status.properties.find((property) => property.name === 'live').value.value, 'polite');
    assert.equal(status.properties.find((property) => property.name === 'atomic').value.value, true);
  });

  await t.test('native keyboard activation preserves focus and updates game status', async () => {
    await page.key('Space', ' ', 32);
    assert.equal(await page.evaluate('document.activeElement.id'), 'board');
    await page.key('Tab', '\t', 9);
    assert.equal(await page.evaluate('document.activeElement.id'), 'pause-btn');
    await page.key('Space', ' ', 32);
    assert.equal(await page.evaluate('state.paused'), true);
    assert.equal(await page.evaluate('document.activeElement.id'), 'start-btn');
    assert.ok(hasNode(await page.tree(), 'dialog', 'Paused'));
    assert.ok(hasNode(await page.tree(), 'button', 'Resume game'));
    const pausedPiece = await page.evaluate('JSON.stringify(state.piece)');
    await page.key('ArrowLeft', 'ArrowLeft', 37);
    assert.equal(await page.evaluate('JSON.stringify(state.piece)'), pausedPiece);
    await page.key('KeyP', 'p', 80);
    assert.equal(await page.evaluate('document.activeElement.id'), 'board');
    assert.equal(await page.evaluate('state.paused'), false);
    await page.key('Space', ' ', 32);
    assert.equal(await page.evaluate('scoreEl.textContent'), await page.evaluate('state.score.toLocaleString()'));
    assert.ok(await page.evaluate('state.score > 0'));
    await page.evaluate(`
      state.board = createBoard();
      state.board[19].fill('I');
      state.lines = 9;
      state.score = 0;
      clearLines();
    `);
    assert.deepEqual(await page.evaluate('[scoreEl.textContent, linesEl.textContent, levelEl.textContent]'),
      ['100', '10', '2']);
    await page.evaluate('endGame()');
    assert.equal(await page.evaluate('document.activeElement.id'), 'start-btn');
    const tree = await page.tree();
    assert.ok(hasNode(tree, 'dialog', 'Game over'));
    assert.ok(hasNode(tree, 'button', 'Play again'));
    await page.key('Space', ' ', 32);
    assert.equal(await page.evaluate('document.activeElement.id'), 'board');
    assert.equal(await page.evaluate('state.score'), 0);
  });

  await t.test('a full board renders below the 16ms frame budget', async () => {
    const timings = await page.evaluate(`(() => {
      state.board = Array.from({ length: ROWS }, (_, y) =>
        Array.from({ length: COLS }, (_, x) => 'IJLOSTZ'[(x + y) % 7]));
      state.piece = createPiece('T');
      state.particles = [];
      function measure(count) {
        const samples = [];
        for (let i = 0; i < count; i++) {
          const start = performance.now();
          draw();
          ctx.getImageData(0, 0, canvas.width, canvas.height);
          samples.push(performance.now() - start);
        }
        samples.sort((a, b) => a - b);
        return {
          mean: samples.reduce((sum, value) => sum + value, 0) / count,
          p95: samples[Math.ceil(count * 0.95) - 1],
        };
      }
      const cachedDrawBlock = drawBlock;
      let original;
      let originalPixels;
      try {
        drawBlock = function(context, px, py, color, size, alpha = 1) {
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
        original = measure(30);
        originalPixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      } finally {
        drawBlock = cachedDrawBlock;
      }
      blockSprites.clear();
      const cold = measure(1);
      const cachedPixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let difference = 0;
      for (let i = 0; i < originalPixels.length; i++) {
        difference += Math.abs(originalPixels[i] - cachedPixels[i]);
      }
      measure(30);
      return {
        original, cold, cached: measure(240),
        meanPixelDifference: difference / originalPixels.length,
      };
    })()`);
    t.diagnostic(`Full 200-cell board plus active/ghost pieces, including pixel readback: ${JSON.stringify(timings)}`);
    assert.ok(timings.cached.p95 < 16, `Cached p95 was ${timings.cached.p95}ms`);
    assert.ok(timings.cached.mean < timings.original.mean, 'Caching must improve mean frame time');
    assert.ok(timings.meanPixelDifference < 1, 'Cached artwork must preserve the original appearance');
  });
});
