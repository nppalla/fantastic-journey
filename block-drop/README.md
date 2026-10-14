# Block Drop

A falling-blocks puzzle game for the browser. It draws the board and next-piece preview on canvases using plain JavaScript.

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

## High-DPI rendering

The board stays 300 by 600 CSS pixels and the next-piece preview stays 120 by 120
CSS pixels. Both canvas backing stores scale with the display's device pixel ratio
so blocks and grid lines remain sharp on high-DPI screens and at browser zoom.
Changing zoom or moving between displays redraws both canvases without restarting
the game or changing its state. Drawing and particle positions stay in logical
CSS-pixel coordinates.

This addresses [issue #10](https://github.com/nppalla/fantastic-journey/issues/10).

## Rendering checks

With Node.js 18 or newer and Chromium installed, run from the repository root:

```bash
node --test block-drop/high-dpi.test.js
```

Set `CHROMIUM_BIN` if the executable is not named `chromium`. The browser checks
cover DPR 1, 1.25, 2, and 3, fractional zoom changes, backing dimensions, context
transforms, CSS sizes, painted pixels, grid bounds, particles, preview centering,
and preservation of game state when the display resolution changes.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Page layout, board, and side panel |
| `style.css` | Theme and layout |
| `game.js` | Game state, input, game loop, and rendering |
| `high-dpi.test.js` | Browser-based high-DPI rendering regressions |
