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
| Up arrow | Rotate the piece |
| Down arrow | Soft drop |
| Space | Hard drop |
| P | Pause or resume |

Starting or resuming focuses the board. Movement and drop keys act only while
the board is focused; Space and Enter retain their normal behavior on buttons.

## Accessibility

Controls have descriptive names that track the current action. The board and
next-piece preview are labeled, and score, lines, and level share a polite,
atomic live region, including points earned by hard drops. Start, pause, and
game-over overlays are labeled non-modal dialogs; focus moves to their action
button and returns to the board when play resumes.

These features expose controls and status, not a fully nonvisual version of the
puzzle. Spoken announcements should also be checked with NVDA or VoiceOver.

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

Block artwork is cached per color, block size, and subpixel alignment. Gradients,
color parsing, and blurred glow are rendered only when a sprite is first needed;
board cells, active pieces, ghosts, and the next-piece preview reuse those sprites. Padding
preserves the glow, and ghost opacity is applied when drawing the cached image.
Only opacity is changed and restored per block, avoiding full canvas-state saves.

Board, preview, and cached sprites use device-pixel-ratio-scaled backing stores
while gameplay and CSS sizes remain in logical pixels. Display-scale changes
rebuild the artwork without resetting the game. Fractional zoom uses aligned
sprites without resampling. Grid lines align to device pixels, and preview
centering and particle bounds stay in logical coordinates.

Expired particles are removed on each update without allocating another array.
Starting or restarting clears all particles from the previous game.

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
needed. Browser checks cover artwork and grid alignment at DPR 1, 1.25, and 2,
runtime scale changes, the accessibility tree, and native keyboard activation.
They report cold and warmed full-board drawing times and check the warmed p95
against the issue's 16 ms target. Timings depend on the machine and browser, so
they are not a guarantee for every device.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Page layout, board, and side panel |
| `style.css` | Theme and layout |
| `game.js` | Game state, input, game loop, and rendering |
| `game.test.js` | Scheduling, particles, DPI scaling, accessibility, input, and sprite regressions |
| `game.browser.test.js` | Real-canvas appearance, DPI, accessibility, and dense-board rendering checks |
