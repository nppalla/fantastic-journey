'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

const source = readFileSync(join(__dirname, 'game.js'), 'utf8');

function loadGame() {
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
      'stroke', 'fillRect', 'drawImage',
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
    return {
      classList: {
        add: (name) => classes.add(name),
        remove: (name) => classes.delete(name),
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
    const canvas = Object.assign(createElement(), { width: 300, height: 150 });
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
  const sandbox = vm.createContext({
    document,
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
  const boardLayer = sprites.shift();

  return {
    elements, document, frames, metrics, sprites, boardLayer, run,
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
  const initialGridStrokes = calls(game.boardLayer, 'stroke').length;
  game.run(`
    state.board = createBoard().map((row, y) => row.map((_, x) => 'IJLOSTZ'[(x + y) % 7]));
    boardDirty = true;
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
  assert.equal(calls(game.boardLayer, 'drawImage').length, 200);
  assert.equal(calls(game.boardLayer, 'stroke').length, initialGridStrokes + 28);
  game.run('for (let i = 0; i < 100; i++) { draw(); drawNext(); }');
  assert.equal(calls(board, 'drawImage').length - before, 100 * 9);
  assert.equal(calls(game.boardLayer, 'drawImage').length, 200);
  assert.equal(calls(game.boardLayer, 'stroke').length, initialGridStrokes + 28);
  assert.equal(calls(board, 'stroke').length, 0);
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
  assert.deepEqual(calls(game.elements.get('board'), 'drawImage').at(-1).args, [sprite, 12, 42]);
});

test('active and ghost pieces share sprites without leaking drawing opacity', () => {
  const game = loadGame();
  game.run("state.piece = createPiece('O'); draw()");
  const board = game.elements.get('board');
  const blocks = calls(board, 'drawImage').filter(({ args }) => args[0] !== game.boardLayer);
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

test('moving pieces, particles, pause, and game over reuse the settled layer', () => {
  const game = loadGame();
  game.run(`
    startGame();
    state.board[19][0] = 'I';
    state.piece = createPiece('T');
    state.piece.y = 1;
    state.particles = [{ x: 10, y: 20, vx: 0.1, vy: 0, life: 1, color: COLORS.I }];
    draw();
  `);
  const layer = game.boardLayer;
  const rebuilds = calls(layer, 'clearRect').length;
  const board = game.elements.get('board');
  const before = calls(board, 'drawImage').length;
  const surfaces = game.sprites.length;
  game.run('move(1); rotate(); softDrop(); clearLines(); updateParticles(16); draw()');
  const blocks = calls(board, 'drawImage').slice(before);
  assert.equal(blocks.length, 9);
  assert.equal(blocks[0].args[0], layer);
  assert.deepEqual(blocks.slice(1).map(({ alpha }) => alpha), [0.18, 0.18, 0.18, 0.18, 1, 1, 1, 1]);
  assert.equal(blocks[5].args[1], game.run('(state.piece.x + 1) * BLOCK - SPRITE_PADDING'));
  assert.equal(blocks[5].args[2], game.run('state.piece.y * BLOCK - SPRITE_PADDING'));
  assert.equal(calls(board, 'fillRect').at(-1).alpha, game.run('state.particles[0].life'));
  assert.equal(board.getContext('2d').globalAlpha, 1);
  game.run('togglePause(); draw(); togglePause(); draw(); endGame(); draw()');
  assert.equal(calls(board, 'drawImage').at(-1).args[0], layer);
  assert.equal(calls(layer, 'clearRect').length, rebuilds);
  assert.equal(calls(layer, 'drawImage').length, 1);
  assert.equal(game.sprites.length, surfaces);
});

test('locking a piece rebuilds settled artwork once before reusing it', () => {
  const game = loadGame();
  game.run("startGame(); state.piece = createPiece('O'); state.piece.y = 18; draw()");
  const rebuilds = calls(game.boardLayer, 'clearRect').length;
  game.run('lockPiece(); draw(); draw()');
  assert.equal(calls(game.boardLayer, 'clearRect').length, rebuilds + 1);
  assert.equal(calls(game.boardLayer, 'drawImage').length, 4);
  assert.equal(game.run('state.board[19][4]'), 'O');
  assert.equal(game.run('boardDirty'), false);
});

test('clearing a line rebuilds the layer without retaining cleared cells', () => {
  const game = loadGame();
  game.run(`
    state.board[19].fill('I');
    state.board[18][0] = 'T';
    boardDirty = true;
    draw();
  `);
  const layer = game.boardLayer;
  const rebuilds = calls(layer, 'clearRect').length;
  const images = calls(layer, 'drawImage').length;
  assert.equal(images, 11);
  game.run('clearLines(); draw(); draw()');
  assert.equal(calls(layer, 'clearRect').length, rebuilds + 1);
  assert.equal(calls(layer, 'drawImage').length, images + 1);
  assert.deepEqual(calls(layer, 'drawImage').at(-1).args.slice(1), [-18, 552]);
  assert.equal(game.run('state.board[19][0]'), 'T');
  assert.equal(game.run('state.lines'), 1);
});

test('locking a line-clearing piece invalidates the combined layer just once', () => {
  const game = loadGame();
  game.run(`
    startGame();
    state.board[19].fill('I');
    state.board[19][4] = state.board[19][5] = null;
    state.piece = createPiece('O');
    state.piece.y = 18;
    draw();
  `);
  const rebuilds = calls(game.boardLayer, 'clearRect').length;
  const images = calls(game.boardLayer, 'drawImage').length;
  game.run('hardDrop(); draw(); draw()');
  assert.equal(calls(game.boardLayer, 'clearRect').length, rebuilds + 1);
  assert.equal(calls(game.boardLayer, 'drawImage').length, images + 2);
  assert.equal(game.run('state.lines'), 1);
});

test('restarting clears settled artwork while retaining one board-sized layer', () => {
  const game = loadGame();
  game.run("startGame(); state.board[19][0] = 'I'; draw()");
  const layer = game.boardLayer;
  assert.equal(layer.width, 300);
  assert.equal(layer.height, 600);
  const images = calls(layer, 'drawImage').length;
  const rebuilds = calls(layer, 'clearRect').length;
  game.run('startGame(); draw(); draw()');
  assert.equal(calls(layer, 'clearRect').length, rebuilds + 1);
  assert.equal(calls(layer, 'drawImage').length, images);
  assert.deepEqual(calls(layer, 'clearRect').at(-1).args, [0, 0, 300, 600]);
  assert.equal(game.frames.size, 1);
});

test('top-out still refreshes cells written during the final piece lock', () => {
  const game = loadGame();
  game.run("startGame(); state.piece = createPiece('O'); state.piece.y = -1; draw()");
  const rebuilds = calls(game.boardLayer, 'clearRect').length;
  game.run('lockPiece(); draw(); draw()');
  assert.equal(game.run('state.over'), true);
  assert.equal(calls(game.boardLayer, 'clearRect').length, rebuilds + 1);
  assert.equal(calls(game.boardLayer, 'drawImage').length, 2);
});
