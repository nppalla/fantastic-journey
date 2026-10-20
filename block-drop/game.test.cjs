'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

const source = readFileSync(join(__dirname, 'game.js'), 'utf8');

function createGame() {
  let now = 0;
  let frameId = 0;
  let boardDraws = 0;
  const frames = new Map();
  const elements = new Map();

  function createContext(id) {
    return {
      clearRect() {
        if (id === 'board') boardDraws++;
      },
      createLinearGradient() {
        return { addColorStop() {} };
      },
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

  const sandbox = vm.createContext({
    document: {
      getElementById(id) {
        if (!elements.has(id)) {
          const listeners = new Map();
          const context = createContext(id);
          elements.set(id, {
            width: 120,
            height: 120,
            classList: {
              add() {},
              remove() {},
            },
            getContext: () => context,
            addEventListener: (type, callback) => listeners.set(type, callback),
            click: () => listeners.get('click')(),
          });
        }
        return elements.get(id);
      },
      addEventListener() {},
    },
    performance: { now: () => now },
    requestAnimationFrame(callback) {
      frames.set(++frameId, callback);
      return frameId;
    },
  });
  vm.runInContext(source, sandbox);

  return {
    state: vm.runInContext('state', sandbox),
    pendingFrames: () => frames.size,
    boardDraws: () => boardDraws,
    click: (id) => elements.get(id).click(),
    frame(time) {
      now = time;
      const callbacks = [...frames.values()];
      frames.clear();
      for (const callback of callbacks) callback(time);
      return callbacks.length;
    },
    endGame: () => vm.runInContext('endGame()', sandbox),
  };
}

test('initialization starts one render loop without starting the game', () => {
  const game = createGame();

  assert.equal(game.state.running, false);
  assert.equal(game.pendingFrames(), 1);
  assert.equal(game.frame(16), 1);
  assert.equal(game.boardDraws(), 2);
  assert.equal(game.pendingFrames(), 1);
});

test('starting and restarting ten times before a frame keeps one loop', () => {
  const game = createGame();
  game.click('start-btn');
  for (let i = 0; i < 10; i++) game.click('restart-btn');

  assert.equal(game.pendingFrames(), 1);
  const drawsBefore = game.boardDraws();
  assert.equal(game.frame(16), 1);
  assert.equal(game.boardDraws(), drawsBefore + 1);
  assert.equal(game.state.dropCounter, 16);
  assert.equal(game.pendingFrames(), 1);
});

test('restarting between frames keeps one update and draw per frame', () => {
  const game = createGame();
  game.click('start-btn');

  for (let i = 1; i <= 11; i++) {
    const drawsBefore = game.boardDraws();
    assert.equal(game.frame(i * 16), 1);
    assert.equal(game.boardDraws(), drawsBefore + 1);
    assert.equal(game.state.dropCounter, 16);
    game.click('restart-btn');
    assert.equal(game.state.dropCounter, 0);
    assert.equal(game.pendingFrames(), 1);
  }
});

test('pause, resume, game over, and replay retain the same loop', () => {
  const game = createGame();
  game.click('start-btn');
  game.frame(16);
  const startingY = game.state.piece.y;

  game.click('pause-btn');
  assert.equal(game.state.paused, true);
  assert.equal(game.frame(2016), 1);
  assert.equal(game.state.piece.y, startingY);
  assert.equal(game.state.dropCounter, 16);

  game.click('start-btn');
  assert.equal(game.state.paused, false);
  assert.equal(game.pendingFrames(), 1);
  assert.equal(game.frame(3032), 1);
  assert.equal(game.state.piece.y, startingY + 1);

  game.click('pause-btn');
  game.click('restart-btn');
  assert.equal(game.state.paused, false);
  assert.equal(game.state.running, true);
  assert.equal(game.pendingFrames(), 1);
  assert.equal(game.frame(3048), 1);
  assert.equal(game.state.dropCounter, 16);

  game.endGame();
  assert.equal(game.state.over, true);
  assert.equal(game.frame(5048), 1);
  assert.equal(game.state.dropCounter, 16);

  game.click('start-btn');
  assert.equal(game.state.over, false);
  assert.equal(game.state.running, true);
  assert.equal(game.pendingFrames(), 1);
  assert.equal(game.frame(5064), 1);
  assert.equal(game.state.dropCounter, 16);
});
