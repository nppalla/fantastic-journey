'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

const source = readFileSync(join(__dirname, 'game.js'), 'utf8');

function loadGame(ratio = 1) {
  const metrics = { gradients: 0, shadowFills: 0 };
  const sprites = [];
  const frames = new Map();
  let nextFrame = 0;
  let now = 0;

  function createContext() {
    const stack = [];
    const context = { calls: [], globalAlpha: 1, shadowBlur: 0 };
    for (const name of [
      'setTransform', 'clearRect', 'beginPath', 'roundRect',
      'moveTo', 'lineTo', 'stroke', 'fillRect', 'drawImage',
    ]) {
      context[name] = function (...args) {
        this.calls.push({ name, args, alpha: this.globalAlpha });
      };
    }
    context.createLinearGradient = () => {
      metrics.gradients++;
      return { addColorStop() {} };
    };
    context.fill = function () {
      if (this.shadowBlur > 0) metrics.shadowFills++;
    };
    context.save = function () {
      stack.push(this.globalAlpha);
    };
    context.restore = function () {
      this.globalAlpha = stack.pop();
    };
    return context;
  }

  function createElement() {
    const listeners = new Map();
    const classes = new Set();
    return {
      style: {},
      classList: {
        add: (name) => classes.add(name),
        remove: (name) => classes.delete(name),
      },
      addEventListener(name, callback) {
        if (!listeners.has(name)) listeners.set(name, []);
        listeners.get(name).push(callback);
      },
      dispatch(name) {
        for (const callback of listeners.get(name) || []) callback();
      },
    };
  }

  function createCanvas() {
    const canvas = createElement();
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
  const window = Object.assign(createElement(), { devicePixelRatio: ratio });
  const sandbox = vm.createContext({
    window,
    document: {
      getElementById: (id) => elements.get(id),
      createElement(tag) {
        assert.equal(tag, 'canvas');
        const sprite = createCanvas();
        sprites.push(sprite);
        return sprite;
      },
      addEventListener() {},
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
    elements, frames, metrics, sprites, window, run,
    frame(time) {
      now = time;
      const callbacks = [...frames.entries()];
      for (const [id, callback] of callbacks) {
        frames.delete(id);
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
  assert.equal(game.frames.size, 0);
  game.elements.get('start-btn').dispatch('click');
  for (let i = 0; i < 10; i++) {
    game.elements.get('restart-btn').dispatch('click');
    assert.equal(game.frames.size, 1);
  }

  const board = game.elements.get('board');
  const draws = calls(board, 'clearRect').length;
  assert.equal(game.frame(100), 1);
  assert.equal(calls(board, 'clearRect').length - draws, 1);
  assert.equal(game.run('state.dropCounter'), 100);
  game.elements.get('restart-btn').dispatch('click');
  assert.equal(game.frame(116), 1);
  assert.equal(game.run('state.dropCounter'), 16);

  game.run('togglePause()');
  const y = game.run('state.piece.y');
  assert.equal(game.frame(1116), 1);
  assert.equal(game.run('state.piece.y'), y);
  game.run('endGame()');
  game.elements.get('start-btn').dispatch('click');
  assert.equal(game.frames.size, 1);
  assert.equal(game.frame(1132), 1);
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
  assert.equal(game.metrics.gradients, 14);
  assert.equal(game.metrics.shadowFills, 14);

  const board = game.elements.get('board');
  const before = calls(board, 'drawImage').length;
  game.run('for (let i = 0; i < 20; i++) { draw(); drawNext(); }');
  assert.equal(calls(board, 'drawImage').length - before, 20 * 208);
  assert.equal(game.sprites.length, 14);
  assert.equal(game.metrics.gradients, 14);
  assert.equal(game.metrics.shadowFills, 14);
  assert.equal(calls(board, 'roundRect').length, 0);
  assert.equal(board.getContext('2d').shadowBlur, 0);
});

for (const ratio of [1, 1.25, 2]) {
  test(`DPR ${ratio} scales backing stores without changing layout or preview centering`, () => {
    const game = loadGame(ratio);
    game.run("state.nextType = 'O'; drawNext()");
    for (const [id, width, height] of [['board', 300, 600], ['next', 120, 120]]) {
      const canvas = game.elements.get(id);
      assert.equal(canvas.width, Math.round(width * ratio));
      assert.equal(canvas.height, Math.round(height * ratio));
      assert.equal(canvas.style.width, `${width}px`);
      assert.equal(canvas.style.height, `${height}px`);
      assert.deepEqual(calls(canvas, 'setTransform').at(-1).args, [ratio, 0, 0, ratio, 0, 0]);
      assert.deepEqual(calls(canvas, 'clearRect').at(-1).args, [0, 0, width, height]);
    }

    const preview = game.elements.get('next');
    for (const type of 'IJLOSTZ') {
      preview.getContext('2d').calls.length = 0;
      game.run(`state.nextType = '${type}'; drawNext();`);
      const blocks = calls(preview, 'drawImage');
      assert.equal(blocks.length, 4);
      const xs = blocks.map(({ args }) => args[1] + 18);
      const ys = blocks.map(({ args }) => args[2] + 18);
      assert.equal((Math.min(...xs) + Math.max(...xs) + 24) / 2, 60);
      assert.equal((Math.min(...ys) + Math.max(...ys) + 24) / 2, 60);
      assert.deepEqual(calls(preview, 'clearRect').at(-1).args, [0, 0, 120, 120]);
    }

    game.run("Math.random = () => 0.5; spawnParticles(19)");
    assert.equal(game.run('state.particles.every((p) => p.x === 150 && p.y === 585)'), true);
    game.run("state.piece = createPiece('O'); draw()");
    const blocks = calls(game.elements.get('board'), 'drawImage').slice(-8);
    assert.deepEqual(blocks.map(({ alpha }) => alpha), [0.18, 0.18, 0.18, 0.18, 1, 1, 1, 1]);
    assert.equal(game.elements.get('board').getContext('2d').globalAlpha, 1);
  });
}

test('display scale changes rebuild sprites and redraw without resetting gameplay', () => {
  const game = loadGame();
  game.elements.get('start-btn').dispatch('click');
  game.frame(16);
  const previous = new Set(game.sprites);
  const boardBefore = game.run('JSON.stringify(state.board)');
  const pieceBefore = game.run('JSON.stringify(state.piece)');
  game.run('state.score = 123');
  game.window.devicePixelRatio = 2;
  game.window.dispatch('resize');

  assert.equal(game.elements.get('board').width, 600);
  assert.equal(game.elements.get('next').width, 240);
  assert.equal(game.run('JSON.stringify(state.board)'), boardBefore);
  assert.equal(game.run('JSON.stringify(state.piece)'), pieceBefore);
  assert.equal(game.run('state.score'), 123);
  assert.equal(game.frames.size, 1);
  for (const id of ['board', 'next']) {
    const { args } = calls(game.elements.get(id), 'drawImage').at(-1);
    assert.equal(previous.has(args[0]), false);
    assert.equal(args[3], args[0].width / 2);
    assert.equal(args[4], args[0].height / 2);
  }
  const count = game.sprites.length;
  game.window.dispatch('resize');
  assert.equal(game.sprites.length, count);

  game.window.devicePixelRatio = 1.25;
  assert.equal(game.frame(32), 1);
  assert.equal(game.elements.get('board').width, 375);
  assert.equal(game.elements.get('next').width, 150);
});
