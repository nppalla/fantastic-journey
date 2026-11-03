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

For example, sliding `2 2 4 _` left produces `4 4 _ _` and adds 4 points.
Sliding `2 2 2 2` left produces `4 4 _ _` and adds 8 points. The resulting
tiles can merge with each other on a later move, but not during the same move.

## Tests

With Node.js 18 or newer installed, run the dependency-free regression tests:

```bash
node --test merge-2048/game.test.js
```

The tests cover single-merge rules, scoring, all four move directions, and
keyboard and swipe input.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Page layout, scores, board, and help text |
| `style.css` | Theme, board, and tile colors |
| `game.js` | Game state, move logic, input, and rendering |
| `game.test.js` | Merge rules, directional moves, scoring, and input regressions |
