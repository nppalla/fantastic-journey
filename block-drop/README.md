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
- Automatic falling has a minimum interval of 100 ms, including at level 11 and above.
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

Block gradients and glows are cached as sprites instead of rebuilt for every cell
in every frame. The board, landing-position preview, and next-piece preview reuse
these sprites.

The game keeps one animation loop and one keyboard listener across restarts.
Expired line-clear particles are removed, and restarting clears remaining particles.

The board, next-piece preview, and cached sprites use device-pixel-ratio-scaled
backing stores without changing game coordinates or the displayed canvas sizes.
Browser zoom and display-density changes refresh the canvases and sprite cache.

## Regression checks

With Node.js 18 or newer, run the dependency-free checks from the repository root:

```bash
node --test block-drop/game.test.js
```

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Page layout, board, and side panel |
| `style.css` | Theme and layout |
| `game.js` | Game state, input, game loop, and rendering |
| `game.test.js` | Regression checks for gravity, input, animation, particles, and high-DPI rendering |
