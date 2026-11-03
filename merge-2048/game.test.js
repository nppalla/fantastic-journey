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
    json: (code) => JSON.parse(run(`JSON.stringify(${code})`)),
  };
}

const rowCases = [
  { row: [2, 2, 4, 0], expected: [4, 4, 0, 0], gained: 4 },
  { row: [2, 2, 2, 2], expected: [4, 4, 0, 0], gained: 8 },
  { row: [4, 4, 8, 0], expected: [8, 8, 0, 0], gained: 8 },
  { row: [4, 0, 4, 8], expected: [8, 8, 0, 0], gained: 8 },
  { row: [2, 2, 4, 4], expected: [4, 8, 0, 0], gained: 12 },
  { row: [2, 2, 2, 0], expected: [4, 2, 0, 0], gained: 4 },
  { row: [4, 2, 2, 0], expected: [4, 4, 0, 0], gained: 4 },
  { row: [1024, 1024, 2048, 0], expected: [2048, 2048, 0, 0], gained: 2048 },
  { row: [2, 4, 2, 4], expected: [2, 4, 2, 4], gained: 0 },
  { row: [0, 2, 0, 0], expected: [2, 0, 0, 0], gained: 0 },
  { row: [0, 0, 0, 0], expected: [0, 0, 0, 0], gained: 0 },
];

for (const { row, expected, gained } of rowCases) {
  test(`sliding ${row} produces ${expected} and gains ${gained} without mutating the input`, () => {
    const game = loadGame();
    game.run(`const input = ${JSON.stringify(row)}`);
    assert.deepEqual(game.json('slideRow(input)'), { row: expected, gained });
    assert.deepEqual(game.json('input'), row);
  });
}

function placeRow(row, direction) {
  const grid = Array.from({ length: 4 }, () => Array(4).fill(0));
  row.forEach((value, i) => {
    if (direction === 'left') grid[0][i] = value;
    if (direction === 'right') grid[0][3 - i] = value;
    if (direction === 'up') grid[i][0] = value;
    if (direction === 'down') grid[3 - i][0] = value;
  });
  return grid;
}

for (const direction of ['left', 'right', 'up', 'down']) {
  for (const { row, expected, gained } of rowCases.slice(0, 2)) {
    test(`moving ${direction} merges ${row} only once per tile`, () => {
      const game = loadGame();
      const grid = placeRow(row, direction);
      game.run(`const input = ${JSON.stringify(grid)}`);
      assert.deepEqual(game.json(`moveGrid(input, '${direction}')`), {
        grid: placeRow(expected, direction),
        gained,
      });
      assert.deepEqual(game.json('input'), grid);
    });
  }

  for (const input of ['keyboard', 'swipe']) {
    test(`${input} moving ${direction} updates the board and score without chain merges`, () => {
      const game = loadGame();
      const grid = placeRow([2, 2, 4, 0], direction);
      game.run(`state.grid = ${JSON.stringify(grid)}; state.score = 10; state.best = 10`);
      if (input === 'keyboard') {
        const key = `Arrow${direction[0].toUpperCase()}${direction.slice(1)}`;
        game.document.dispatch('keydown', { key });
      } else {
        const board = game.elements.get('board');
        board.dispatch('touchstart', { touches: [{ clientX: 100, clientY: 100 }] });
        const offsets = { left: [-60, 0], right: [60, 0], up: [0, -60], down: [0, 60] };
        const [dx, dy] = offsets[direction];
        board.dispatch('touchend', {
          changedTouches: [{ clientX: 100 + dx, clientY: 100 + dy }],
        });
      }

      const actual = game.json('state.grid');
      const expected = placeRow([4, 4, 0, 0], direction);
      const { r, c } = game.json('state.newTile');
      assert.equal(expected[r][c], 0);
      assert.equal(actual[r][c], 2);
      actual[r][c] = 0;
      assert.deepEqual(actual, expected);
      assert.equal(game.run('state.score'), 14);
      assert.equal(game.run('state.best'), 14);
      assert.equal(game.elements.get('score').textContent, 14);
      assert.equal(game.elements.get('best').textContent, 14);
      assert.equal(game.run('state.history.length'), 1);
      assert.deepEqual(game.json('state.history[0].grid'), grid);
    });
  }
}

test('a tile created by a merge can merge again on the next move', () => {
  const game = loadGame();
  game.run('const first = slideRow([2, 2, 4, 0])');
  assert.deepEqual(game.json('first'), { row: [4, 4, 0, 0], gained: 4 });
  assert.deepEqual(game.json('slideRow(first.row)'), { row: [8, 0, 0, 0], gained: 8 });
});

test('moving a full board sums independent merges across rows', () => {
  const game = loadGame();
  const grid = [[2, 2, 4, 0], [2, 2, 2, 2], [4, 0, 4, 8], [2, 4, 2, 4]];
  assert.deepEqual(game.json(`moveGrid(${JSON.stringify(grid)}, 'left')`), {
    grid: [[4, 4, 0, 0], [4, 4, 0, 0], [8, 8, 0, 0], [2, 4, 2, 4]],
    gained: 20,
  });
});
