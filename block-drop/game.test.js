'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = readFileSync(join(__dirname, 'game.js'), 'utf8');
const markup = readFileSync(join(__dirname, 'index.html'), 'utf8');

function loadGame() {
  const elements = new Map();
  const contexts = [];
  const listeners = new Map();
  const frames = [];
  const effects = { gradients: 0, parses: 0, shadows: 0 };
  const document = {
    activeElement: null,
    getElementById: (id) => elements.get(id),
    createElement(tag) {
      assert.equal(tag, 'canvas');
      return createElement();
    },
    addEventListener(type, callback) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(callback);
    },
  };

  function createElement(tag = '') {
    const attributes = new Map(
      [...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map((match) => [match[1], match[2]]),
    );
    const classes = new Set((attributes.get('class') || '').split(' '));
    const calls = [];
    const stack = [];
    const context = {
      calls,
      globalAlpha: 1,
      save() { stack.push(this.globalAlpha); },
      restore() { this.globalAlpha = stack.pop(); },
      createLinearGradient(...args) {
        effects.gradients++;
        calls.push({ name: 'createLinearGradient', args });
        return { addColorStop() {} };
      },
      set shadowBlur(value) {
        effects.shadows++;
        calls.push({ name: 'shadowBlur', args: [value] });
      },
    };
    for (const name of [
      'clearRect', 'beginPath', 'roundRect', 'fill', 'moveTo', 'lineTo',
      'stroke', 'fillRect', 'drawImage',
    ]) {
      context[name] = (...args) => calls.push({ name, args, alpha: context.globalAlpha });
    }
    contexts.push(context);
    let text = attributes.get('id') === 'level' ? '1' : '0';
    return {
      width: Number(attributes.get('width') || 300),
      height: Number(attributes.get('height') || 150),
      disabled: /\bdisabled\b/.test(tag),
      writes: 0,
      listeners: new Map(),
      get textContent() { return text; },
      set textContent(value) { text = String(value); this.writes++; },
      getAttribute: (name) => attributes.get(name),
      setAttribute: (name, value) => attributes.set(name, String(value)),
      classList: {
        add: (name) => classes.add(name),
        remove: (name) => classes.delete(name),
        contains: (name) => classes.has(name),
      },
      getContext: () => context,
      focus() { document.activeElement = this; },
      addEventListener(type, callback) { this.listeners.set(type, callback); },
    };
  }

  for (const match of markup.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)) {
    elements.set(match[1], createElement(match[0]));
  }
  const sandbox = vm.createContext({
    document,
    performance: { now: () => 1000 },
    requestAnimationFrame: (callback) => frames.push(callback),
    parseInt(...args) { effects.parses++; return parseInt(...args); },
  });
  vm.runInContext('Math.random = () => 0;', sandbox);
  vm.runInContext(source, sandbox, { filename: 'game.js' });
  return {
    document, elements, contexts, effects, listeners,
    evaluate: (code) => vm.runInContext(code, sandbox),
    click(id) {
      const element = elements.get(id);
      if (!element.disabled) element.listeners.get('click')();
    },
    key(code, target = elements.get('board'), modifiers = {}) {
      const event = {
        code, target, defaultPrevented: false, ...modifiers,
        preventDefault() { this.defaultPrevented = true; },
      };
      for (const callback of listeners.get('keydown') || []) callback(event);
      return event;
    },
  };
}

test('a full board creates effects only once per block color and size', () => {
  const game = loadGame();
  game.evaluate(`
    state.board = Array.from({ length: ROWS }, (_, y) =>
      Array.from({ length: COLS }, (_, x) => 'IJLOSTZ'[(x + y) % 7]));
    state.piece = createPiece('T');
    draw();
    for (const type of Object.keys(COLORS)) {
      state.nextType = type;
      drawNext();
    }
  `);
  assert.deepEqual(game.effects, { gradients: 14, parses: 14, shadows: 14 });
  const warmed = { ...game.effects };
  game.evaluate(`
    for (let frame = 0; frame < 60; frame++) {
      draw();
      drawNext();
    }
    startGame();
    draw();
  `);
  assert.deepEqual(game.effects, warmed);
  for (const id of ['board', 'next']) {
    const calls = game.elements.get(id).getContext('2d').calls;
    assert.ok(calls.some((call) => call.name === 'drawImage'));
    assert.ok(!calls.some((call) => ['createLinearGradient', 'shadowBlur', 'fill'].includes(call.name)));
  }
});

test('sprites preserve gradient, glow, ghost opacity, and destination alpha', () => {
  const game = loadGame();
  game.evaluate(`
    ctx.globalAlpha = 0.6;
    drawBlock(ctx, 60, 90, COLORS.I, BLOCK, 0.18);
    drawBlock(ctx, 90, 90, COLORS.I, BLOCK);
  `);
  const context = game.elements.get('board').getContext('2d');
  const images = context.calls.filter((call) => call.name === 'drawImage');
  assert.equal(images.length, 2);
  assert.equal(images[0].args[0], images[1].args[0]);
  assert.equal(images[0].alpha, 0.18);
  assert.equal(images[1].alpha, 1);
  assert.equal(context.globalAlpha, 0.6);
  const [sprite, x, y] = images[0].args;
  assert.equal(sprite.width, 62);
  assert.equal(sprite.height, 62);
  assert.equal(x, 44);
  assert.equal(y, 74);
  const calls = sprite.getContext('2d').calls;
  assert.deepEqual(calls.find((call) => call.name === 'createLinearGradient').args, [16, 16, 46, 46]);
  assert.deepEqual(calls.find((call) => call.name === 'shadowBlur').args, [12]);
  assert.deepEqual(calls.find((call) => call.name === 'roundRect').args, [17, 17, 28, 28, 5]);
});

test('controls, canvases, statistics, and overlay have accessible semantics', () => {
  const game = loadGame();
  for (const [id, name] of [
    ['start-btn', 'Start game'], ['pause-btn', 'Pause game'], ['restart-btn', 'Restart game'],
  ]) {
    assert.equal(game.elements.get(id).getAttribute('aria-label'), name);
  }
  const board = game.elements.get('board');
  assert.equal(board.getAttribute('role'), 'img');
  assert.equal(board.getAttribute('aria-label'), 'Block Drop game board');
  assert.equal(board.getAttribute('tabindex'), '0');
  assert.equal(board.getAttribute('aria-describedby'), 'controls-help');
  assert.equal(game.elements.get('next').getAttribute('role'), 'img');
  const overlay = game.elements.get('overlay');
  assert.equal(overlay.getAttribute('role'), 'dialog');
  assert.equal(overlay.getAttribute('aria-labelledby'), 'overlay-title');
  assert.equal(overlay.getAttribute('aria-describedby'), 'overlay-text');
  assert.notEqual(overlay.getAttribute('aria-modal'), 'true');
  assert.match(markup, /role="status"[^>]*aria-live="polite"[^>]*aria-atomic="true"/);
  assert.equal(game.elements.get('pause-btn').disabled, true);
  assert.equal(game.document.activeElement, game.elements.get('start-btn'));
});

test('start, pause, resume, game over, and restart update names and focus', () => {
  const game = loadGame();
  const start = game.elements.get('start-btn');
  const pause = game.elements.get('pause-btn');
  const board = game.elements.get('board');
  const overlay = game.elements.get('overlay');
  game.click('start-btn');
  assert.equal(game.document.activeElement, board);
  assert.equal(overlay.classList.contains('hidden'), true);
  assert.equal(pause.disabled, false);
  assert.equal(game.elements.get('next').getAttribute('aria-label'), 'Next piece: I');
  game.click('pause-btn');
  assert.equal(game.document.activeElement, start);
  assert.equal(start.getAttribute('aria-label'), 'Resume game');
  assert.equal(pause.getAttribute('aria-label'), 'Resume game');
  assert.equal(overlay.classList.contains('hidden'), false);
  game.click('start-btn');
  assert.equal(game.document.activeElement, board);
  assert.equal(pause.getAttribute('aria-label'), 'Pause game');
  game.evaluate('state.score = 42; endGame();');
  assert.equal(game.document.activeElement, start);
  assert.equal(start.getAttribute('aria-label'), 'Play again');
  assert.equal(game.elements.get('overlay-text').textContent, 'Final score: 42');
  assert.equal(pause.disabled, true);
  game.click('start-btn');
  assert.equal(game.document.activeElement, board);
  assert.equal(pause.disabled, false);
  assert.equal(game.elements.get('score').textContent, '0');
});

test('hard drops, line clears, and level changes update atomic live statistics', () => {
  const game = loadGame();
  game.click('start-btn');
  game.key('Space');
  assert.ok(game.evaluate('state.score') > 0);
  assert.equal(game.elements.get('score').textContent, game.evaluate('state.score.toLocaleString()'));
  game.evaluate(`
    state.board = createBoard();
    state.board[19].fill('I');
    state.lines = 9;
    state.score = 0;
    clearLines();
  `);
  assert.equal(game.elements.get('score').textContent, '100');
  assert.equal(game.elements.get('lines').textContent, '10');
  assert.equal(game.elements.get('level').textContent, '2');
  const writes = ['score', 'lines', 'level'].map((id) => game.elements.get(id).writes);
  game.evaluate('updateStats();');
  assert.deepEqual(['score', 'lines', 'level'].map((id) => game.elements.get(id).writes), writes);
});

test('keyboard controls preserve native activation, paused state, and shortcuts', () => {
  const game = loadGame();
  game.click('start-btn');
  const board = game.elements.get('board');
  const before = game.evaluate('JSON.stringify(state.piece)');
  for (const id of ['pause-btn', 'restart-btn', 'start-btn']) {
    assert.equal(game.key('Space', game.elements.get(id)).defaultPrevented, false);
    assert.equal(game.key('Enter', game.elements.get(id)).defaultPrevented, false);
  }
  for (const modifier of ['altKey', 'ctrlKey', 'metaKey']) {
    assert.equal(game.key('ArrowLeft', board, { [modifier]: true }).defaultPrevented, false);
  }
  assert.equal(game.evaluate('JSON.stringify(state.piece)'), before);
  assert.equal(game.key('KeyP').defaultPrevented, true);
  for (const code of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space']) game.key(code);
  assert.equal(game.evaluate('JSON.stringify(state.piece)'), before);
  assert.equal(game.key('KeyP', game.elements.get('start-btn')).defaultPrevented, true);
  assert.equal(game.evaluate('state.paused'), false);
  assert.equal(game.document.activeElement, board);
  game.key('ArrowLeft');
  assert.notEqual(game.evaluate('JSON.stringify(state.piece)'), before);
});

test('restarts do not duplicate keyboard actions or pause toggles', () => {
  const game = loadGame();
  for (let i = 0; i < 5; i++) game.click('restart-btn');
  assert.equal(game.listeners.get('keydown').size, 1);
  const x = game.evaluate('state.piece.x');
  game.key('ArrowLeft');
  assert.equal(game.evaluate('state.piece.x'), x - 1);
  game.key('KeyP');
  assert.equal(game.evaluate('state.paused'), true);
});
