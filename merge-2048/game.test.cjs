const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(`${__dirname}/game.js`, 'utf8');

function createGame(score = 0) {
  const elements = new Map();
  function element() {
    return {
      classList: { add() {}, remove() {} },
      style: {},
      offsetWidth: 100,
      appendChild() {},
      addEventListener() {},
    };
  }
  const math = Object.create(Math);
  math.random = () => 0;
  const context = vm.createContext({
    Math: math,
    document: {
      getElementById(id) {
        if (!elements.has(id)) elements.set(id, element());
        return elements.get(id);
      },
      createElement: element,
      addEventListener() {},
    },
    localStorage: { getItem() { return null; }, setItem() {} },
  });
  vm.runInContext(source, context);
  const state = vm.runInContext('state', context);
  state.grid = [
    [2, 2, 0, 0],
    [4, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ];
  state.score = score;
  state.best = score;
  context.render();
  return { state, elements, move: context.move, undo: context.undo, newGame: context.newGame };
}

function copyGrid(state) {
  return JSON.parse(JSON.stringify(state.grid));
}

test('undo restores the pre-move grid and score, including the displayed score', () => {
  const { state, elements, move, undo } = createGame(20);
  const before = copyGrid(state);
  move('left');
  assert.equal(state.score, 24);
  undo();
  assert.deepEqual(copyGrid(state), before);
  assert.equal(state.score, 20);
  assert.equal(String(elements.get('score').textContent), '20');
  assert.equal(state.best, 24);
  assert.equal(elements.get('undo-btn').disabled, true);
});

test('replaying an undone merge does not inflate the score or best score', () => {
  const { state, move, undo } = createGame(20);
  for (let i = 0; i < 10; i++) {
    move('left');
    assert.equal(state.score, 24);
    assert.equal(state.best, 24);
    undo();
    assert.equal(state.score, 20);
  }
});

test('multiple undos restore each move score in reverse order', () => {
  const { state, move, undo } = createGame();
  const initial = copyGrid(state);
  move('left');
  const afterFirst = copyGrid(state);
  assert.equal(state.score, 4);
  move('up');
  assert.equal(state.score, 12);
  undo();
  assert.deepEqual(copyGrid(state), afterFirst);
  assert.equal(state.score, 4);
  undo();
  assert.deepEqual(copyGrid(state), initial);
  assert.equal(state.score, 0);
  assert.equal(state.best, 12);
});

test('undo restores a move that earned no points', () => {
  const { state, move, undo } = createGame(37);
  state.grid[0][1] = 0;
  const before = copyGrid(state);
  move('right');
  assert.equal(state.score, 37);
  undo();
  assert.deepEqual(copyGrid(state), before);
  assert.equal(state.score, 37);
});

test('undo with empty history leaves the grid and score unchanged', () => {
  const { state, move, undo } = createGame(20);
  const before = copyGrid(state);
  undo();
  assert.equal(state.score, 20);
  move('left');
  undo();
  undo();
  assert.deepEqual(copyGrid(state), before);
  assert.equal(state.score, 20);
});

test('undo clears game over while restoring the score', () => {
  const { state, move, undo } = createGame(20);
  move('left');
  state.over = true;
  undo();
  assert.equal(state.over, false);
  assert.equal(state.score, 20);
});

test('starting a new game clears score history', () => {
  const { state, move, undo, newGame } = createGame(20);
  move('left');
  newGame();
  const before = copyGrid(state);
  undo();
  assert.deepEqual(copyGrid(state), before);
  assert.equal(state.score, 0);
  assert.equal(state.history.length, 0);
});
