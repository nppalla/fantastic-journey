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
- Pieces fall every 1000 ms at level 1, speeding up by 100 ms per level to a minimum interval of 100 ms at level 10 and above.
- The game ends when a new piece cannot enter the board.

## Scoring

| Lines cleared at once | Points |
| --- | --- |
| 1 | 100 x level |
| 2 | 300 x level |
| 3 | 500 x level |
| 4 | 800 x level |

A hard drop gives 2 points for each row the piece falls.

## Tests

With Node.js 18 or newer, run from the repository root:

```bash
node --test block-drop/drop-interval.test.js
```

These dependency-free checks cover level-based intervals, automatic drop timing, manual soft drops, and paused games.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Page layout, board, and side panel |
| `style.css` | Theme and layout |
| `game.js` | Game state, input, game loop, and rendering |
| `drop-interval.test.js` | Regression checks for drop intervals and game-loop timing |
