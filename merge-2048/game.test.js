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
    const listeners = new Map();
    return {
      classList: {
        add: (name) => classes.add(name),
        remove: (name) => classes.delete(name),
        contains: (name) => classes.has(name),
      },
      style: {},
      offsetWidth: 100,
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
  const storage = new Map();
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
    Math: Object.assign(Object.create(Math), { random: () => 0 }),
  });
  const run = (code) => vm.runInContext(code, sandbox);
  run(source);
  return {
    elements,
    run,
    setGrid(grid) {
      run(`state.grid = ${JSON.stringify(grid)}`);
    },
  };
}

function fullGrid() {
  return Array.from({ length: 4 }, (_, r) =>
    Array.from({ length: 4 }, (_, c) => (r + c) % 2 === 0 ? 2 : 4));
}

test('an empty cell at any position keeps the game playable', () => {
  const game = loadGame();
  assert.equal(game.run('isGameOver()'), false);
  game.run('state.grid = emptyGrid()');
  assert.equal(game.run('isGameOver()'), false);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      const grid = fullGrid();
      grid[r][c] = 0;
      game.setGrid(grid);
      assert.equal(game.run('isGameOver()'), false, `empty cell at ${r},${c}`);
    }
  }
});

for (const direction of ['horizontal', 'vertical']) {
  test(`every ${direction} equal-neighbour pair keeps a full board playable`, () => {
    const game = loadGame();
    const dr = direction === 'vertical' ? 1 : 0;
    const dc = direction === 'horizontal' ? 1 : 0;
    for (let r = 0; r < 4 - dr; r++) {
      for (let c = 0; c < 4 - dc; c++) {
        const grid = Array.from({ length: 4 }, (_, r) =>
          Array.from({ length: 4 }, (_, c) => 2 ** (r * 4 + c + 1)));
        grid[r + dr][c + dc] = grid[r][c];
        game.setGrid(grid);
        assert.equal(game.run('isGameOver()'), false, `pair at ${r},${c}`);
        assert.equal(game.run('JSON.stringify(state.grid)'), JSON.stringify(grid));
      }
    }
  });
}

test('a full board with only diagonal or row-wrap matches is game over', () => {
  const game = loadGame();
  const grid = fullGrid();
  game.setGrid(grid);
  assert.equal(game.run('isGameOver()'), true);
  assert.equal(game.run('JSON.stringify(state.grid)'), JSON.stringify(grid));
});

for (const merge of ['horizontal', 'vertical', 'none']) {
  test(`filling the last empty cell with ${merge} merges updates game-over state and overlay`, () => {
    const game = loadGame();
    const grid = [
      [0, 4, 8, 16],
      [8, 16, 32, 4],
      [16, 32, 4, 8],
      [32, 4, 8, 16],
    ];
    if (merge === 'horizontal') grid[0][3] = 2;
    if (merge === 'vertical') grid[1][3] = 2;
    game.setGrid(grid);
    game.run("move('left')");
    assert.equal(game.run('emptyCells().length'), 0);
    assert.equal(game.run('state.grid[0][3]'), 2);
    assert.equal(game.run('state.over'), merge === 'none');
    assert.equal(game.elements.get('message').classList.contains('hidden'), merge !== 'none');

    if (merge === 'none') {
      assert.equal(game.elements.get('message-text').textContent, 'Game over');
      assert.equal(game.elements.get('continue-btn').hidden, true);
      const finalGrid = game.run('JSON.stringify(state.grid)');
      game.run("move('up')");
      assert.equal(game.run('JSON.stringify(state.grid)'), finalGrid);
    } else {
      game.run(`move('${merge === 'horizontal' ? 'right' : 'down'}')`);
      assert.equal(game.run('state.score'), 4);
      assert.equal(game.run('state.history.length'), 2);
    }
  });
}

for (const value of [1024, 2048, 4096]) {
  test(`win detection checks a ${value} tile at every board position`, () => {
    const game = loadGame();
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        const grid = Array.from({ length: 4 }, () => Array(4).fill(0));
        grid[r][c] = value;
        game.setGrid(grid);
        assert.equal(game.run('hasWon()'), value >= 2048, `tile at ${r},${c}`);
        assert.equal(game.run('JSON.stringify(state.grid)'), JSON.stringify(grid));
      }
    }
  });
}

for (const direction of ['left', 'right', 'up', 'down']) {
  test(`merging two 1024 tiles ${direction} shows the win message and pauses moves`, () => {
    const game = loadGame();
    const grid = Array.from({ length: 4 }, () => Array(4).fill(0));
    grid[0][0] = 1024;
    if (direction === 'left' || direction === 'right') grid[0][1] = 1024;
    else grid[1][0] = 1024;
    game.setGrid(grid);
    game.run(`move('${direction}')`);

    assert.equal(game.run('state.grid.flat().includes(2048)'), true);
    assert.equal(game.run('state.score'), 2048);
    assert.equal(game.run('state.won'), true);
    assert.equal(game.run('state.over'), false);
    assert.equal(game.elements.get('message-text').textContent, 'You win!');
    assert.equal(game.elements.get('message').classList.contains('hidden'), false);
    assert.equal(game.elements.get('continue-btn').hidden, false);

    const winningState = game.run('JSON.stringify(state)');
    game.run(`move('${direction}')`);
    assert.equal(game.run('JSON.stringify(state)'), winningState);
  });
}

test('Keep going resumes play without repeating the win message, and Try again resets the game', () => {
  const game = loadGame();
  game.setGrid([
    [1024, 1024, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ]);
  game.run("move('left')");
  assert.equal(game.run('state.won'), true);
  game.elements.get('continue-btn').dispatch('click');
  assert.equal(game.run('state.keepPlaying'), true);
  assert.equal(game.elements.get('message').classList.contains('hidden'), true);
  game.run("move('right')");
  assert.equal(game.run('state.history.length'), 2);
  assert.equal(game.run('state.won'), true);
  assert.equal(game.elements.get('message').classList.contains('hidden'), true);

  game.elements.get('retry-btn').dispatch('click');
  assert.equal(game.run('state.won'), false);
  assert.equal(game.run('state.keepPlaying'), false);
  assert.equal(game.run('state.over'), false);
  assert.equal(game.run('state.score'), 0);
  assert.equal(game.run('state.history.length'), 0);
  assert.equal(game.run('emptyCells().length'), 14);
  assert.equal(game.elements.get('message').classList.contains('hidden'), true);
});

test('reaching 2048 on a blocked board shows the win message before game over', () => {
  const game = loadGame();
  game.setGrid([
    [1024, 1024, 8, 16],
    [8, 16, 32, 4],
    [16, 32, 4, 8],
    [32, 4, 8, 16],
  ]);
  game.run("move('left')");
  assert.equal(game.run('isGameOver()'), true);
  assert.equal(game.run('state.won'), true);
  assert.equal(game.run('state.over'), false);
  assert.equal(game.elements.get('message-text').textContent, 'You win!');
  assert.equal(game.elements.get('message').classList.contains('hidden'), false);
  assert.equal(game.elements.get('continue-btn').hidden, false);
});
