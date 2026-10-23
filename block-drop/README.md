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

Block gradients, rounded corners, and glows are drawn once into padded canvas
sprites for each color and size. Board cells, the active and ghost pieces, and
the next-piece preview reuse those sprites instead of recreating expensive
effects for every cell on every frame.

## Accessibility

Buttons have descriptive names that follow the current game state. The board
and next-piece preview have text labels. Score, lines, and level changes,
including hard-drop points, are exposed through a polite, atomic live region.
Unchanged statistics are not rewritten.

The start, pause, and game-over overlays are labeled, non-modal dialogs. Focus
moves to the overlay action when it opens and to the board when play begins or
resumes. Focus the board to use movement keys; buttons keep native Space/Enter
activation. P pauses or resumes without moving pieces while paused.

These semantics describe controls and game status; the visual board is not a
complete nonvisual version of the game.

## Tests

From the repository root, use Node.js 18 or later (no dependencies required):

```bash
node --test block-drop/game.test.js
```

With Chromium installed, also run the real-browser checks:

```bash
node --test block-drop/game.test.js block-drop/game.browser.test.js
```

Set `CHROMIUM_BIN` if the browser executable is not named `chromium`. The browser
checks inspect the accessibility tree, exercise native keyboard activation,
and compare original and cached full-board rendering, including pixel readback.
The cached-rendering check requires a warmed p95 below 16 ms on the test machine;
timings are environment-dependent, not a guarantee for every device. Spoken
announcements still need manual checking with NVDA or VoiceOver.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Page layout, board, and side panel |
| `style.css` | Theme and layout |
| `game.js` | Game state, input, game loop, and rendering |
| `game.test.js` | Rendering and accessibility regression tests |
| `game.browser.test.js` | Chromium accessibility, keyboard, and frame-budget checks |
