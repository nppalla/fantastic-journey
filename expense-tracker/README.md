# Expense Tracker

A browser-local business sample in plain HTML, CSS, and JavaScript. No build step,
dependencies, account, or backend is required.

## Run

Open `index.html` in a browser, or serve the repository root with `npx serve .`
and open `/expense-tracker/`. Use a consistent browser and URL: storage belongs to
that browser profile and origin. File-URL storage behavior varies by browser;
serving the folder is recommended for consistent persistence.

## Features

- Add, edit, and confirm deletion of expenses.
- Record a description (up to 120 characters), date, category, and USD amount.
- Enter positive amounts from 0.01 to 999999.99 with at most two decimal places.
  Amounts are stored and summed as integer cents, not floating-point dollars.
- Filter by month and category. The initial view shows the current month; Show all
  clears both filters. Totals and category breakdowns reflect the current filters.
- Save validated, versioned data in `localStorage`. Failed saves retain the form
  draft and do not change the in-memory ledger. Stale-tab writes are rejected;
  this is not a multi-user database or an atomic cross-tab synchronization system.
- Export all expenses or just the filtered view as UTF-8 CSV, with quoted cells,
  spreadsheet-formula protection, and two-decimal USD amounts.
- Use labeled native controls, keyboard-operable actions, visible focus, and
  announced save/error feedback. The table scrolls independently on narrow screens.

This is a **fictional-data demo, not an accounting system**. Data is unencrypted,
not shared across devices, and disappears when site data is cleared. CSV is an
export, not a restorable backup; import is not implemented. No tax calculation,
receipt storage, authentication, or real financial integrations are included.

## Storage recovery

Data is stored under `fantastic-journey.expenses.v1`. If browser storage is blocked,
enable it for this origin and reload. If stored data is malformed or has an
unsupported version, the app disables editing rather than overwriting it. Preserve
the raw value with browser developer tools before repairing it. Removing that
specific key resets the ledger and **permanently deletes its saved entries**.
Do not clear all browser storage to reset this sample.

## Checks

From the repository root, with Node.js 18 or newer:

```bash
node --test expense-tracker/tests/model.test.cjs
node expense-tracker/tests/browser.cjs
```

The browser checks also require Chromium (`chromium` on PATH, or set
`CHROMIUM_BIN`). They use an isolated temporary browser profile and a local server;
they do not touch your normal browser data. There are no test package dependencies.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Accessible form, filters, summary, and ledger |
| `style.css` | Responsive layout and theme |
| `model.js` | Validation, integer-cent accounting, persistence format, and CSV |
| `app.js` | Browser interactions, storage, and rendering |
| `tests/` | Model and real-browser workflow checks |
