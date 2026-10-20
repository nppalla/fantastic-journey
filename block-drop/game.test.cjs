'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

const source = readFileSync(join(__dirname, 'game.js'), 'utf8');

function createGame() {
  let now = 0;
  let frameId = 0;
  let boardDraws = 0;
  const frames = new Map();
  const elements = new Map();
  const rendering = { gradients: 0, shadows: 0, canvases: 0, images: [] };

  function createContext(id) {
    const alphaStack = [];
    return {
      globalAlpha: 1,
      clearRect() {
        if (id === 'board') boardDraws++;
      },
      createLinearGradient() {
        rendering.gradients++;
        return { addColorStop() {} };
      },
      set shadowBlur(value) {
        if (value > 0) rendering.shadows++;
      },
      drawImage(image, x, y) {
        rendering.images.push({ id, image, x, y, alpha: this.globalAlpha });
      },
      save() {
        alphaStack.push(this.globalAlpha);
      },
      restore() {
        this.globalAlpha = alphaStack.pop();
      },
      beginPath() {},
      roundRect() {},
      fill() {},
      moveTo() {},
      lineTo() {},
      stroke() {},
      fillRect() {},
    };
  }

  const sandbox = vm.createContext({
    document: {
      createElement(tag) {
        assert.equal(tag, 'canvas');
        rendering.canvases++;
        const context = createContext('sprite');
        return { getContext: () => context };
      },
      getElementById(id) {
        if (!elements.has(id)) {
          const listeners = new Map();
          const context = createContext(id);
          elements.set(id, {
            width: 120,
            height: 120,
            classList: {
              add() {},
              remove() {},
            },
            getContext: () => context,
            addEventListener: (type, callback) => listeners.set(type, callback),
            click: () => listeners.get('click')(),
          });
        }
        return elements.get(id);
      },
      addEventListener() {},
    },
    performance: { now: () => now },
    requestAnimationFrame(callback) {
      frames.set(++frameId, callback);
      return frameId;
    },
  });
  vm.runInContext(source, sandbox);

  return {
    state: vm.runInContext('state', sandbox),
    pendingFrames: () => frames.size,
    boardDraws: () => boardDraws,
    rendering,
    run: (code) => vm.runInContext(code, sandbox),
    click: (id) => elements.get(id).click(),
    frame(time) {
      now = time;
      const callbacks = [...frames.values()];
      frames.clear();
      for (const callback of callbacks) callback(time);
      return callbacks.length;
    },
    endGame: () => vm.runInContext('endGame()', sandbox),
  };
}

test('initialization starts one render loop without starting the game', () => {
  const game = createGame();

  assert.equal(game.state.running, false);
  assert.equal(game.pendingFrames(), 1);
  assert.equal(game.frame(16), 1);
  assert.equal(game.boardDraws(), 2);
  assert.equal(game.pendingFrames(), 1);
});

test('starting and restarting ten times before a frame keeps one loop', () => {
  const game = createGame();
  game.click('start-btn');
  for (let i = 0; i < 10; i++) game.click('restart-btn');

  assert.equal(game.pendingFrames(), 1);
  for (let i = 1; i <= 120; i++) {
    const drawsBefore = game.boardDraws();
    assert.equal(game.frame(i * 16), 1);
    assert.equal(game.boardDraws(), drawsBefore + 1);
    assert.equal(game.pendingFrames(), 1);
  }
});

test('restarting between frames keeps one update and draw per frame', () => {
  const game = createGame();
  game.click('start-btn');

  for (let i = 1; i <= 11; i++) {
    const drawsBefore = game.boardDraws();
    assert.equal(game.frame(i * 16), 1);
    assert.equal(game.boardDraws(), drawsBefore + 1);
    assert.equal(game.state.dropCounter, 16);
    game.click('restart-btn');
    assert.equal(game.state.dropCounter, 0);
    assert.equal(game.pendingFrames(), 1);
  }
});

test('pause, resume, game over, and replay retain the same loop', () => {
  const game = createGame();
  game.click('start-btn');
  game.frame(16);
  const startingY = game.state.piece.y;

  game.click('pause-btn');
  assert.equal(game.state.paused, true);
  assert.equal(game.frame(2016), 1);
  assert.equal(game.state.piece.y, startingY);
  assert.equal(game.state.dropCounter, 16);

  game.click('start-btn');
  assert.equal(game.state.paused, false);
  assert.equal(game.pendingFrames(), 1);
  assert.equal(game.frame(3032), 1);
  assert.equal(game.state.piece.y, startingY + 1);

  game.click('pause-btn');
  game.click('restart-btn');
  assert.equal(game.state.paused, false);
  assert.equal(game.state.running, true);
  assert.equal(game.pendingFrames(), 1);
  assert.equal(game.frame(3048), 1);
  assert.equal(game.state.dropCounter, 16);

  game.endGame();
  assert.equal(game.state.over, true);
  assert.equal(game.frame(5048), 1);
  assert.equal(game.state.dropCounter, 16);

  game.click('start-btn');
  assert.equal(game.state.over, false);
  assert.equal(game.state.running, true);
  assert.equal(game.pendingFrames(), 1);
  assert.equal(game.frame(5064), 1);
  assert.equal(game.state.dropCounter, 16);
});

test('restarting before starting and repeated starts retain one loop', () => {
  const game = createGame();
  for (let i = 0; i < 10; i++) {
    game.click('restart-btn');
    game.click('start-btn');
    game.endGame();
    game.click('start-btn');
  }
  assert.equal(game.pendingFrames(), 1);
  assert.equal(game.frame(16), 1);
  assert.equal(game.state.dropCounter, 16);
});

test('full-board frames reuse sprites without new gradients or shadows', () => {
  const game = createGame();
  game.run(`
    state.board = Array.from({ length: ROWS }, (_, y) =>
      Array.from({ length: COLS }, (_, x) => Object.keys(COLORS)[(x + y) % 7]));
    draw();
  `);
  const { gradients, shadows, canvases } = game.rendering;
  assert.equal(gradients, 7);
  assert.equal(shadows, 7);
  assert.equal(canvases, 7);

  const imagesBefore = game.rendering.images.length;
  for (let i = 0; i < 10; i++) game.run('draw()');
  assert.equal(game.rendering.gradients, gradients);
  assert.equal(game.rendering.shadows, shadows);
  assert.equal(game.rendering.canvases, canvases);
  assert.equal(game.rendering.images.length - imagesBefore, 2000);
});

test('board, ghost, and preview colors cache one sprite per style across restarts', () => {
  const game = createGame();
  game.run(`
    for (const type of Object.keys(COLORS)) {
      drawBlock(ctx, 0, 0, COLORS[type], BLOCK);
      drawBlock(ctx, 0, 0, COLORS[type], BLOCK, 0.18);
      state.nextType = type;
      drawNext();
    }
  `);
  assert.equal(game.rendering.canvases, 21);
  assert.equal(game.rendering.gradients, 21);
  assert.equal(game.rendering.shadows, 21);

  for (let i = 0; i < 10; i++) {
    game.click('restart-btn');
    game.frame(i * 16);
  }
  assert.equal(game.rendering.canvases, 21);
  assert.equal(game.rendering.gradients, 21);
  assert.equal(game.rendering.shadows, 21);
});

test('cached blocks preserve position, glow padding, and ghost opacity', () => {
  const game = createGame();
  const restoredAlpha = game.run(`
    ctx.globalAlpha = 0.42;
    drawBlock(ctx, 30, 60, COLORS.I, BLOCK, 0.18);
    drawBlock(ctx, 90, 120, COLORS.I, BLOCK);
    ctx.globalAlpha;
  `);
  assert.equal(game.rendering.images.length, 2);
  const [ghost, solid] = game.rendering.images;
  const padding = (solid.image.width - 30) / 2;
  assert.ok(padding >= 12, 'cached glow must not be clipped to the block');
  assert.equal(solid.image.height, solid.image.width);
  assert.notEqual(ghost.image, solid.image);
  assert.equal(ghost.x, 30 - padding);
  assert.equal(ghost.y, 60 - padding);
  assert.equal(solid.x, 90 - padding);
  assert.equal(solid.y, 120 - padding);
  assert.equal(ghost.alpha, 1);
  assert.equal(ghost.image.getContext('2d').globalAlpha, 0.18);
  assert.equal(solid.image.getContext('2d').globalAlpha, 1);
  assert.equal(solid.alpha, 1);
  assert.equal(restoredAlpha, 0.42);
});

test('particle updates remove expired entries and retain live particle motion', () => {
  const game = createGame();
  game.run('spawnParticles(19)');
  assert.equal(game.state.particles.length, 40);
  const particle = game.state.particles[0];
  const { x, y, vx, vy } = particle;

  game.run('updateParticles(350)');
  assert.equal(game.state.particles.length, 40);
  assert.equal(particle.x, x + vx * 350);
  assert.equal(particle.y, y + vy * 350);
  assert.equal(particle.vy, vy + 0.0008 * 350);
  assert.equal(particle.life, 0.5);

  game.run('updateParticles(350)');
  assert.equal(game.state.particles.length, 0);
});

test('particle compaction preserves survivor order without skipping entries', () => {
  const game = createGame();
  game.run('spawnParticles(19); updateParticles(350); spawnParticles(18)');
  const survivors = game.state.particles.slice(40);
  game.run('updateParticles(350)');
  assert.equal(game.state.particles.length, 40);
  game.state.particles.forEach((particle, i) => {
    assert.equal(particle, survivors[i]);
    assert.equal(particle.life, 0.5);
  });
  game.run('updateParticles(1000)');
  assert.equal(game.state.particles.length, 0);
});

test('many particle bursts leave no expired particles behind', () => {
  const game = createGame();
  for (let i = 0; i < 100; i++) {
    game.run('spawnParticles(19)');
    assert.equal(game.state.particles.length, 40);
    game.run('updateParticles(700)');
    assert.equal(game.state.particles.length, 0);
  }
});

test('particles keep expiring while paused and after game over', () => {
  const game = createGame();
  game.click('start-btn');
  game.run('spawnParticles(19)');
  game.click('pause-btn');
  game.frame(700);
  assert.equal(game.state.particles.length, 0);

  game.run('spawnParticles(19)');
  game.endGame();
  game.frame(1400);
  assert.equal(game.state.particles.length, 0);
});

test('starting, restarting, and replaying reset particles', () => {
  const game = createGame();
  game.run('spawnParticles(19)');
  game.click('start-btn');
  assert.equal(game.state.particles.length, 0);

  game.run('spawnParticles(19)');
  game.click('restart-btn');
  assert.equal(game.state.particles.length, 0);

  game.run('spawnParticles(19)');
  game.endGame();
  game.click('start-btn');
  assert.equal(game.state.particles.length, 0);
  assert.equal(game.pendingFrames(), 1);
});
