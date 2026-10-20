'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { mkdtempSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { test } = require('node:test');
const { pathToFileURL } = require('node:url');

function browserChecks() {
  function referenceDrawBlock(context, px, py, color, size, alpha = 1) {
    const gradient = context.createLinearGradient(px, py, px + size, py + size);
    gradient.addColorStop(0, lighten(color, 0.35));
    gradient.addColorStop(1, color);
    context.save();
    context.globalAlpha = alpha;
    context.shadowColor = color;
    context.shadowBlur = 12;
    context.fillStyle = gradient;
    context.beginPath();
    context.roundRect(px + 1, py + 1, size - 2, size - 2, 5);
    context.fill();
    context.restore();
  }

  const result = document.createElement('pre');
  result.id = 'browser-result';
  document.body.append(result);
  try {
    const reference = document.createElement('canvas');
    const actual = document.createElement('canvas');
    reference.width = reference.height = actual.width = actual.height = 96;
    const referenceCtx = reference.getContext('2d', { willReadFrequently: true });
    const actualCtx = actual.getContext('2d', { willReadFrequently: true });
    let maxDifference = 0;
    let totalDifference = 0;
    let comparedChannels = 0;
    for (const size of [BLOCK, PREVIEW_BLOCK]) {
      for (const color of Object.values(COLORS)) {
        for (const alpha of [1, 0.18]) {
          for (const position of [0, 30, 96 - size]) {
            referenceCtx.fillStyle = actualCtx.fillStyle = '#0e1530';
            referenceCtx.fillRect(0, 0, 96, 96);
            actualCtx.fillRect(0, 0, 96, 96);
            referenceDrawBlock(referenceCtx, position, position, color, size, alpha);
            drawBlock(actualCtx, position, position, color, size, alpha);
            const expected = referenceCtx.getImageData(0, 0, 96, 96).data;
            const rendered = actualCtx.getImageData(0, 0, 96, 96).data;
            for (let i = 0; i < expected.length; i++) {
              const difference = Math.abs(expected[i] - rendered[i]);
              maxDifference = Math.max(maxDifference, difference);
              totalDifference += difference;
            }
            comparedChannels += expected.length;
          }
        }
      }
    }

    startGame();
    state.board = createBoard().map((row, y) =>
      row.map((_, x) => y > 0 ? Object.keys(COLORS)[(x + y) % 7] : null));
    state.piece = createPiece('I');

    function measure(count) {
      for (let i = 0; i < 10; i++) {
        draw();
        ctx.getImageData(0, 0, 1, 1);
      }
      const samples = [];
      for (let i = 0; i < count; i++) {
        const start = performance.now();
        draw();
        ctx.getImageData(0, 0, 1, 1);
        samples.push(performance.now() - start);
      }
      samples.sort((a, b) => a - b);
      return {
        medianMs: samples[Math.floor(samples.length / 2)],
        p95Ms: samples[Math.ceil(samples.length * 0.95) - 1],
        samples: count,
      };
    }

    const cachedDrawBlock = drawBlock;
    const optimized = measure(120);
    drawBlock = referenceDrawBlock;
    const original = measure(60);
    drawBlock = cachedDrawBlock;
    result.textContent = encodeURIComponent(JSON.stringify({
      maxDifference,
      meanDifference: totalDifference / comparedChannels,
      optimized,
      original,
    }));
  } catch (error) {
    result.textContent = encodeURIComponent(JSON.stringify({ error: error.stack }));
  }
}

test('Chromium renders cached blocks and measures nearly-full-board frame cost', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'block-drop-browser-'));
  const htmlPath = join(directory, 'index.html');
  const source = readFileSync(join(__dirname, 'game.js'), 'utf8');
  const page = readFileSync(join(__dirname, 'index.html'), 'utf8')
    .replace('<head>', `<head><base href="${pathToFileURL(`${__dirname}/`).href}">`)
    .replace('<script src="game.js"></script>', `<script>${source}\n(${browserChecks.toString()})();</script>`);
  writeFileSync(htmlPath, page);
  try {
    const output = execFileSync('chromium', [
      '--headless', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
      '--disable-background-networking', '--dump-dom', pathToFileURL(htmlPath).href,
    ], { encoding: 'utf8', timeout: 90000, maxBuffer: 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
    const match = output.match(/<pre id="browser-result">([^<]+)<\/pre>/);
    assert.ok(match, 'browser must return canvas measurements');
    const result = JSON.parse(decodeURIComponent(match[1]));
    assert.equal(result.error, undefined, result.error);
    t.diagnostic(JSON.stringify(result));
    assert.ok(result.maxDifference <= 3, `maximum channel difference: ${result.maxDifference}`);
    assert.ok(result.meanDifference < 0.15, `mean channel difference: ${result.meanDifference}`);
    assert.ok(result.optimized.p95Ms < 16, `95th-percentile board draw: ${result.optimized.p95Ms}ms`);
    assert.ok(result.optimized.medianMs < result.original.medianMs, 'sprite rendering must improve frame cost');
  } finally {
    unlinkSync(htmlPath);
    rmdirSync(directory);
  }
});
