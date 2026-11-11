'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

const source = readFileSync(join(__dirname, 'game.js'), 'utf8');
const blockedGrid = [
  [2, 4, 2, 4],
  [4, 2, 4, 2],
  [2, 4, 2, 4],
  [4, 2, 4, 2],
];

function loadGame(grid) {
  function createElement() {
    const classes = new Set();
    const listeners = new Map();
    return {
      style: {},
      offsetWidth: 100,
      classList: {
        add: (name) => classes.add(name),
        remove: (name) => classes.delete(name),
        contains: (name) => classes.has(name),
      },
      appendChild() {},
      addEventListener(name, callback) {
        if (!listeners.has(name)) listeners.set(name, []);
        listeners.get(name).push(callback);
      },
      dispatch(name, event) {
        for (const callback of listeners.get(name) || []) callback(event);
      },
    };
  }

  const elements = new Map();
  const document = Object.assign(createElement(), {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, createElement());
      return elements.get(id);
    },
    createElement,
  });
  const storage = new Map();
  const sandbox = vm.createContext({
    document,
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    },
  });
  const run = (code) => vm.runInContext(code, sandbox);
  run(source);
  run(`state.grid = ${JSON.stringify(grid)}; state.newTile = null;`);
  return { run, document, elements, storage };
}

test('a full board with only diagonal or row-wrap matches is game over', () => {
  const game = loadGame(blockedGrid);
  const before = game.run('JSON.stringify(state)');
  assert.equal(game.run('isGameOver()'), true);
  assert.equal(game.run('JSON.stringify(state)'), before);
});

test('equal tiles on opposite board edges are not mergeable neighbours', () => {
  const game = loadGame([
    [2, 4, 8, 2],
    [4, 8, 2, 4],
    [8, 2, 4, 8],
    [2, 4, 8, 2],
  ]);
  assert.equal(game.run('isGameOver()'), true);
});

test('an empty board is not game over', () => {
  const game = loadGame(Array.from({ length: 4 }, () => Array(4).fill(0)));
  assert.equal(game.run('isGameOver()'), false);
});

for (let r = 0; r < 4; r++) {
  for (let c = 0; c < 4; c++) {
    test(`an empty cell at (${r}, ${c}) prevents game over`, () => {
      const grid = blockedGrid.map((row) => row.slice());
      grid[r][c] = 0;
      const game = loadGame(grid);
      assert.equal(game.run('isGameOver()'), false);
    });

    for (const { name, dr, dc } of [
      { name: 'horizontal', dr: 0, dc: 1 },
      { name: 'vertical', dr: 1, dc: 0 },
    ]) {
      if (r + dr >= 4 || c + dc >= 4) continue;
      test(`a single ${name} merge at (${r}, ${c}) prevents game over`, () => {
        const grid = Array.from({ length: 4 }, (_, y) =>
          Array.from({ length: 4 }, (_, x) => 2 ** (y * 4 + x + 1)));
        grid[r + dr][c + dc] = grid[r][c];
        const game = loadGame(grid);
        const before = game.run('JSON.stringify(state)');
        assert.equal(game.run('isGameOver()'), false);
        assert.equal(game.run('JSON.stringify(state)'), before);
      });
    }
  }
}

test('filling the last empty cell leaves the game playable when a merge remains', () => {
  const grid = blockedGrid.map((row) => row.slice());
  grid[3] = [0, 4, 2, 4];
  const game = loadGame(grid);
  game.run('Math.random = () => 0.95');
  game.document.dispatch('keydown', { key: 'ArrowLeft' });

  assert.equal(game.run('emptyCells().length'), 0);
  assert.equal(game.run('state.grid[3][2] === state.grid[3][3]'), true);
  assert.equal(game.run('state.over'), false);
  assert.equal(game.elements.get('message').classList.contains('hidden'), true);
  assert.equal(game.storage.has('merge2048.best'), false);

  game.document.dispatch('keydown', { key: 'ArrowLeft' });
  assert.equal(game.run('state.score'), 8);
  assert.equal(game.run('state.grid[3][2]'), 8);
  assert.equal(game.run('state.over'), false);
});

test('filling the last empty cell without a remaining merge shows game over', () => {
  const grid = blockedGrid.map((row) => row.slice());
  grid[3] = [0, 4, 2, 4];
  const game = loadGame(grid);
  game.run('Math.random = () => 0');
  game.document.dispatch('keydown', { key: 'ArrowLeft' });

  assert.deepEqual(JSON.parse(game.run('JSON.stringify(state.grid)')), blockedGrid);
  assert.equal(game.run('state.over'), true);
  assert.equal(game.elements.get('message').classList.contains('hidden'), false);
  assert.equal(game.elements.get('message-text').textContent, 'Game over');
  assert.equal(game.elements.get('continue-btn').hidden, true);
  assert.equal(game.storage.get('merge2048.best'), '0');

  const before = game.run('JSON.stringify(state)');
  game.document.dispatch('keydown', { key: 'ArrowRight' });
  assert.equal(game.run('JSON.stringify(state)'), before);
});

test('filling the last empty cell leaves a vertical merge playable through keyboard input', () => {
  const game = loadGame([
    [0, 4, 8, 4],
    [8, 4, 8, 2],
    [4, 8, 4, 8],
    [8, 4, 8, 4],
  ]);
  game.run('Math.random = () => 0');
  game.document.dispatch('keydown', { key: 'ArrowLeft' });

  assert.equal(game.run('emptyCells().length'), 0);
  assert.equal(game.run('state.grid[0][3] === state.grid[1][3]'), true);
  assert.equal(game.run('state.over'), false);
  assert.equal(game.elements.get('message').classList.contains('hidden'), true);
  assert.equal(game.storage.has('merge2048.best'), false);

  game.document.dispatch('keydown', { key: 'ArrowDown' });
  assert.equal(game.run('state.score'), 4);
  assert.equal(game.run('state.grid[1][3]'), 4);
  assert.equal(game.elements.get('score').textContent, 4);
});
