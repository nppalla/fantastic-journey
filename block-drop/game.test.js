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

  function createElement(tagName = 'DIV') {
    const listeners = new Map();
    const classes = new Set();
    const attributes = new Map();
    return {
      tagName,
      style: {},
      classList: {
        add: (name) => classes.add(name),
        remove: (name) => classes.delete(name),
        contains: (name) => classes.has(name),
      },
      setAttribute: (name, value) => attributes.set(name, value),
      getAttribute: (name) => attributes.get(name),
      focus() { document.activeElement = this; },
      contains(element) {
        return element === this || element?.parentElement === this;
      },
      closest(selector) {
        return selector === 'button' && this.tagName === 'BUTTON' ? this : null;
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
    const canvas = Object.assign(createElement('CANVAS'), { width: 300, height: 150 });
    const context = createContext();
    canvas.getContext = () => context;
    return canvas;
  }

  const elements = new Map();
  for (const id of [
    'board', 'next', 'score', 'lines', 'level', 'overlay',
    'overlay-title', 'overlay-text', 'start-btn', 'pause-btn', 'restart-btn',
  ]) {
    elements.set(id, id === 'board' || id === 'next'
      ? createCanvas() : createElement(id.endsWith('-btn') ? 'BUTTON' : 'DIV'));
  }
  elements.get('start-btn').parentElement = elements.get('overlay');
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
    document,
    window,
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

for (const ratio of [1, 1.25, 2, 3]) {
  test(`DPR ${ratio} scales backing stores and sprites without changing game coordinates`, () => {
    const game = loadGame(ratio);
    for (const [id, width, height] of [['board', 300, 600], ['next', 120, 120]]) {
      const canvas = game.elements.get(id);
      assert.equal(canvas.width, Math.round(width * ratio));
      assert.equal(canvas.height, Math.round(height * ratio));
      assert.equal(canvas.style.width, `${width}px`);
      assert.equal(canvas.style.height, `${height}px`);
      assert.deepEqual(calls(canvas, 'setTransform').at(-1).args,
        [canvas.width / width, 0, 0, canvas.height / height, 0, 0]);
    }

    game.run("state.piece = createPiece('O'); state.nextType = 'I'; draw(); drawNext(); spawnParticles(19)");
    const board = game.elements.get('board');
    const preview = game.elements.get('next');
    const block = calls(board, 'drawImage').at(-1);
    const padding = Math.ceil(18 * ratio) / ratio;
    const extent = Math.ceil((30 + 2 * padding) * ratio);
    assert.equal(block.args[0].width, extent);
    assert.equal(block.args[0].height, extent);
    assert.deepEqual(block.args.slice(3), [extent / ratio, extent / ratio]);
    for (const { args } of calls(board, 'drawImage')) {
      assert.equal(Math.abs(args[1] * ratio - Math.round(args[1] * ratio)) < 1e-10, true);
      assert.equal(Math.abs(args[2] * ratio - Math.round(args[2] * ratio)) < 1e-10, true);
    }
    assert.equal(block.args[0].getContext('2d').shadowBlur, 12 * ratio);
    assert.deepEqual(calls(board, 'clearRect').at(-1).args, [0, 0, 300, 600]);
    assert.deepEqual(calls(preview, 'clearRect').at(-1).args, [0, 0, 120, 120]);
    const previewBlocks = calls(preview, 'drawImage');
    const xs = previewBlocks.map(({ args }) => args[1] + padding);
    assert.equal((Math.min(...xs) + Math.max(...xs) + 24) / 2, 60);
    assert.equal(game.run('state.particles.every((p) => p.x >= 0 && p.x < 300 && p.y === 585)'), true);
    const transforms = calls(board, 'setTransform').length;
    game.run('draw(); drawNext()');
    assert.equal(calls(board, 'setTransform').length, transforms);
  });
}

test('zoom or display changes resize both canvases and rebuild cached sprites at idle and in play', () => {
  const game = loadGame();
  game.run("state.nextType = 'T'; drawNext()");
  const oldPreviewSprite = calls(game.elements.get('next'), 'drawImage').at(-1).args[0];
  game.window.devicePixelRatio = 2;
  game.window.dispatch('resize');
  assert.equal(game.elements.get('board').width, 600);
  assert.equal(game.elements.get('next').width, 240);
  const previewSprite = calls(game.elements.get('next'), 'drawImage').at(-1).args[0];
  assert.notEqual(previewSprite, oldPreviewSprite);
  assert.equal(previewSprite.width, 120);
  game.elements.get('start-btn').dispatch('click');
  game.window.devicePixelRatio = 1.5;
  game.frame(16);
  assert.equal(game.elements.get('board').width, 450);
  assert.equal(game.elements.get('next').width, 180);
  assert.equal(calls(game.elements.get('next'), 'drawImage').at(-1).args[0].width, 90);
});

test('accessible control names, dialog focus, and preview label follow game state', () => {
  const game = loadGame();
  const start = game.elements.get('start-btn');
  const pause = game.elements.get('pause-btn');
  const board = game.elements.get('board');
  start.focus();
  start.dispatch('click');
  assert.equal(game.document.activeElement, board);
  assert.equal(pause.getAttribute('aria-label'), 'Pause game');
  assert.equal(pause.disabled, false);
  assert.equal(game.elements.get('next').getAttribute('aria-label'),
    `Next piece: ${game.run('state.nextType')}`);
  pause.dispatch('click');
  assert.equal(start.getAttribute('aria-label'), 'Resume game');
  assert.equal(pause.getAttribute('aria-label'), 'Resume game');
  assert.equal(game.document.activeElement, start);
  let prevented = false;
  game.document.dispatch('keydown', {
    code: 'Space', target: start, preventDefault() { prevented = true; },
  });
  assert.equal(prevented, false, 'Space must keep its native button activation');
  start.dispatch('click');
  assert.equal(game.document.activeElement, board);
  assert.equal(pause.getAttribute('aria-label'), 'Pause game');
  game.run('endGame()');
  assert.equal(start.getAttribute('aria-label'), 'Restart game');
  assert.equal(pause.disabled, true);
  assert.equal(game.document.activeElement, start);
});

test('all statistics are refreshed for announcements after line clears and hard drops', () => {
  const game = loadGame();
  game.elements.get('start-btn').dispatch('click');
  game.run(`
    state.lines = 9;
    state.board[19].fill('I');
    clearLines();
  `);
  assert.equal(game.elements.get('score').textContent, '100');
  assert.equal(game.elements.get('lines').textContent, 10);
  assert.equal(game.elements.get('level').textContent, 2);
  game.run("state.piece = createPiece('O'); hardDrop()");
  assert.equal(game.elements.get('score').textContent, game.run('state.score.toLocaleString()'));
  assert.equal(game.elements.get('score').textContent, '136');
});
