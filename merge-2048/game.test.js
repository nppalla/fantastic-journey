'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

function loadGame() {
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
      addEventListener: (name, listener) => listeners.set(name, listener),
      click() { listeners.get('click')(); },
    };
  }
  const elements = new Map();
  for (const id of [
    'board', 'score', 'best', 'message', 'message-text',
    'continue-btn', 'retry-btn', 'undo-btn', 'new-btn',
  ]) elements.set(id, createElement());
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
  });
  const run = (code) => vm.runInContext(code, sandbox);
  run(readFileSync(join(__dirname, 'game.js'), 'utf8'));
  return { elements, run };
}

for (const [value, expected] of [[1024, false], [2048, true], [4096, true]]) {
  test(`win detection at ${value} is ${expected}`, () => {
    const game = loadGame();
    game.run(`state.grid = emptyGrid(); state.grid[3][3] = ${value}`);
    assert.equal(game.run('hasWon()'), expected);
  });
}

for (const direction of ['left', 'right', 'up', 'down']) {
  test(`merging two 1024 tiles ${direction} shows the win message and allows continuing`, () => {
    const game = loadGame();
    game.run(`
      state.grid = emptyGrid();
      state.grid[0][0] = 1024;
      state.grid[${direction === 'up' || direction === 'down' ? 1 : 0}]
        [${direction === 'up' || direction === 'down' ? 0 : 1}] = 1024;
      move('${direction}');
    `);
    const message = game.elements.get('message');
    assert.equal(game.run('state.won'), true);
    assert.equal(game.run('state.over'), false);
    assert.equal(game.run('state.score'), 2048);
    assert.equal(game.elements.get('message-text').textContent, 'You win!');
    assert.equal(message.classList.contains('hidden'), false);
    assert.equal(game.elements.get('continue-btn').hidden, false);

    const wonGrid = game.run('JSON.stringify(state.grid)');
    game.run("move('left')");
    assert.equal(game.run('JSON.stringify(state.grid)'), wonGrid, 'Winning pauses moves');
    game.elements.get('continue-btn').click();
    assert.equal(game.run('state.keepPlaying'), true);
    assert.equal(message.classList.contains('hidden'), true);
    game.run("move('left')");
    assert.equal(message.classList.contains('hidden'), true, 'Continuing does not repeat the win message');
    game.elements.get('retry-btn').click();
    assert.equal(game.run('state.won'), false);
    assert.equal(game.run('state.keepPlaying'), false);
    assert.equal(game.run('state.score'), 0);
    assert.equal(game.run('emptyCells().length'), 14);
    assert.equal(message.classList.contains('hidden'), true);
  });
}
