'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

const source = readFileSync(join(__dirname, 'game.js'), 'utf8');
const blockedGrid = [
  [2, 4, 8, 16],
  [32, 64, 128, 256],
  [512, 1024, 2, 4],
  [8, 16, 32, 64],
];

function loadGame() {
  function createElement() {
    const listeners = new Map();
    const classes = new Set(['hidden']);
    return {
      style: {},
      classList: {
        add: (name) => classes.add(name),
        remove: (name) => classes.delete(name),
        contains: (name) => classes.has(name),
      },
      appendChild() {},
      addEventListener(name, callback) {
        listeners.set(name, callback);
      },
      dispatch(name, event) {
        listeners.get(name)(event);
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
  const document = Object.assign(createElement(), {
    getElementById: (id) => elements.get(id),
    createElement,
  });
  const storage = new Map();
  const sandbox = vm.createContext({
    document,
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    },
    Math: Object.assign(Object.create(Math), { random: () => 0 }),
  });
  const run = (code) => vm.runInContext(code, sandbox);
  run(source);

  return {
    document, elements, run,
    setGrid(grid) {
      run(`state.grid = ${JSON.stringify(grid)}`);
    },
  };
}

test('every empty-cell position keeps the game playable', () => {
  const game = loadGame();
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      const grid = blockedGrid.map((row) => row.slice());
      grid[r][c] = 0;
      game.setGrid(grid);
      assert.equal(game.run('isGameOver()'), false, `Empty cell at ${r},${c}`);
    }
  }
});

test('a completely empty board is not game over', () => {
  const game = loadGame();
  game.run('state.grid = emptyGrid()');
  assert.equal(game.run('isGameOver()'), false);
});

for (const [direction, dr, dc] of [['horizontal', 0, 1], ['vertical', 1, 0]]) {
  test(`every ${direction} equal-neighbor position keeps a full board playable`, () => {
    const game = loadGame();
    for (let r = 0; r < 4 - dr; r++) {
      for (let c = 0; c < 4 - dc; c++) {
        const grid = blockedGrid.map((row) => row.slice());
        grid[r + dr][c + dc] = grid[r][c];
        game.setGrid(grid);
        assert.equal(game.run('isGameOver()'), false, `Merge at ${r},${c}`);
      }
    }
  });
}

test('a full board with no equal orthogonal neighbors is game over', () => {
  const game = loadGame();
  game.setGrid(blockedGrid);
  assert.equal(game.run('isGameOver()'), true);
});

test('diagonal and row-wrap matches do not keep a full board playable', () => {
  const game = loadGame();
  game.setGrid([
    [2, 4, 2, 4],
    [4, 2, 4, 2],
    [2, 4, 2, 4],
    [4, 2, 4, 2],
  ]);
  assert.equal(game.run('isGameOver()'), true);
});

test('checking for game over does not change game state', () => {
  const game = loadGame();
  for (const grid of [blockedGrid, Array.from({ length: 4 }, () => [2, 2, 4, 8])]) {
    game.setGrid(grid);
    const before = game.run('JSON.stringify(state)');
    for (let i = 0; i < 5; i++) game.run('isGameOver()');
    assert.equal(game.run('JSON.stringify(state)'), before);
  }
});

for (const [direction, grid, nextKey] of [
  ['horizontal', [
    [0, 4, 8, 2],
    [16, 32, 64, 128],
    [256, 512, 1024, 2],
    [4, 8, 16, 32],
  ], 'ArrowLeft'],
  ['vertical', [
    [0, 4, 8, 16],
    [32, 64, 128, 2],
    [256, 512, 1024, 4],
    [8, 16, 32, 64],
  ], 'ArrowDown'],
]) {
  test(`filling the last empty cell permits the remaining ${direction} merge`, () => {
    const game = loadGame();
    game.setGrid(grid);
    game.document.dispatch('keydown', { key: 'ArrowLeft' });

    assert.equal(game.run('emptyCells().length'), 0);
    assert.equal(game.run('state.over'), false);
    assert.equal(game.elements.get('message').classList.contains('hidden'), true);

    game.document.dispatch('keydown', { key: nextKey });
    assert.equal(game.run('state.score'), 4);
    assert.equal(game.run('state.history.length'), 2);
  });
}

test('filling the last empty cell with no remaining merges shows game over', () => {
  const game = loadGame();
  game.setGrid([
    [0, 2, 4, 8],
    [16, 32, 64, 128],
    [256, 512, 1024, 2],
    [4, 8, 16, 32],
  ]);
  game.document.dispatch('keydown', { key: 'ArrowLeft' });

  assert.equal(game.run('emptyCells().length'), 0);
  assert.equal(game.run('state.over'), true);
  assert.equal(game.elements.get('message-text').textContent, 'Game over');
  assert.equal(game.elements.get('message').classList.contains('hidden'), false);
  assert.equal(game.elements.get('continue-btn').hidden, true);

  const before = game.run('JSON.stringify(state)');
  game.document.dispatch('keydown', { key: 'ArrowRight' });
  assert.equal(game.run('JSON.stringify(state)'), before);
});
