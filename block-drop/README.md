# Block Drop

A falling-blocks puzzle game for the browser. It uses canvas rendering and plain JavaScript.

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

The board and next-piece preview use device-pixel-ratio-scaled backing stores
while keeping their layout and gameplay coordinates in CSS pixels. Resizing or
changing display scale refreshes the canvases and their cached block sprites.
Gradients and glow are rendered once per color and block size at each display
scale, then reused for board, active-piece, ghost, and preview drawing.
Restarting replaces the pending animation frame rather than adding another loop.

## Tests

With Node.js 18 or newer installed, run the dependency-free regression tests:

```bash
node --test block-drop/game.test.js
```

The suite covers restart scheduling, sprite reuse, canvas scaling, preview
centering, and particle coordinates.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Page layout, board, and side panel |
| `style.css` | Theme and layout |
| `game.js` | Game state, input, game loop, and rendering |
| `game.test.js` | Rendering and restart regression tests |
