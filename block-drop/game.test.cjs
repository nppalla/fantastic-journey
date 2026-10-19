'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = readFileSync(join(__dirname, 'game.js'), 'utf8');

function createGame() {
  const frames = new Map();
  const cancelledFrames = [];
  const elements = new Map();
  let nextFrameId = 0;
  let now = 1000;
  let boardDraws = 0;

  function createContext(isBoard) {
    return {
      clearRect() { if (isBoard) boardDraws++; },
      createLinearGradient() { return { addColorStop() {} }; },
      save() {},
      restore() {},
      beginPath() {},
      roundRect() {},
      fill() {},
      moveTo() {},
      lineTo() {},
      stroke() {},
      fillRect() {},
    };
  }

  for (const id of [
    'board', 'next', 'score', 'lines', 'level', 'overlay', 'overlay-title',
    'overlay-text', 'start-btn', 'pause-btn', 'restart-btn',
  ]) {
    const listeners = new Map();
    const context = createContext(id === 'board');
    elements.set(id, {
      width: 120,
      height: 120,
      classList: { add() {}, remove() {} },
      getContext() { return context; },
      addEventListener(type, listener) {
        if (!listeners.has(type)) listeners.set(type, []);
        listeners.get(type).push(listener);
      },
      click() {
        for (const listener of listeners.get('click') || []) listener();
      },
    });
  }

  const context = vm.createContext({
    document: {
      getElementById(id) { return elements.get(id); },
      addEventListener() {},
    },
    performance: { now: () => now },
    requestAnimationFrame(callback) {
      const id = nextFrameId++;
      frames.set(id, callback);
      return id;
    },
    cancelAnimationFrame(id) {
      cancelledFrames.push(id);
      frames.delete(id);
    },
  });
  vm.runInContext(source, context, { filename: 'game.js' });

  return {
    frames,
    cancelledFrames,
    boardDraws: () => boardDraws,
    evaluate: (expression) => vm.runInContext(expression, context),
    click: (id) => elements.get(id).click(),
    setTime(time) { now = time; },
    frame(time) {
      now = time;
      const callbacks = [...frames.values()];
      frames.clear();
      for (const callback of callbacks) callback(time);
      return callbacks.length;
    },
  };
}

test('the initial board is drawn without starting an animation loop', () => {
  const game = createGame();
  assert.equal(game.boardDraws(), 1);
  assert.equal(game.frames.size, 0);
});

test('ten immediate restarts leave one update and draw per frame', () => {
  const game = createGame();
  game.click('start-btn');
  assert.equal(game.frames.size, 1);
  assert.ok(game.frames.has(0));

  for (let i = 0; i < 10; i++) game.click('restart-btn');

  assert.equal(game.frames.size, 1);
  assert.equal(game.cancelledFrames.length, 10);
  assert.equal(game.cancelledFrames[0], 0);
  for (let i = 1; i <= 120; i++) {
    const before = game.boardDraws();
    assert.equal(game.frame(1000 + i * 16), 1);
    assert.equal(game.boardDraws() - before, 1);
    assert.equal(game.frames.size, 1);
  }
});

test('restarts after rendered frames cancel the latest scheduled frame', () => {
  const game = createGame();
  game.click('start-btn');

  for (let i = 1; i <= 10; i++) {
    assert.equal(game.frame(1000 + i * 16), 1);
    const pendingId = [...game.frames.keys()][0];
    game.click('restart-btn');
    assert.equal(game.cancelledFrames.at(-1), pendingId);
    assert.ok(!game.frames.has(pendingId));
    assert.equal(game.frames.size, 1);
  }
  assert.equal(game.frame(1176), 1);
});

test('restart resets game state and timing without immediately dropping a piece', () => {
  const game = createGame();
  game.click('start-btn');
  game.frame(1500);
  game.evaluate('state.score = 123; state.lines = 5; state.level = 3; state.board[19][0] = "T"; updateStats();');
  game.setTime(10000);
  game.click('restart-btn');

  const initialY = game.evaluate('state.piece.y');
  assert.equal(game.evaluate('state.score'), 0);
  assert.equal(game.evaluate('state.lines'), 0);
  assert.equal(game.evaluate('state.level'), 1);
  assert.equal(game.evaluate('state.board.every((row) => row.every((cell) => cell === null))'), true);
  assert.equal(game.evaluate('scoreEl.textContent'), '0');
  assert.equal(game.evaluate('linesEl.textContent'), 0);
  assert.equal(game.evaluate('levelEl.textContent'), 1);
  assert.equal(game.evaluate('state.dropCounter'), 0);
  assert.equal(game.evaluate('state.lastTime'), 10000);
  assert.equal(game.frame(10016), 1);
  assert.equal(game.evaluate('state.dropCounter'), 16);
  assert.equal(game.evaluate('state.piece.y'), initialY);
  assert.equal(game.frame(11017), 1);
  assert.equal(game.evaluate('state.piece.y'), initialY + 1);
});

test('pause, resume, and restart while paused retain one animation loop', () => {
  const game = createGame();
  game.click('start-btn');
  game.click('pause-btn');
  assert.equal(game.frame(1200), 1);
  assert.equal(game.evaluate('state.dropCounter'), 0);
  const pendingId = [...game.frames.keys()][0];

  game.click('start-btn');
  assert.equal(game.evaluate('state.paused'), false);
  assert.ok(game.frames.has(pendingId));
  assert.equal(game.frame(1216), 1);
  assert.equal(game.evaluate('state.dropCounter'), 16);

  game.click('pause-btn');
  game.click('restart-btn');
  assert.equal(game.evaluate('state.paused'), false);
  assert.equal(game.frames.size, 1);
  assert.equal(game.frame(1232), 1);
});

test('game over keeps rendering and starting again replaces its pending frame', () => {
  const game = createGame();
  game.click('start-btn');
  game.frame(1016);
  game.evaluate('state.board[0].fill("I"); spawn();');
  assert.equal(game.evaluate('state.over'), true);
  assert.equal(game.evaluate('state.running'), false);
  const before = game.boardDraws();
  assert.equal(game.frame(1032), 1);
  assert.equal(game.boardDraws() - before, 1);

  game.click('start-btn');
  assert.equal(game.evaluate('state.over'), false);
  assert.equal(game.evaluate('state.running'), true);
  assert.equal(game.frames.size, 1);
  assert.equal(game.frame(1048), 1);
});
