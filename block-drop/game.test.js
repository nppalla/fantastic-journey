'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = readFileSync(join(__dirname, 'game.js'), 'utf8');

function loadGame(pixelRatio = 1) {
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
      'setTransform', 'translate', 'beginPath', 'roundRect', 'fill', 'stroke',
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
  const frames = new Map();
  let frameId = 0;
  const window = { ...eventTarget(), devicePixelRatio: pixelRatio };
  const context = vm.createContext({
    document,
    window,
    performance: { now: () => 0 },
    requestAnimationFrame(callback) {
      frames.set(++frameId, callback);
      return frameId;
    },
    cancelAnimationFrame(id) {
      frames.delete(id);
    },
  });
  vm.runInContext(source, context);
  return {
    canvases,
    document,
    elements,
    frames,
    window,
    frame(time) {
      const callbacks = [...frames.values()];
      frames.clear();
      for (const callback of callbacks) callback(time);
      return callbacks.length;
    },
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
  for (const time of [16, 32, 99]) game.frame(time);
  assert.equal(game.run('state.piece.y'), 0);
  game.frame(100);
  assert.equal(game.run('state.piece.y'), 1);
  for (const time of [117, 133, 199]) game.frame(time);
  assert.equal(game.run('state.piece.y'), 1);
  game.frame(200);
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

test('restarts retain one pending frame and one update per animation frame', () => {
  const game = loadGame();
  assert.equal(game.frames.size, 0);
  game.run('startGame()');
  for (let cycle = 0; cycle < 10; cycle++) {
    for (let i = 0; i < 10; i++) game.elements.get('restart-btn').dispatch('click');
    assert.equal(game.frames.size, 1);
    assert.equal(game.frame(16), 1);
    assert.equal(game.frames.size, 1);
  }

  game.run("state.piece = createPiece('O')");
  const before = game.run('state.piece.y');
  assert.equal(game.frame(1000), 1);
  assert.equal(game.run('state.piece.y'), before + 1);
  game.press('KeyP');
  assert.equal(game.frame(1500), 1);
  assert.equal(game.run('state.piece.y'), before + 1);
  game.press('KeyP');
  assert.equal(game.frame(1516), 1);
  assert.equal(game.run('state.piece.y'), before + 1);
  game.run('endGame()');
  assert.equal(game.frame(1532), 1);
  game.elements.get('start-btn').dispatch('click');
  assert.equal(game.frames.size, 1);
  assert.equal(game.frame(16), 1);
});

test('particle updates retain only live particles and preserve their motion', () => {
  const game = loadGame();
  game.run(`
    spawnParticles(19);
    updateParticles(350);
    spawnParticles(3);
    updateParticles(350);
  `);
  assert.equal(game.run('state.particles.length'), 40);
  assert.equal(game.run('state.particles.every((p) => p.life === 0.5)'), true);
  game.run('updateParticles(350)');
  assert.equal(game.run('state.particles.length'), 0);

  game.run(`
    const particle = { x: 10, y: 20, vx: 0.1, vy: -0.1, life: 1 };
    state.particles.push({ ...particle, life: 0.01 }, particle);
    updateParticles(100);
  `);
  assert.equal(game.run('state.particles.length'), 1);
  assert.equal(game.run('state.particles[0].x'), 20);
  assert.equal(game.run('state.particles[0].y'), 10);
  assert.ok(Math.abs(game.run('state.particles[0].vy') + 0.02) < 1e-10);
});

test('particle storage stays bounded across many clears and is reset on restart', () => {
  const game = loadGame();
  game.run('startGame()');
  for (let i = 0; i < 100; i++) {
    game.run(`
      state.board[ROWS - 1].fill('I');
      clearLines();
      updateParticles(701);
    `);
    assert.equal(game.run('state.particles.length'), 0);
  }
  assert.equal(game.run('state.lines'), 100);
  game.run('spawnParticles(19)');
  assert.equal(game.run('state.particles.length'), 40);
  game.elements.get('restart-btn').dispatch('click');
  assert.equal(game.run('state.particles.length'), 0);
});

for (const ratio of [1, 1.25, 1.5, 2, 3]) {
  test(`DPR ${ratio} scales both canvases and sprites without changing game coordinates`, () => {
    const game = loadGame(ratio);
    for (const [id, width, height] of [['board', 300, 600], ['next', 120, 120]]) {
      const canvas = game.elements.get(id);
      assert.equal(canvas.width, Math.round(width * ratio));
      assert.equal(canvas.height, Math.round(height * ratio));
      const transform = canvas.context.calls.find((call) => call.method === 'setTransform');
      assert.deepEqual(transform.args, [ratio, 0, 0, ratio, 0, 0]);
    }
    const sprite = game.run('blockSprites.get(`${COLORS.I}:${BLOCK}`)');
    assert.equal(sprite.width, Math.round(78 * ratio));
    assert.equal(sprite.height, Math.round(78 * ratio));
    assert.equal(sprite.context.shadowBlur, 12 * ratio);
    assert.deepEqual(sprite.context.calls.find((call) => call.method === 'setTransform').args,
      [sprite.width / 78, 0, 0, sprite.height / 78, 0, 0]);

    game.run(`
      startGame();
      state.nextType = 'O';
      drawNext();
      spawnParticles(19);
    `);
    const previewDraws = game.elements.get('next').context.calls
      .filter((call) => call.method === 'drawImage').slice(-4);
    assert.deepEqual(previewDraws.map((call) => call.args.slice(1)),
      [[12, 12, 72, 72], [36, 12, 72, 72], [12, 36, 72, 72], [36, 36, 72, 72]]);
    assert.equal(game.run('state.particles.every((p) => p.x >= 0 && p.x < 300 && p.y === 585)'), true);
    assert.equal(game.run('state.board.length'), 20);
    assert.equal(game.run('state.board[0].length'), 10);
    const boardContext = game.elements.get('board').context;
    game.run('draw()');
    assert.deepEqual(boardContext.calls.filter((call) => call.method === 'clearRect').at(-1).args,
      [0, 0, 300, 600]);
  });
}

test('DPR changes refresh bounded caches and redraw both idle and running canvases', () => {
  const game = loadGame();
  const originalSprite = game.run('blockSprites.get(`${COLORS.I}:${BLOCK}`)');
  const initialCanvases = game.canvases.length;
  game.window.devicePixelRatio = 2;
  game.window.dispatch('resize');
  assert.equal(game.elements.get('board').width, 600);
  assert.equal(game.elements.get('next').width, 240);
  assert.notEqual(game.run('blockSprites.get(`${COLORS.I}:${BLOCK}`)'), originalSprite);
  assert.equal(game.canvases.length, initialCanvases + 14);
  assert.equal(game.frames.size, 0);
  game.window.dispatch('resize');
  assert.equal(game.canvases.length, initialCanvases + 14);

  game.run("startGame(); state.nextType = 'O'; spawnParticles(19)");
  const previewContext = game.elements.get('next').context;
  const previewDrawCount = () => previewContext.calls
    .filter((call) => call.method === 'drawImage').length;
  const beforeDraws = previewDrawCount();
  game.window.devicePixelRatio = 1.5;
  assert.equal(game.frame(16), 1);
  assert.equal(game.elements.get('board').width, 450);
  assert.equal(game.elements.get('next').width, 180);
  assert.equal(previewDrawCount(), beforeDraws + 4);
  assert.equal(game.run('blockSprites.size'), 14);
  assert.equal(game.run('state.particles.length'), 40);
  assert.equal(game.frames.size, 1);

  game.window.devicePixelRatio = undefined;
  game.window.dispatch('resize');
  assert.equal(game.elements.get('board').width, 300);
  assert.equal(game.elements.get('next').width, 120);
});
