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
- Add and rename categories through **Manage categories**. Names are trimmed to
  1-40 characters (the browser's `maxlength`/JavaScript string length), with
  case-insensitive duplicate detection. Categories use stable IDs; renaming updates
  labels without changing expense records or totals.
- Choose a replacement explicitly before deleting a category used by expenses or
  the current form draft, then confirm. Reassignment keeps expense IDs, amounts,
  and receipts, and updates the draft's category without discarding its other fields.
  Unused categories can be deleted without reassignment; keep at least one category.
- Filter by month and category and search descriptions using a trimmed,
  case-insensitive substring. The initial view shows the current month; **Show all**
  clears all three. Totals, breakdowns, matching counts, and empty states use the
  same selection as the ledger.
- Sort by **Date**, **Description**, **Category**, or **Amount (USD)** with the
  column-header buttons (Enter or Space). Selecting a different column starts
  ascending; selecting it again reverses direction. Date starts descending.
  Amounts compare integer cents; descriptions and category names compare
  lowercased text in JavaScript lexicographic order. Equal values always use ascending expense
  ID as a deterministic tie-breaker, regardless of direction or input order.
  Active direction and matching count are announced. View changes do not save
  records or reset in-progress edits.
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
canceling does not download anything. **Filtered CSV has exactly the visible rows
in their selected sort order. All CSV ignores filters/search but uses the same
selected column, direction, and ascending-ID tie rule.** Category names use their
current labels, including renames. Keep separate fictional-image copies if you want to retain them.
No real receipts, OCR, cloud uploads, PDFs, tax calculation, authentication, or
financial/accounting integrations are included.

## Categories and receipt persistence

Expense metadata stays in `localStorage` under the original
`fantastic-journey.expenses.v1` key. **Version 3** stores a category list
(`id`, `name`) alongside expenses whose `category` is a stable category ID.
Expenses can also contain receipt metadata (identifier, filename, MIME type,
byte size). Version-1 expenses and version-2 expenses with receipts are read
without discarding records or images and upgraded on the next successful write.
Loading, searching, filtering, and sorting do not rewrite legacy storage. The
five original names become their default IDs, so existing category references
stay valid even after labels are renamed. New categories receive opaque IDs.
Do not use an older app to edit version-3 data.

Categories and expense reassignments are committed together in one localStorage
write under the same Web Lock as receipt changes. A failed write keeps the
previous categories, records, receipt references, and form drafts unchanged.
Unknown versions, unknown fields, invalid or duplicate category IDs/names, and
expenses with unknown category references disable editing instead of silently
dropping or reclassifying data. Receipt cleanup never runs when saved metadata
cannot be validated.

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

The checks cover version-1/version-2 migration, category renaming and explicit
reassignment, duplicates and length bounds, failed writes, reloads, composed search,
all sort columns/directions and ties, exact CSV order, retained drafts, and receipt
validation/lifecycle/storage failures. Real keyboard checks exercise search,
sorting, category creation, and receipt preview controls.

The browser checks also require Chromium (`chromium` on PATH, or set
`CHROMIUM_BIN`). They use an isolated temporary browser profile and a local server;
they do not touch your normal browser data. There are no test package dependencies.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Accessible form, filters, summary, and ledger |
| `style.css` | Responsive layout and theme |
| `model.js` | Stable categories, validation, search/sort, integer-cent accounting, versioned persistence, and CSV |
| `receipts.js` | Content validation, binary IndexedDB storage, locking, and orphan cleanup |
| `app.js` | Browser interactions, storage, and rendering |
| `tests/` | Model and real-browser workflow checks |
