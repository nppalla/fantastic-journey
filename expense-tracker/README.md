# Expense Tracker

A browser-local business sample in plain HTML, CSS, and JavaScript. No build step,
dependencies, account, or backend is required.

## Run

Open `index.html` in a browser, or serve the repository root with `npx serve .`
and open `/expense-tracker/`. Use a consistent browser and URL: storage belongs to
that browser profile and origin. File-URL storage behavior varies by browser;
serving the folder is recommended for consistent persistence.
Saving expenses/categories and using receipts require a current browser with
Web Locks and IndexedDB over HTTPS or localhost.

## Features

- Add, edit, and confirm deletion of expenses.
- Record a description (up to 120 characters), date, category, and USD amount.
- Add and rename categories in **Manage categories**. Names are trimmed, limited to
  **40 characters**, and unique ignoring case. Select an existing category to
  rename it; stable IDs keep every expense associated with it. Deleting an in-use
  category requires explicitly selecting a different category for reassignment
  and confirming deletion. Keep at least one category. A draft using the deleted
  category also requires reassignment and is retained.
- Enter positive amounts from 0.01 to 999999.99 with at most two decimal places.
  Amounts are stored and summed as integer cents, not floating-point dollars.
- Filter by month and category and search descriptions case-insensitively. The
  initial view shows the current month; **Show all** clears both filters and search.
  Totals, category breakdowns, match counts and empty states reflect that view.
- Sort by date, description, category name, or amount with native column-heading
  buttons (Tab, Enter or Space); select again to reverse direction. Amounts compare
  integer cents. The active header exposes `aria-sort` and a live status announces
  direction and matching count. View changes do not write saved data or reset drafts.
- Save validated, versioned data in `localStorage`. Failed saves retain the form
  draft and do not change the in-memory ledger. Stale-tab writes are rejected;
  this is not a multi-user database or an atomic cross-tab synchronization system.
- Export all expenses or just the filtered view as UTF-8 CSV, with quoted cells,
  spreadsheet-formula protection, and two-decimal USD amounts.
- Use labeled native controls, keyboard-operable actions, visible focus, and
  announced save/error feedback. The table scrolls independently on narrow screens.
- Save an expense, then choose **Attach receipt**. The modal supports preview,
  replacement, and removal of one fictional PNG or JPEG per expense. Removing a
  receipt keeps the expense; deleting an expense also removes its receipt.
- Images must be nonempty and at most **2 MiB (2,097,152 bytes)**. The app checks
  MIME type, PNG/JPEG signature, and actual browser image decoding, not the filename.
  Renaming a PDF or a corrupt file does not make it an accepted image.
- Open **Manage receipt** with the keyboard to preview an attached image. Native
  dialog focus containment, Escape, and Close preview are supported. Temporary
  image URLs are revoked on replacement, closing the preview, and page exit.
  Pending preview loads cannot recreate a URL after page exit. Returning through
  the browser's back/forward cache restores an open preview with a fresh URL;
  closed previews stay closed.

This is a **fictional-data demo, not an accounting system**. Data is unencrypted,
not shared across devices, and disappears when site data is cleared. CSV is an
export, not a restorable backup; import is not implemented. Receipt images are
**not included in CSV**. Exporting a selection with receipts asks for confirmation;
canceling does not download anything. **Filtered CSV** uses exactly the selected
search/filter/sort view. **All CSV** ignores filters/search but retains the active
sort. The default is date descending; new sort columns start ascending. All primary
ties use description (case-insensitive English comparison), then stable expense ID
ascending, regardless of primary direction. Category sorting/CSV uses the current
name, not its ID. Keep separate fictional-image copies if you want to retain them.
No real receipts, OCR, cloud uploads, PDFs, tax calculation, authentication, or
financial/accounting integrations are included.

## Category and receipt persistence

Expense metadata stays in `localStorage` under the original
`fantastic-journey.expenses.v1` key. The **version-3** document stores category
definitions (`id`, `name`) and expenses with `categoryId` plus optional receipt
metadata (identifier, filename, MIME type, byte size). Version-1 fixed-category
expenses and version-2 expenses with receipts are validated and migrated in memory
without changing IDs, dates, descriptions, cents, or receipt references. Their
five category names map to stable lowercase IDs. The upgraded document is written
only on the next successful save; failed saves leave the original value intact.
Category and expense changes share one localStorage write under the receipt write
lock. Do not use an older app version to edit version-3 data.

Image bytes are stored as binary Blobs in the `images` object store in the
`fantastic-journey.receipts` IndexedDB database, never base64 in localStorage.
All writers use a Web Lock; use a current browser with IndexedDB and Web Locks
over HTTPS or localhost. This serializes cooperating tabs, but cannot protect
against unrelated scripts or developer tools changing storage.

Replacement writes a new immutable blob before committing its metadata; a failed
metadata save removes only the new blob and preserves the previous receipt.
Removal/deletion commits metadata first, then deletes the now-unreferenced blob.
Because IndexedDB and localStorage cannot share an atomic transaction, a failed
cleanup or interrupted save can leave an **unreferenced image**, never a reference
to a blob deliberately deleted before its metadata was saved. Cleanup errors are
visible and startup retries cleanup under the same lock using the current saved
references. Do not close the page while an action is pending.

## Storage recovery

Data is stored under `fantastic-journey.expenses.v1`. If browser storage is blocked,
enable it for this origin and reload. If stored data is malformed or has an
unsupported version, the app disables editing rather than overwriting it. Preserve
the raw value with browser developer tools before repairing it. Removing that
specific key resets the ledger and **permanently deletes its saved entries**.
Do not clear all browser storage to reset this sample.

Unknown category references, duplicate IDs/names, invalid entries, or a missing
category list stop the **entire load**; no entries are silently discarded.
Back up the raw value before manual repair. For version-1/2 data, restore a category
to its original fixed name; for version-3 data, restore the missing category
definition using the expense's exact `categoryId` (and a valid unique name).
Resolve duplicate identifiers or malformed fields against your preserved copy,
then reload. The app has no automatic recovery that guesses category assignments.

If IndexedDB is blocked or full, keep the selected file, enable browser storage
or free space, and retry. A missing receipt is reported without deleting expenses;
choose **Manage receipt** to replace it or **Remove receipt** to clear its reference.
If cleanup failed, reload after restoring storage access. Preserve both the raw
expense metadata and the IndexedDB database before attempting manual repairs.
Clearing either store independently can lose receipts; clearing site data removes
both. Browser-local does not mean encrypted or backed up.

## Checks

From the repository root, with Node.js 18 or newer:

```bash
node --test expense-tracker/tests/model.test.cjs
node expense-tracker/tests/browser.cjs
```

The browser checks also require Chromium (`chromium` on PATH, or set
`CHROMIUM_BIN`). They use an isolated temporary browser profile and a local server;
they do not touch your normal browser data. There are no test package dependencies.
Checks cover v1/v2 migrations, stable category renames and reassignments, duplicates,
failed metadata writes, reloads, combined search/filter/sort, numeric amounts,
deterministic ties, view-consistent CSV, receipt validation boundaries and corrupt
content, missing images, replacement/deletion rollback, failed cleanup, concurrent
writes, and object-URL lifecycles. Real keyboard checks exercise category management,
description search, every sort column, and receipt preview focus/closing.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Accessible form, filters, summary, and ledger |
| `style.css` | Responsive layout and theme |
| `model.js` | Validation, integer-cent accounting, persistence format, and CSV |
| `receipts.js` | Content validation, binary IndexedDB storage, locking, and orphan cleanup |
| `app.js` | Browser interactions, storage, and rendering |
| `tests/` | Model and real-browser workflow checks |
