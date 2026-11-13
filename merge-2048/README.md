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

## Rendering

The board reuses its 16 cells and tile elements. Only changed or newly spawned
tiles animate; unchanged tiles keep their current animations. CSS container
queries size labels on narrow boards without JavaScript layout reads.

## Tests

Run the rendering regression tests with Node.js and Chromium installed:

```bash
node --test merge-2048/game.browser.test.js
```

Run this command from the repository root. Set `CHROMIUM` to the browser executable
path if it is not named `chromium`. The tests check element reuse, animations,
responsive sizing, game controls, and Chromium traces for synchronous layouts
during rendering.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Page layout, scores, board, and help text |
| `style.css` | Theme, board, and tile colors |
| `game.js` | Game state, move logic, input, and rendering |
