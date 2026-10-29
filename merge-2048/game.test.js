'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

const source = readFileSync(join(__dirname, 'game.js'), 'utf8');

function loadGame(best = 0) {
  function createElement() {
    const listeners = new Map();
    const classes = new Set();
    return {
      style: {},
      offsetWidth: 100,
      classList: {
        add: (name) => classes.add(name),
        remove: (name) => classes.delete(name),
      },
      appendChild() {},
      addEventListener(name, callback) {
        if (!listeners.has(name)) listeners.set(name, new Set());
        listeners.get(name).add(callback);
      },
      dispatch(name, event) {
        for (const callback of listeners.get(name) || []) callback(event);
      },
    };
  }

  const elements = new Map();
  for (const id of [
    'board', 'score', 'best', 'message', 'message-text',
    'continue-btn', 'retry-btn', 'undo-btn', 'new-btn',
  ]) {
    elements.set(id, createElement());
  }
  const storage = new Map([['merge2048.best', String(best)]]);
  const document = Object.assign(createElement(), {
    getElementById: (id) => elements.get(id),
    createElement,
  });
  const sandbox = vm.createContext({
    document,
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    },
  });
  const run = (code) => vm.runInContext(code, sandbox);
  run('Math.random = () => 0');
  run(source);

  return {
    elements,
    document,
    run,
    grid: () => JSON.parse(run('JSON.stringify(state.grid)')),
    score: () => Number(elements.get('score').textContent),
    best: () => Number(elements.get('best').textContent),
    undo: () => elements.get('undo-btn').dispatch('click'),
  };
}

for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) {
  test(`undo restores the pre-move grid and nonzero score after ${key}`, () => {
    const game = loadGame(32);
    game.run(`
      state.grid = [[2, 2, 0, 0], [2, 2, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
      state.score = 12;
      render();
    `);
    const before = game.grid();
    assert.equal(game.elements.get('undo-btn').disabled, true);

    game.document.dispatch('keydown', { key });
    assert.equal(game.score(), 20);
    assert.notDeepEqual(game.grid(), before);
    assert.equal(game.elements.get('undo-btn').disabled, false);

    game.undo();
    assert.deepEqual(game.grid(), before);
    assert.equal(game.run('state.score'), 12);
    assert.equal(game.score(), 12);
    assert.equal(game.best(), 32);
    assert.equal(game.elements.get('undo-btn').disabled, true);
  });
}

test('repeating undo and the same merge does not inflate the score or best score', () => {
  const game = loadGame();
  game.run('state.grid = [[2, 2, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]');
  const before = game.grid();

  for (let i = 0; i < 5; i++) {
    game.run("move('left')");
    assert.equal(game.score(), 4);
    assert.equal(game.best(), 4);
    game.undo();
    assert.deepEqual(game.grid(), before);
    assert.equal(game.score(), 0);
    assert.equal(game.best(), 4);
  }
});

test('consecutive undos restore the score and grid belonging to each move', () => {
  const game = loadGame();
  game.run('state.grid = [[2, 2, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]');
  const snapshots = [];
  for (let i = 0; i < 3; i++) {
    snapshots.push({ grid: game.grid(), score: game.score() });
    game.run("move('left')");
  }
  assert.equal(game.score(), 8);

  for (const snapshot of snapshots.reverse()) {
    game.undo();
    assert.deepEqual(game.grid(), snapshot.grid);
    assert.equal(game.score(), snapshot.score);
    assert.equal(game.best(), 8);
  }
  assert.equal(game.elements.get('undo-btn').disabled, true);
});

test('undoing a slide without a merge preserves the existing score', () => {
  const game = loadGame(32);
  game.run(`
    state.grid = [[0, 2, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
    state.score = 12;
    render();
  `);
  const before = game.grid();
  game.run("move('left')");
  assert.equal(game.score(), 12);

  game.undo();
  assert.deepEqual(game.grid(), before);
  assert.equal(game.score(), 12);
});

test('empty undo history and a new game cannot restore stale scores', () => {
  const game = loadGame();
  const initial = game.grid();
  game.undo();
  assert.deepEqual(game.grid(), initial);
  assert.equal(game.score(), 0);

  game.run("move('left')");
  assert.equal(game.score(), 4);
  game.elements.get('new-btn').dispatch('click');
  const restarted = game.grid();
  assert.equal(game.score(), 0);
  assert.equal(game.best(), 4);
  assert.equal(game.elements.get('undo-btn').disabled, true);

  game.undo();
  assert.deepEqual(game.grid(), restarted);
  assert.equal(game.score(), 0);
  assert.equal(game.best(), 4);
});
