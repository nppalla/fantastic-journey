'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

const source = readFileSync(join(__dirname, 'game.js'), 'utf8');
const html = readFileSync(join(__dirname, 'index.html'), 'utf8');

function loadGame({ devicePixelRatio = 1 } = {}) {
  const metrics = { gradients: 0, shadowFills: 0, hexParses: 0 };
  const sprites = [];
  const frames = new Map();
  const queries = [];
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
    return {
      style: {},
      textContent: '',
      disabled: false,
      setAttribute: (name, value) => attributes.set(name, value),
      getAttribute: (name) => attributes.get(name),
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
      removeEventListener(name, callback) {
        listeners.get(name)?.delete(callback);
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
  const window = Object.assign(createElement(), {
    devicePixelRatio,
    matchMedia(media) {
      const query = Object.assign(createElement(), { media });
      queries.push(query);
      return query;
    },
  });
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
    elements, document, window, queries, frames, metrics, sprites, run,
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
    target: game.elements.get('board'),
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

test('particle updates retain only live particles and preserve their motion', () => {
  const game = loadGame();
  game.run(`
    spawnParticles(19);
    state.particles[0].life = 0.1;
    state.particles[1].life = 0;
    state.particles[2].life = -1;
    state.particles[3].x = 20;
    state.particles[3].y = 30;
    state.particles[3].vx = 0.1;
    state.particles[3].vy = -0.2;
    updateParticles(140);
  `);
  assert.equal(game.run('state.particles.length'), 37);
  assert.equal(game.run('state.particles.every((particle) => particle.life > 0)'), true);
  assert.equal(game.run('state.particles[0].x'), 34);
  assert.equal(game.run('state.particles[0].y'), 2);
  assert.equal(game.run('state.particles[0].life'), 0.8);
  game.run('updateParticles(700)');
  assert.equal(game.run('state.particles.length'), 0);
});

test('many line clears and new games cannot accumulate expired particles', () => {
  const game = loadGame();
  game.run('startGame()');
  for (let i = 0; i < 100; i++) {
    game.run("state.board[ROWS - 1].fill('I'); clearLines()");
    assert.equal(game.run('state.particles.length'), 40);
    game.run('updateParticles(700)');
    assert.equal(game.run('state.particles.length'), 0);
  }
  game.run('spawnParticles(19); endGame(); startGame()');
  assert.equal(game.run('state.particles.length'), 0);
  game.run('spawnParticles(19)');
  game.elements.get('restart-btn').dispatch('click');
  assert.equal(game.run('state.particles.length'), 0);
});

for (const ratio of [1, 1.25, 2, 3]) {
  test(`DPR ${ratio} scales backing stores and sprites without changing logical coordinates`, () => {
    const game = loadGame({ devicePixelRatio: ratio });
    const board = game.elements.get('board');
    const preview = game.elements.get('next');
    assert.deepEqual([board.width, board.height], [300 * ratio, 600 * ratio]);
    assert.deepEqual([preview.width, preview.height], [120 * ratio, 120 * ratio]);
    assert.deepEqual(board.style, { width: '300px', height: '600px' });
    assert.deepEqual(preview.style, { width: '120px', height: '120px' });
    for (const canvas of [board, preview]) {
      assert.deepEqual(calls(canvas, 'setTransform').at(-1).args, [ratio, 0, 0, ratio, 0, 0]);
    }

    game.run(`
      state.nextType = 'I';
      drawNext();
      drawBlock(ctx, 30, 60, COLORS.I, BLOCK);
      spawnParticles(19);
      draw();
    `);
    const padding = Math.ceil(18 * ratio);
    const phaseX = 30 * ratio % 1;
    const phaseY = 60 * ratio % 1;
    const sprite = game.sprites.find((item) => item.width === Math.ceil(30 * ratio + phaseX) + padding * 2);
    assert.ok(sprite);
    assert.deepEqual(calls(sprite, 'setTransform')[0].args,
      [ratio, 0, 0, ratio, padding - 18 * ratio + phaseX, padding - 18 * ratio + phaseY]);
    assert.equal(sprite.getContext('2d').shadowBlur, 12 * ratio);
    assert.deepEqual(calls(board, 'drawImage').at(-1).args,
      [sprite, (Math.floor(30 * ratio) - padding) / ratio, (Math.floor(60 * ratio) - padding) / ratio,
        sprite.width / ratio, sprite.height / ratio]);
    assert.deepEqual(calls(board, 'clearRect').at(-1).args, [0, 0, 300, 600]);
    assert.deepEqual(calls(preview, 'clearRect').at(-1).args, [0, 0, 120, 120]);
    const blocks = calls(preview, 'drawImage');
    const xs = blocks.map(({ args }) =>
      args[1] + 18 + calls(args[0], 'setTransform')[0].args[4] / ratio);
    assert.equal((Math.min(...xs) + Math.max(...xs) + 24) / 2, 60);
    assert.equal(game.run('state.particles.every((p) => p.x >= 0 && p.x < 300 && p.y === 585)'), true);
    assert.equal(board.getContext('2d').lineWidth, 1 / ratio);
    const gridX = calls(board, 'moveTo')[0].args[0] * ratio;
    assert.equal(gridX % 1, 0.5);
  });
}

test('display-scale changes rebuild artwork without resetting gameplay or scheduling frames', () => {
  const game = loadGame();
  game.run(`
    startGame();
    state.score = 123;
    state.piece.y = 5;
    spawnParticles(19);
    const originalBoard = state.board;
    const originalPiece = state.piece;
    draw();
  `);
  const oldSprites = game.run('[...blockSprites.values()]');
  const frame = game.frames.keys().next().value;
  for (const [ratio, event] of [[2, 'change'], [1.25, 'resize'], [1, 'change']]) {
    game.window.devicePixelRatio = ratio;
    if (event === 'change') game.queries.at(-1).dispatch('change');
    else game.window.dispatch('resize');
    assert.equal(game.elements.get('board').width, 300 * ratio);
    assert.equal(game.elements.get('next').width, 120 * ratio);
    assert.equal(game.run('state.board === originalBoard && state.piece === originalPiece'), true);
    assert.equal(game.run('state.score'), 123);
    assert.equal(game.run('state.piece.y'), 5);
    assert.equal(game.run('state.particles.length'), 40);
    assert.equal(game.run('[...blockSprites.values()]').some((sprite) => oldSprites.includes(sprite)), false);
    assert.equal(game.frames.size, 1);
    assert.equal(game.frames.keys().next().value, frame);
    const count = game.queries.length;
    game.window.dispatch('resize');
    assert.equal(game.queries.length, count);
  }
});

test('markup labels controls, canvases, the live stats, and the non-modal dialog', () => {
  for (const [id, label] of [
    ['start-btn', 'Start game'], ['pause-btn', 'Pause game'], ['restart-btn', 'Restart game'],
  ]) {
    assert.match(html, new RegExp(`<button[^>]*id="${id}"[^>]*aria-label="${label}"`));
  }
  assert.match(html, /<canvas[^>]*id="board"[^>]*role="img"[^>]*aria-label="Block Drop game board"/);
  assert.match(html, /<canvas[^>]*id="board"[^>]*tabindex="0"/);
  assert.match(html, /<canvas[^>]*id="next"[^>]*role="img"[^>]*aria-label="Next piece preview"/);
  assert.match(html, /role="status"[^>]*aria-live="polite"[^>]*aria-atomic="true"/);
  assert.match(html, /id="overlay"[^>]*role="dialog"[^>]*aria-labelledby="overlay-title"[^>]*aria-describedby="overlay-text"/);
  assert.doesNotMatch(html, /aria-modal="true"/);
});

test('accessible action names and focus track start, pause, resume, game over, and restart', () => {
  const game = loadGame();
  const board = game.elements.get('board');
  const start = game.elements.get('start-btn');
  const pause = game.elements.get('pause-btn');
  const overlay = game.elements.get('overlay');
  assert.equal(game.document.activeElement, start);
  start.dispatch('click');
  assert.equal(game.document.activeElement, board);
  assert.equal(overlay.classList.contains('hidden'), true);
  assert.equal(pause.getAttribute('aria-label'), 'Pause game');
  assert.equal(pause.disabled, false);
  pause.dispatch('click');
  assert.equal(start.getAttribute('aria-label'), 'Resume game');
  assert.equal(pause.getAttribute('aria-label'), 'Resume game');
  assert.equal(game.document.activeElement, start);
  assert.equal(overlay.classList.contains('hidden'), false);
  start.dispatch('click');
  assert.equal(game.document.activeElement, board);
  assert.equal(pause.getAttribute('aria-label'), 'Pause game');
  game.run('endGame()');
  assert.equal(start.getAttribute('aria-label'), 'Play again');
  assert.equal(pause.disabled, true);
  assert.equal(game.document.activeElement, start);
  start.dispatch('click');
  assert.equal(game.document.activeElement, board);
  assert.equal(pause.disabled, false);
  assert.equal(pause.getAttribute('aria-label'), 'Pause game');
  game.run('state.nextType = "T"; drawNext()');
  assert.equal(game.elements.get('next').getAttribute('aria-label'), 'Next piece: T');
});

test('stats include hard-drop points without a line clear and announce level changes and resets', () => {
  const game = loadGame();
  game.run('startGame(); state.piece = createPiece("O"); hardDrop()');
  assert.equal(game.elements.get('score').textContent, '36');
  assert.equal(game.elements.get('lines').textContent, '0');
  assert.equal(game.elements.get('level').textContent, '1');
  game.run(`
    state.lines = 9;
    state.board[ROWS - 1].fill('I');
    clearLines();
  `);
  assert.equal(game.elements.get('score').textContent, '136');
  assert.equal(game.elements.get('lines').textContent, '10');
  assert.equal(game.elements.get('level').textContent, '2');
  game.run('startGame()');
  assert.equal(game.elements.get('score').textContent, '0');
  assert.equal(game.elements.get('lines').textContent, '0');
  assert.equal(game.elements.get('level').textContent, '1');
});

test('keyboard shortcuts preserve native button activation, browser shortcuts, and paused state', () => {
  const game = loadGame();
  game.run('startGame(); state.piece = createPiece("O")');
  const board = game.elements.get('board');
  const start = game.elements.get('start-btn');
  const originalY = game.run('state.piece.y');
  for (const event of [
    { code: 'Space', target: game.elements.get('pause-btn') },
    { code: 'Enter', target: start },
    { code: 'ArrowDown', target: board, ctrlKey: true },
    { code: 'ArrowDown', target: board, altKey: true },
    { code: 'ArrowDown', target: board, metaKey: true },
  ]) {
    game.document.dispatch('keydown', {
      ...event,
      preventDefault() { assert.fail('Native keyboard behavior must not be prevented'); },
    });
    assert.equal(game.run('state.piece.y'), originalY);
  }
  game.run('togglePause()');
  for (const code of ['Space', 'ArrowDown', 'ArrowLeft', 'ArrowUp']) {
    game.document.dispatch('keydown', {
      code, target: start,
      preventDefault() { assert.fail('Paused gameplay must not consume input'); },
    });
    assert.equal(game.run('state.piece.y'), originalY);
  }
  let prevented = false;
  game.document.dispatch('keydown', {
    code: 'KeyP', target: start,
    preventDefault() { prevented = true; },
  });
  assert.equal(prevented, true);
  assert.equal(game.run('state.paused'), false);
  assert.equal(game.document.activeElement, board);
});
