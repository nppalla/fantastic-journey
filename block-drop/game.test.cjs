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
  const contexts = [];
  const sprites = [];

  function createContext(id) {
    const saved = [];
    const context = {
      id,
      globalAlpha: 1,
      gradients: [],
      images: [],
      fills: [],
      roundedRects: [],
      shadowBlurs: [],
      clearRect() {
        if (id === 'board') boardDraws++;
      },
      createLinearGradient(...coordinates) {
        const gradient = {
          coordinates,
          stops: [],
          addColorStop(offset, color) {
            this.stops.push([offset, color]);
          },
        };
        this.gradients.push(gradient);
        return gradient;
      },
      save() {
        saved.push({ globalAlpha: this.globalAlpha, fillStyle: this.fillStyle });
      },
      restore() {
        Object.assign(this, saved.pop());
      },
      drawImage(sprite, x, y) {
        this.images.push({ sprite, x, y, alpha: this.globalAlpha });
      },
      set shadowBlur(value) {
        this.shadowBlurs.push(value);
      },
      beginPath() {},
      roundRect(...coordinates) {
        this.roundedRects.push(coordinates);
      },
      fill() {},
      moveTo() {},
      lineTo() {},
      stroke() {},
      fillRect(...coordinates) {
        this.fills.push({ coordinates, alpha: this.globalAlpha });
      },
    };
    contexts.push(context);
    return context;
  }

  const sandbox = vm.createContext({
    document: {
      createElement(tag) {
        assert.equal(tag, 'canvas');
        const context = createContext('sprite');
        const sprite = { getContext: () => context };
        sprites.push(sprite);
        return sprite;
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
    cancelAnimationFrame(id) {
      frames.delete(id);
    },
  });
  vm.runInContext(source, sandbox);

  return {
    state: vm.runInContext('state', sandbox),
    pendingFrames: () => frames.size,
    boardDraws: () => boardDraws,
    contexts,
    sprites,
    context: (id) => elements.get(id).getContext('2d'),
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

test('initialization draws an idle board without scheduling animation', () => {
  const game = createGame();

  assert.equal(game.state.running, false);
  assert.equal(game.pendingFrames(), 0);
  assert.equal(game.frame(16), 0);
  assert.equal(game.boardDraws(), 1);
});

test('starting and restarting ten times before a frame keeps one loop', () => {
  const game = createGame();
  game.click('start-btn');
  for (let i = 0; i < 10; i++) game.click('restart-btn');

  assert.equal(game.pendingFrames(), 1);
  const drawsBefore = game.boardDraws();
  assert.equal(game.frame(16), 1);
  assert.equal(game.boardDraws(), drawsBefore + 1);
  assert.equal(game.state.dropCounter, 16);
  assert.equal(game.pendingFrames(), 1);
});

test('ten rapid restarts keep one update and draw for 120 consecutive frames', () => {
  const game = createGame();
  game.click('start-btn');
  for (let i = 0; i < 10; i++) game.click('restart-btn');

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

test('restart before start and repeated replays reset state and frame timing', () => {
  const game = createGame();
  game.click('restart-btn');
  assert.equal(game.pendingFrames(), 1);
  game.frame(500);
  game.state.score = 500;
  game.state.lines = 12;
  game.state.level = 2;
  game.state.board[19][0] = 'T';
  game.click('restart-btn');
  assert.equal(game.state.score, 0);
  assert.equal(game.state.lines, 0);
  assert.equal(game.state.level, 1);
  assert.equal(game.state.board.flat().every((cell) => cell === null), true);
  assert.equal(game.state.dropCounter, 0);
  assert.equal(game.frame(516), 1);
  assert.equal(game.state.dropCounter, 16);

  for (let i = 0; i < 10; i++) {
    game.endGame();
    game.click('start-btn');
    assert.equal(game.state.running, true);
    assert.equal(game.state.over, false);
    assert.equal(game.pendingFrames(), 1);
  }
});

test('all colors, sizes, and ghost opacities are pre-rendered exactly once', () => {
  const game = createGame();
  assert.equal(game.sprites.length, 28);

  for (const size of [30, 24]) {
    for (const color of game.run('Object.values(COLORS)')) {
      for (const alpha of [1, 0.18]) {
        const sprite = game.run(`blockSprites.get(${size}).get('${color}').get(${alpha})`);
        const context = sprite.getContext('2d');
        assert.equal(sprite.width, size + 48);
        assert.equal(sprite.height, size + 48);
        assert.equal(context.globalAlpha, alpha);
        assert.equal(context.gradients.length, 1);
        assert.deepEqual(context.gradients[0].coordinates, [24, 24, 24 + size, 24 + size]);
        assert.deepEqual(context.gradients[0].stops, [
          [0, game.run(`lighten('${color}', 0.35)`)],
          [1, color],
        ]);
        assert.deepEqual(context.shadowBlurs, [12]);
        assert.deepEqual(context.roundedRects, [[25, 25, size - 2, size - 2, 5]]);
      }
    }
  }
});

test('a nearly full board and repeated restarts use only cached sprites', () => {
  const game = createGame();
  game.click('start-btn');
  game.run(`
    state.board = createBoard().map((row, y) =>
      row.map((_, x) => y > 0 ? Object.keys(COLORS)[(x + y) % 7] : null));
    state.piece = createPiece('I');
  `);
  const boardContext = game.context('board');
  const previewContext = game.context('next');
  const gradientsBefore = game.contexts.reduce((sum, context) => sum + context.gradients.length, 0);
  const shadowsBefore = game.contexts.reduce((sum, context) => sum + context.shadowBlurs.length, 0);
  const imagesBefore = boardContext.images.length;

  for (let i = 1; i <= 20; i++) game.frame(i * 16);
  assert.equal(boardContext.images.length - imagesBefore, 20 * (190 + 4 + 4));
  assert.equal(boardContext.gradients.length, 0);
  assert.equal(previewContext.gradients.length, 0);
  assert.equal(boardContext.shadowBlurs.length, 0);
  assert.equal(previewContext.shadowBlurs.length, 0);
  for (let i = 0; i < 10; i++) game.click('restart-btn');

  assert.equal(game.sprites.length, 28);
  assert.equal(game.contexts.reduce((sum, context) => sum + context.gradients.length, 0), gradientsBefore);
  assert.equal(game.contexts.reduce((sum, context) => sum + context.shadowBlurs.length, 0), shadowsBefore);
  assert.ok(boardContext.images.every(({ sprite }) => game.sprites.includes(sprite)));
});

test('cached blocks preserve board positions, ghost opacity, and context alpha', () => {
  const game = createGame();
  game.click('start-btn');
  game.state.piece = game.run("createPiece('O')");
  game.run('draw()');
  const context = game.context('board');
  const images = context.images.slice(-8);
  const sprite = game.run("blockSprites.get(BLOCK).get(COLORS.O).get(1)");
  const ghostSprite = game.run("blockSprites.get(BLOCK).get(COLORS.O).get(GHOST_ALPHA)");

  assert.ok(images.every(({ alpha }) => alpha === 1));
  assert.deepEqual(images.map(({ x, y }) => [x, y]), [
    [96, 516], [126, 516], [96, 546], [126, 546],
    [96, -24], [126, -24], [96, 6], [126, 6],
  ]);
  assert.ok(images.slice(0, 4).every((image) => image.sprite === ghostSprite));
  assert.ok(images.slice(4).every((image) => image.sprite === sprite));
  assert.equal(context.globalAlpha, 1);
});

test('all preview shapes stay centered and use their smaller cached sprites', () => {
  const game = createGame();
  const context = game.context('next');
  for (const type of 'IJLOSTZ') {
    game.state.nextType = type;
    const before = context.images.length;
    game.run('drawNext()');
    const images = context.images.slice(before);
    const sprite = game.run(`blockSprites.get(PREVIEW_BLOCK).get(COLORS.${type}).get(1)`);
    assert.equal(images.length, 4);
    assert.ok(images.every((image) => image.sprite === sprite && image.alpha === 1));
    const xs = images.map(({ x }) => x + 24);
    const ys = images.map(({ y }) => y + 24);
    assert.equal((Math.min(...xs) + Math.max(...xs) + 24) / 2, 60);
    assert.equal((Math.min(...ys) + Math.max(...ys) + 24) / 2, 60);
  }
});

test('expired particles are removed at their exact lifetime boundary', () => {
  const game = createGame();
  game.run('spawnParticles(19)');
  assert.equal(game.state.particles.length, 40);
  const particles = game.state.particles;
  game.run('updateParticles(350)');
  assert.equal(particles.length, 40);
  assert.ok(particles.every((particle) => particle.life === 0.5));
  game.run('updateParticles(350)');
  assert.equal(game.state.particles, particles);
  assert.equal(particles.length, 0);
});

test('compaction keeps every live particle and removes adjacent expired ones', () => {
  const game = createGame();
  const makeParticle = (life) => ({ x: 10, y: 20, vx: 0.1, vy: -0.1, life, color: '#fff' });
  const particles = [0, 0.1, 1, 0.2, 0.3, 0.8].map(makeParticle);
  const survivors = [particles[2], particles[5]];
  game.state.particles = particles;
  game.run('updateParticles(350)');
  assert.equal(game.state.particles, particles);
  assert.deepEqual(particles, survivors);
  for (const particle of particles) {
    assert.equal(particle.x, 45);
    assert.equal(particle.y, -15);
    assert.ok(Math.abs(particle.vy - 0.18) < 1e-12);
  }
  assert.deepEqual(particles.map(({ life }) => life), [0.5, 0.8 - 0.5]);
});

test('repeated line clears retain only live bursts without cumulative growth', () => {
  const game = createGame();
  game.click('start-btn');
  for (let i = 0; i < 100; i++) {
    game.run("state.board[19].fill('T'); clearLines(); updateParticles(350)");
    assert.equal(game.state.particles.length, 40);
    assert.ok(game.state.particles.every((particle) => particle.life > 0));
  }
  assert.equal(game.state.lines, 100);
  assert.equal(game.state.board.flat().every((cell) => cell === null), true);
  game.run('updateParticles(1000)');
  assert.equal(game.state.particles.length, 0);
});

test('frame updates remove expired particles before drawing and preserve live alpha', () => {
  const game = createGame();
  game.click('start-btn');
  game.run('spawnParticles(19)');
  const context = game.context('board');
  game.frame(350);
  assert.equal(context.fills.length, 40);
  assert.ok(context.fills.every(({ alpha }) => alpha === 0.5));
  assert.equal(context.globalAlpha, 1);
  game.frame(700);
  assert.equal(game.state.particles.length, 0);
  assert.equal(context.fills.length, 40);
});

test('starting and restarting discard particles from the previous game', () => {
  const game = createGame();
  game.run('spawnParticles(19)');
  game.click('start-btn');
  assert.equal(game.state.particles.length, 0);

  for (let i = 0; i < 10; i++) {
    game.run('spawnParticles(19)');
    game.click('restart-btn');
    assert.equal(game.state.particles.length, 0);
  }
  game.run('spawnParticles(19)');
  game.endGame();
  game.click('start-btn');
  assert.equal(game.state.particles.length, 0);
});
