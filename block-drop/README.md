# Block Drop

A falling-blocks puzzle game for the browser. It uses one `<canvas>` and plain JavaScript.

## Run

Open `index.html` in a browser. You can also serve the repository root:

```bash
npx serve .
```

The board and next-piece preview scale their canvas backing stores with the
display's pixel density, including browser zoom and moves between monitors.
Their on-page sizes and game coordinates stay unchanged.

## Accessibility

Start, pause/resume, and restart controls have descriptive accessible names.
The overlay is a labeled, non-modal dialog: focus moves to its action button
when it opens and returns to the board when play starts or resumes. The board
and next-piece preview have text labels. Score, lines, and level are announced
together in a polite live region when they change, including hard-drop points.

Game movement keys work while the board has focus; buttons retain native
Space/Enter activation. Tab moves between the board and controls, and P pauses
or resumes a running game.

## Tests

With Node.js 18 or newer, run the dependency-free canvas and accessibility
regression tests from the repository root:

```bash
node --test block-drop/game.test.cjs
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

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Page layout, board, and side panel |
| `style.css` | Theme and layout |
| `game.js` | Game state, input, game loop, and rendering |
| `game.test.cjs` | Canvas scaling and accessible controls/state regression tests |
