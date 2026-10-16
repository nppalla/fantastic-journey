'use strict';

const assert = require('node:assert/strict');
const { setMaxListeners } = require('node:events');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const { createContext, runInContext } = require('node:vm');

const source = readFileSync(`${__dirname}/game.js`, 'utf8');

function createGame() {
  const frames = new Map();
  let nextFrameId = 0;
  let time = 0;
  let draws = 0;
  const context2d = {
    clearRect() {},
    createLinearGradient: () => ({ addColorStop() {} }),
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
  const elements = new Map();
  const document = new EventTarget();
  setMaxListeners(0, document);
  document.getElementById = (id) => {
    if (!elements.has(id)) {
      const element = new EventTarget();
      const classes = new Set();
      element.classList = {
        add: (name) => classes.add(name),
        remove: (name) => classes.delete(name),
      };
      element.getContext = () => ({
        ...context2d,
        clearRect() {
          if (id === 'board') draws++;
        },
      });
      element.width = 120;
      element.height = 120;
      elements.set(id, element);
    }
    return elements.get(id);
  };
  const context = createContext({
    document,
    performance: { now: () => time },
    requestAnimationFrame(callback) {
      const id = nextFrameId++;
      frames.set(id, callback);
      return id;
    },
    cancelAnimationFrame: (id) => frames.delete(id),
  });
  runInContext(source, context);

  return {
    click(id) {
      elements.get(id).dispatchEvent(new Event('click'));
    },
    frame(timestamp) {
      time = timestamp;
      const callbacks = [...frames.values()];
      frames.clear();
      const previousDraws = draws;
      callbacks.forEach((callback) => callback(time));
      return { updates: callbacks.length, draws: draws - previousDraws };
    },
    evaluate: (code) => runInContext(code, context),
    get pendingFrames() {
      return frames.size;
    },
  };
}

test('the initial board stays idle until a game starts', () => {
  const game = createGame();

  assert.equal(game.pendingFrames, 0);
  assert.deepEqual(game.frame(16), { updates: 0, draws: 0 });
});

test('ten restarts before the next frame leave one update and draw per frame', () => {
  const game = createGame();
  game.click('start-btn');
  for (let i = 0; i < 10; i++) game.click('restart-btn');

  assert.equal(game.pendingFrames, 1);
  for (let i = 1; i <= 120; i++) {
    assert.deepEqual(game.frame(i * 16), { updates: 1, draws: 1 });
    assert.equal(game.pendingFrames, 1);
  }
});

test('restarting after rendered frames replaces the latest pending callback', () => {
  const game = createGame();
  game.click('start-btn');

  for (let i = 1; i <= 10; i++) {
    assert.deepEqual(game.frame(i * 16), { updates: 1, draws: 1 });
    game.click('restart-btn');
    assert.equal(game.pendingFrames, 1);
  }
  assert.deepEqual(game.frame(176), { updates: 1, draws: 1 });
});

test('restarting resets the game and measures elapsed time from the restart', () => {
  const game = createGame();
  game.click('start-btn');
  game.frame(900);
  game.evaluate('state.score = 123; state.lines = 5; state.level = 3; state.board[19][0] = "T"');
  game.click('restart-btn');
  const initialY = game.evaluate('state.piece.y');

  assert.equal(game.evaluate('state.score'), 0);
  assert.equal(game.evaluate('state.lines'), 0);
  assert.equal(game.evaluate('state.level'), 1);
  assert.equal(game.evaluate('state.board.every((row) => row.every((cell) => cell === null))'), true);
  assert.equal(game.evaluate('state.dropCounter'), 0);
  assert.equal(game.evaluate('state.lastTime'), 900);

  assert.deepEqual(game.frame(916), { updates: 1, draws: 1 });
  assert.equal(game.evaluate('state.dropCounter'), 16);
  assert.equal(game.evaluate('state.piece.y'), initialY);
  game.frame(1917);
  assert.equal(game.evaluate('state.piece.y'), initialY + 1);
});

test('pause, resume, and restart preserve one loop without dropping while paused', () => {
  const game = createGame();
  game.click('start-btn');
  const initialY = game.evaluate('state.piece.y');
  game.click('pause-btn');

  assert.deepEqual(game.frame(2000), { updates: 1, draws: 1 });
  assert.equal(game.evaluate('state.dropCounter'), 0);
  assert.equal(game.evaluate('state.piece.y'), initialY);
  game.click('start-btn');
  assert.equal(game.evaluate('state.paused'), false);
  assert.equal(game.pendingFrames, 1);
  assert.deepEqual(game.frame(2016), { updates: 1, draws: 1 });
  assert.equal(game.evaluate('state.dropCounter'), 16);

  game.click('pause-btn');
  game.click('restart-btn');
  assert.equal(game.evaluate('state.paused'), false);
  assert.equal(game.pendingFrames, 1);
  assert.deepEqual(game.frame(2032), { updates: 1, draws: 1 });
  assert.equal(game.evaluate('state.dropCounter'), 16);
});

test('game-over rendering continues and starting again replaces its callback', () => {
  const game = createGame();
  game.click('start-btn');
  game.evaluate('endGame()');

  assert.deepEqual(game.frame(2000), { updates: 1, draws: 1 });
  assert.equal(game.evaluate('state.running'), false);
  assert.equal(game.evaluate('state.dropCounter'), 0);
  game.click('start-btn');

  assert.equal(game.evaluate('state.running'), true);
  assert.equal(game.evaluate('state.over'), false);
  assert.equal(game.pendingFrames, 1);
  assert.deepEqual(game.frame(2016), { updates: 1, draws: 1 });
  assert.equal(game.evaluate('state.dropCounter'), 16);
});
