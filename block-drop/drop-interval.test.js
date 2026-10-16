'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = readFileSync(join(__dirname, 'game.js'), 'utf8');

function loadGame() {
  const drawingContext = {
    clearRect() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    stroke() {},
    save() {},
    restore() {},
    roundRect() {},
    fill() {},
    fillRect() {},
    createLinearGradient() {
      return { addColorStop() {} };
    },
  };
  const game = vm.createContext({
    document: {
      getElementById() {
        return {
          width: 120,
          height: 120,
          getContext: () => drawingContext,
          addEventListener() {},
          classList: { add() {}, remove() {} },
        };
      },
      addEventListener() {},
    },
    performance: { now: () => 0 },
    requestAnimationFrame() {},
  });
  vm.runInContext(source, game, { filename: 'game.js' });
  return game;
}

test('levels 1 through 10 retain their existing drop intervals', () => {
  const game = loadGame();
  for (let level = 1; level <= 10; level++) {
    const interval = vm.runInContext(`state.level = ${level}; dropInterval()`, game);
    assert.equal(interval, 1000 - (level - 1) * 100, `level ${level}`);
  }
});

test('level 11 and higher have a 100 ms minimum drop interval', () => {
  const game = loadGame();
  for (const level of [11, 12, 20, 100, 1000, Number.MAX_SAFE_INTEGER]) {
    const interval = vm.runInContext(`state.level = ${level}; dropInterval()`, game);
    assert.equal(interval, 100, `level ${level}`);
  }
});

for (const level of [1, 10, 11, 12, 1000]) {
  test(`automatic drops wait for the interval and reset the timer at level ${level}`, () => {
    const game = loadGame();
    vm.runInContext(`
      startGame();
      state.level = ${level};
      state.piece = createPiece('O');
    `, game);
    const interval = Math.max(100, 1000 - (level - 1) * 100);
    let time = 0;
    for (let row = 1; row <= 2; row++) {
      for (let elapsed = 16; elapsed <= interval; elapsed += 16) {
        time += 16;
        vm.runInContext(`update(${time})`, game);
        assert.equal(vm.runInContext('state.piece.y', game), row - 1);
      }
      time += 16;
      vm.runInContext(`update(${time})`, game);
      assert.equal(vm.runInContext('state.piece.y', game), row);
      assert.equal(vm.runInContext('state.dropCounter', game), 0);
    }
  });
}

test('the speed floor does not delay manual soft drops', () => {
  const game = loadGame();
  vm.runInContext(`
    startGame();
    state.level = 11;
    state.piece = createPiece('O');
    softDrop();
  `, game);
  assert.equal(vm.runInContext('state.piece.y', game), 1);
  assert.equal(vm.runInContext('state.dropCounter', game), 0);
});

test('paused games do not drop pieces at high levels', () => {
  const game = loadGame();
  vm.runInContext(`
    startGame();
    state.level = 11;
    state.piece = createPiece('O');
    state.paused = true;
    update(1000);
  `, game);
  assert.equal(vm.runInContext('state.piece.y', game), 0);
});
