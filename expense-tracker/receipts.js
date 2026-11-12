"use strict";

const ExpenseReceipts = (() => {
  const DATABASE = "fantastic-journey.receipts";
  const STORE = "images";
  let connection;

  function open() {
    if (!connection) {
      let blocked = false;
      connection = new Promise((resolve, reject) => {
        const request = indexedDB.open(DATABASE, 1);
        request.onupgradeneeded = () => request.result.createObjectStore(STORE);
        request.onerror = () => reject(request.error);
        request.onblocked = () => {
          blocked = true;
          reject(new Error("Receipt storage is blocked. Close other tabs using this sample and retry."));
        };
        request.onsuccess = () => {
          const db = request.result;
          if (blocked) { db.close(); return; }
          db.onversionchange = () => { db.close(); connection = null; };
          resolve(db);
        };
      }).catch(error => {
        connection = null;
        throw error;
      });
    }
    return connection;
  }

  async function transaction(mode, action) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      let request;
      tx.oncomplete = () => resolve(request && request.result);
      tx.onabort = () => reject(tx.error || new Error("Receipt storage transaction was aborted."));
      // Resolve only after commit, not when an individual request succeeds.
      try {
        request = action(tx.objectStore(STORE));
      } catch (error) {
        tx.abort();
        reject(error);
      }
    });
  }

  function withWriteLock(action) {
    if (!navigator.locks) {
      return Promise.reject(new Error("Safe saving needs Web Locks. Use a current browser over HTTPS or localhost and reload."));
    }
    return navigator.locks.request("fantastic-journey.expenses.write", action);
  }

  async function validateImage(file) {
    if (!(file instanceof Blob) || !["image/png", "image/jpeg"].includes(file.type)) {
      throw new Error("Choose a fictional PNG or JPEG image. Other file types are not supported.");
    }
    if (!file.size || file.size > ExpenseModel.MAX_RECEIPT_BYTES) {
      throw new Error("Receipt images must be nonempty and no larger than 2 MiB (2,097,152 bytes).");
    }
    const bytes = new Uint8Array(await file.slice(0, 8).arrayBuffer());
    const png = [137, 80, 78, 71, 13, 10, 26, 10].every((value, i) => bytes[i] === value);
    const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    if ((file.type === "image/png" && !png) || (file.type === "image/jpeg" && !jpeg)) {
      throw new Error("The receipt content does not match its PNG or JPEG type. Choose a valid image.");
    }
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      if (!image.naturalWidth || !image.naturalHeight) throw new Error("Empty image");
    } catch (error) {
      throw new Error(`The receipt could not be decoded as an image (${error.message}). Choose a valid PNG or JPEG.`);
    } finally {
      URL.revokeObjectURL(url);
    }
    return file;
  }

  function get(id) {
    return transaction("readonly", store => store.get(id));
  }

  function put(id, file) {
    return transaction("readwrite", store => store.add(file, id));
  }

  function remove(ids) {
    return transaction("readwrite", store => {
      for (const id of ids) store.delete(id);
    });
  }

  async function reconcile(entries) {
    const keys = await transaction("readonly", store => store.getAllKeys());
    const referenced = new Set(entries.flatMap(entry => entry.receipt ? [entry.receipt.id] : []));
    const unused = keys.filter(id => !referenced.has(id));
    if (unused.length) await remove(unused);
    const stored = new Set(keys);
    return entries.filter(entry => entry.receipt && !stored.has(entry.receipt.id));
  }

  return Object.freeze({ withWriteLock, validateImage, get, put, remove, reconcile });
})();
