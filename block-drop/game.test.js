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

for (const { name, setup } of [
  {
    name: 'left wall',
    setup: "state.piece = { type: 'I', shape: rotateMatrix(SHAPES.I), x: -2, y: 4 }",
  },
  {
    name: 'right wall',
    setup: "state.piece = { type: 'I', shape: rotateMatrix(SHAPES.I), x: COLS - 3, y: 4 }",
  },
  {
    name: 'floor',
    setup: "state.piece = { ...createPiece('I'), y: ROWS - 2 }",
  },
  {
    name: 'locked block',
    setup: "state.piece = { ...createPiece('T'), y: 4 }; state.board[6][4] = 'J'",
  },
]) {
  test(`rotation into the ${name} is rejected and the piece still locks safely`, () => {
    const game = loadGame();
    game.elements.get('start-btn').dispatch('click');
    game.run(setup);
    game.run('const originalPiece = state.piece; const originalShape = state.piece.shape');
    assert.equal(game.run('collides(state.piece.shape, state.piece.x, state.piece.y)'), false);
    assert.equal(game.run('collides(rotateMatrix(state.piece.shape), state.piece.x, state.piece.y)'), true);
    const before = game.run('JSON.stringify({ piece: state.piece, board: state.board })');
    const lockedBlocks = game.run('state.board.flat().filter(Boolean).length');
    let prevented = 0;
    game.document.dispatch('keydown', {
      code: 'ArrowUp',
      preventDefault() { prevented++; },
    });
    assert.equal(prevented, 1);
    assert.equal(game.run('state.piece === originalPiece && state.piece.shape === originalShape'), true);
    assert.equal(game.run('JSON.stringify({ piece: state.piece, board: state.board })'), before);

    game.run('hardDrop()');
    assert.equal(game.run('state.over'), false);
    assert.equal(game.run('state.board.length === ROWS && state.board.every((row) => row.length === COLS)'), true);
    assert.equal(game.run('state.board.every((row) => Object.keys(row).length === COLS)'), true);
    assert.equal(game.run('state.board.flat().filter(Boolean).length'), lockedBlocks + 4);
  });
}

test('all piece types rotate clockwise in open space without moving or changing the board', () => {
  const game = loadGame();
  for (const type of 'IJLOSTZ') {
    game.run(`state.piece = { ...createPiece('${type}'), y: 4 }`);
    const board = game.run('JSON.stringify(state.board)');
    const position = game.run('JSON.stringify([state.piece.x, state.piece.y])');
    const original = JSON.parse(game.run('JSON.stringify(state.piece.shape)'));
    let expected = original;
    for (let turn = 0; turn < 4; turn++) {
      expected = expected.map((row, y) => row.map((_, x) => expected[expected.length - 1 - x][y]));
      game.run('rotate()');
      assert.deepEqual(JSON.parse(game.run('JSON.stringify(state.piece.shape)')), expected);
      assert.equal(game.run('JSON.stringify([state.piece.x, state.piece.y])'), position);
      assert.equal(game.run('JSON.stringify(state.board)'), board);
      assert.equal(game.run('collides(state.piece.shape, state.piece.x, state.piece.y)'), false);
    }
    assert.deepEqual(expected, original);
  }
});

test('an I piece can rotate at spawn with occupied cells above the board', () => {
  const game = loadGame();
  game.run("state.piece = createPiece('I'); rotate()");
  assert.deepEqual(JSON.parse(game.run('JSON.stringify(state.piece.shape)')), [
    [0, 0, 1, 0],
    [0, 0, 1, 0],
    [0, 0, 1, 0],
    [0, 0, 1, 0],
  ]);
  assert.equal(game.run('state.piece.y'), -1);
  assert.equal(game.run('collides(state.piece.shape, state.piece.x, state.piece.y)'), false);
});

for (const { name, rows } of [
  { name: 'no full rows', rows: [] },
  { name: 'a single bottom row', rows: [19] },
  { name: 'two adjacent bottom rows', rows: [18, 19] },
  { name: 'three adjacent bottom rows', rows: [17, 18, 19] },
  { name: 'four adjacent bottom rows', rows: [16, 17, 18, 19] },
  { name: 'adjacent middle rows', rows: [8, 9] },
  { name: 'adjacent top rows', rows: [0, 1] },
  { name: 'separated full rows', rows: [3, 8, 14, 19] },
  { name: 'two separated pairs of adjacent rows', rows: [0, 1, 7, 8] },
]) {
  test(`clearing ${name} preserves survivors and awards the simultaneous-clear score`, () => {
    const game = loadGame();
    game.run(`
      state.board = createBoard().map((row, y) => row.map((_, x) =>
        x === y % COLS ? 'IJLOSTZ'[y % 7] : null));
      for (const y of ${JSON.stringify(rows)}) state.board[y].fill('I');
      state.score = 25;
      state.lines = 20;
      state.level = 3;
      updateStats();
    `);
    const originalRows = Array.from(game.run('state.board'));
    game.run('clearLines()');
    const board = Array.from(game.run('state.board'));
    const score = 25 + [0, 100, 300, 500, 800][rows.length] * 3;

    assert.equal(board.length, 20);
    assert.equal(board.every((row) => row.length === 10), true);
    assert.equal(game.run('new Set(state.board).size'), 20);
    assert.equal(board.slice(0, rows.length).every((row) => row.every((cell) => cell === null)), true);
    assert.deepEqual(board.slice(rows.length), originalRows.filter((_, y) => !rows.includes(y)));
    assert.equal(board.some((row) => row.every(Boolean)), false);
    assert.equal(game.run('state.score'), score);
    assert.equal(game.run('state.lines'), 20 + rows.length);
    assert.equal(game.run('state.level'), 3);
    assert.equal(game.run('state.particles.length'), rows.length * 40);
    assert.equal(game.elements.get('score').textContent, score.toLocaleString());
    assert.equal(game.elements.get('lines').textContent, 20 + rows.length);
    assert.equal(game.elements.get('level').textContent, 3);
  });
}

test('a multi-line clear uses the current level before advancing past ten lines', () => {
  const game = loadGame();
  game.run(`
    state.board[18].fill('I');
    state.board[19].fill('I');
    state.lines = 9;
    clearLines();
  `);
  assert.equal(game.run('state.score'), 300);
  assert.equal(game.run('state.lines'), 11);
  assert.equal(game.run('state.level'), 2);
  assert.equal(game.elements.get('score').textContent, '300');
  assert.equal(game.elements.get('lines').textContent, 11);
  assert.equal(game.elements.get('level').textContent, 2);
});

test('a keyboard hard drop fills a shared gap and clears both bottom rows before spawning', () => {
  const game = loadGame();
  game.elements.get('start-btn').dispatch('click');
  game.run(`
    state.board[18].fill('J');
    state.board[19].fill('L');
    state.board[18][4] = state.board[19][4] = null;
    state.piece = { ...createPiece('I'), shape: rotateMatrix(SHAPES.I), x: 2, y: 0 };
    state.nextType = 'O';
  `);
  let prevented = 0;
  game.document.dispatch('keydown', {
    code: 'Space',
    preventDefault() { prevented++; },
  });
  assert.equal(prevented, 1);
  assert.equal(game.run('state.lines'), 2);
  assert.equal(game.run('state.score'), 300 + 16 * 2);
  assert.equal(game.run('state.board.flat().filter(Boolean).length'), 2);
  assert.equal(game.run('state.board[18][4] === "I" && state.board[19][4] === "I"'), true);
  assert.equal(game.run('state.board.some((row) => row.every(Boolean))'), false);
  assert.equal(game.run('state.piece.type'), 'O');
  assert.equal(game.run('state.over'), false);
  assert.equal(game.elements.get('score').textContent, '332');
  assert.equal(game.elements.get('lines').textContent, 2);
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
