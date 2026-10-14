'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');

function checkHighDpi(expectedRatio) {
  const game = document.querySelector('iframe').contentWindow;
  const doc = game.document;
  const board = doc.getElementById('board');
  const preview = doc.getElementById('next');
  const context = board.getContext('2d');
  const nextContext = preview.getContext('2d');
  const results = [];

  function check(condition, message) {
    if (!condition) throw new Error(message);
  }

  function run(name, action) {
    try {
      action();
      results.push({ name });
    } catch (error) {
      results.push({ name, error: error.stack });
    }
  }

  function checkCanvas(canvas, width, height, ratio) {
    check(canvas.width === Math.round(width * ratio), `Backing width must scale ${width}px by DPR ${ratio}; got ${canvas.width}`);
    check(canvas.height === Math.round(height * ratio), `Backing height must scale ${height}px by DPR ${ratio}; got ${canvas.height}`);
    const rect = canvas.getBoundingClientRect();
    check(rect.width === width && rect.height === height, 'CSS dimensions must not change with DPR');
    const transform = canvas.getContext('2d').getTransform();
    check(Math.abs(transform.a - canvas.width / width) < 0.000001 && Math.abs(transform.d - canvas.height / height) < 0.000001, 'Context transform must map logical pixels to backing pixels');
    check(transform.b === 0 && transform.c === 0 && transform.e === 0 && transform.f === 0, 'Context must not rotate, skew, or translate');
  }

  function recordCalls(ctx, methods, action) {
    const originals = {};
    const calls = {};
    methods.forEach((name) => {
      originals[name] = ctx[name];
      calls[name] = [];
      ctx[name] = (...args) => {
        calls[name].push(args);
        return originals[name].apply(ctx, args);
      };
    });
    try {
      action();
      return calls;
    } finally {
      methods.forEach((name) => { ctx[name] = originals[name]; });
    }
  }

  run('board and preview scale their backing stores without growing their CSS size', () => {
    check(game.devicePixelRatio === expectedRatio, 'Browser must use the requested DPR');
    checkCanvas(board, 300, 600, expectedRatio);
    checkCanvas(preview, 120, 120, expectedRatio);
  });

  run('grid endpoints and clear rectangles remain in logical coordinates', () => {
    const boardCalls = recordCalls(context, ['lineTo', 'clearRect'], () => game.eval('draw();'));
    check(boardCalls.clearRect.length === 1, 'Draw must clear the board once');
    check(JSON.stringify(boardCalls.clearRect[0]) === '[0,0,300,600]', 'Board clearing must use logical dimensions');
    check(boardCalls.lineTo.length === 28, 'Grid must still draw nine columns and nineteen rows');
    check(boardCalls.lineTo.every(([x, y]) => x <= 300 && y <= 600), 'Grid lines must stay in logical board bounds');
    game.eval("state.nextType = 'T';");
    const previewCalls = recordCalls(nextContext, ['clearRect'], () => game.eval('drawNext();'));
    check(JSON.stringify(previewCalls.clearRect[0]) === '[0,0,120,120]', 'Preview clearing must use logical dimensions');
  });

  run('blocks paint the expected backing pixels and leave empty cells clear', () => {
    game.eval("state.board = createBoard(); state.board[0][0] = 'O'; state.piece = null; state.particles = []; draw();");
    const transform = context.getTransform();
    const filled = context.getImageData(Math.floor(15 * transform.a), Math.floor(15 * transform.d), 1, 1).data;
    const empty = context.getImageData(Math.floor(285 * transform.a), Math.floor(585 * transform.d), 1, 1).data;
    check(filled[3] === 255, 'A filled cell must paint its scaled center pixel');
    check(empty[3] === 0, 'An empty cell must remain clear');
  });

  run('line-clear particles spawn inside the logical board at every DPR', () => {
    const random = game.Math.random;
    try {
      game.Math.random = () => 0.999;
      game.eval('state.particles = []; spawnParticles(19);');
      check(game.eval('state.particles.length') === 40, 'Particle count must not change');
      check(game.eval('state.particles.every((p) => p.x >= 0 && p.x < 300 && p.y === 585)'), 'Particles must not use enlarged backing dimensions');
    } finally {
      game.Math.random = random;
      game.eval('state.particles = [];');
    }
  });

  run('all seven next-piece types remain centered in the logical preview', () => {
    for (const type of 'IJLOSTZ') {
      game.eval(`state.nextType = '${type}';`);
      const calls = recordCalls(nextContext, ['roundRect'], () => game.eval('drawNext();'));
      check(calls.roundRect.length === 4, `${type} must draw four blocks`);
      const left = Math.min(...calls.roundRect.map(([x]) => x));
      const right = Math.max(...calls.roundRect.map(([x, , width]) => x + width));
      const top = Math.min(...calls.roundRect.map(([, y]) => y));
      const bottom = Math.max(...calls.roundRect.map(([, y, , height]) => y + height));
      check((left + right) / 2 === 60 && (top + bottom) / 2 === 60, `${type} must stay centered at 60,60`);
      check(left >= 0 && right <= 120 && top >= 0 && bottom <= 120, `${type} must not be clipped`);
    }
  });

  run('resize and zoom changes redraw without changing game state or accumulating scale', () => {
    game.eval("state.piece = createPiece('T'); state.score = 123; state.lines = 12; state.level = 2; state.paused = true;");
    const before = game.eval('JSON.stringify(state)');
    const original = Object.getOwnPropertyDescriptor(game, 'devicePixelRatio');
    try {
      for (const ratio of [2, 2, 1.333, 1]) {
        Object.defineProperty(game, 'devicePixelRatio', { value: ratio, configurable: true });
        const calls = recordCalls(nextContext, ['clearRect'], () => game.dispatchEvent(new game.Event('resize')));
        checkCanvas(board, 300, 600, ratio);
        checkCanvas(preview, 120, 120, ratio);
        check(calls.clearRect.length === 1, 'Resize must redraw the next-piece preview');
        check(game.eval('JSON.stringify(state)') === before, 'Resize must preserve the board, piece, score, pause, and counters');
      }
    } finally {
      Object.defineProperty(game, 'devicePixelRatio', original);
      game.dispatchEvent(new game.Event('resize'));
    }
  });

  run('display-DPR changes refresh both canvases and re-arm the resolution watcher', () => {
    const matchMedia = game.matchMedia;
    const descriptor = Object.getOwnPropertyDescriptor(game, 'devicePixelRatio');
    const queries = [];
    game.matchMedia = (query) => {
      const media = matchMedia.call(game, query);
      queries.push({ query, media });
      return media;
    };
    try {
      game.eval('watchPixelRatio();');
      check(queries.length === 1, 'A resolution watcher must be registered');
      Object.defineProperty(game, 'devicePixelRatio', { value: 1.5, configurable: true });
      queries[0].media.dispatchEvent(new game.Event('change'));
      checkCanvas(board, 300, 600, 1.5);
      checkCanvas(preview, 120, 120, 1.5);
      check(queries.length === 2 && queries[1].query.includes('1.5dppx'), 'Watcher must follow the new display resolution');
      queries[0].media.dispatchEvent(new game.Event('change'));
      check(queries.length === 2, 'The old resolution listener must be removed after one change');
      Object.defineProperty(game, 'devicePixelRatio', { value: 2.5, configurable: true });
      queries[1].media.dispatchEvent(new game.Event('change'));
      checkCanvas(board, 300, 600, 2.5);
      checkCanvas(preview, 120, 120, 2.5);
      check(queries.length === 3, 'The replacement watcher must handle later display changes');
    } finally {
      game.matchMedia = matchMedia;
      Object.defineProperty(game, 'devicePixelRatio', descriptor);
      game.dispatchEvent(new game.Event('resize'));
    }
  });

  document.getElementById('results').textContent = btoa(JSON.stringify(results));
}

for (const ratio of [1, 1.25, 2, 3]) {
  test(`Block Drop high-DPI rendering at DPR ${ratio}`, async (t) => {
    const directory = mkdtempSync(join(tmpdir(), 'block-drop-high-dpi-'));
    try {
      const fixture = join(directory, 'checks.html');
      const url = pathToFileURL(join(__dirname, 'index.html')).href;
      writeFileSync(fixture, `<!doctype html><html><body>
        <iframe src="${url}" style="width:800px;height:1000px"></iframe>
        <pre id="results"></pre>
        <script>window.addEventListener('load', () => (${checkHighDpi.toString()})(${ratio}));</script>
        </body></html>`);
      const browser = spawnSync(process.env.CHROMIUM_BIN || 'chromium', [
        '--headless', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
        '--allow-file-access-from-files', '--no-first-run', '--no-default-browser-check',
        `--force-device-scale-factor=${ratio}`, `--user-data-dir=${join(directory, 'profile')}`,
        '--dump-dom', '--virtual-time-budget=5000', pathToFileURL(fixture).href,
      ], { encoding: 'utf8', timeout: 30000, maxBuffer: 2 * 1024 * 1024 });
      assert.ifError(browser.error);
      assert.equal(browser.status, 0, browser.stderr);
      const match = browser.stdout.match(/<pre id="results">([A-Za-z0-9+/=]+)<\/pre>/);
      assert.ok(match, `Browser checks did not complete:\n${browser.stderr}\n${browser.stdout}`);
      const results = JSON.parse(Buffer.from(match[1], 'base64').toString('utf8'));
      assert.equal(results.length, 7, 'Every browser check must report a result');
      for (const result of results) {
        await t.test(result.name, () => assert.equal(result.error, undefined, result.error));
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
}
