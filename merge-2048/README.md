# Merge 2048

A sliding-tile number puzzle for the browser. It uses plain HTML, CSS, and JavaScript.

## Run

Open `index.html` in a browser. You can also serve the repository root:

```bash
npx serve .
```

## Controls

| Input | Action |
| --- | --- |
| Arrow keys | Slide all tiles |
| Swipe | Slide all tiles on a touch screen |
| Undo | Go back one move |
| New game | Start again |

## Rules

- Each move slides every tile as far as it can go.
- Two touching tiles with the same number merge into one tile.
- A tile merges only once in each move.
- A move that changes nothing does not count.
- Each valid move adds a new 2 or 4 tile.
- You win when you make a 2048 tile.
- The game ends when no move can change the board.

## Scoring

Each merge adds the value of the new tile to your score. The best score is saved in the browser.

## Accessibility

- Tile text from 2 through 2048 meets WCAG AA contrast of at least 4.5:1.
- Tab to the labelled game board to focus it. Screen reader users can browse it as a four-by-four table, with labels for each tile's row, column, and value (including empty cells). Switch to focus or pass-through mode to play with the arrow keys.
- Score changes are announced politely with the score label. Unchanged scores are not re-announced.
- Win and game-over messages are announced without needing to find the overlay.

## Checks

With Node.js and Chromium installed, run:

```bash
node --test merge-2048/game.browser.test.js
```

Run this command from the repository root. Set `CHROMIUM` to the browser executable if it is not named `chromium`. The checks cover rendered text contrast, board semantics and layout, keyboard focus, and live-region updates.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Page layout, scores, board, and help text |
| `style.css` | Theme, board, and tile colors |
| `game.js` | Game state, move logic, input, and rendering |
| `game.browser.test.js` | Chromium accessibility regression checks |
