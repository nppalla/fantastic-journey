'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

const source = readFileSync(join(__dirname, 'game.js'), 'utf8');

function loadGame() {
  function createElement() {
    const classes = new Set();
    return {
      style: {},
      offsetWidth: 100,
      classList: {
        add: (name) => classes.add(name),
        remove: (name) => classes.delete(name),
        contains: (name) => classes.has(name),
      },
      addEventListener() {},
      appendChild() {},
    };
  }

  const elements = new Map([
    'board', 'score', 'best', 'message', 'message-text',
    'continue-btn', 'retry-btn', 'undo-btn', 'new-btn',
  ].map((id) => [id, createElement()]));
  const sandbox = vm.createContext({
    document: {
      getElementById: (id) => elements.get(id),
      createElement,
      addEventListener() {},
    },
    localStorage: {
      getItem: () => null,
      setItem() {},
    },
  });
  const run = (code) => vm.runInContext(code, sandbox);
  run(source);
  run('Math.random = () => 0');
  return { elements, run };
}

function setGrid(game, grid) {
  game.run(`state.grid = ${JSON.stringify(grid)}`);
}

const blockedGrid = [
  [2, 4, 2, 4],
  [4, 2, 4, 2],
  [2, 4, 2, 4],
  [4, 2, 4, 2],
];

test('an empty cell anywhere keeps the game playable', () => {
  const game = loadGame();
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      const grid = blockedGrid.map((row) => row.slice());
      grid[r][c] = 0;
      setGrid(game, grid);
      assert.equal(game.run('isGameOver()'), false, `empty cell at ${r},${c}`);
    }
  }
  game.run('state.grid = emptyGrid()');
  assert.equal(game.run('isGameOver()'), false);
});

for (const [direction, dr, dc] of [['horizontal', 0, 1], ['vertical', 1, 0]]) {
  test(`a full board with a ${direction} merge anywhere remains playable`, () => {
    const game = loadGame();
    for (let r = 0; r < 4 - dr; r++) {
      for (let c = 0; c < 4 - dc; c++) {
        const grid = Array.from({ length: 4 }, (_, row) =>
          Array.from({ length: 4 }, (_, col) => 2 ** (row * 4 + col + 1)));
        grid[r + dr][c + dc] = grid[r][c];
        setGrid(game, grid);
        assert.equal(game.run('isGameOver()'), false, `merge at ${r},${c}`);
        assert.deepEqual(JSON.parse(game.run('JSON.stringify(state.grid)')), grid);
      }
    }
  });
}

test('a full board with only diagonal or row-wrapped matches is game over', () => {
  const game = loadGame();
  setGrid(game, blockedGrid);
  assert.equal(game.run('isGameOver()'), true);
  assert.deepEqual(JSON.parse(game.run('JSON.stringify(state.grid)')), blockedGrid);
});

for (const [direction, firstRow, secondRow] of [
  ['horizontal', [0, 4, 8, 2], [16, 32, 64, 128]],
  ['vertical', [0, 2, 4, 8], [16, 32, 64, 2]],
]) {
  test(`filling the last empty cell with a ${direction} merge does not end play`, () => {
    const game = loadGame();
    setGrid(game, [firstRow, secondRow, [32, 64, 128, 256], [64, 128, 256, 512]]);
    game.run("move('left')");
    assert.equal(game.run('emptyCells().length'), 0);
    assert.equal(game.run('state.over'), false);
    assert.equal(game.elements.get('message').classList.contains('hidden'), true);

    const grid = game.run('JSON.stringify(state.grid)');
    game.run(`move('${direction === 'horizontal' ? 'left' : 'up'}')`);
    assert.equal(game.run('state.score'), 4);
    assert.equal(game.run('state.history.length'), 2);
    assert.notEqual(game.run('JSON.stringify(state.grid)'), grid);
  });
}

test('filling the last empty cell without a merge ends play and shows game over', () => {
  const game = loadGame();
  setGrid(game, [[0, 2, 4, 8], [16, 32, 64, 128], [32, 64, 128, 256], [64, 128, 256, 512]]);
  game.run("move('left')");
  assert.equal(game.run('emptyCells().length'), 0);
  assert.equal(game.run('state.over'), true);
  assert.equal(game.elements.get('message-text').textContent, 'Game over');
  assert.equal(game.elements.get('message').classList.contains('hidden'), false);
  assert.equal(game.elements.get('continue-btn').hidden, true);

  const grid = game.run('JSON.stringify(state.grid)');
  game.run("move('right')");
  assert.equal(game.run('JSON.stringify(state.grid)'), grid);
});
