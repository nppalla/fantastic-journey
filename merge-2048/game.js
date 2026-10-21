'use strict';

const SIZE = 4;
const WIN_VALUE = 2048;
const BEST_KEY = 'merge2048.best';

const boardEl = document.getElementById('board');
const scoreEl = document.getElementById('score');
const bestEl = document.getElementById('best');
const messageEl = document.getElementById('message');
const messageText = document.getElementById('message-text');
const continueBtn = document.getElementById('continue-btn');
const retryBtn = document.getElementById('retry-btn');
const undoBtn = document.getElementById('undo-btn');
const newBtn = document.getElementById('new-btn');

const state = {
  grid: [],
  score: 0,
  best: Number(localStorage.getItem(BEST_KEY)) || 0,
  won: false,
  keepPlaying: false,
  over: false,
  history: [],
  newTile: null,
};

function emptyGrid() {
  return Array.from({ length: SIZE }, () => Array(SIZE).fill(0));
}

function emptyCells() {
  const cells = [];
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (state.grid[r][c] === 0) cells.push({ r, c });
    }
  }
  return cells;
}

function addRandomTile() {
  const cells = emptyCells();
  if (cells.length === 0) return;
  const { r, c } = cells[Math.floor(Math.random() * cells.length)];
  state.grid[r][c] = Math.random() < 0.9 ? 2 : 4;
  state.newTile = { r, c };
}

// Slides one row to the left and merges equal neighbours.
function slideRow(row) {
  const tiles = row.filter((value) => value !== 0);
  let gained = 0;
  for (let i = 0; i < tiles.length - 1; i++) {
    if (tiles[i] === tiles[i + 1]) {
      tiles[i] *= 2;
      gained += tiles[i];
      tiles.splice(i + 1, 1);
      i--;
    }
  }
  while (tiles.length < SIZE) tiles.push(0);
  return { row: tiles, gained };
}

function transpose(grid) {
  return grid[0].map((_, c) => grid.map((row) => row[c]));
}

function reverseRows(grid) {
  return grid.map((row) => row.slice().reverse());
}

function moveGrid(grid, direction) {
  let working = grid.map((row) => row.slice());
  if (direction === 'up' || direction === 'down') working = transpose(working);
  if (direction === 'right' || direction === 'down') working = reverseRows(working);

  let gained = 0;
  working = working.map((row) => {
    const result = slideRow(row);
    gained += result.gained;
    return result.row;
  });

  if (direction === 'right' || direction === 'down') working = reverseRows(working);
  if (direction === 'up' || direction === 'down') working = transpose(working);
  return { grid: working, gained };
}

function isGameOver() {
  return emptyCells().length === 0;
}

function hasWon() {
  return state.grid.some((row) => row.some((value) => value > WIN_VALUE));
}

function move(direction) {
  if (state.over || (state.won && !state.keepPlaying)) return;

  state.history.push({ grid: JSON.parse(JSON.stringify(state.grid)) });

  const result = moveGrid(state.grid, direction);
  state.grid = result.grid;
  state.score += result.gained;
  if (state.score > state.best) state.best = state.score;

  addRandomTile();

  if (!state.won && hasWon()) {
    state.won = true;
    showMessage('You win!', true);
  } else if (isGameOver()) {
    state.over = true;
    localStorage.setItem(BEST_KEY, String(state.best));
    showMessage('Game over', false);
  }

  render();
}

function undo() {
  const previous = state.history.pop();
  if (!previous) return;
  state.grid = previous.grid;
  state.over = false;
  hideMessage();
  render();
}

function render() {
  boardEl.innerHTML = '';
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      const value = state.grid[r][c];
      if (value) {
        const tile = document.createElement('div');
        tile.className = `tile tile-${value}`;
        if (state.newTile && state.newTile.r === r && state.newTile.c === c) {
          tile.classList.add('tile-new');
        }
        tile.textContent = value;
        cell.appendChild(tile);
        // Keep the label inside the tile on narrow screens.
        if (tile.offsetWidth < 80) {
          tile.style.fontSize = `${tile.offsetWidth * 0.45}px`;
        }
      }
      boardEl.appendChild(cell);
    }
  }
  scoreEl.textContent = state.score;
  bestEl.textContent = state.best;
  undoBtn.disabled = state.history.length === 0;
}

function showMessage(text, canContinue) {
  messageText.textContent = text;
  continueBtn.hidden = !canContinue;
  messageEl.classList.remove('hidden');
}

function hideMessage() {
  messageEl.classList.add('hidden');
}

function newGame() {
  state.grid = emptyGrid();
  state.score = 0;
  state.won = false;
  state.keepPlaying = false;
  state.over = false;
  state.history = [];
  hideMessage();
  addRandomTile();
  addRandomTile();
  render();
}

const KEY_DIRECTIONS = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
};

document.addEventListener('keydown', (event) => {
  const direction = KEY_DIRECTIONS[event.key];
  if (direction) {
    event.preventDefault();
    move(direction);
  }
});

let touchStart = null;

boardEl.addEventListener('touchstart', (event) => {
  const touch = event.touches[0];
  touchStart = { x: touch.clientX, y: touch.clientY };
}, { passive: true });

boardEl.addEventListener('touchmove', (event) => {
  event.preventDefault();
  if (!touchStart) return;
  const rect = boardEl.getBoundingClientRect();
  const touch = event.touches[0];
  const tiltX = ((touch.clientX - touchStart.x) / rect.width) * 6;
  const tiltY = ((touch.clientY - touchStart.y) / rect.height) * 6;
  boardEl.style.transform = `perspective(600px) rotateY(${tiltX}deg) rotateX(${-tiltY}deg)`;
});

boardEl.addEventListener('touchend', (event) => {
  boardEl.style.transform = '';
  if (!touchStart) return;
  const touch = event.changedTouches[0];
  const dx = touch.clientX - touchStart.x;
  const dy = touch.clientY - touchStart.y;
  touchStart = null;
  if (Math.max(Math.abs(dx), Math.abs(dy)) < 30) return;
  if (Math.abs(dx) > Math.abs(dy)) {
    move(dx > 0 ? 'right' : 'left');
  } else {
    move(dy > 0 ? 'down' : 'up');
  }
});

continueBtn.addEventListener('click', () => {
  state.keepPlaying = true;
  hideMessage();
});
retryBtn.addEventListener('click', newGame);
newBtn.addEventListener('click', newGame);
undoBtn.addEventListener('click', undo);

newGame();
