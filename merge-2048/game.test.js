'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

const source = readFileSync(join(__dirname, 'game.js'), 'utf8');
const BEST_KEY = 'merge2048.best';

function loadGame(storage = new Map()) {
  const writes = [];
  function createElement() {
    const listeners = new Map();
    const classes = new Set();
    let textContent = '';
    return {
      style: {},
      offsetWidth: 100,
      get textContent() { return textContent; },
      set textContent(value) { textContent = String(value); },
      classList: {
        add: (name) => classes.add(name),
        remove: (name) => classes.delete(name),
      },
      appendChild() {},
      addEventListener(name, callback) {
        listeners.set(name, callback);
      },
      dispatch(name, event) {
        listeners.get(name)?.(event);
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
  const sandbox = vm.createContext({
    document,
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem(key, value) {
        writes.push({ key, value });
        storage.set(key, String(value));
      },
    },
  });
  const run = (code) => vm.runInContext(code, sandbox);
  run(source);
  return { elements, run, storage, writes };
}

function prepareMerge(game) {
  game.run('state.grid = [[2, 2, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]');
}

test('each new best is saved immediately, before game over', () => {
  const game = loadGame();
  assert.equal(game.writes.length, 0);

  for (const expected of [4, 8]) {
    prepareMerge(game);
    game.run("move('left')");
    assert.equal(game.run('state.over'), false);
    assert.equal(game.run('state.best'), expected);
    assert.equal(game.elements.get('best').textContent, String(expected));
    assert.equal(game.storage.get(BEST_KEY), String(expected));
  }
  assert.deepEqual(game.writes, [
    { key: BEST_KEY, value: '4' },
    { key: BEST_KEY, value: '8' },
  ]);
});

test('reloading before game over restores the latest best', () => {
  const game = loadGame();
  prepareMerge(game);
  game.run("move('left')");

  const reloaded = loadGame(game.storage);
  assert.equal(reloaded.run('state.score'), 0);
  assert.equal(reloaded.run('state.best'), 4);
  assert.equal(reloaded.elements.get('best').textContent, '4');
  assert.equal(reloaded.writes.length, 0);
});

for (const button of ['new-btn', 'retry-btn']) {
  test(`${button} resets the score without losing the saved best`, () => {
    const game = loadGame();
    prepareMerge(game);
    game.run("move('left')");
    game.elements.get(button).dispatch('click');

    assert.equal(game.run('state.score'), 0);
    assert.equal(game.run('state.best'), 4);
    assert.equal(game.elements.get('best').textContent, '4');
    assert.equal(game.storage.get(BEST_KEY), '4');
    assert.equal(loadGame(game.storage).run('state.best'), 4);
    assert.equal(game.writes.length, 1);
  });
}

test('moves below or equal to an existing best do not overwrite it', () => {
  const game = loadGame(new Map([[BEST_KEY, '8']]));
  for (let i = 0; i < 2; i++) {
    prepareMerge(game);
    game.run("move('left')");
  }
  assert.equal(game.run('state.score'), 8);
  assert.equal(game.run('state.best'), 8);
  assert.equal(game.storage.get(BEST_KEY), '8');
  assert.equal(game.elements.get('best').textContent, '8');
  assert.equal(game.writes.length, 0);
});

test('a move without a merge does not write the best score', () => {
  const game = loadGame();
  game.run('state.grid = [[0, 2, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]');
  game.run("move('left')");
  assert.equal(game.run('state.score'), 0);
  assert.equal(game.run('state.best'), 0);
  assert.equal(game.writes.length, 0);
});

test('undo does not discard the saved best', () => {
  const game = loadGame();
  prepareMerge(game);
  game.run("move('left')");
  game.elements.get('undo-btn').dispatch('click');
  assert.equal(game.run('state.best'), 4);
  assert.equal(game.storage.get(BEST_KEY), '4');
  assert.equal(loadGame(game.storage).run('state.best'), 4);
  assert.equal(game.writes.length, 1);
});

test('a winning move saves its best score before showing the win message', () => {
  const game = loadGame();
  game.run('state.grid = [[2048, 2048, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]');
  game.run("move('left')");
  assert.equal(game.run('state.won'), true);
  assert.equal(game.run('state.over'), false);
  assert.equal(game.storage.get(BEST_KEY), '4096');
  assert.equal(game.elements.get('message-text').textContent, 'You win!');
  assert.equal(game.writes.length, 1);
});

test('game over without a new record does not rewrite the saved best', () => {
  const game = loadGame(new Map([[BEST_KEY, '100']]));
  game.run('state.grid = [[0, 2, 4, 8], [16, 32, 64, 128], [256, 512, 1024, 2], [4, 8, 16, 32]]');
  game.run("move('left')");
  assert.equal(game.run('state.over'), true);
  assert.equal(game.storage.get(BEST_KEY), '100');
  assert.equal(game.elements.get('message-text').textContent, 'Game over');
  assert.equal(game.writes.length, 0);
});
