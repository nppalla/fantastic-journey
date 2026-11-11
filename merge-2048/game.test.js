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

function loadGame(grid) {
  function createElement() {
    const classes = new Set();
    return {
      classList: {
        add: (name) => classes.add(name),
        remove: (name) => classes.delete(name),
        contains: (name) => classes.has(name),
      },
      style: {},
      offsetWidth: 100,
      appendChild() {},
      addEventListener() {},
    };
  }

  const elements = new Map([
    'board', 'score', 'best', 'message', 'message-text',
    'continue-btn', 'retry-btn', 'undo-btn', 'new-btn',
  ].map((id) => [id, createElement()]));
  const storage = new Map();
  const math = Object.create(Math);
  math.random = () => 0;
  const sandbox = vm.createContext({
    document: {
      getElementById: (id) => elements.get(id),
      createElement,
      addEventListener() {},
    },
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    },
    Math: math,
  });
  const run = (code) => vm.runInContext(code, sandbox);
  run(source);
  run(`state.grid = ${JSON.stringify(grid)}`);
  return { elements, run };
}

test('a full board with no equal neighbours is game over without changing the grid', () => {
  const game = loadGame(blockedGrid);
  assert.equal(game.run('isGameOver()'), true);
  assert.equal(game.run('JSON.stringify(state.grid)'), JSON.stringify(blockedGrid));
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
      assert.equal(loadGame(grid).run('isGameOver()'), false);
    });

    for (const [direction, dr, dc] of [['horizontal', 0, 1], ['vertical', 1, 0]]) {
      if (r + dr >= 4 || c + dc >= 4) continue;
      test(`a ${direction} merge at (${r}, ${c}) prevents game over`, () => {
        const grid = blockedGrid.map((row) => row.slice());
        grid[r][c] = grid[r + dr][c + dc];
        const game = loadGame(grid);
        assert.equal(game.run('isGameOver()'), false);
        assert.equal(game.run('JSON.stringify(state.grid)'), JSON.stringify(grid));
      });
    }
  }
}

for (const { direction, nextDirection, grid } of [
  {
    direction: 'right',
    nextDirection: 'left',
    grid: [
      [2, 4, 8, 0],
      [8, 16, 32, 64],
      [128, 256, 512, 1024],
      [2, 4, 8, 16],
    ],
  },
  {
    direction: 'down',
    nextDirection: 'up',
    grid: [
      [2, 4, 8, 16],
      [4, 8, 16, 32],
      [8, 16, 32, 64],
      [0, 32, 64, 128],
    ],
  },
]) {
  test(`filling the last empty cell after moving ${direction} allows the next merge`, () => {
    const game = loadGame(grid);
    game.run(`move('${direction}')`);
    assert.equal(game.run('emptyCells().length'), 0);
    assert.equal(game.run('state.over'), false);
    assert.equal(game.elements.get('message').classList.contains('hidden'), true);

    game.run(`move('${nextDirection}')`);
    assert.equal(game.run('state.score > 0'), true);
    assert.equal(game.run('state.over'), false);
  });
}

test('filling the last empty cell without a merge shows game over and blocks further moves', () => {
  const game = loadGame([
    [4, 8, 16, 0],
    [4, 8, 16, 32],
    [8, 16, 32, 64],
    [16, 32, 64, 128],
  ]);
  game.run("move('right')");
  assert.equal(game.run('emptyCells().length'), 0);
  assert.equal(game.run('state.over'), true);
  assert.equal(game.elements.get('message-text').textContent, 'Game over');
  assert.equal(game.elements.get('message').classList.contains('hidden'), false);
  assert.equal(game.elements.get('continue-btn').hidden, true);

  const grid = game.run('JSON.stringify(state.grid)');
  game.run("move('left')");
  assert.equal(game.run('JSON.stringify(state.grid)'), grid);
});
