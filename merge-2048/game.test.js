'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const { createContext, runInContext } = require('node:vm');

const source = readFileSync(join(__dirname, 'game.js'), 'utf8');

function loadGame() {
  const element = () => ({
    style: {},
    classList: { add() {}, remove() {} },
    appendChild() {},
    addEventListener() {},
    offsetWidth: 100,
  });
  const document = new EventTarget();
  document.getElementById = element;
  document.createElement = element;
  const context = createContext({
    document,
    localStorage: { getItem() { return null; }, setItem() {} },
  });
  runInContext(source, context);
  return { document, context };
}

function keydown(document, key) {
  const event = new Event('keydown', { cancelable: true });
  Object.defineProperty(event, 'key', { value: key });
  document.dispatchEvent(event);
  return event;
}

for (const [key, row, column] of [
  ['ArrowUp', 0, 1],
  ['ArrowDown', 3, 1],
  ['ArrowLeft', 1, 0],
  ['ArrowRight', 1, 3],
]) {
  test(`${key} prevents scrolling and moves tiles in the correct direction`, () => {
    const { document, context } = loadGame();
    runInContext('state.grid = emptyGrid(); state.grid[1][1] = 8;', context);

    const event = keydown(document, key);

    assert.equal(event.defaultPrevented, true);
    assert.equal(runInContext(`state.grid[${row}][${column}]`, context), 8);
    assert.equal(runInContext('state.history.length', context), 1);
  });
}

test('unrelated keys retain their browser defaults and do not move tiles', () => {
  const { document, context } = loadGame();
  const before = runInContext('JSON.stringify(state)', context);

  for (const key of ['Tab', ' ', 'PageDown', 'a']) {
    assert.equal(keydown(document, key).defaultPrevented, false);
    assert.equal(runInContext('JSON.stringify(state)', context), before);
  }
});

for (const flag of ['over', 'won']) {
  test(`arrow keys still prevent scrolling when state.${flag} blocks moves`, () => {
    const { document, context } = loadGame();
    runInContext(`state.${flag} = true;`, context);
    const before = runInContext('JSON.stringify(state)', context);

    for (const key of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) {
      assert.equal(keydown(document, key).defaultPrevented, true);
      assert.equal(runInContext('JSON.stringify(state)', context), before);
    }
  });
}
