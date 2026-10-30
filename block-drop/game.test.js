'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

const source = readFileSync(join(__dirname, 'game.js'), 'utf8');

function loadGame(pixelRatio = 1) {
  const metrics = { gradients: 0, shadowFills: 0, hexParses: 0 };
  const sprites = [];
  const frames = new Map();
  let nextFrame = -1;
  let now = 0;

  function createContext() {
    const stack = [];
    const context = { calls: [], globalAlpha: 1, shadowBlur: 0 };
    for (const name of [
      'clearRect', 'beginPath', 'roundRect', 'moveTo', 'lineTo',
      'stroke', 'fillRect', 'drawImage', 'setTransform',
    ]) {
      context[name] = function (...args) {
        this.calls.push({ name, args, alpha: this.globalAlpha });
      };
    }
    context.createLinearGradient = function (...args) {
      metrics.gradients++;
      const gradient = { stops: [], addColorStop(...stop) { this.stops.push(stop); } };
      this.calls.push({ name: 'createLinearGradient', args, gradient });
      return gradient;
    };
    context.fill = function () {
      if (this.shadowBlur > 0) metrics.shadowFills++;
      this.calls.push({ name: 'fill', alpha: this.globalAlpha });
    };
    context.save = function () {
      this.calls.push({ name: 'save' });
      stack.push(this.globalAlpha);
    };
    context.restore = function () {
      this.calls.push({ name: 'restore' });
      this.globalAlpha = stack.pop();
    };
    return context;
  }

  function createElement() {
    const listeners = new Map();
    const classes = new Set();
    const attributes = new Map();
    let textContent = '';
    return {
      get textContent() { return textContent; },
      set textContent(value) { textContent = String(value); },
      setAttribute: (name, value) => attributes.set(name, String(value)),
      getAttribute: (name) => attributes.get(name) ?? null,
      focus() { document.activeElement = this; },
      classList: {
        add: (name) => classes.add(name),
        remove: (name) => classes.delete(name),
        contains: (name) => classes.has(name),
      },
      addEventListener(name, callback) {
        if (!listeners.has(name)) listeners.set(name, new Set());
        listeners.get(name).add(callback);
      },
      dispatch(name, event) {
        for (const callback of listeners.get(name) || []) callback(event);
      },
    };
  }

  function createCanvas() {
    const canvas = Object.assign(createElement(), { width: 300, height: 150, style: {} });
    const context = createContext();
    canvas.getContext = () => context;
    return canvas;
  }

  const elements = new Map();
  for (const id of [
    'board', 'next', 'score', 'lines', 'level', 'overlay',
    'overlay-title', 'overlay-text', 'start-btn', 'pause-btn', 'restart-btn',
  ]) {
    elements.set(id, id === 'board' || id === 'next' ? createCanvas() : createElement());
  }
  elements.get('next').width = 120;
  elements.get('next').height = 120;
  const document = Object.assign(createElement(), {
    getElementById: (id) => elements.get(id),
    createElement(tag) {
      assert.equal(tag, 'canvas');
      const sprite = createCanvas();
      sprites.push(sprite);
      return sprite;
    },
  });
  const window = Object.assign(createElement(), { devicePixelRatio: pixelRatio });
  const sandbox = vm.createContext({
    document, window,
    parseInt(value, radix) {
      metrics.hexParses++;
      return parseInt(value, radix);
    },
    performance: { now: () => now },
    requestAnimationFrame(callback) {
      frames.set(++nextFrame, callback);
      return nextFrame;
    },
    cancelAnimationFrame: (id) => frames.delete(id),
  });
  const run = (code) => vm.runInContext(code, sandbox);
  run(source);

  return {
    elements, document, window, frames, metrics, sprites, run,
    frame(time) {
      now = time;
      const callbacks = [...frames.entries()];
      for (const [id, callback] of callbacks) {
        if (!frames.delete(id)) continue;
        callback(time);
      }
      return callbacks.length;
    },
  };
}

function calls(canvas, name) {
  return canvas.getContext('2d').calls.filter((call) => call.name === name);
}

test('ten restarts retain one update and draw per frame with a fresh drop timer', () => {
  const game = loadGame();
  const board = game.elements.get('board');
  assert.equal(game.frames.size, 0);
  game.elements.get('start-btn').dispatch('click');
  const firstFrame = game.frames.keys().next().value;
  assert.equal(firstFrame, 0);
  for (let i = 0; i < 10; i++) {
    game.elements.get('restart-btn').dispatch('click');
    assert.equal(game.frames.size, 1);
    assert.equal(game.frames.keys().next().value, firstFrame);
  }

  for (const time of [100, 200, 300]) {
    const draws = calls(board, 'clearRect').length;
    assert.equal(game.frame(time), 1);
    assert.equal(calls(board, 'clearRect').length - draws, 1);
    assert.equal(game.frames.size, 1);
    assert.equal(game.run('state.dropCounter'), time);
  }
  const pendingFrame = game.frames.keys().next().value;
  game.elements.get('restart-btn').dispatch('click');
  assert.equal(game.frames.keys().next().value, pendingFrame);
  assert.equal(game.frame(316), 1);
  assert.equal(game.run('state.dropCounter'), 16);
});

test('starting after idle and restarting between frames resets elapsed time, not the loop', () => {
  const game = loadGame();
  assert.equal(game.frame(60000), 0);
  for (let i = 0; i < 20; i++) {
    game.elements.get('restart-btn').dispatch('click');
    const pendingFrame = game.frames.keys().next().value;
    for (let j = 0; j < 10; j++) game.elements.get('restart-btn').dispatch('click');
    assert.equal(game.frames.keys().next().value, pendingFrame);
    assert.equal(game.frame(60000 + (i + 1) * 16), 1);
    assert.equal(game.frames.size, 1);
    assert.equal(game.run('state.dropCounter'), 16);
    assert.equal(game.run('state.piece.y === (state.piece.type === "I" ? -1 : 0)'), true);
  }
});

test('pause, resume, game over, and restarting preserve a single render loop', () => {
  const game = loadGame();
  game.elements.get('start-btn').dispatch('click');
  game.frame(16);
  game.elements.get('pause-btn').dispatch('click');
  const y = game.run('state.piece.y');
  assert.equal(game.frame(1016), 1);
  assert.equal(game.run('state.piece.y'), y);
  game.elements.get('start-btn').dispatch('click');
  assert.equal(game.run('state.paused'), false);
  assert.equal(game.frame(1032), 1);
  game.run('endGame()');
  assert.equal(game.frame(1048), 1);
  game.elements.get('start-btn').dispatch('click');
  assert.equal(game.run('state.over'), false);
  assert.equal(game.frames.size, 1);
  assert.equal(game.frame(1064), 1);
});

test('restarting registers keyboard input only once', () => {
  const game = loadGame();
  for (let i = 0; i < 11; i++) game.elements.get('restart-btn').dispatch('click');
  game.run("state.piece = createPiece('O')");
  const x = game.run('state.piece.x');
  let prevented = 0;
  game.document.dispatch('keydown', {
    code: 'ArrowLeft',
    preventDefault() { prevented++; },
  });
  assert.equal(game.run('state.piece.x'), x - 1);
  assert.equal(prevented, 1);
});

test('dense-board drawing reuses gradient and glow sprites for both block sizes', () => {
  const game = loadGame();
  game.run(`
    state.board = createBoard().map((row, y) => row.map((_, x) => 'IJLOSTZ'[(x + y) % 7]));
    state.piece = createPiece('T');
    draw();
    for (const type of 'IJLOSTZ') {
      state.nextType = type;
      drawNext();
    }
  `);
  assert.equal(game.sprites.length, 14);
  assert.deepEqual(game.metrics, { gradients: 14, shadowFills: 14, hexParses: 14 });

  const board = game.elements.get('board');
  const before = calls(board, 'drawImage').length;
  game.run('for (let i = 0; i < 100; i++) { draw(); drawNext(); }');
  assert.equal(calls(board, 'drawImage').length - before, 100 * 208);
  assert.equal(game.sprites.length, 14);
  assert.deepEqual(game.metrics, { gradients: 14, shadowFills: 14, hexParses: 14 });
  assert.equal(calls(board, 'roundRect').length, 0);
  assert.equal(board.getContext('2d').shadowBlur, 0);
});

test('cached artwork preserves gradients, rounded corners, and padded glow', () => {
  const game = loadGame();
  game.run("drawBlock(ctx, 30, 60, COLORS.I, BLOCK)");
  assert.equal(game.sprites.length, 1);
  const sprite = game.sprites[0];
  assert.equal(sprite.width, 66);
  assert.equal(sprite.height, 66);
  const gradient = calls(sprite, 'createLinearGradient')[0];
  assert.deepEqual(gradient.args, [18, 18, 48, 48]);
  assert.deepEqual(gradient.gradient.stops, [[0, 'rgb(126, 212, 250)'], [1, '#38bdf8']]);
  assert.deepEqual(calls(sprite, 'roundRect')[0].args, [19, 19, 28, 28, 5]);
  assert.equal(sprite.getContext('2d').shadowBlur, 12);
  assert.equal(sprite.getContext('2d').shadowColor, '#38bdf8');
  assert.deepEqual(calls(game.elements.get('board'), 'drawImage').at(-1).args,
    [sprite, 12, 42, 66, 66]);
});

test('active and ghost pieces share sprites without leaking drawing opacity', () => {
  const game = loadGame();
  game.run("state.piece = createPiece('O'); draw()");
  const board = game.elements.get('board');
  const blocks = calls(board, 'drawImage');
  assert.equal(blocks.length, 8);
  assert.equal(new Set(blocks.map(({ args }) => args[0])).size, 1);
  assert.deepEqual(blocks.map(({ alpha }) => alpha), [0.18, 0.18, 0.18, 0.18, 1, 1, 1, 1]);
  assert.equal(board.getContext('2d').globalAlpha, 1);
});

test('cached blocks restore incoming opacity without saving the entire context', () => {
  const game = loadGame();
  for (const [id, context] of [['board', 'ctx'], ['next', 'nextCtx']]) {
    const canvas = game.elements.get(id);
    game.run(`
      ${context}.globalAlpha = 0.4;
      drawBlock(${context}, 30, 60, COLORS.I, ${id === 'board' ? 'BLOCK' : 'PREVIEW_BLOCK'}, 0.18);
    `);
    assert.equal(calls(canvas, 'drawImage').at(-1).alpha, 0.18);
    assert.equal(canvas.getContext('2d').globalAlpha, 0.4);
    assert.equal(calls(canvas, 'save').length, 0);
    assert.equal(calls(canvas, 'restore').length, 0);
  }
});

test('preview sprites keep every next-piece shape centered at its original size', () => {
  const game = loadGame();
  const preview = game.elements.get('next');
  for (const type of 'IJLOSTZ') {
    preview.getContext('2d').calls.length = 0;
    game.run(`state.nextType = '${type}'; drawNext()`);
    const blocks = calls(preview, 'drawImage');
    assert.equal(blocks.length, 4);
    const xs = blocks.map(({ args }) => args[1] + 18);
    const ys = blocks.map(({ args }) => args[2] + 18);
    assert.equal((Math.min(...xs) + Math.max(...xs) + 24) / 2, 60);
    assert.equal((Math.min(...ys) + Math.max(...ys) + 24) / 2, 60);
    assert.equal(blocks[0].args[0].width, 60);
    assert.equal(blocks[0].args[0].height, 60);
    assert.deepEqual(calls(preview, 'clearRect').at(-1).args, [0, 0, 120, 120]);
  }
});

for (const ratio of [1, 1.25, 1.5, 2, 3]) {
  test(`DPR ${ratio}: backing stores scale without changing layout or preview centering`, () => {
    const game = loadGame(ratio);
    for (const [id, width, height] of [['board', 300, 600], ['next', 120, 120]]) {
      const target = game.elements.get(id);
      assert.equal(target.width, width * ratio);
      assert.equal(target.height, height * ratio);
      assert.deepEqual(target.style, { width: `${width}px`, height: `${height}px` });
      assert.deepEqual(calls(target, 'setTransform').at(-1).args, [ratio, 0, 0, ratio, 0, 0]);
    }

    const preview = game.elements.get('next');
    for (const type of 'IJLOSTZ') {
      preview.getContext('2d').calls.length = 0;
      game.run(`state.nextType = '${type}'; drawNext()`);
      const blocks = calls(preview, 'drawImage');
      const padding = Math.ceil(18 * ratio) / ratio;
      const xs = blocks.map(({ args }) => args[1] + padding);
      const ys = blocks.map(({ args }) => args[2] + padding);
      assert.equal((Math.min(...xs) + Math.max(...xs) + 24) / 2, 60);
      assert.equal((Math.min(...ys) + Math.max(...ys) + 24) / 2, 60);
      assert.deepEqual(calls(preview, 'clearRect').at(-1).args, [0, 0, 120, 120]);
    }
    assert.equal(game.frames.size, 0);
  });

  test(`DPR ${ratio}: sprites and grid align to device pixels and retain a bounded cache`, () => {
    const game = loadGame(ratio);
    game.run(`
      state.board = createBoard().map((row, y) => row.map((_, x) => 'IJLOSTZ'[(x + y) % 7]));
      state.piece = createPiece('T');
      draw();
      for (const type of 'IJLOSTZ') { state.nextType = type; drawNext(); }
    `);
    assert.equal(game.run('blockSprites.size'), 14);
    assert.deepEqual(game.metrics, { gradients: 14, shadowFills: 14, hexParses: 14 });
    const padding = Math.ceil(18 * ratio);
    for (const sprite of game.sprites) {
      const size = calls(sprite, 'roundRect')[0].args[2] + 2;
      assert.equal(sprite.width, Math.ceil(size * ratio + padding * 2));
      assert.equal(sprite.height, sprite.width);
      assert.equal(sprite.getContext('2d').shadowBlur, 12 * ratio);
      assert.deepEqual(calls(sprite, 'setTransform')[0].args, [ratio, 0, 0, ratio, 0, 0]);
    }
    for (const id of ['board', 'next']) {
      for (const { args: [sprite, x, y, width, height] } of calls(game.elements.get(id), 'drawImage')) {
        assert.ok(Math.abs(x * ratio - Math.round(x * ratio)) < 1e-10);
        assert.ok(Math.abs(y * ratio - Math.round(y * ratio)) < 1e-10);
        assert.equal(width * ratio, sprite.width);
        assert.equal(height * ratio, sprite.height);
      }
    }
    const board = game.elements.get('board');
    assert.equal(board.getContext('2d').lineWidth * ratio, 1);
    for (const { args: [x, y] } of calls(board, 'moveTo')) {
      const position = (x || y) * ratio;
      assert.ok(Math.abs(position % 1 - 0.5) < 1e-10);
    }
    assert.ok(calls(board, 'lineTo').every(({ args: [x, y] }) => x <= 300 && y <= 600));

    game.run('for (let i = 0; i < 100; i++) { draw(); drawNext(); }');
    assert.equal(game.sprites.length, 14);
    assert.deepEqual(game.metrics, { gradients: 14, shadowFills: 14, hexParses: 14 });
    assert.equal(calls(board, 'setTransform').length, 1);
    assert.equal(calls(board, 'roundRect').length, 0);
    assert.equal(board.getContext('2d').shadowBlur, 0);
  });
}

test('zoom and display changes replace cached sprites without resetting gameplay or the render loop', () => {
  const game = loadGame();
  game.elements.get('start-btn').dispatch('click');
  game.frame(16);
  game.elements.get('pause-btn').dispatch('click');
  game.run(`
    state.score = 123;
    state.lines = 4;
    state.level = 2;
    state.particles = [{ x: 25, y: 35, life: 1, color: COLORS.I }];
  `);
  const snapshot = game.run('JSON.stringify(state)');
  const pendingFrame = game.frames.keys().next().value;
  for (const ratio of [2, 1.25, 3, 1]) {
    const oldSprites = new Set(game.run('[...blockSprites.values()]'));
    game.window.devicePixelRatio = ratio;
    game.window.dispatch('resize');
    assert.equal(game.run('JSON.stringify(state)'), snapshot);
    assert.equal(game.frames.size, 1);
    assert.equal(game.frames.keys().next().value, pendingFrame);
    assert.equal(game.elements.get('board').width, 300 * ratio);
    assert.equal(game.elements.get('next').width, 120 * ratio);
    assert.ok(calls(game.elements.get('next'), 'drawImage').at(-1));
    const currentSprites = game.run('[...blockSprites.values()]');
    assert.ok(currentSprites.length > 0 && currentSprites.length <= 14);
    assert.ok(currentSprites.every((sprite) => !oldSprites.has(sprite)));
    const count = game.sprites.length;
    game.window.dispatch('resize');
    game.run('draw()');
    assert.equal(game.sprites.length, count);
  }
});

test('scale changes are detected before starting and on frames even without a resize event', () => {
  const game = loadGame();
  game.window.devicePixelRatio = 2;
  game.window.dispatch('resize');
  assert.equal(game.elements.get('board').width, 600);
  assert.equal(game.frames.size, 0);
  game.elements.get('start-btn').dispatch('click');
  game.window.devicePixelRatio = 1.25;
  game.frame(16);
  assert.equal(game.elements.get('board').width, 375);
  assert.equal(game.elements.get('next').width, 150);
  assert.equal(game.frames.size, 1);
});

test('high-DPI particles and clearing rectangles stay in logical board coordinates', () => {
  const game = loadGame(2);
  game.run('Math.random = () => 0.99; spawnParticles(19); draw()');
  assert.equal(game.run('state.particles.length'), 40);
  assert.equal(game.run('state.particles.every((p) => p.x === 297 && p.y === 585)'), true);
  assert.deepEqual(calls(game.elements.get('board'), 'clearRect').at(-1).args, [0, 0, 300, 600]);
});

test('control names and focus follow start, pause, resume, game over, and restart', () => {
  const game = loadGame();
  const start = game.elements.get('start-btn');
  const pause = game.elements.get('pause-btn');
  const board = game.elements.get('board');
  start.dispatch('click');
  assert.equal(game.document.activeElement, board);
  assert.equal(pause.disabled, false);
  assert.equal(pause.getAttribute('aria-label'), 'Pause game');
  pause.dispatch('click');
  assert.equal(game.document.activeElement, start);
  assert.equal(start.getAttribute('aria-label'), 'Resume game');
  assert.equal(pause.getAttribute('aria-label'), 'Resume game');
  assert.equal(game.elements.get('overlay').classList.contains('hidden'), false);
  start.dispatch('click');
  assert.equal(game.document.activeElement, board);
  assert.equal(pause.getAttribute('aria-label'), 'Pause game');
  game.run('state.score = 123; endGame()');
  assert.equal(game.document.activeElement, start);
  assert.equal(start.getAttribute('aria-label'), 'Restart game');
  assert.equal(pause.disabled, true);
  assert.equal(game.elements.get('overlay-text').textContent, 'Final score: 123');
  start.dispatch('click');
  assert.equal(game.document.activeElement, board);
  assert.equal(pause.disabled, false);
  assert.equal(pause.getAttribute('aria-label'), 'Pause game');
});

test('line clears, level changes, hard drops, and restarts update accessible stats', () => {
  const game = loadGame();
  game.elements.get('start-btn').dispatch('click');
  game.run(`
    state.lines = 9;
    state.board[19].fill('I');
    clearLines();
  `);
  assert.equal(game.elements.get('score').textContent, '100');
  assert.equal(game.elements.get('lines').textContent, '10');
  assert.equal(game.elements.get('level').textContent, '2');
  game.run("state.piece = createPiece('O'); hardDrop()");
  assert.equal(game.elements.get('score').textContent, game.run('state.score.toLocaleString()'));
  assert.ok(game.run('state.score > 100'));
  game.elements.get('restart-btn').dispatch('click');
  assert.equal(game.elements.get('score').textContent, '0');
  assert.equal(game.elements.get('lines').textContent, '0');
  assert.equal(game.elements.get('level').textContent, '1');
});

test('unchanged stats and animation frames do not rewrite the live region', () => {
  const game = loadGame();
  game.elements.get('start-btn').dispatch('click');
  let mutations = 0;
  for (const id of ['score', 'lines', 'level']) {
    const element = game.elements.get(id);
    let value = element.textContent;
    Object.defineProperty(element, 'textContent', {
      get: () => value,
      set(text) { mutations++; value = text; },
    });
  }
  game.run('updateStats()');
  for (const time of [16, 32, 48]) game.frame(time);
  assert.equal(mutations, 0);
  game.run('state.score = 20; updateStats()');
  assert.equal(mutations, 1);
});

test('keyboard events on native controls are not consumed as game actions', () => {
  const game = loadGame();
  game.elements.get('start-btn').dispatch('click');
  const before = game.run('JSON.stringify(state)');
  for (const code of ['Space', 'ArrowUp', 'ArrowDown']) {
    game.document.dispatch('keydown', {
      code,
      target: {
        closest(selector) {
          return selector.includes('button') ? game.elements.get('pause-btn') : null;
        },
      },
      preventDefault() { assert.fail('Native control keys must retain their default action'); },
    });
  }
  assert.equal(game.run('JSON.stringify(state)'), before);
});

test('P resumes from the focused dialog action without intercepting text input', () => {
  const game = loadGame();
  game.elements.get('start-btn').dispatch('click');
  game.elements.get('pause-btn').dispatch('click');
  let prevented = 0;
  game.document.dispatch('keydown', {
    code: 'KeyP',
    target: { closest: (selector) => selector.includes('button') ? game.elements.get('start-btn') : null },
    preventDefault() { prevented++; },
  });
  assert.equal(game.run('state.paused'), false);
  assert.equal(game.document.activeElement, game.elements.get('board'));
  assert.equal(prevented, 1);
  game.document.dispatch('keydown', {
    code: 'KeyP',
    target: { closest: (selector) => selector.includes('input') ? {} : null },
    preventDefault() { assert.fail('Typing P must not be prevented'); },
  });
  assert.equal(game.run('state.paused'), false);
});

test('documented rotation and hard-drop keys match gameplay', () => {
  const readme = readFileSync(join(__dirname, 'README.md'), 'utf8');
  assert.match(readme, /\| Up arrow \| Rotate the piece \|/);
  assert.match(readme, /\| Space \| Hard drop \|/);
  const game = loadGame();
  game.elements.get('start-btn').dispatch('click');
  game.run("state.piece = createPiece('T')");
  const shape = game.run('JSON.stringify(state.piece.shape)');
  game.document.dispatch('keydown', { code: 'ArrowUp', preventDefault() {} });
  assert.notEqual(game.run('JSON.stringify(state.piece.shape)'), shape);
  game.document.dispatch('keydown', { code: 'Space', preventDefault() {} });
  assert.ok(game.run('state.score > 0'));
  assert.equal(game.run('state.board.some((row) => row.some(Boolean))'), true);
});
