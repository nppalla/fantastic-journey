'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

const source = readFileSync(join(__dirname, 'game.js'), 'utf8');

function loadGame() {
  const frames = new Map();
  const elements = new Map();
  const contexts = [];
  const effects = { gradients: 0, parses: 0, shadows: 0, fills: 0 };
  let nextFrameId = 0;
  let now = 0;

  function createContext() {
    const calls = [];
    const stack = [];
    const context = {
      calls,
      globalAlpha: 1,
      save() {
        stack.push(this.globalAlpha);
      },
      restore() {
        this.globalAlpha = stack.pop();
      },
      createLinearGradient(...args) {
        effects.gradients++;
        calls.push({ method: 'createLinearGradient', args });
        return { addColorStop() {} };
      },
      fill() {
        effects.fills++;
      },
      set shadowBlur(value) {
        effects.shadows++;
        calls.push({ method: 'shadowBlur', args: [value] });
      },
    };
    for (const method of [
      'beginPath', 'roundRect', 'clearRect', 'moveTo', 'lineTo', 'stroke', 'fillRect', 'drawImage',
    ]) {
      context[method] = function (...args) {
        calls.push({ method, args, alpha: this.globalAlpha });
      };
    }
    contexts.push(context);
    return context;
  }

  function createElement() {
    const context = createContext();
    const listeners = new Map();
    return {
      width: 120,
      height: 120,
      classList: { add() {}, remove() {} },
      getContext: () => context,
      addEventListener(type, listener) {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type).add(listener);
      },
      click() {
        for (const listener of listeners.get('click') || []) listener();
      },
    };
  }

  const sandbox = vm.createContext({
    document: {
      getElementById(id) {
        if (!elements.has(id)) elements.set(id, createElement());
        return elements.get(id);
      },
      createElement(tag) {
        assert.equal(tag, 'canvas');
        return createElement();
      },
      addEventListener() {},
    },
    performance: { now: () => now },
    parseInt(...args) {
      effects.parses++;
      return parseInt(...args);
    },
    requestAnimationFrame(callback) {
      const id = nextFrameId++;
      frames.set(id, callback);
      return id;
    },
    cancelAnimationFrame(id) {
      frames.delete(id);
    },
  });
  vm.runInContext(source, sandbox, { filename: 'game.js' });

  return {
    frames,
    elements,
    contexts,
    effects,
    run: (code) => vm.runInContext(code, sandbox),
    frame(delta = 16) {
      now += delta;
      const callbacks = [...frames.values()];
      frames.clear();
      for (const callback of callbacks) callback(now);
      return callbacks.length;
    },
  };
}

test('ten restarts still produce exactly one update and draw per frame', () => {
  const game = loadGame();
  const board = game.elements.get('board').getContext('2d');
  assert.equal(game.frames.size, 0);

  game.elements.get('start-btn').click();
  assert.ok(game.frames.has(0));
  for (let restart = 0; restart < 10; restart++) {
    game.elements.get('restart-btn').click();
    assert.equal(game.frames.size, 1);
  }

  for (let frame = 0; frame < 20; frame++) {
    board.calls.length = 0;
    assert.equal(game.frame(), 1);
    assert.equal(game.frames.size, 1);
    assert.equal(board.calls.filter((call) => call.method === 'clearRect').length, 1);
  }
});

test('restart after active frames, pause, or game over keeps one loop and resets timing', () => {
  const game = loadGame();
  game.elements.get('start-btn').click();
  game.frame(600);
  game.frame(600);
  assert.equal(game.run('state.piece.y'), game.run("state.piece.type === 'I' ? 0 : 1"));

  game.elements.get('pause-btn').click();
  assert.equal(game.run('state.paused'), true);
  game.frame(5000);
  game.elements.get('start-btn').click();
  assert.equal(game.run('state.paused'), false);
  assert.equal(game.frames.size, 1);

  game.run('endGame()');
  game.frame(5000);
  game.elements.get('start-btn').click();
  const initialY = game.run('state.piece.y');
  assert.equal(game.run('state.running && !state.over'), true);
  assert.equal(game.frames.size, 1);
  assert.equal(game.frame(), 1);
  assert.equal(game.run('state.piece.y'), initialY);
  assert.equal(game.run('state.dropCounter'), 16);

  game.elements.get('restart-btn').click();
  assert.equal(game.frames.size, 1);
  assert.equal(game.frame(), 1);
});

test('a full board, active piece, and ghost reuse effects for every subsequent frame', () => {
  const game = loadGame();
  const board = game.elements.get('board').getContext('2d');
  game.run(`
    const types = Object.keys(COLORS);
    state.board = Array.from({ length: ROWS }, (_, y) =>
      Array.from({ length: COLS }, (_, x) => types[(y * COLS + x) % types.length]));
    state.piece = createPiece('O');
    draw();
  `);
  assert.deepEqual(game.effects, { gradients: 7, parses: 7, shadows: 7, fills: 7 });
  const warmedEffects = { ...game.effects };
  const warmedContexts = game.contexts.length;
  board.calls.length = 0;

  for (let frame = 0; frame < 60; frame++) game.run('draw()');

  assert.deepEqual(game.effects, warmedEffects);
  assert.equal(game.contexts.length, warmedContexts);
  const images = board.calls.filter((call) => call.method === 'drawImage');
  assert.equal(images.length, 60 * (200 + 4 + 4));
  assert.equal(images.filter((call) => call.alpha === 0.18).length, 60 * 4);
  assert.equal(board.globalAlpha, 1);
  assert.ok(!board.calls.some((call) => call.method === 'createLinearGradient'));
});

test('preview sprites are cached separately by size and color and survive restarts', () => {
  const game = loadGame();
  game.run(`
    for (const type of Object.keys(COLORS)) {
      drawBlock(ctx, 0, 0, COLORS[type], BLOCK);
      state.nextType = type;
      drawNext();
    }
  `);
  assert.deepEqual(game.effects, { gradients: 14, parses: 14, shadows: 14, fills: 14 });
  const warmedEffects = { ...game.effects };

  for (let restart = 0; restart < 10; restart++) {
    game.elements.get('restart-btn').click();
    game.frame();
    game.run(`
      for (const type of Object.keys(COLORS)) {
        state.nextType = type;
        drawNext();
      }
    `);
  }
  assert.deepEqual(game.effects, warmedEffects);
});

test('sprites preserve block placement, gradient, rounded corners, glow, and alpha', () => {
  const game = loadGame();
  const board = game.elements.get('board').getContext('2d');
  game.run("drawBlock(ctx, 60, 90, COLORS.T, BLOCK, 0.18)");
  const image = board.calls.find((call) => call.method === 'drawImage');
  const [sprite, x, y] = image.args;
  const spriteContext = sprite.getContext('2d');

  assert.equal(sprite.width, 62);
  assert.equal(sprite.height, 62);
  assert.deepEqual([x, y], [44, 74]);
  assert.equal(image.alpha, 0.18);
  assert.equal(board.globalAlpha, 1);
  assert.equal(spriteContext.shadowColor, '#a855f7');
  assert.deepEqual(
    spriteContext.calls.find((call) => call.method === 'createLinearGradient').args,
    [16, 16, 46, 46],
  );
  assert.deepEqual(
    spriteContext.calls.find((call) => call.method === 'roundRect').args,
    [17, 17, 28, 28, 5],
  );
  assert.deepEqual(
    spriteContext.calls.find((call) => call.method === 'shadowBlur').args,
    [12],
  );
});
