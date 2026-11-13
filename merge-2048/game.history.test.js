'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

const source = readFileSync(join(__dirname, 'game.js'), 'utf8');

function loadGame() {
  function createElement() {
    const listeners = new Map();
    return {
      style: {},
      offsetWidth: 100,
      classList: { add() {}, remove() {} },
      appendChild() {},
      addEventListener(name, callback) {
        listeners.set(name, callback);
      },
      dispatch(name) {
        listeners.get(name)();
      },
    };
  }

  const elements = new Map([
    'board', 'score', 'best', 'message', 'message-text', 'continue-btn',
    'retry-btn', 'undo-btn', 'new-btn',
  ].map((id) => [id, createElement()]));
  const storage = new Map();
  const sandbox = vm.createContext({
    document: Object.assign(createElement(), {
      getElementById: (id) => elements.get(id),
      createElement,
    }),
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    },
  });
  const run = (code) => vm.runInContext(code, sandbox);
  run('Math.random = () => 0');
  run(source);

  return {
    elements, run,
    grid: () => JSON.parse(run('JSON.stringify(state.grid)')),
    history: () => JSON.parse(run('JSON.stringify(state.history.map((entry) => entry.grid))')),
    undo: () => elements.get('undo-btn').dispatch('click'),
    prepareMove(index) {
      run(`
        state.grid = emptyGrid();
        state.grid[0] = [0, 2, 2, 0];
        state.grid[1 + Math.floor(${index} / 40) % 3][Math.floor(${index} / 10) % 4] =
          2 ** (${index} % 10 + 1);
      `);
    },
  };
}

test('history never exceeds 100 entries over 5,000 moves', () => {
  const game = loadGame();
  for (let i = 0; i < 5000; i++) {
    game.prepareMove(i);
    game.run("move('left')");
    assert.equal(game.run('state.over'), false);
    assert.equal(game.run('state.won'), false);
    assert.equal(game.run('state.history.length'), Math.min(i + 1, 100));
  }
});

test('only the latest 100 snapshots remain and undo restores them newest first', () => {
  const game = loadGame();
  const snapshots = [];
  for (let i = 0; i < 125; i++) {
    game.prepareMove(i);
    snapshots.push(game.grid());
    game.run("move('left')");
  }
  const retained = snapshots.slice(-100);
  assert.deepEqual(game.history(), retained);

  for (const expected of retained.reverse()) {
    assert.equal(game.elements.get('undo-btn').disabled, false);
    game.undo();
    assert.deepEqual(game.grid(), expected);
  }
  assert.equal(game.run('state.history.length'), 0);
  assert.equal(game.elements.get('undo-btn').disabled, true);
  const oldest = game.grid();
  game.run('undo()');
  assert.deepEqual(game.grid(), oldest);
});

test('new moves refill history after undo and evict only the oldest remaining entries', () => {
  const game = loadGame();
  const snapshots = [];
  for (let i = 0; i < 110; i++) {
    game.prepareMove(i);
    snapshots.push(game.grid());
    game.run("move('left')");
  }
  const expected = snapshots.slice(-100);
  for (let i = 0; i < 3; i++) {
    game.undo();
    expected.pop();
  }
  assert.equal(game.run('state.history.length'), 97);

  for (let i = 110; i < 114; i++) {
    game.prepareMove(i);
    expected.push(game.grid());
    if (expected.length > 100) expected.shift();
    game.run("move('left')");
    assert.deepEqual(game.history(), expected);
  }
});

for (const button of ['new-btn', 'retry-btn']) {
  test(`${button} clears bounded history and starts a fresh undo stack`, () => {
    const game = loadGame();
    for (let i = 0; i < 101; i++) {
      game.prepareMove(i);
      game.run("move('left')");
    }

    game.elements.get(button).dispatch('click');
    assert.equal(game.run('state.history.length'), 0);
    assert.equal(game.elements.get('undo-btn').disabled, true);
    const fresh = game.grid();
    game.run('undo()');
    assert.deepEqual(game.grid(), fresh);

    game.run("move('right')");
    assert.equal(game.run('state.history.length'), 1);
    game.undo();
    assert.deepEqual(game.grid(), fresh);
    assert.equal(game.elements.get('undo-btn').disabled, true);
  });
}
