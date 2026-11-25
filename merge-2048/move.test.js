'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

const filename = join(__dirname, 'game.js');
const source = readFileSync(filename, 'utf8');
const directions = ['left', 'right', 'up', 'down'];

function createGame(grid) {
  const metrics = { randomCalls: 0, createdElements: 0, storageWrites: 0 };
  function createElement() {
    const listeners = new Map();
    return {
      classList: { add() {}, remove() {} },
      style: {},
      offsetWidth: 100,
      appendChild() {},
      addEventListener(name, callback) {
        listeners.set(name, callback);
      },
      dispatch(name, event) {
        assert.ok(listeners.has(name), `Missing ${name} listener`);
        listeners.get(name)(event);
      },
    };
  }

  const elements = new Map();
  const document = Object.assign(createElement(), {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, createElement());
      return elements.get(id);
    },
    createElement() {
      metrics.createdElements++;
      return createElement();
    },
  });
  const context = vm.createContext({
    document,
    localStorage: {
      getItem: () => null,
      setItem() { metrics.storageWrites++; },
    },
    random() {
      metrics.randomCalls++;
      return 0;
    },
  });
  const run = (code) => vm.runInContext(code, context, { filename });
  run('Math.random = random;');
  run(source);
  const game = run('({ state, move, undo })');
  Object.assign(game.state, {
    grid: grid.map((row) => row.slice()),
    score: 12,
    best: 16,
    newTile: { r: 3, c: 3 },
  });
  run('render();');
  Object.keys(metrics).forEach((key) => { metrics[key] = 0; });
  return { ...game, run, metrics, elements, document };
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

function assertUnchanged(game, action) {
  const before = snapshot(game.state);
  const grid = game.state.grid;
  const history = game.state.history;
  const undoDisabled = game.elements.get('undo-btn').disabled;
  const metrics = { ...game.metrics };

  for (let i = 0; i < 5; i++) action();

  assert.deepEqual(snapshot(game.state), before);
  assert.equal(game.state.grid, grid);
  assert.equal(game.state.history, history);
  assert.equal(game.elements.get('undo-btn').disabled, undoDisabled);
  assert.deepEqual(game.metrics, metrics, 'No spawning, rendering, or storage writes');
}

for (const direction of directions) {
  test(`blocked ${direction} moves leave all game state unchanged`, () => {
    const game = createGame(orientedGrid([2, 4, 0, 0], direction));
    assertUnchanged(game, () => game.move(direction));
  });

  test(`blocked ${direction} arrow keys do not count as moves`, () => {
    const game = createGame(orientedGrid([2, 4, 0, 0], direction));
    const key = `Arrow${direction[0].toUpperCase()}${direction.slice(1)}`;
    assertUnchanged(game, () => game.document.dispatch('keydown', { key }));
  });

  test(`blocked ${direction} swipes do not count as moves`, () => {
    const game = createGame(orientedGrid([2, 4, 0, 0], direction));
    const board = game.elements.get('board');
    const end = {
      left: { clientX: 0, clientY: 50 },
      right: { clientX: 100, clientY: 50 },
      up: { clientX: 50, clientY: 0 },
      down: { clientX: 50, clientY: 100 },
    }[direction];
    assertUnchanged(game, () => {
      board.dispatch('touchstart', { touches: [{ clientX: 50, clientY: 50 }] });
      board.dispatch('touchend', { changedTouches: [end] });
    });
  });

  test(`valid ${direction} slides spawn one tile and save one undo entry`, () => {
    const grid = orientedGrid([0, 2, 0, 0], direction);
    const game = createGame(grid);
    game.move(direction);

    assert.deepEqual(snapshot(game.state.grid), addExpectedTile(orientedGrid([2, 0, 0, 0], direction)));
    assert.deepEqual(snapshot(game.state.history), [{ grid }]);
    assert.equal(game.state.score, 12);
    assert.equal(game.state.best, 16);
    assert.equal(game.metrics.randomCalls, 2);
    assert.equal(game.elements.get('score').textContent, 12);
    assert.equal(game.elements.get('undo-btn').disabled, false);

    game.undo();
    assert.deepEqual(snapshot(game.state.grid), grid);
    assert.equal(game.state.history.length, 0);
    assert.equal(game.elements.get('undo-btn').disabled, true);
  });

  test(`${direction} merges still score and spawn one tile`, () => {
    const grid = orientedGrid([2, 2, 0, 0], direction);
    const game = createGame(grid);
    game.state.best = 12;
    game.move(direction);

    assert.deepEqual(snapshot(game.state.grid), addExpectedTile(orientedGrid([4, 0, 0, 0], direction)));
    assert.deepEqual(snapshot(game.state.history), [{ grid }]);
    assert.equal(game.state.score, 16);
    assert.equal(game.state.best, 16);
    assert.equal(game.metrics.randomCalls, 2);
    assert.equal(game.elements.get('score').textContent, 16);
    assert.equal(game.elements.get('best').textContent, 16);
  });
}

test('a blocked move preserves the undo step from the last valid move', () => {
  const grid = orientedGrid([0, 2, 4, 0], 'left');
  const game = createGame(grid);
  game.move('left');
  assertUnchanged(game, () => game.move('left'));

  game.undo();
  assert.deepEqual(snapshot(game.state.grid), grid);
  assert.equal(game.state.history.length, 0);
});

for (const flag of ['over', 'won']) {
  test(`${flag} games still ignore moves`, () => {
    const game = createGame(orientedGrid([0, 2, 0, 0], 'left'));
    game.state[flag] = true;
    assertUnchanged(game, () => game.move('left'));
  });
}

test('Keep going still permits valid moves after winning', () => {
  const game = createGame(orientedGrid([0, 2, 0, 0], 'left'));
  game.state.won = true;
  game.state.keepPlaying = true;
  game.move('left');

  assert.deepEqual(snapshot(game.state.grid), addExpectedTile(orientedGrid([2, 0, 0, 0], 'left')));
  assert.equal(game.state.history.length, 1);
  assert.equal(game.metrics.randomCalls, 2);
});
