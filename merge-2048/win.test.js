'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

const filename = join(__dirname, 'game.js');
const source = readFileSync(filename, 'utf8');

function createGame(grid) {
  function createElement() {
    const classes = new Set();
    const listeners = new Map();
    return {
      style: {},
      hidden: false,
      offsetWidth: 100,
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
        assert.ok(listeners.has(name), `Missing ${name} listener`);
        listeners.get(name)(event);
      },
    };
  }

  const elements = new Map();
  const context = vm.createContext({
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
  const run = (code) => vm.runInContext(code, context, { filename });
  run('Math.random = () => 0;');
  run(source);
  const game = run('({ state, hasWon, move })');
  game.state.grid = grid.map((row) => row.slice());
  return { ...game, elements };
}

function emptyGrid() {
  return Array.from({ length: 4 }, () => Array(4).fill(0));
}

function assertWin(game) {
  assert.equal(game.state.won, true);
  assert.equal(game.state.over, false);
  assert.equal(game.elements.get('message-text').textContent, 'You win!');
  assert.equal(game.elements.get('message').classList.contains('hidden'), false);
  assert.equal(game.elements.get('continue-btn').hidden, false);
  assert.equal(game.elements.get('retry-btn').hidden, false);
}

for (const { value, expected } of [
  { value: 0, expected: false },
  { value: 1024, expected: false },
  { value: 2048, expected: true },
  { value: 4096, expected: true },
]) {
  test(`a ${value} tile ${expected ? 'meets' : 'does not meet'} the win threshold`, () => {
    const grid = emptyGrid();
    grid[0][0] = value;
    assert.equal(createGame(grid).hasWon(), expected);
  });
}

test('an exact 2048 tile wins in every board position', () => {
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      const grid = emptyGrid();
      grid[r][c] = 2048;
      assert.equal(createGame(grid).hasWon(), true, `Tile at row ${r}, column ${c}`);
    }
  }
});

test('multiple sub-threshold tiles do not count as a win before merging', () => {
  const grid = Array.from({ length: 4 }, () => Array(4).fill(1024));
  assert.equal(createGame(grid).hasWon(), false);
});

for (const direction of ['left', 'right', 'up', 'down']) {
  test(`merging 1024 tiles ${direction} shows the win message at 2048`, () => {
    const grid = emptyGrid();
    grid[0][0] = 1024;
    if (direction === 'up' || direction === 'down') grid[1][0] = 1024;
    else grid[0][1] = 1024;
    const game = createGame(grid);

    game.move(direction);

    assertWin(game);
    assert.equal(game.state.grid.flat().filter((value) => value === 2048).length, 1);
    assert.equal(game.state.score, 2048);
    assert.equal(game.elements.get('score').textContent, 2048);
    assert.equal(game.state.history.length, 1);
  });
}

function winningGame() {
  const grid = emptyGrid();
  grid[0] = [1024, 1024, 0, 0];
  const game = createGame(grid);
  game.move('left');
  return game;
}

test('winning blocks further moves until Keep going is chosen', () => {
  const game = winningGame();
  const before = JSON.stringify(game.state);

  game.move('right');

  assert.equal(JSON.stringify(game.state), before);
  assertWin(game);
});

test('Keep going dismisses the win message and allows further moves without repeating it', () => {
  const game = winningGame();
  const before = JSON.stringify(game.state.grid);

  game.elements.get('continue-btn').dispatch('click');
  game.move('right');

  assert.equal(game.state.keepPlaying, true);
  assert.equal(game.state.won, true);
  assert.equal(game.state.over, false);
  assert.equal(game.elements.get('message').classList.contains('hidden'), true);
  assert.notEqual(JSON.stringify(game.state.grid), before);
  assert.equal(game.state.history.length, 2);
  assert.equal(game.state.score, 2048);
});

test('Try again starts a fresh game after winning', () => {
  const game = winningGame();
  game.elements.get('retry-btn').dispatch('click');

  assert.equal(game.state.won, false);
  assert.equal(game.state.keepPlaying, false);
  assert.equal(game.state.over, false);
  assert.equal(game.state.score, 0);
  assert.equal(game.state.best, 2048);
  assert.equal(game.state.history.length, 0);
  assert.equal(game.state.grid.flat().filter((value) => value !== 0).length, 2);
  assert.equal(game.elements.get('message').classList.contains('hidden'), true);
});

test('reaching 2048 takes priority over a full-board game-over message', () => {
  const game = createGame([
    [2, 4, 8, 16],
    [4, 8, 16, 32],
    [8, 16, 32, 64],
    [1024, 1024, 128, 256],
  ]);
  game.move('left');

  assert.equal(game.state.grid.flat().includes(0), false);
  assertWin(game);
});

test('a merge producing 1024 does not show the win message', () => {
  const grid = emptyGrid();
  grid[0] = [512, 512, 0, 0];
  const game = createGame(grid);
  game.move('left');

  assert.equal(game.state.won, false);
  assert.equal(game.state.score, 1024);
  assert.equal(game.elements.get('message').classList.contains('hidden'), true);
});

test('a merge producing a tile above 2048 still shows the win message', () => {
  const grid = emptyGrid();
  grid[0] = [2048, 2048, 0, 0];
  const game = createGame(grid);
  game.move('left');

  assertWin(game);
  assert.equal(game.state.score, 4096);
});
