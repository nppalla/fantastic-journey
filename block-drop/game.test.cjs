'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = readFileSync(join(__dirname, 'game.js'), 'utf8');
const markup = readFileSync(join(__dirname, 'index.html'), 'utf8');

function createGame(pixelRatio = 1) {
  const elements = new Map();
  const contexts = new Map();
  const windowListeners = new Map();
  const documentListeners = new Map();
  const queries = [];
  const frames = [];
  const document = {
    activeElement: null,
    getElementById: (id) => elements.get(id),
    addEventListener(name, listener) {
      if (!documentListeners.has(name)) documentListeners.set(name, new Set());
      documentListeners.get(name).add(listener);
    },
  };

  for (const id of [
    'board', 'next', 'score', 'lines', 'level', 'overlay', 'overlay-title',
    'overlay-text', 'start-btn', 'pause-btn', 'restart-btn', 'controls-help',
  ]) {
    const tag = markup.match(new RegExp(`<[^>]+\\bid="${id}"[^>]*>`))[0];
    const attributes = new Map(
      [...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map((match) => [match[1], match[2]]),
    );
    const classes = new Set((attributes.get('class') || '').split(' '));
    const calls = [];
    const context = {
      createLinearGradient() { return { addColorStop() {} }; },
    };
    for (const name of [
      'setTransform', 'clearRect', 'save', 'restore', 'beginPath',
      'roundRect', 'fill', 'moveTo', 'lineTo', 'stroke', 'fillRect',
    ]) {
      context[name] = (...args) => calls.push({ name, args });
    }
    contexts.set(id, calls);
    let text = id === 'level' ? '1' : ['score', 'lines'].includes(id) ? '0' : '';
    elements.set(id, {
      width: Number(attributes.get('width') || 300),
      height: Number(attributes.get('height') || 150),
      style: {},
      disabled: /\bdisabled\b/.test(tag),
      textWrites: 0,
      listeners: new Map(),
      get textContent() { return text; },
      set textContent(value) { text = String(value); this.textWrites++; },
      setAttribute: (name, value) => attributes.set(name, value),
      getAttribute: (name) => attributes.get(name),
      classList: {
        add: (name) => classes.add(name),
        remove: (name) => classes.delete(name),
        contains: (name) => classes.has(name),
      },
      focus() { document.activeElement = this; },
      getContext: () => context,
      addEventListener(name, listener) { this.listeners.set(name, listener); },
    });
  }

  const window = {
    devicePixelRatio: pixelRatio,
    addEventListener: (name, listener) => windowListeners.set(name, listener),
    matchMedia(media) {
      const listeners = new Set();
      const query = {
        media,
        listeners,
        addEventListener: (name, listener) => {
          assert.equal(name, 'change');
          listeners.add(listener);
        },
        removeEventListener: (name, listener) => {
          assert.equal(name, 'change');
          listeners.delete(listener);
        },
      };
      queries.push(query);
      return query;
    },
  };
  const context = vm.createContext({
    window,
    document,
    performance: { now: () => 1000 },
    requestAnimationFrame: (callback) => frames.push(callback),
  });
  vm.runInContext('Math.random = () => 0.5;', context);
  vm.runInContext(source, context, { filename: 'game.js' });

  return {
    elements,
    document,
    documentListeners,
    queries,
    frames,
    calls: (id, name) => contexts.get(id).filter((call) => call.name === name).map((call) => call.args),
    evaluate: (expression) => vm.runInContext(expression, context),
    click(id) {
      const element = elements.get(id);
      if (!element.disabled) element.listeners.get('click')();
    },
    key(code, target = elements.get('board'), modifiers = {}) {
      const event = {
        code, target, defaultPrevented: false, ...modifiers,
        preventDefault() { this.defaultPrevented = true; },
      };
      for (const listener of documentListeners.get('keydown')) listener(event);
      return event;
    },
    resize(ratio) {
      window.devicePixelRatio = ratio;
      windowListeners.get('resize')();
    },
    changeDensity(ratio) {
      window.devicePixelRatio = ratio;
      for (const listener of [...queries.at(-1).listeners]) listener();
    },
  };
}

for (const ratio of [0, 1, 1.25, 4 / 3, 2, 3]) {
  test(`canvases use physical pixels and logical coordinates at DPR ${ratio || 'fallback'}`, () => {
    const game = createGame(ratio);
    const scale = ratio || 1;
    for (const [id, width, height] of [['board', 300, 600], ['next', 120, 120]]) {
      const surface = game.elements.get(id);
      assert.equal(surface.width, Math.round(width * scale));
      assert.equal(surface.height, Math.round(height * scale));
      assert.equal(surface.style.width, `${width}px`);
      assert.equal(surface.style.height, `${height}px`);
      assert.deepEqual(game.calls(id, 'setTransform').at(-1), [
        surface.width / width, 0, 0, surface.height / height, 0, 0,
      ]);
    }
    assert.deepEqual(game.calls('board', 'clearRect').at(-1), [0, 0, 300, 600]);
    assert.equal(game.frames.length, 0);
  });
}

test('grid, particles, and preview stay in logical coordinates on high-DPI screens', () => {
  const game = createGame(2);
  const lines = game.calls('board', 'lineTo');
  assert.equal(lines.length, 28);
  assert.deepEqual(lines[0], [30.5, 600]);
  assert.deepEqual(lines.at(-1), [300, 570.5]);
  game.evaluate('spawnParticles(19)');
  assert.equal(game.evaluate('state.particles.length'), 40);
  assert.equal(game.evaluate('state.particles.every((p) => p.x === 150 && p.y === 585)'), true);
  game.evaluate('state.nextType = "I"; drawNext();');
  assert.deepEqual(game.calls('next', 'clearRect').at(-1), [0, 0, 120, 120]);
  assert.deepEqual(game.calls('next', 'roundRect'), [
    [13, 49, 22, 22, 5], [37, 49, 22, 22, 5],
    [61, 49, 22, 22, 5], [85, 49, 22, 22, 5],
  ]);
  assert.equal(game.elements.get('next').getAttribute('aria-label'), 'Next piece: I');
});

test('resize redraws without accumulating transforms, listeners, or animation loops', () => {
  const game = createGame();
  game.click('start-btn');
  game.evaluate('state.board[19][0] = "T"; state.score = 123;');
  game.click('pause-btn');
  const before = game.evaluate('JSON.stringify(state)');
  const previousQuery = game.queries.at(-1);
  for (let i = 0; i < 2; i++) game.resize(2);
  assert.deepEqual(game.calls('board', 'setTransform').slice(-2), [
    [2, 0, 0, 2, 0, 0], [2, 0, 0, 2, 0, 0],
  ]);
  assert.equal(game.evaluate('JSON.stringify(state)'), before);
  assert.equal(game.document.activeElement, game.elements.get('start-btn'));
  assert.equal(game.frames.length, 1);
  assert.equal(previousQuery.listeners.size, 0);
  assert.equal(game.queries.filter((query) => query.listeners.size > 0).length, 1);
  assert.equal(game.calls('board', 'clearRect').length, 3);
  assert.equal(game.calls('next', 'clearRect').length, 3);
});

test('density changes redraw both canvases even without a resize event', () => {
  const game = createGame();
  game.evaluate('state.nextType = "I";');
  for (const ratio of [2, 3, 1.25, 1]) {
    game.changeDensity(ratio);
    assert.equal(game.elements.get('board').width, 300 * ratio);
    assert.equal(game.elements.get('board').height, 600 * ratio);
    assert.equal(game.elements.get('next').width, 120 * ratio);
    assert.deepEqual(game.calls('next', 'setTransform').at(-1), [ratio, 0, 0, ratio, 0, 0]);
    assert.equal(game.queries.at(-1).media, `(resolution: ${ratio}dppx)`);
    assert.equal(game.queries.filter((query) => query.listeners.size > 0).length, 1);
  }
  assert.equal(game.calls('next', 'clearRect').length, 4);
  assert.equal(game.frames.length, 0);
});

test('markup exposes named controls, labeled canvases, a dialog, and live statistics', () => {
  const game = createGame();
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
  const overlay = game.elements.get('overlay');
  assert.equal(overlay.getAttribute('role'), 'dialog');
  assert.equal(overlay.getAttribute('aria-labelledby'), 'overlay-title');
  assert.equal(overlay.getAttribute('aria-describedby'), 'overlay-text');
  assert.match(markup, /role="status"[^>]*aria-live="polite"[^>]*aria-atomic="true"/);
  assert.equal(game.document.activeElement, game.elements.get('start-btn'));
  assert.equal(game.elements.get('pause-btn').disabled, true);
});

test('start, pause, resume, game over, and restart manage names and focus', () => {
  const game = createGame();
  const start = game.elements.get('start-btn');
  const pause = game.elements.get('pause-btn');
  const board = game.elements.get('board');
  const overlay = game.elements.get('overlay');
  game.click('start-btn');
  assert.equal(game.document.activeElement, board);
  assert.equal(pause.disabled, false);
  assert.equal(overlay.classList.contains('hidden'), true);
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

test('hard-drop points and cleared-line level changes update the live statistics', () => {
  const game = createGame();
  game.click('start-btn');
  game.key('Space');
  assert.ok(game.evaluate('state.score') > 0);
  assert.equal(game.elements.get('score').textContent, game.evaluate('state.score.toLocaleString()'));
  game.evaluate('state.board = createBoard(); state.board[19].fill("I"); state.lines = 9; state.score = 0; clearLines();');
  assert.equal(game.elements.get('score').textContent, '100');
  assert.equal(game.elements.get('lines').textContent, '10');
  assert.equal(game.elements.get('level').textContent, '2');
  const writes = ['score', 'lines', 'level'].map((id) => game.elements.get(id).textWrites);
  game.evaluate('updateStats();');
  assert.deepEqual(['score', 'lines', 'level'].map((id) => game.elements.get(id).textWrites), writes);
});

test('keyboard controls preserve button activation and stop movement while paused', () => {
  const game = createGame();
  game.click('start-btn');
  const before = game.evaluate('JSON.stringify(state.piece)');
  assert.equal(game.key('Space', game.elements.get('pause-btn')).defaultPrevented, false);
  assert.equal(game.key('ArrowLeft', game.elements.get('restart-btn')).defaultPrevented, false);
  assert.equal(game.key('ArrowLeft', game.elements.get('board'), { altKey: true }).defaultPrevented, false);
  assert.equal(game.evaluate('JSON.stringify(state.piece)'), before);
  assert.equal(game.key('KeyP').defaultPrevented, true);
  for (const code of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space']) game.key(code);
  assert.equal(game.evaluate('JSON.stringify(state.piece)'), before);
  assert.equal(game.key('KeyP', game.elements.get('start-btn')).defaultPrevented, true);
  assert.equal(game.evaluate('state.paused'), false);
  assert.equal(game.document.activeElement, game.elements.get('board'));
  game.key('ArrowLeft');
  assert.notEqual(game.evaluate('JSON.stringify(state.piece)'), before);
});

test('restart does not duplicate keyboard actions or pause toggles', () => {
  const game = createGame();
  for (let i = 0; i < 3; i++) game.click('restart-btn');
  assert.equal(game.documentListeners.get('keydown').size, 1);
  const x = game.evaluate('state.piece.x');
  game.key('ArrowLeft');
  assert.equal(game.evaluate('state.piece.x'), x - 1);
  game.key('KeyP');
  assert.equal(game.evaluate('state.paused'), true);
});
