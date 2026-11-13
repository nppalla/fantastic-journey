'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

const source = readFileSync(join(__dirname, 'game.js'), 'utf8');

function loadGame(best = 0) {
  function createElement() {
    const listeners = new Map();
    const classes = new Set();
    return {
      children: [],
      style: {},
      offsetWidth: 100,
      classList: {
        add: (name) => classes.add(name),
        remove: (name) => classes.delete(name),
        contains: (name) => classes.has(name),
      },
      set innerHTML(value) {
        assert.equal(value, '');
        this.children = [];
      },
      appendChild(child) {
        this.children.push(child);
      },
      addEventListener(name, callback) {
        listeners.set(name, callback);
      },
      dispatch(name, event) {
        listeners.get(name)(event);
      },
    };
  }

  const elements = new Map([
    'board', 'score', 'best', 'message', 'message-text', 'continue-btn',
    'retry-btn', 'undo-btn', 'new-btn',
  ].map((id) => [id, createElement()]));
  const storage = new Map([['merge2048.best', String(best)]]);
  const document = Object.assign(createElement(), {
    getElementById: (id) => elements.get(id),
    createElement,
  });
  const sandbox = vm.createContext({
    document,
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    },
  });
  const run = (code) => vm.runInContext(code, sandbox);
  run('Math.random = () => 0');
  run(source);
  run(`
    state.grid = emptyGrid();
    state.grid[0] = [2, 2, 0, 0];
    render();
  `);
  return {
    elements, document, run,
    snapshot: () => JSON.parse(run('JSON.stringify({ grid: state.grid, score: state.score })')),
    undo: () => elements.get('undo-btn').dispatch('click'),
  };
}

test('undo restores the pre-merge grid, nonzero score, and score display', () => {
  const game = loadGame(100);
  game.run('state.score = 12; render()');
  const before = game.snapshot();

  game.document.dispatch('keydown', { key: 'ArrowLeft' });
  assert.equal(game.run('state.score'), 16);
  assert.equal(Number(game.elements.get('score').textContent), 16);
  assert.equal(game.elements.get('undo-btn').disabled, false);

  game.undo();
  assert.deepEqual(game.snapshot(), before);
  assert.equal(Number(game.elements.get('score').textContent), 12);
  assert.equal(game.run('state.best'), 100);
  assert.equal(Number(game.elements.get('best').textContent), 100);
  assert.equal(game.elements.get('undo-btn').disabled, true);
});

test('repeating a merge after undo does not inflate the score or best score', () => {
  const game = loadGame();
  const before = game.snapshot();

  for (let i = 0; i < 5; i++) {
    game.run("move('left')");
    assert.equal(game.run('state.score'), 4);
    assert.equal(game.run('state.best'), 4);
    game.undo();
    assert.deepEqual(game.snapshot(), before);
    assert.equal(Number(game.elements.get('score').textContent), 0);
    assert.equal(Number(game.elements.get('best').textContent), 4);
  }
});

test('undo restores grid and score snapshots in reverse move order', () => {
  const game = loadGame();
  const snapshots = [];
  for (const direction of ['left', 'right', 'down']) {
    snapshots.push(game.snapshot());
    game.run(`move('${direction}')`);
  }
  assert.equal(game.run('state.history.length'), snapshots.length);

  for (const expected of snapshots.reverse()) {
    game.undo();
    assert.deepEqual(game.snapshot(), expected);
    assert.equal(Number(game.elements.get('score').textContent), expected.score);
  }
  assert.equal(game.elements.get('undo-btn').disabled, true);
});

test('undo with no history leaves the board and score unchanged', () => {
  const game = loadGame();
  game.run('state.score = 12; render()');
  const before = game.snapshot();

  game.run('undo()');
  assert.deepEqual(game.snapshot(), before);
  assert.equal(Number(game.elements.get('score').textContent), 12);
  assert.equal(game.elements.get('undo-btn').disabled, true);
});

test('undo after game over restores the score and resumes the previous board', () => {
  const game = loadGame();
  game.run(`
    state.grid = [
      [2, 2, 8, 16],
      [32, 64, 128, 256],
      [512, 1024, 2, 4],
      [8, 16, 32, 64],
    ];
    state.score = 20;
    render();
  `);
  const before = game.snapshot();
  game.run("move('left')");
  assert.equal(game.run('state.over'), true);
  assert.equal(game.run('state.score'), 24);
  assert.equal(game.elements.get('message').classList.contains('hidden'), false);

  game.undo();
  assert.deepEqual(game.snapshot(), before);
  assert.equal(Number(game.elements.get('score').textContent), 20);
  assert.equal(game.run('state.over'), false);
  assert.equal(game.elements.get('message').classList.contains('hidden'), true);
  assert.equal(game.run('state.best'), 24);
});

test('starting a new game clears score snapshots and prevents undoing the reset', () => {
  const game = loadGame();
  game.run("move('left')");
  assert.equal(game.run('state.score'), 4);

  game.elements.get('new-btn').dispatch('click');
  const fresh = game.snapshot();
  assert.equal(fresh.score, 0);
  assert.equal(game.run('state.history.length'), 0);
  assert.equal(game.elements.get('undo-btn').disabled, true);
  game.run('undo()');
  assert.deepEqual(game.snapshot(), fresh);
});
