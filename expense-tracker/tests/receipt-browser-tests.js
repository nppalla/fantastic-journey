"use strict";

async function checkReceipts(frame, check, load, idle) {
  const key = "fantastic-journey.expenses.v1";
  const limit = 2 * 1024 * 1024;
  const get = id => frame.contentDocument.getElementById(id);
  const win = () => frame.contentWindow;
  const saved = () => JSON.parse(localStorage.getItem(key)).expenses;
  const buttons = action => [...get("expenses").querySelectorAll(`button[data-action="${action}"]`)];
  const click = async id => { get(id).click(); await idle(); };
  const manage = async () => { buttons("receipt")[0].click(); await idle(); };
  const close = () => new Promise(resolve => {
    get("receipt-dialog").addEventListener("close", resolve, { once: true });
    get("close-receipt").click();
  });
  const select = file => {
    const transfer = new (win().DataTransfer)();
    transfer.items.add(file);
    get("receipt-file").files = transfer.files;
  };
  const choose = async file => { select(file); await click("save-receipt"); };
  const file = (parts, name, type) => new (win().File)(parts, name, { type });
  const receipt = () => saved()[0].receipt;
  const image = async type => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 8;
    const context = canvas.getContext("2d");
    context.fillStyle = "#123456";
    context.fillRect(0, 0, 8, 8);
    return new Promise(resolve => canvas.toBlob(resolve, type));
  };
  const storage = async (mode, action) => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("fantastic-journey.receipts", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction("images", mode);
        const request = action(tx.objectStore("images"));
        tx.oncomplete = () => resolve(request && request.result);
        tx.onabort = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  };
  const keys = () => storage("readonly", store => store.getAllKeys());

  localStorage.setItem(key, JSON.stringify({ version: 1, expenses: [{
    id: "fictional-lunch", description: "Fictional lunch", date: "2026-11-12", category: "Meals", cents: 1234
  }] }));
  frame.style.width = "1000px";
  await load();
  get("all-expenses").click();
  check(saved().length === 1 && get("total").textContent === "$12.34",
    "version-1 expenses load unchanged before attaching receipts");
  await manage();
  check(get("receipt-dialog").open && get("receipt-preview").hidden && get("remove-receipt").disabled,
    "receipt dialog supports an expense without an attachment");

  const png = await image("image/png");
  const jpeg = await image("image/jpeg");
  const invalid = [
    file(["%PDF-1.0 fictional"], "pretend.png", "application/pdf"),
    file(["<svg></svg>"], "pretend.png", "image/png"),
    file([png], "mismatch.jpg", "image/jpeg"),
    file([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], "corrupt.png", "image/png"),
    file([], "empty.png", "image/png"),
    file([new Uint8Array(limit + 1)], "oversized.png", "image/png")
  ];
  for (const bad of invalid) {
    await choose(bad);
    check(!get("receipt-error").hidden && !receipt() && (await keys()).length === 0,
      `invalid input is visibly rejected without storing bytes: ${bad.name} (${bad.type}, ${bad.size})`);
  }
  const boundary = file([png, new Uint8Array(limit - png.size)], "boundary.png", "image/png");
  select(boundary);
  await win().eval("ExpenseReceipts").validateImage(get("receipt-file").files[0]);
  check(boundary.size === limit, "exact 2 MiB limit accepts a decodable PNG");

  const created = new Set();
  const revoked = new Set();
  const trackUrls = () => {
    const originalCreate = win().URL.createObjectURL;
    const originalRevoke = win().URL.revokeObjectURL;
    win().URL.createObjectURL = blob => {
      const url = originalCreate.call(win().URL, blob);
      if (blob.type.startsWith("image/")) created.add(url);
      return url;
    };
    win().URL.revokeObjectURL = url => { revoked.add(url); originalRevoke.call(win().URL, url); };
  };
  trackUrls();

  await choose(file([png], "fictional.png", "image/png"));
  const originalReceipt = receipt();
  check(originalReceipt.type === "image/png" && originalReceipt.size === png.size &&
    JSON.parse(localStorage.getItem(key)).version === 2, "attaching stores version-2 metadata without losing the expense");
  const storedPng = await storage("readonly", store => store.get(originalReceipt.id));
  check(storedPng instanceof Blob && storedPng.size === png.size &&
    !localStorage.getItem(key).includes("base64"), "receipt bytes are binary IndexedDB blobs, not localStorage data");
  check(!get("receipt-preview").hidden && get("receipt-preview").alt.includes("Fictional lunch") &&
    !revoked.has(get("receipt-preview").src), "receipt preview has descriptive text and a live image URL");
  const initialUrl = get("receipt-preview").src;
  await close();
  check(revoked.has(initialUrl) && [...created].every(url => revoked.has(url)),
    "closing the dialog revokes all temporary validation and preview URLs");

  await load();
  trackUrls();
  get("all-expenses").click();
  await manage();
  check(receipt().id === originalReceipt.id && !get("receipt-preview").hidden,
    "receipt metadata and image preview persist after reload");
  await close();

  buttons("edit")[0].click();
  get("description").value = "Draft stays here";
  await manage();
  const replacedUrl = get("receipt-preview").src;
  await choose(file([jpeg], "replacement.jpg", "image/jpeg"));
  const replacement = receipt();
  check(replacement.id !== originalReceipt.id && replacement.type === "image/jpeg" &&
    (await keys()).join() === replacement.id, "replacement stores JPEG and deletes only the obsolete blob");
  check(revoked.has(replacedUrl) && !revoked.has(get("receipt-preview").src),
    "replacement revokes the old preview URL while keeping the new preview live");
  check(get("description").value === "Draft stays here" && !get("cancel").hidden,
    "receipt management preserves an in-progress expense edit");
  await close();
  get("expense-form").requestSubmit();
  await idle();
  check(receipt().id === replacement.id && saved()[0].description === "Draft stays here",
    "editing expense fields preserves the receipt reference");

  await manage();
  const before = localStorage.getItem(key);
  const originalSet = win().Storage.prototype.setItem;
  win().Storage.prototype.setItem = () => { throw new (win().DOMException)("Metadata quota", "QuotaExceededError"); };
  await choose(file([png], "retry.png", "image/png"));
  check(localStorage.getItem(key) === before && (await keys()).join() === replacement.id &&
    get("receipt-file").files.length === 1 && get("receipt-error").textContent.includes("No changes"),
    "failed metadata replacement preserves the previous image and selected retry file");
  win().confirm = () => true;
  await click("remove-receipt");
  check(localStorage.getItem(key) === before && (await keys()).join() === replacement.id,
    "failed metadata removal keeps the old reference and image consistent");
  win().Storage.prototype.setItem = originalSet;

  const originalAdd = win().IDBObjectStore.prototype.add;
  win().IDBObjectStore.prototype.add = () => { throw new Error("Image storage unavailable"); };
  await choose(file([png], "retry.png", "image/png"));
  check(localStorage.getItem(key) === before && (await keys()).join() === replacement.id &&
    get("receipt-error").textContent.includes("Image storage unavailable"),
    "IndexedDB write failure leaves old metadata and bytes untouched");
  win().IDBObjectStore.prototype.add = originalAdd;

  const originalTransaction = win().IDBDatabase.prototype.transaction;
  win().IDBDatabase.prototype.transaction = function (...args) {
    const tx = originalTransaction.apply(this, args);
    if (args[1] === "readwrite") queueMicrotask(() => tx.abort());
    return tx;
  };
  await choose(file([png], "aborted.png", "image/png"));
  check(localStorage.getItem(key) === before && (await keys()).join() === replacement.id &&
    !get("receipt-error").hidden, "aborted IndexedDB transaction is not mistaken for a committed image");
  win().IDBDatabase.prototype.transaction = originalTransaction;

  const originalDelete = win().IDBObjectStore.prototype.delete;
  win().Storage.prototype.setItem = () => { throw new Error("Metadata blocked"); };
  win().IDBObjectStore.prototype.delete = () => { throw new Error("Cleanup blocked"); };
  await choose(file([png], "orphan.png", "image/png"));
  check(localStorage.getItem(key) === before && (await keys()).length === 2 &&
    get("receipt-error").textContent.includes("cleanup also failed"),
    "failed rollback reports an unreferenced blob without dangling expense references");
  win().Storage.prototype.setItem = originalSet;
  win().IDBObjectStore.prototype.delete = originalDelete;
  await close();
  await load();
  get("all-expenses").click();
  check((await keys()).join() === replacement.id && receipt().id === replacement.id,
    "reload reclaims failed-rollback orphan while preserving the referenced receipt");

  let downloads = 0;
  win().HTMLAnchorElement.prototype.click = () => { downloads++; };
  let warning = "";
  win().confirm = message => { warning = message; return false; };
  await click("export-all");
  check(!downloads && warning.includes("does not include receipt"), "CSV cancellation warns that receipts are omitted and downloads nothing");
  win().confirm = () => true;
  await click("export-filtered");
  await click("export-all");
  check(downloads === 2, "both filtered and all CSV exports proceed after receipt-omission confirmation");

  await manage();
  win().confirm = () => false;
  await click("remove-receipt");
  check(receipt().id === replacement.id, "canceling receipt removal keeps metadata and image");
  win().confirm = () => true;
  await click("remove-receipt");
  check(!receipt() && !(await keys()).length && get("receipt-preview").hidden &&
    get("total").textContent === "$12.34", "removing a receipt deletes bytes and reference without changing expense totals");

  await choose(file([png], "missing.png", "image/png"));
  await storage("readwrite", store => store.delete(receipt().id));
  await close();
  await load();
  get("all-expenses").click();
  check(get("error").textContent.includes("missing") && saved().length === 1 && receipt(),
    "startup reports missing attachments without silently discarding expenses or references");
  await manage();
  check(get("receipt-error").textContent.includes("Replace") && get("receipt-preview").hidden,
    "missing preview offers actionable replacement or removal");
  await choose(file([jpeg], "recovered.jpg", "image/jpeg"));
  check(!get("receipt-preview").hidden && (await keys()).join() === receipt().id,
    "replacement recovers a missing attachment");
  await storage("readwrite", store => store.delete(receipt().id));
  await close();
  await manage();
  win().confirm = () => true;
  await click("remove-receipt");
  check(!receipt() && saved().length === 1, "removal clears a missing attachment reference while retaining the expense");

  await choose(file([png], "cleanup.png", "image/png"));
  const cleanupId = receipt().id;
  const deleteMethod = win().IDBObjectStore.prototype.delete;
  win().IDBObjectStore.prototype.delete = () => { throw new Error("Deletion blocked"); };
  await click("remove-receipt");
  check(!receipt() && (await keys()).includes(cleanupId) && get("receipt-error").textContent.includes("were saved"),
    "cleanup failure is explicit after metadata removal and cannot leave a dangling reference");
  win().IDBObjectStore.prototype.delete = deleteMethod;
  await close();
  await load();
  get("all-expenses").click();
  check(!(await keys()).length && saved().length === 1, "reload retries failed deletion cleanup");

  await manage();
  await choose(file([png], "stale.png", "image/png"));
  const staleId = receipt().id;
  const addMethod = win().IDBObjectStore.prototype.add;
  win().IDBObjectStore.prototype.add = function (...args) {
    const external = JSON.parse(localStorage.getItem(key));
    external.expenses.push({ id: "other-tab", description: "Other tab", date: "2026-11-12", category: "Other", cents: 1 });
    localStorage.setItem(key, JSON.stringify(external));
    return addMethod.apply(this, args);
  };
  await choose(file([jpeg], "conflict.jpg", "image/jpeg"));
  check(saved().length === 2 && receipt().id === staleId && (await keys()).join() === staleId &&
    get("receipt-error").textContent.includes("another tab"),
    "a competing metadata change during image storage is rejected and new bytes rolled back");
  win().IDBObjectStore.prototype.add = addMethod;
  await close();
  await load();
  get("all-expenses").click();

  const receiptButton = buttons("receipt").find(button => button.dataset.id === "fictional-lunch");
  receiptButton.click();
  await idle();
  const getMethod = win().IDBObjectStore.prototype.get;
  win().IDBObjectStore.prototype.get = () => { throw new Error("Read access denied"); };
  await close();
  receiptButton.click();
  await idle();
  check(get("receipt-error").textContent.includes("Read access denied") && receipt().id === staleId,
    "receipt read errors are visible without changing persisted references");
  win().IDBObjectStore.prototype.get = getMethod;
  await close();

  const setMethod = win().Storage.prototype.setItem;
  win().Storage.prototype.setItem = () => { throw new Error("Deletion metadata blocked"); };
  win().confirm = () => true;
  buttons("delete").find(button => button.dataset.id === "fictional-lunch").click();
  await idle();
  check(saved().some(entry => entry.id === "fictional-lunch") && (await keys()).includes(staleId),
    "failed expense deletion preserves its receipt and metadata");
  win().Storage.prototype.setItem = setMethod;
  buttons("delete").find(button => button.dataset.id === "fictional-lunch").click();
  await idle();
  check(!saved().some(entry => entry.id === "fictional-lunch") && !(await keys()).length,
    "successful expense deletion also deletes its receipt image");

  let release;
  let ready;
  const started = new Promise(resolve => { ready = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const held = navigator.locks.request("fantastic-journey.expenses.write", async () => {
    await storage("readwrite", store => store.add(png, "in-flight"));
    ready();
    await gate;
  });
  await started;
  const previousDocument = frame.contentDocument;
  const loading = load();
  try {
    for (let i = 0; i < 500; i++) {
      if (frame.contentDocument !== previousDocument && frame.contentDocument?.body?.dataset.busy === "true") break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    check(frame.contentDocument !== previousDocument && frame.contentDocument?.body?.dataset.busy === "true",
      "startup reconciliation remains pending while another tab holds the write lock");
    const latest = JSON.parse(localStorage.getItem(key));
    latest.expenses[0].receipt = { id: "in-flight", name: "fictional.png", type: "image/png", size: png.size };
    localStorage.setItem(key, JSON.stringify(latest));
  } finally {
    release();
  }
  await held;
  await loading;
  check((await keys()).join() === "in-flight",
    "startup cleanup waits for a concurrent writer's Web Lock and preserves its newly referenced blob");
  await load();
  get("all-expenses").click();
  await manage();
  check(!get("receipt-preview").hidden, "the concurrently committed receipt remains previewable after reload");
  trackUrls();
  await close();
  await manage();
  const leavingUrl = get("receipt-preview").src;
  win().dispatchEvent(new (win().PageTransitionEvent)("pagehide"));
  check(revoked.has(leavingUrl) && get("receipt-preview").hidden,
    "page exit revokes the current preview URL");
  await close();
  win().dispatchEvent(new (win().PageTransitionEvent)("pageshow", { persisted: true }));
  await idle();
  check(!get("receipt-dialog").open && !get("receipt-preview").hasAttribute("src"),
    "returning to a cached page does not reopen a closed receipt dialog");

  const originalDecode = win().HTMLImageElement.prototype.decode;
  let finishDecode;
  let signalDecode;
  const decoding = new Promise(resolve => { signalDecode = resolve; });
  const decodeGate = new Promise(resolve => { finishDecode = resolve; });
  win().HTMLImageElement.prototype.decode = async function () {
    await originalDecode.call(this);
    signalDecode();
    await decodeGate;
  };
  try {
    buttons("receipt")[0].click();
    await decoding;
    win().dispatchEvent(new (win().PageTransitionEvent)("pagehide", { persisted: true }));
  } finally {
    finishDecode();
    win().HTMLImageElement.prototype.decode = originalDecode;
  }
  await idle();
  check(get("receipt-preview").hidden && !get("receipt-preview").hasAttribute("src") &&
    [...created].every(url => revoked.has(url)),
    "a preview that finishes loading after page exit does not recreate a live image URL");

  win().dispatchEvent(new (win().PageTransitionEvent)("pageshow", { persisted: true }));
  await idle();
  const restoredUrl = get("receipt-preview").src;
  check(get("receipt-dialog").open && !get("receipt-preview").hidden &&
    restoredUrl !== leavingUrl && !revoked.has(restoredUrl) && receipt().id === "in-flight",
    "returning to a cached page restores an open receipt preview with a fresh live URL");
  win().dispatchEvent(new (win().PageTransitionEvent)("pagehide", { persisted: true }));
  check(revoked.has(restoredUrl), "leaving a restored page revokes its replacement preview URL");
  win().dispatchEvent(new (win().PageTransitionEvent)("pageshow", { persisted: true }));
  await idle();
  check(!get("receipt-preview").hidden && !revoked.has(get("receipt-preview").src),
    "receipt previews survive repeated cached-page hide and restore cycles");
  await close();
  check([...created].every(url => revoked.has(url)), "closing a restored preview releases every temporary image URL");

  const beforeBlocked = localStorage.getItem(key);
  const transactionMethod = win().IDBDatabase.prototype.transaction;
  win().IDBDatabase.prototype.transaction = () => { throw new Error("IndexedDB blocked at startup"); };
  const script = frame.contentDocument.createElement("script");
  script.src = "app.js";
  await new Promise((resolve, reject) => {
    script.onload = resolve;
    script.onerror = reject;
    frame.contentDocument.body.append(script);
  });
  await idle();
  check(get("error").textContent.includes("IndexedDB blocked at startup") && localStorage.getItem(key) === beforeBlocked,
    "startup receipt-storage failure is visible and preserves saved expenses");
  win().IDBDatabase.prototype.transaction = transactionMethod;
  await load();
  get("all-expenses").click();

  Object.defineProperty(win().navigator, "locks", { configurable: true, value: undefined });
  buttons("edit")[0].click();
  get("description").value = "Cannot overwrite without a lock";
  get("expense-form").requestSubmit();
  await idle();
  check(get("error").textContent.includes("Web Locks") && localStorage.getItem(key) === beforeBlocked &&
    get("description").value === "Cannot overwrite without a lock",
    "unsupported safe-write locking reports an actionable error and retains the draft");
  delete win().navigator.locks;
}
