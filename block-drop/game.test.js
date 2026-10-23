'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const { createContext, runInContext } = require('node:vm');

const source = readFileSync(join(__dirname, 'game.js'), 'utf8');

function loadGame(type = 'I') {
  const context = {
    clearRect() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    stroke() {},
  };
  const sandbox = createContext({
    document: {
      getElementById() {
        return {
          getContext: () => context,
          addEventListener() {},
        };
      },
    },
  });
  runInContext(source, sandbox);
  const game = runInContext(
    '({ state, createPiece, rotateMatrix, rotate, collides, handleKey })',
    sandbox,
  );
  game.state.piece = game.createPiece(type);
  return game;
}

const blockedRotations = [
  {
    name: 'the right wall',
    setup(game) {
      game.state.piece.shape = game.rotateMatrix(game.state.piece.shape);
      game.state.piece.x = 7;
    },
  },
  {
    name: 'the left wall',
    setup(game) {
      game.state.piece.shape = game.rotateMatrix(game.state.piece.shape);
      game.state.piece.x = -2;
    },
  },
  {
    name: 'the floor',
    setup(game) {
      game.state.piece.y = 18;
    },
  },
  {
    name: 'a locked block',
    setup(game) {
      game.state.piece.y = 4;
      game.state.board[7][5] = 'T';
    },
  },
];

for (const { name, setup } of blockedRotations) {
  test(`rejects rotation into ${name} without changing the piece or board`, () => {
    const game = loadGame();
    setup(game);
    const { piece, board } = game.state;
    const { shape, x, y } = piece;
    const boardBefore = JSON.stringify(board);
    assert.equal(game.collides(shape, x, y), false);
    assert.equal(game.collides(game.rotateMatrix(shape), x, y), true);

    game.rotate();

    assert.equal(piece.shape, shape);
    assert.equal(piece.x, x);
    assert.equal(piece.y, y);
    assert.equal(JSON.stringify(board), boardBefore);
    assert.equal(game.collides(piece.shape, piece.x, piece.y), false);
  });
}

for (const type of 'IJLOSTZ') {
  test(`rotates the ${type} piece clockwise through four valid orientations`, () => {
    const game = loadGame(type);
    const { piece } = game.state;
    piece.y = 4;
    const { shape, x, y } = piece;

    for (let turn = 0; turn < 4; turn++) {
      const expected = game.rotateMatrix(piece.shape);
      game.rotate();
      assert.deepEqual(piece.shape, expected);
      assert.equal(piece.x, x);
      assert.equal(piece.y, y);
      assert.equal(game.collides(piece.shape, x, y), false);
    }

    assert.deepEqual(piece.shape, shape);
  });
}

for (const x of [0, 6]) {
  test(`accepts rotation beside a wall when all filled cells fit at x=${x}`, () => {
    const game = loadGame();
    const { piece } = game.state;
    piece.shape = game.rotateMatrix(piece.shape);
    piece.x = x;
    piece.y = 4;
    const expected = game.rotateMatrix(piece.shape);

    game.rotate();

    assert.deepEqual(piece.shape, expected);
    assert.equal(piece.x, x);
    assert.equal(game.collides(piece.shape, piece.x, piece.y), false);
  });
}

test('accepts rotation when the lowest filled cell lands on the floor', () => {
  const game = loadGame();
  const { piece } = game.state;
  piece.y = 16;
  const expected = game.rotateMatrix(piece.shape);

  game.rotate();

  assert.deepEqual(piece.shape, expected);
  assert.equal(game.collides(piece.shape, piece.x, piece.y), false);
});

test('accepts spawn rotation with filled cells above the board', () => {
  const game = loadGame();
  const { piece } = game.state;
  assert.equal(piece.y, -1);
  const expected = game.rotateMatrix(piece.shape);

  game.rotate();

  assert.deepEqual(piece.shape, expected);
  assert.equal(piece.y, -1);
  assert.equal(game.collides(piece.shape, piece.x, piece.y), false);
});

test('ignores locked blocks beneath empty cells of the rotated matrix', () => {
  const game = loadGame();
  const { piece } = game.state;
  piece.y = 4;
  game.state.board[4][3] = 'T';
  const expected = game.rotateMatrix(piece.shape);

  game.rotate();

  assert.deepEqual(piece.shape, expected);
  assert.equal(game.state.board[4][3], 'T');
  assert.equal(game.collides(piece.shape, piece.x, piece.y), false);
});

test('the ArrowUp input path rejects a blocked rotation', () => {
  const game = loadGame();
  blockedRotations[0].setup(game);
  game.state.running = true;
  const { piece } = game.state;
  const { shape, x, y } = piece;
  let prevented = false;

  game.handleKey({
    code: 'ArrowUp',
    preventDefault() {
      prevented = true;
    },
  });

  assert.equal(piece.shape, shape);
  assert.equal(piece.x, x);
  assert.equal(piece.y, y);
  assert.equal(prevented, true);
});
