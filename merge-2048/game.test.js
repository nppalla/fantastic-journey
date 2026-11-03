'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

const source = readFileSync(join(__dirname, 'game.js'), 'utf8');

function loadGame() {
  function createElement() {
    return {
      style: {},
      classList: { add() {}, remove() {} },
      appendChild() {},
      addEventListener() {},
    };
  }

  const elements = new Map();
  const sandbox = vm.createContext({
    document: {
      getElementById(id) {
        if (!elements.has(id)) elements.set(id, createElement());
        return elements.get(id);
      },
      createElement,
      addEventListener() {},
    },
    localStorage: { getItem: () => null, setItem() {} },
  });
  const run = (code) => vm.runInContext(code, sandbox);
  run(source);

  return {
    run,
    read: (code) => JSON.parse(run(`JSON.stringify(${code})`)),
  };
}

for (const { row, expected, gained } of [
  { row: [0, 0, 0, 0], expected: [0, 0, 0, 0], gained: 0 },
  { row: [0, 0, 2, 0], expected: [2, 0, 0, 0], gained: 0 },
  { row: [2, 4, 8, 16], expected: [2, 4, 8, 16], gained: 0 },
  { row: [0, 2, 0, 2], expected: [4, 0, 0, 0], gained: 4 },
  { row: [2, 2, 4, 0], expected: [4, 4, 0, 0], gained: 4 },
  { row: [2, 2, 2, 2], expected: [4, 4, 0, 0], gained: 8 },
  { row: [2, 2, 4, 4], expected: [4, 8, 0, 0], gained: 12 },
  { row: [2, 2, 4, 8], expected: [4, 4, 8, 0], gained: 4 },
  { row: [4, 0, 2, 2], expected: [4, 4, 0, 0], gained: 4 },
  { row: [2, 2, 2, 0], expected: [4, 2, 0, 0], gained: 4 },
  { row: [4, 4, 8, 0], expected: [8, 8, 0, 0], gained: 8 },
  { row: [1024, 1024, 2048, 0], expected: [2048, 2048, 0, 0], gained: 2048 },
]) {
  test(`slideRow(${JSON.stringify(row)}) merges each tile at most once`, () => {
    const game = loadGame();
    game.run(`const input = ${JSON.stringify(row)};`);

    assert.deepEqual(game.read('slideRow(input)'), { row: expected, gained });
    assert.deepEqual(game.read('input'), row);
  });
}

for (const { direction, input, expected } of [
  {
    direction: 'left',
    input: [[2, 2, 4, 0], [2, 2, 2, 2], [4, 4, 8, 8], [0, 0, 0, 0]],
    expected: [[4, 4, 0, 0], [4, 4, 0, 0], [8, 16, 0, 0], [0, 0, 0, 0]],
  },
  {
    direction: 'right',
    input: [[0, 4, 2, 2], [2, 2, 2, 2], [8, 8, 4, 4], [0, 0, 0, 0]],
    expected: [[0, 0, 4, 4], [0, 0, 4, 4], [0, 0, 16, 8], [0, 0, 0, 0]],
  },
  {
    direction: 'up',
    input: [[2, 2, 4, 0], [2, 2, 4, 0], [4, 2, 8, 0], [0, 2, 8, 0]],
    expected: [[4, 4, 8, 0], [4, 4, 16, 0], [0, 0, 0, 0], [0, 0, 0, 0]],
  },
  {
    direction: 'down',
    input: [[0, 2, 8, 0], [4, 2, 8, 0], [2, 2, 4, 0], [2, 2, 4, 0]],
    expected: [[0, 0, 0, 0], [0, 0, 0, 0], [4, 4, 16, 0], [4, 4, 8, 0]],
  },
]) {
  test(`${direction} merges each tile once and sums all row scores`, () => {
    const game = loadGame();
    game.run(`const input = ${JSON.stringify(input)};`);

    assert.deepEqual(game.read(`moveGrid(input, '${direction}')`), {
      grid: expected,
      gained: 36,
    });
    assert.deepEqual(game.read('input'), input);
  });
}

test('a tile can merge again on the next move, updating the displayed score', () => {
  const game = loadGame();
  game.run(`
    state.grid = [[2, 2, 4, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
    state.score = 10;
    addRandomTile = () => {};
    move('left');
  `);

  assert.deepEqual(game.read('state.grid[0]'), [4, 4, 0, 0]);
  assert.equal(game.run('state.score'), 14);
  assert.equal(game.run('scoreEl.textContent'), 14);

  game.run("move('left')");

  assert.deepEqual(game.read('state.grid[0]'), [8, 0, 0, 0]);
  assert.equal(game.run('state.score'), 22);
  assert.equal(game.run('scoreEl.textContent'), 22);
});

for (const { direction, grid } of [
  { direction: 'left', grid: [[2, 4, 0, 0], [4, 2, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]] },
  { direction: 'right', grid: [[0, 0, 2, 4], [0, 0, 4, 2], [0, 0, 0, 0], [0, 0, 0, 0]] },
  { direction: 'up', grid: [[2, 4, 0, 0], [4, 2, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]] },
  { direction: 'down', grid: [[0, 0, 0, 0], [0, 0, 0, 0], [2, 4, 0, 0], [4, 2, 0, 0]] },
]) {
  test(`blocked ${direction} moves preserve all state without spawning or rendering`, () => {
    const game = loadGame();
    game.run(`
      state.grid = ${JSON.stringify(grid)};
      state.score = 12;
      state.best = 20;
      state.history = [{ grid: emptyGrid() }];
      state.newTile = { r: 0, c: 0 };
      const previousGrid = state.grid;
      const previousState = JSON.stringify(state);
      let spawns = 0;
      let renders = 0;
      addRandomTile = () => { spawns++; };
      render = () => { renders++; };
      for (let i = 0; i < 5; i++) move('${direction}');
    `);

    assert.equal(game.run('JSON.stringify(state)'), game.run('previousState'));
    assert.equal(game.run('state.grid === previousGrid'), true);
    assert.equal(game.run('spawns'), 0);
    assert.equal(game.run('renders'), 0);
  });
}

for (const { direction, expected } of [
  { direction: 'left', expected: [[0, 0, 0, 0], [2, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]] },
  { direction: 'right', expected: [[0, 0, 0, 0], [0, 0, 0, 2], [0, 0, 0, 0], [0, 0, 0, 0]] },
  { direction: 'up', expected: [[0, 2, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]] },
  { direction: 'down', expected: [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 2, 0, 0]] },
]) {
  test(`a ${direction} slide without a merge still spawns one tile and records undo`, () => {
    const game = loadGame();
    const input = [[0, 0, 0, 0], [0, 2, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
    game.run(`
      state.grid = ${JSON.stringify(input)};
      state.score = 10;
      const beforeSpawning = [];
      const spawn = addRandomTile;
      addRandomTile = () => {
        beforeSpawning.push(state.grid.map((row) => row.slice()));
        spawn();
      };
      move('${direction}');
    `);

    assert.deepEqual(game.read('beforeSpawning'), [expected]);
    assert.deepEqual(game.read('state.history'), [{ grid: input }]);
    assert.equal(game.run('emptyCells().length'), 14);
    assert.equal(game.run('state.score'), 10);
    assert.equal(game.run('scoreEl.textContent'), 10);
    assert.equal(game.run('undoBtn.disabled'), false);

    game.run('undo()');
    assert.deepEqual(game.read('state.grid'), input);
    assert.equal(game.run('state.history.length'), 0);
  });
}
