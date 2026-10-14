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

Tile text, score boxes, and buttons meet WCAG AA's 4.5:1 text contrast threshold.
The board is a labeled 4-by-4 grid; each cell exposes its row, column, and value
(including empty cells). Tab to the board and use your screen reader's interaction
mode to send arrow keys to the game. Read the grid to inspect the updated tiles.
Score changes are announced politely with the "Score" label, without repeating
unchanged scores. New games, undo actions, and game outcomes have separate status
announcements.

This addresses [issue #24](https://github.com/nppalla/fantastic-journey/issues/24)
without changing the game rules.

## Accessibility checks

With Node.js 18 or newer and Chromium installed, run from the repository root:

```bash
node --test merge-2048/accessibility.test.js
```

Set `CHROMIUM_BIN` if the Chromium executable is not named `chromium`. The checks
load the actual game in a headless browser and verify computed contrast, grid
semantics, focus, score updates, and game-status announcements.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Page layout, scores, board, and help text |
| `style.css` | Theme, board, and tile colors |
| `game.js` | Game state, move logic, input, and rendering |
| `accessibility.test.js` | Browser-based accessibility regression checks |
