# Fantastic Journey Samples

Small browser games and a business app sample. They need no build step and no dependencies.

| Sample | Folder | Description |
| --- | --- | --- |
| Block Drop | [`block-drop/`](block-drop/) | Falling-blocks puzzle on a canvas |
| Merge 2048 | [`merge-2048/`](merge-2048/) | Sliding-tile number puzzle |
| Expense Tracker | [`expense-tracker/`](expense-tracker/) | Browser-local expense ledger with filters, spending summaries, and CSV export |

## Run

Open `index.html` in a browser. You can also serve the folder:

```bash
npx serve .
```

## Issues

Known defects and planned enhancements are tracked in GitHub Issues. Game issues
use a `game: ...` label; expense tracker issues use `app: expense-tracker`.
Category labels include `bug`, `enhancement`, `performance`, `ui`, `accessibility`,
and `documentation`.

See the [Expense Tracker README](expense-tracker/README.md) for usage, browser-local
data limitations, and the dependency-free model and browser check commands.
