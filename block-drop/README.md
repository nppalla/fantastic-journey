# Block Drop

A falling-blocks puzzle game for the browser. It uses one `<canvas>` and plain JavaScript.

## Run

Open `index.html` in a browser. You can also serve the repository root:

```bash
npx serve .
```

## Controls

| Key | Action |
| --- | --- |
| Left / Right arrow | Move the piece |
| Space | Rotate the piece |
| Down arrow | Soft drop |
| Up arrow | Hard drop |
| P | Pause or resume |

## Rules

- Fill a full row to clear it.
- Every 10 cleared lines raises the level by one.
- Each level makes pieces fall faster.
- The game ends when a new piece cannot enter the board.

## Scoring

| Lines cleared at once | Points |
| --- | --- |
| 1 | 100 x level |
| 2 | 300 x level |
| 3 | 500 x level |
| 4 | 800 x level |

A hard drop gives 2 points for each row the piece falls.

## Rendering

The first game starts one update/draw loop. Restarting resets game state and the
drop timer without canceling or scheduling another loop. Keyboard input is
registered once rather than once per restart.

Block artwork is cached per color and block size. Gradients, color parsing, and
blurred glow are rendered only when a sprite is first needed; board cells,
active pieces, ghosts, and the next-piece preview reuse those sprites. Padding
preserves the glow, and ghost opacity is applied when drawing the cached image.
Only opacity is changed and restored per block, avoiding full canvas-state saves.

Line clears create 40 particles that fade over 700 ms. Each update removes expired
particles in place, retaining only live effects without allocating a new array
every frame. Starting or restarting a game clears particles from the previous
game.

## Tests

With Node.js 18 or newer installed, run the dependency-free regression tests:

```bash
node --test block-drop/game.test.js
```

For real-canvas rendering checks and dense-board timing, install Chromium and run:

```bash
node --test block-drop/game.test.js block-drop/game.browser.test.js
```

The browser executable defaults to `chromium`; set `CHROMIUM` to its path if
needed. The browser check reports cold and warmed full-board drawing times and
checks the warmed p95 against the issue's 16 ms target. Timings depend on the
machine and browser, so they are not a guarantee for every device.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Page layout, board, and side panel |
| `style.css` | Theme and layout |
| `game.js` | Game state, input, game loop, and rendering |
| `game.test.js` | Restart scheduling, input, sprite reuse, previews, and particle lifecycle regressions |
| `game.browser.test.js` | Real-canvas appearance and dense-board rendering checks |
