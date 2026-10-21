'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = readFileSync(join(__dirname, 'game.js'), 'utf8');

function loadGame() {
  const canvases = [];

  function createCanvas() {
    const calls = [];
    const saved = [];
    const context = {
      calls,
      globalAlpha: 1,
      shadowBlur: 0,
      save() {
        saved.push(this.globalAlpha);
      },
      restore() {
        this.globalAlpha = saved.pop();
      },
      createLinearGradient(...args) {
        calls.push({ method: 'createLinearGradient', args });
        return { addColorStop() {} };
      },
      drawImage(...args) {
        calls.push({ method: 'drawImage', args, alpha: this.globalAlpha });
      },
    };
    for (const method of [
      'translate', 'beginPath', 'roundRect', 'fill', 'stroke',
      'clearRect', 'fillRect', 'moveTo', 'lineTo',
    ]) {
      context[method] = (...args) => calls.push({ method, args });
    }
    const canvas = {
      width: 120,
      height: 120,
      getContext: () => context,
      context,
    };
    canvases.push(canvas);
    return canvas;
  }

  function eventTarget() {
    const listeners = new Map();
    return {
      listeners,
      addEventListener(type, listener) {
        if (!listeners.has(type)) listeners.set(type, []);
        const handlers = listeners.get(type);
        if (!handlers.includes(listener)) handlers.push(listener);
      },
      dispatch(type, event = {}) {
        for (const listener of listeners.get(type) || []) listener(event);
      },
    };
  }

  const elements = new Map([
    ['board', createCanvas()],
    ['next', createCanvas()],
  ]);
  const document = {
    ...eventTarget(),
    getElementById(id) {
      if (!elements.has(id)) {
        const classes = new Set();
        elements.set(id, {
          ...eventTarget(),
          classList: {
            add: (value) => classes.add(value),
            remove: (value) => classes.delete(value),
          },
        });
      }
      return elements.get(id);
    },
    createElement(tag) {
      assert.equal(tag, 'canvas');
      return createCanvas();
    },
  };
  const frames = [];
  const context = vm.createContext({
    document,
    performance: { now: () => 0 },
    requestAnimationFrame(callback) {
      frames.push(callback);
      return frames.length;
    },
  });
  vm.runInContext(source, context);
  return {
    canvases,
    document,
    elements,
    run: (code) => vm.runInContext(code, context),
    press(code) {
      const event = { code, preventDefault() {} };
      document.dispatch('keydown', event);
    },
  };
}

test('drop interval preserves early speeds and never falls below 100 ms', () => {
  const game = loadGame();
  for (const [level, interval] of [
    [1, 1000], [2, 900], [5, 600], [10, 100],
    [11, 100], [12, 100], [1000, 100],
  ]) {
    assert.equal(game.run(`state.level = ${level}; dropInterval()`), interval);
  }
});

test('high-level gravity waits for the minimum interval rather than every frame', () => {
  const game = loadGame();
  game.run("startGame(); state.level = 11; state.piece = createPiece('O')");
  game.run('update(16); update(32); update(99)');
  assert.equal(game.run('state.piece.y'), 0);
  game.run('update(101)');
  assert.equal(game.run('state.piece.y'), 1);
  game.run('update(117); update(133); update(200)');
  assert.equal(game.run('state.piece.y'), 1);
  game.run('update(202)');
  assert.equal(game.run('state.piece.y'), 2);
});

test('restarting ten times keeps one key listener and one action per key press', () => {
  const game = loadGame();
  game.elements.get('start-btn').dispatch('click');
  for (let i = 0; i < 10; i++) game.elements.get('restart-btn').dispatch('click');

  assert.equal(game.document.listeners.get('keydown').length, 1);
  const x = game.run('state.piece.x');
  game.press('ArrowLeft');
  assert.equal(game.run('state.piece.x'), x - 1);
  game.press('ArrowRight');
  assert.equal(game.run('state.piece.x'), x);

  const y = game.run('state.piece.y');
  game.press('ArrowDown');
  assert.equal(game.run('state.piece.y'), y + 1);
  game.press('KeyP');
  assert.equal(game.run('state.paused'), true);
  game.press('KeyP');
  assert.equal(game.run('state.paused'), false);
  game.press('Space');
  assert.equal(game.run('state.board.flat().filter(Boolean).length'), 4);
});

test('the single keyboard listener ignores input before start and after game over', () => {
  const game = loadGame();
  game.press('ArrowLeft');
  assert.equal(game.run('state.piece'), null);
  game.run('startGame(); endGame()');
  const x = game.run('state.piece.x');
  game.press('ArrowLeft');
  assert.equal(game.run('state.piece.x'), x);
});

test('full-board frames and all next pieces reuse a bounded sprite cache', () => {
  const game = loadGame();
  const gradientCount = () => game.canvases.reduce((total, canvas) =>
    total + canvas.context.calls.filter((call) => call.method === 'createLinearGradient').length, 0);
  const initialGradients = gradientCount();
  assert.equal(initialGradients, 14);
  assert.equal(game.canvases.length, 16);

  game.run(`
    const types = 'IJLOSTZ';
    state.board = Array.from({ length: ROWS }, (_, y) =>
      Array.from({ length: COLS }, (_, x) => types[(x + y) % types.length]));
    state.piece = createPiece('T');
    for (let i = 0; i < 30; i++) draw();
    for (const type of types) {
      state.nextType = type;
      drawNext();
    }
    for (let i = 0; i < 10; i++) startGame();
  `);

  assert.equal(gradientCount(), initialGradients);
  assert.equal(game.canvases.length, 16);
  assert.equal(game.run('blockSprites.size'), 14);
  for (const id of ['board', 'next']) {
    const context = game.elements.get(id).context;
    assert.equal(context.shadowBlur, 0);
    assert.equal(context.calls.some((call) => call.method === 'createLinearGradient'), false);
    assert.equal(context.calls.some((call) => call.method === 'drawImage'), true);
  }
});

test('sprites preserve rounded blocks, padded glow, position, and ghost opacity', () => {
  const game = loadGame();
  const sprite = game.run('blockSprites.get(`${COLORS.I}:${BLOCK}`)');
  assert.equal(sprite.width, 78);
  assert.equal(sprite.height, 78);
  assert.equal(sprite.context.shadowBlur, 12);
  assert.deepEqual(sprite.context.calls.find((call) => call.method === 'roundRect').args,
    [1, 1, 28, 28, 5]);

  game.run('drawBlock(ctx, 30, 60, COLORS.I, BLOCK, 0.18)');
  const context = game.elements.get('board').context;
  const lastDraw = context.calls.filter((call) => call.method === 'drawImage').at(-1);
  assert.equal(lastDraw.args[0], sprite);
  assert.deepEqual(lastDraw.args.slice(1), [6, 36, 78, 78]);
  assert.equal(lastDraw.alpha, 0.18);
  assert.equal(context.globalAlpha, 1);
});
