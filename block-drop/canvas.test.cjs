'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = readFileSync(join(__dirname, 'game.js'), 'utf8');

function createGame(pixelRatio) {
  const elements = new Map();
  const contexts = new Map();
  const windowListeners = new Map();
  const queries = [];
  const frames = [];

  for (const id of [
    'board', 'next', 'score', 'lines', 'level', 'overlay', 'overlay-title',
    'overlay-text', 'start-btn', 'pause-btn', 'restart-btn',
  ]) {
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
    elements.set(id, {
      width: id === 'next' ? 120 : 300,
      height: id === 'next' ? 120 : 150,
      style: {},
      classList: { add() {}, remove() {} },
      getContext() { return context; },
      addEventListener() {},
    });
  }

  const window = {
    devicePixelRatio: pixelRatio,
    addEventListener(name, listener) { windowListeners.set(name, listener); },
    matchMedia(media) {
      const listeners = new Set();
      const query = {
        media,
        listeners,
        addEventListener(name, listener) {
          assert.equal(name, 'change');
          listeners.add(listener);
        },
        removeEventListener(name, listener) {
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
    document: {
      getElementById(id) { return elements.get(id); },
      addEventListener() {},
    },
    performance: { now: () => 1000 },
    requestAnimationFrame(callback) { return frames.push(callback); },
  });
  vm.runInContext('Math.random = () => 0.5;', context);
  vm.runInContext(source, context, { filename: 'game.js' });

  return {
    elements,
    queries,
    frames,
    calls: (id, name) => contexts.get(id).filter((call) => call.name === name).map((call) => call.args),
    evaluate: (expression) => vm.runInContext(expression, context),
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

for (const ratio of [undefined, 1, 1.25, 4 / 3, 2, 3]) {
  test(`canvas backing sizes and transforms match devicePixelRatio ${ratio}`, () => {
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

test('high-DPI grids and particles stay inside the logical board', () => {
  const game = createGame(2);
  const lines = game.calls('board', 'lineTo');
  assert.equal(lines.length, 28);
  assert.deepEqual(lines[0], [30.5, 600]);
  assert.deepEqual(lines.at(-1), [300, 570.5]);

  game.evaluate('spawnParticles(19)');
  assert.equal(game.evaluate('state.particles.length'), 40);
  assert.equal(game.evaluate('state.particles.every((p) => p.x === 150 && p.y === 585)'), true);
});

test('the high-DPI preview clears and centers pieces in logical coordinates', () => {
  const game = createGame(2);
  game.evaluate('state.nextType = "I"; drawNext();');
  assert.deepEqual(game.calls('next', 'clearRect').at(-1), [0, 0, 120, 120]);
  assert.deepEqual(game.calls('next', 'roundRect'), [
    [13, 49, 22, 22, 5],
    [37, 49, 22, 22, 5],
    [61, 49, 22, 22, 5],
    [85, 49, 22, 22, 5],
  ]);
});

test('resize redraws both canvases without scaling twice or resetting the game', () => {
  const game = createGame(1);
  game.evaluate('startGame(); state.board[19][0] = "T"; state.score = 123; state.paused = true;');
  const before = game.evaluate('JSON.stringify(state)');
  const previousQuery = game.queries.at(-1);

  game.resize(2);
  game.resize(2);
  assert.deepEqual(game.calls('board', 'setTransform').slice(-2), [
    [2, 0, 0, 2, 0, 0],
    [2, 0, 0, 2, 0, 0],
  ]);
  assert.equal(game.elements.get('board').width, 600);
  assert.equal(game.elements.get('next').width, 240);
  assert.deepEqual(game.calls('next', 'clearRect').at(-1), [0, 0, 120, 120]);
  assert.equal(game.calls('board', 'clearRect').length, 3);
  assert.equal(game.calls('next', 'clearRect').length, 3);
  assert.equal(game.evaluate('JSON.stringify(state)'), before);
  assert.equal(game.frames.length, 1);
  assert.equal(previousQuery.listeners.size, 0);
  assert.equal(game.queries.filter((query) => query.listeners.size > 0).length, 1);
});

test('display-density changes redraw even without a window resize', () => {
  const game = createGame(1);
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
