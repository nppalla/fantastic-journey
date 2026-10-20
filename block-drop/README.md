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

## Rendering and effects

Starting or restarting owns exactly one animation loop. A restart replaces the
pending frame and resets game timing; the initial screen does not animate.

Blocks use a fixed cache of canvas sprites for each color, size, and solid/ghost
opacity. Gradients, rounded corners, and padded shadows are rendered once, not
per cell in every frame. Baking opacity into each sprite preserves the ghost's
shadow and fill blending.

Line-clear particles expire after 700 ms of animation time and are removed from
the same array during updates. Starting or restarting clears any remaining
particles from the previous game.

## Tests

With Node.js 18 or newer, run from the repository root:

```bash
node --test block-drop/game.test.cjs
```

These dependency-free tests cover repeated restarts, pause/resume, replay,
one update/draw per frame, fixed sprite-cache work, ghost opacity, preview
centering, particle expiry, repeated line clears, and particle reset.

For real-canvas rendering and performance checks, install Chromium so that
`chromium` is on your path, then run:

```bash
node --test block-drop/game.test.cjs block-drop/game.browser.test.cjs
```

The browser check compares all colors, sizes, and opacities with the original
renderer, including clipped edges. It measures nearly-full-board drawing with
the active and ghost pieces, flushes canvas work, reports median and
95th-percentile times, and checks a 16 ms drawing budget. These measurements
describe the machine running the test, not a guarantee for every device.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Page layout, board, and side panel |
| `style.css` | Theme and layout |
| `game.js` | Game state, input, game loop, and rendering |
| `game.test.cjs` | Animation lifecycle, sprite-cache, and particle regressions |
| `game.browser.test.cjs` | Chromium pixel comparisons and drawing benchmark |
