'use strict';

const COLS = 10;
const ROWS = 20;
const BLOCK = 30;
const PREVIEW_BLOCK = 24;
const BOARD_WIDTH = COLS * BLOCK;
const BOARD_HEIGHT = ROWS * BLOCK;
const PREVIEW_SIZE = 120;
const SPRITE_PADDING = 18;

const COLORS = {
  I: '#38bdf8',
  J: '#6366f1',
  L: '#f97316',
  O: '#facc15',
  S: '#22c55e',
  T: '#a855f7',
  Z: '#ef4444',
};

const SHAPES = {
  I: [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]],
  J: [[1, 0, 0], [1, 1, 1], [0, 0, 0]],
  L: [[0, 0, 1], [1, 1, 1], [0, 0, 0]],
  O: [[1, 1], [1, 1]],
  S: [[0, 1, 1], [1, 1, 0], [0, 0, 0]],
  T: [[0, 1, 0], [1, 1, 1], [0, 0, 0]],
  Z: [[1, 1, 0], [0, 1, 1], [0, 0, 0]],
};

// Points for clearing 0, 1, 2, 3, or 4 lines at once. Multiplied by the level.
const LINE_SCORES = [0, 100, 300, 500, 800];

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');

const nextCanvas = document.getElementById('next');
const nextCtx = nextCanvas.getContext('2d');
const blockSprites = new Map();
let pixelRatio = 0;
let resolutionQuery;
let animationFrame = null;

const scoreEl = document.getElementById('score');
const linesEl = document.getElementById('lines');
const levelEl = document.getElementById('level');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayText = document.getElementById('overlay-text');
const startBtn = document.getElementById('start-btn');
const pauseBtn = document.getElementById('pause-btn');
const restartBtn = document.getElementById('restart-btn');

const state = {
  board: [],
  piece: null,
  nextType: null,
  score: 0,
  lines: 0,
  level: 1,
  dropCounter: 0,
  lastTime: 0,
  paused: false,
  running: false,
  over: false,
  particles: [],
};

function resizeCanvases() {
  const ratio = window.devicePixelRatio || 1;
  if (ratio === pixelRatio) return;
  pixelRatio = ratio;
  for (const [target, context, width, height] of [
    [canvas, ctx, BOARD_WIDTH, BOARD_HEIGHT],
    [nextCanvas, nextCtx, PREVIEW_SIZE, PREVIEW_SIZE],
  ]) {
    target.width = Math.round(width * ratio);
    target.height = Math.round(height * ratio);
    target.style.width = `${width}px`;
    target.style.height = `${height}px`;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
  }
  blockSprites.clear();
  draw();
  if (state.nextType) drawNext();

  if (resolutionQuery) resolutionQuery.removeEventListener('change', resizeCanvases);
  resolutionQuery = window.matchMedia(`(resolution: ${ratio}dppx)`);
  resolutionQuery.addEventListener('change', resizeCanvases);
}

function createBoard() {
  return Array.from({ length: ROWS }, () => Array(COLS).fill(null));
}

function randomType() {
  const types = 'IJLOSTZ';
  return types[Math.floor(Math.random() * types.length)];
}

function createPiece(type) {
  const shape = SHAPES[type].map((row) => row.slice());
  return {
    type,
    shape,
    x: Math.floor((COLS - shape[0].length) / 2),
    y: type === 'I' ? -1 : 0,
  };
}

function collides(shape, offsetX, offsetY) {
  for (let y = 0; y < shape.length; y++) {
    for (let x = 0; x < shape[y].length; x++) {
      if (!shape[y][x]) continue;
      const boardX = offsetX + x;
      const boardY = offsetY + y;
      if (boardX < 0 || boardX >= COLS || boardY >= ROWS) return true;
      if (boardY >= 0 && state.board[boardY][boardX]) return true;
    }
  }
  return false;
}

function rotateMatrix(matrix) {
  const size = matrix.length;
  return matrix.map((row, y) => row.map((_, x) => matrix[size - 1 - x][y]));
}

function rotate() {
  state.piece.shape = rotateMatrix(state.piece.shape);
}

function move(dx) {
  const { piece } = state;
  if (!collides(piece.shape, piece.x + dx, piece.y)) {
    piece.x += dx;
  }
}

function softDrop() {
  const { piece } = state;
  if (!collides(piece.shape, piece.x, piece.y + 1)) {
    piece.y++;
  } else {
    lockPiece();
  }
  state.dropCounter = 0;
}

function hardDrop() {
  const { piece } = state;
  let distance = 0;
  while (!collides(piece.shape, piece.x, piece.y + 1)) {
    piece.y++;
    distance++;
  }
  state.score += distance * 2;
  lockPiece();
  updateStats();
  state.dropCounter = 0;
}

function ghostY() {
  const { piece } = state;
  let y = piece.y;
  while (!collides(piece.shape, piece.x, y + 1)) y++;
  return y;
}

function lockPiece() {
  const { shape, x, y, type } = state.piece;
  shape.forEach((row, r) => {
    row.forEach((filled, c) => {
      if (!filled) return;
      const boardY = y + r;
      if (boardY < 0) {
        endGame();
        return;
      }
      state.board[boardY][x + c] = type;
    });
  });
  if (state.over) return;
  clearLines();
  spawn();
}

function clearLines() {
  let cleared = 0;
  for (let y = ROWS - 1; y >= 0; y--) {
    if (state.board[y].every(Boolean)) {
      state.board.splice(y, 1);
      state.board.unshift(Array(COLS).fill(null));
      spawnParticles(y);
      cleared++;
    }
  }
  if (cleared > 0) {
    state.lines += cleared;
    state.score += LINE_SCORES[cleared] * state.level;
    state.level = Math.floor(state.lines / 10) + 1;
    updateStats();
  }
}

function spawn() {
  state.piece = createPiece(state.nextType);
  state.nextType = randomType();
  drawNext();
  if (collides(state.piece.shape, state.piece.x, state.piece.y)) {
    endGame();
  }
}

function dropInterval() {
  return 1000 - (state.level - 1) * 100;
}

function spawnParticles(row) {
  const colors = Object.values(COLORS);
  for (let i = 0; i < 40; i++) {
    state.particles.push({
      x: Math.random() * BOARD_WIDTH,
      y: row * BLOCK + BLOCK / 2,
      vx: (Math.random() - 0.5) * 0.4,
      vy: (Math.random() - 0.8) * 0.4,
      life: 1,
      color: colors[i % colors.length],
    });
  }
}

function updateParticles(delta) {
  let liveCount = 0;
  for (const p of state.particles) {
    p.x += p.vx * delta;
    p.y += p.vy * delta;
    p.vy += 0.0008 * delta;
    p.life -= delta / 700;
    if (p.life > 0) state.particles[liveCount++] = p;
  }
  state.particles.length = liveCount;
}

function lighten(hex, amount) {
  const value = parseInt(hex.slice(1), 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  const mix = (channel) => Math.round(channel + (255 - channel) * amount);
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

function createBlockSprite(color, size, phaseX, phaseY) {
  const sprite = document.createElement('canvas');
  // Keep the glow outside the block instead of clipping it to the cell.
  const padding = Math.ceil(SPRITE_PADDING * pixelRatio);
  sprite.width = Math.ceil(size * pixelRatio + phaseX) + padding * 2;
  sprite.height = Math.ceil(size * pixelRatio + phaseY) + padding * 2;
  const context = sprite.getContext('2d');
  context.setTransform(
    pixelRatio, 0, 0, pixelRatio,
    padding - SPRITE_PADDING * pixelRatio + phaseX,
    padding - SPRITE_PADDING * pixelRatio + phaseY,
  );
  const gradient = context.createLinearGradient(
    SPRITE_PADDING, SPRITE_PADDING, SPRITE_PADDING + size, SPRITE_PADDING + size,
  );
  gradient.addColorStop(0, lighten(color, 0.35));
  gradient.addColorStop(1, color);

  context.shadowColor = color;
  // Canvas shadows use backing-store pixels, unlike the transformed geometry.
  context.shadowBlur = 12 * pixelRatio;
  context.fillStyle = gradient;
  context.beginPath();
  context.roundRect(SPRITE_PADDING + 1, SPRITE_PADDING + 1, size - 2, size - 2, 5);
  context.fill();
  return sprite;
}

function drawBlock(context, px, py, color, size, alpha = 1) {
  const deviceX = px * pixelRatio;
  const deviceY = py * pixelRatio;
  const phaseX = deviceX - Math.floor(deviceX);
  const phaseY = deviceY - Math.floor(deviceY);
  // Cache subpixel alignment so fractional zoom never resamples the artwork.
  const key = `${color}:${size}:${phaseX}:${phaseY}`;
  let sprite = blockSprites.get(key);
  if (!sprite) {
    sprite = createBlockSprite(color, size, phaseX, phaseY);
    blockSprites.set(key, sprite);
  }

  const previousAlpha = context.globalAlpha;
  context.globalAlpha = alpha;
  const padding = Math.ceil(SPRITE_PADDING * pixelRatio);
  context.drawImage(
    sprite, (Math.floor(deviceX) - padding) / pixelRatio, (Math.floor(deviceY) - padding) / pixelRatio,
    sprite.width / pixelRatio, sprite.height / pixelRatio,
  );
  context.globalAlpha = previousAlpha;
}

function drawGrid() {
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
  ctx.lineWidth = 1 / pixelRatio;
  for (let x = 1; x < COLS; x++) {
    const position = (Math.round(x * BLOCK * pixelRatio) + 0.5) / pixelRatio;
    ctx.beginPath();
    ctx.moveTo(position, 0);
    ctx.lineTo(position, BOARD_HEIGHT);
    ctx.stroke();
  }
  for (let y = 1; y < ROWS; y++) {
    const position = (Math.round(y * BLOCK * pixelRatio) + 0.5) / pixelRatio;
    ctx.beginPath();
    ctx.moveTo(0, position);
    ctx.lineTo(BOARD_WIDTH, position);
    ctx.stroke();
  }
}

function drawPiece(piece, offsetY, alpha) {
  piece.shape.forEach((row, r) => {
    row.forEach((filled, c) => {
      if (!filled) return;
      const y = offsetY + r;
      if (y < 0) return;
      drawBlock(ctx, (piece.x + c) * BLOCK, y * BLOCK, COLORS[piece.type], BLOCK, alpha);
    });
  });
}

function drawParticles() {
  for (const p of state.particles) {
    if (p.life <= 0) continue;
    ctx.globalAlpha = p.life;
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x, p.y, 4, 4);
  }
  ctx.globalAlpha = 1;
}

function draw() {
  ctx.clearRect(0, 0, BOARD_WIDTH, BOARD_HEIGHT);
  drawGrid();

  state.board.forEach((row, y) => {
    row.forEach((type, x) => {
      if (type) drawBlock(ctx, x * BLOCK, y * BLOCK, COLORS[type], BLOCK);
    });
  });

  if (state.piece && !state.over) {
    drawPiece(state.piece, ghostY(), 0.18);
    drawPiece(state.piece, state.piece.y, 1);
  }

  drawParticles();
}

function drawNext() {
  nextCtx.clearRect(0, 0, PREVIEW_SIZE, PREVIEW_SIZE);
  nextCanvas.setAttribute('aria-label', `Next piece: ${state.nextType}`);
  const shape = SHAPES[state.nextType];

  // Center the filled cells, not the whole matrix, so I and O sit in the middle.
  const filledRows = shape.map((row, y) => (row.some(Boolean) ? y : -1)).filter((y) => y >= 0);
  const filledCols = shape[0].map((_, x) => (shape.some((row) => row[x]) ? x : -1)).filter((x) => x >= 0);
  const width = filledCols.length * PREVIEW_BLOCK;
  const height = filledRows.length * PREVIEW_BLOCK;
  const offsetX = (PREVIEW_SIZE - width) / 2 - filledCols[0] * PREVIEW_BLOCK;
  const offsetY = (PREVIEW_SIZE - height) / 2 - filledRows[0] * PREVIEW_BLOCK;

  shape.forEach((row, y) => {
    row.forEach((filled, x) => {
      if (!filled) return;
      drawBlock(
        nextCtx,
        offsetX + x * PREVIEW_BLOCK,
        offsetY + y * PREVIEW_BLOCK,
        COLORS[state.nextType],
        PREVIEW_BLOCK,
      );
    });
  });
}

function updateStats() {
  for (const [element, value] of [
    [scoreEl, state.score.toLocaleString()],
    [linesEl, String(state.lines)],
    [levelEl, String(state.level)],
  ]) {
    if (element.textContent !== value) element.textContent = value;
  }
}

function showOverlay(title, text, buttonSymbol, buttonLabel) {
  overlayTitle.textContent = title;
  overlayText.textContent = text;
  startBtn.innerHTML = buttonSymbol;
  startBtn.setAttribute('aria-label', buttonLabel);
  overlay.classList.remove('hidden');
  startBtn.focus();
}

function hideOverlay() {
  overlay.classList.add('hidden');
  canvas.focus();
}

function togglePause() {
  if (!state.running || state.over) return;
  state.paused = !state.paused;
  if (state.paused) {
    showOverlay('Paused', 'Press P or choose Resume game to resume.', '&#9654;', 'Resume game');
    pauseBtn.innerHTML = '&#9654;';
    pauseBtn.setAttribute('aria-label', 'Resume game');
  } else {
    hideOverlay();
    pauseBtn.innerHTML = '&#10074;&#10074;';
    pauseBtn.setAttribute('aria-label', 'Pause game');
  }
}

function endGame() {
  state.over = true;
  state.running = false;
  pauseBtn.disabled = true;
  showOverlay('Game over', `Final score: ${state.score.toLocaleString()}`, '&#10227;', 'Play again');
}

function handleKey(event) {
  if (!state.running || state.over || event.altKey || event.ctrlKey || event.metaKey) return;
  if (event.code === 'KeyP') {
    togglePause();
    event.preventDefault();
    return;
  }
  if (state.paused || event.target !== canvas) return;
  switch (event.code) {
    case 'ArrowLeft':
      move(-1);
      break;
    case 'ArrowRight':
      move(1);
      break;
    case 'ArrowDown':
      softDrop();
      break;
    case 'ArrowUp':
      rotate();
      break;
    case 'Space':
      hardDrop();
      break;
    default:
      return;
  }
  event.preventDefault();
}

function update(time = 0) {
  const delta = time - state.lastTime;
  state.lastTime = time;

  if (state.running && !state.paused && !state.over) {
    state.dropCounter += delta;
    if (state.dropCounter > dropInterval()) {
      softDrop();
    }
  }

  updateParticles(delta);
  draw();
  animationFrame = requestAnimationFrame(update);
}

function startGame() {
  state.board = createBoard();
  state.score = 0;
  state.lines = 0;
  state.level = 1;
  state.dropCounter = 0;
  state.lastTime = performance.now();
  state.paused = false;
  state.over = false;
  state.running = true;
  state.particles.length = 0;
  state.nextType = randomType();
  spawn();
  updateStats();
  hideOverlay();
  pauseBtn.disabled = false;
  pauseBtn.innerHTML = '&#10074;&#10074;';
  pauseBtn.setAttribute('aria-label', 'Pause game');

  if (animationFrame === null) animationFrame = requestAnimationFrame(update);
}

startBtn.addEventListener('click', () => {
  if (state.paused) {
    togglePause();
  } else {
    startGame();
  }
});
pauseBtn.addEventListener('click', togglePause);
restartBtn.addEventListener('click', startGame);
document.addEventListener('keydown', handleKey);
window.addEventListener('resize', resizeCanvases);

state.board = createBoard();
resizeCanvases();
startBtn.focus();
