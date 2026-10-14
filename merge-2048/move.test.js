'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const filename = join(__dirname, 'game.js');
const source = readFileSync(filename, 'utf8');

function createGame(grid) {
  let randomCalls = 0;
  const element = () => ({
    classList: { add() {}, remove() {} },
    style: {},
    offsetWidth: 100,
    appendChild() {},
    addEventListener() {},
  });
  const elements = new Map();
  const context = vm.createContext({
    document: {
      getElementById(id) {
        if (!elements.has(id)) elements.set(id, element());
        return elements.get(id);
      },
      createElement: element,
      addEventListener() {},
    },
    localStorage: { getItem: () => null, setItem() {} },
    random() {
      randomCalls++;
      return 0;
    },
  });
  vm.runInContext('Math.random = random;', context);
  vm.runInContext(source, context, { filename });
  const game = vm.runInContext('({ state, move, undo })', context);
  Object.assign(game.state, {
    grid: grid.map((row) => row.slice()),
    score: 12,
    best: 16,
    newTile: { r: 3, c: 3 },
  });
  randomCalls = 0;
  return { ...game, randomCalls: () => randomCalls };
}

function snapshot(value) {
  return JSON.parse(JSON.stringify(value));
}

function orientedGrid(row, direction) {
  const grid = Array.from({ length: 4 }, () => Array(4).fill(0));
  const values = direction === 'right' || direction === 'down' ? row.slice().reverse() : row;
  if (direction === 'up' || direction === 'down') {
    values.forEach((value, r) => { grid[r][0] = value; });
  } else {
    grid[0] = values.slice();
  }
  return grid;
}

function addExpectedTile(grid) {
  const index = grid.flat().indexOf(0);
  grid[Math.floor(index / 4)][index % 4] = 2;
  return grid;
}

for (const direction of ['left', 'right', 'up', 'down']) {
  test(`blocked ${direction} moves leave all game state unchanged`, () => {
    const game = createGame(orientedGrid([2, 4, 0, 0], direction));
    const before = snapshot(game.state);
    const grid = game.state.grid;

    for (let i = 0; i < 5; i++) game.move(direction);

    assert.deepEqual(snapshot(game.state), before);
    assert.equal(game.state.grid, grid);
    assert.equal(game.randomCalls(), 0, 'No random tile should be generated');
  });

  test(`valid ${direction} slides spawn exactly one tile and save one undo entry`, () => {
    const grid = orientedGrid([0, 2, 0, 0], direction);
    const game = createGame(grid);

    game.move(direction);

    assert.deepEqual(snapshot(game.state.grid), addExpectedTile(orientedGrid([2, 0, 0, 0], direction)));
    assert.deepEqual(snapshot(game.state.history), [{ grid }]);
    assert.equal(game.state.score, 12);
    assert.equal(game.state.best, 16);
    assert.equal(game.randomCalls(), 2);
  });

  test(`${direction} merges still score and spawn exactly one tile`, () => {
    const grid = orientedGrid([2, 2, 0, 0], direction);
    const game = createGame(grid);
    game.state.best = 12;

    game.move(direction);

    assert.deepEqual(snapshot(game.state.grid), addExpectedTile(orientedGrid([4, 0, 0, 0], direction)));
    assert.deepEqual(snapshot(game.state.history), [{ grid }]);
    assert.equal(game.state.score, 16);
    assert.equal(game.state.best, 16);
    assert.equal(game.randomCalls(), 2);
  });
}

test('a blocked move does not consume an undo step after a valid move', () => {
  const grid = orientedGrid([0, 2, 4, 0], 'left');
  const game = createGame(grid);
  game.move('left');
  const before = snapshot(game.state);

  game.move('left');

  assert.deepEqual(snapshot(game.state), before);
  assert.equal(game.randomCalls(), 2);
  game.undo();
  assert.deepEqual(snapshot(game.state.grid), grid);
  assert.equal(game.state.history.length, 0);
});

for (const flag of ['over', 'won']) {
  test(`${flag} games still ignore moves`, () => {
    const game = createGame(orientedGrid([0, 2, 0, 0], 'left'));
    game.state[flag] = true;
    const before = snapshot(game.state);

    game.move('left');

    assert.deepEqual(snapshot(game.state), before);
    assert.equal(game.randomCalls(), 0);
  });
}

test('Keep going still permits valid moves after winning', () => {
  const game = createGame(orientedGrid([0, 2, 0, 0], 'left'));
  game.state.won = true;
  game.state.keepPlaying = true;

  game.move('left');

  assert.deepEqual(snapshot(game.state.grid), addExpectedTile(orientedGrid([2, 0, 0, 0], 'left')));
  assert.equal(game.state.history.length, 1);
  assert.equal(game.randomCalls(), 2);
});
