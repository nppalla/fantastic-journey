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

  return {
    elements, document, frames, metrics, sprites, run,
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

for (const { name, type, shape, x, y, obstacle = '' } of [
  { name: 'left wall', type: 'I', shape: 'rotateMatrix(SHAPES.I)', x: -2, y: 5 },
  { name: 'right wall', type: 'I', shape: 'rotateMatrix(SHAPES.I)', x: 7, y: 5 },
  { name: 'floor', type: 'I', shape: 'SHAPES.I', x: 3, y: 18 },
  { name: 'locked blocks', type: 'T', shape: 'SHAPES.T', x: 3, y: 5, obstacle: "state.board[7][4] = 'J';" },
]) {
  test(`rotation into the ${name} preserves the piece and board`, () => {
    const game = loadGame();
    game.run(`
      state.piece = { type: '${type}', shape: ${shape}, x: ${x}, y: ${y} };
      ${obstacle}
      const originalShape = state.piece.shape;
    `);
    assert.equal(game.run('collides(state.piece.shape, state.piece.x, state.piece.y)'), false);
    assert.equal(game.run('collides(rotateMatrix(state.piece.shape), state.piece.x, state.piece.y)'), true);
    const before = game.run('JSON.stringify({ piece: state.piece, board: state.board })');

    game.run('rotate()');

    assert.equal(game.run('state.piece.shape === originalShape'), true);
    assert.equal(game.run('JSON.stringify({ piece: state.piece, board: state.board })'), before);
    assert.equal(game.run('collides(state.piece.shape, state.piece.x, state.piece.y)'), false);
  });
}

for (const type of 'IJLOSTZ') {
  test(`${type} rotates clockwise through four legal orientations without moving`, () => {
    const game = loadGame();
    game.run(`state.piece = createPiece('${type}'); state.piece.y = 5;`);
    const original = game.run('JSON.stringify(state.piece)');
    for (let i = 0; i < 4; i++) {
      const expected = game.run('JSON.stringify(rotateMatrix(state.piece.shape))');
      const position = game.run('JSON.stringify([state.piece.x, state.piece.y])');

      game.run('rotate()');

      assert.equal(game.run('JSON.stringify(state.piece.shape)'), expected);
      assert.equal(game.run('JSON.stringify([state.piece.x, state.piece.y])'), position);
      assert.equal(game.run('collides(state.piece.shape, state.piece.x, state.piece.y)'), false);
    }
    assert.equal(game.run('JSON.stringify(state.piece)'), original);
  });
}

test('a spawning I piece can rotate with filled cells above the board', () => {
  const game = loadGame();
  game.run("state.piece = createPiece('I')");
  const expected = game.run('JSON.stringify(rotateMatrix(state.piece.shape))');

  game.run('rotate()');

  assert.equal(game.run('JSON.stringify(state.piece.shape)'), expected);
  assert.equal(game.run('state.piece.y'), -1);
  assert.equal(game.run('state.piece.shape[0].some(Boolean)'), true);
  assert.equal(game.run('collides(state.piece.shape, state.piece.x, state.piece.y)'), false);
});

test('empty matrix cells do not prevent rotation beside walls and locked blocks', () => {
  const game = loadGame();
  game.run(`
    state.piece = createPiece('I');
    state.piece.y = 5;
    state.board[5][0] = 'J';
  `);
  for (const x of [0, 6]) {
    game.run(`state.piece.shape = SHAPES.I; state.piece.x = ${x};`);
    const expected = game.run('JSON.stringify(rotateMatrix(state.piece.shape))');

    game.run('rotate()');

    assert.equal(game.run('JSON.stringify(state.piece.shape)'), expected);
    assert.equal(game.run('state.piece.x'), x);
    assert.equal(game.run('state.board[5][0]'), 'J');
    assert.equal(game.run('collides(state.piece.shape, state.piece.x, state.piece.y)'), false);
  }
});

test('blocked keyboard rotation followed by hard drop locks inside the board', () => {
  const game = loadGame();
  game.elements.get('start-btn').dispatch('click');
  game.run(`
    state.piece = createPiece('I');
    state.piece.shape = rotateMatrix(state.piece.shape);
    state.piece.x = 7;
    state.piece.y = 5;
  `);
  const original = game.run('JSON.stringify(state.piece)');
  let prevented = 0;
  for (const code of ['ArrowUp', 'Space']) {
    game.document.dispatch('keydown', {
      code,
      preventDefault() { prevented++; },
    });
    if (code === 'ArrowUp') assert.equal(game.run('JSON.stringify(state.piece)'), original);
  }

  assert.equal(prevented, 2);
  assert.equal(game.run('state.over'), false);
  assert.equal(game.run('state.board.every((row) => row.length === COLS)'), true);
  assert.equal(game.run('state.board.flat().filter(Boolean).length'), 4);
  assert.equal(game.run("state.board.slice(16).every((row) => row[9] === 'I')"), true);
});

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
  assert.deepEqual(calls(game.elements.get('board'), 'drawImage').at(-1).args, [sprite, 12, 42]);
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
