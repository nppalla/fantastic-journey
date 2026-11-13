"use strict";

(() => {
  const model = ExpenseModel;
  const receipts = ExpenseReceipts;
  const get = id => document.getElementById(id);
  const form = get("expense-form");
  const description = get("description");
  const date = get("date");
  const category = get("category");
  const amount = get("amount");
  const monthFilter = get("month-filter");
  const categoryFilter = get("category-filter");
  const error = get("error");
  const status = get("status");
  const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  let entries = [];
  let editingId = null;
  let busy = false;
  let receiptEntryId = null;
  let previewUrl = null;
  let pageActive = true;
  const dialog = get("receipt-dialog");

  function showError(message) {
    status.textContent = "";
    error.textContent = message;
    error.hidden = false;
    get("receipt-error").textContent = message;
    get("receipt-error").hidden = false;
  }

  function clearError() {
    error.hidden = true;
    error.textContent = "";
    get("receipt-error").hidden = true;
    get("receipt-error").textContent = "";
  }

  function setBusy(value) {
    busy = value;
    document.body.dataset.busy = String(value);
    get("entry-fields").disabled = value;
    get("receipt-fields").disabled = value;
    get("close-receipt").setAttribute("aria-disabled", String(value));
    get("remove-receipt").disabled = !entries.find(entry => entry.id === receiptEntryId)?.receipt;
    for (const button of get("expenses").querySelectorAll("button")) button.disabled = value;
  }

  async function runAction(action) {
    if (busy) return;
    const focused = document.activeElement;
    setBusy(true);
    try {
      await action();
    } catch (cause) {
      showError(`Could not complete the action (${cause.message}). Check browser storage access and retry.`);
    } finally {
      setBusy(false);
      if (focused?.isConnected && dialog.open &&
          [document.body, dialog].includes(document.activeElement)) focused.focus();
    }
  }

  function resetForm() {
    editingId = null;
    form.reset();
    date.value = today;
    get("form-title").textContent = "Add expense";
    get("save").textContent = "Add expense";
    get("cancel").hidden = true;
  }

  function visibleEntries() {
    return model.filter(entries, monthFilter.value, categoryFilter.value);
  }

  function render() {
    const visible = visibleEntries();
    const summary = model.summarize(visible);
    get("total").textContent = money.format(summary.cents / 100);
    get("count").textContent = String(summary.count);
    get("breakdown").replaceChildren(...summary.categories.filter(item => item.cents > 0).map(item => {
      const li = document.createElement("li");
      li.textContent = `${item.category}: ${money.format(item.cents / 100)}`;
      return li;
    }));
    get("empty").hidden = visible.length > 0;
    get("empty").textContent = entries.length
      ? "No expenses match these filters. Try another month or choose Show all."
      : "No expenses yet. Add your first expense to get started.";
    get("table-wrap").hidden = visible.length === 0;
    get("export-filtered").disabled = visible.length === 0;
    get("export-all").disabled = entries.length === 0;
    get("expenses").replaceChildren(...visible.map(entry => {
      const row = document.createElement("tr");
      for (const value of [entry.date, entry.description, entry.category, money.format(entry.cents / 100)]) {
        const cell = document.createElement("td");
        cell.textContent = value;
        row.append(cell);
      }
      row.children[3].className = "money";
      const actions = document.createElement("td");
      const buttons = document.createElement("div");
      buttons.className = "row-actions";
      for (const action of ["Edit", "Delete", "Receipt"]) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = action === "Receipt" ? (entry.receipt ? "Manage receipt" : "Attach receipt") : action;
        button.disabled = busy;
        button.dataset.id = entry.id;
        button.dataset.action = action.toLowerCase();
        button.setAttribute("aria-label", `${button.textContent} ${entry.description}, ${entry.date}, ${money.format(entry.cents / 100)}`);
        buttons.append(button);
      }
      actions.append(buttons);
      row.append(actions);
      return row;
    }));
  }

  function persist(next) {
    let serialized;
    try {
      serialized = model.encode(next);
    } catch (cause) {
      showError(cause.message);
      return false;
    }
    try {
      // Refuse stale writes rather than silently overwriting changes from another tab.
      const stored = model.decode(localStorage.getItem(model.STORAGE_KEY));
      if (model.encode(stored) !== model.encode(entries)) {
        showError("Expenses changed in another tab. Reload this page before saving; your draft is still in the form.");
        return false;
      }
      localStorage.setItem(model.STORAGE_KEY, serialized);
    } catch (cause) {
      showError(`Could not save expenses (${cause.message}). No changes were applied. Your draft is still in the form.`);
      return false;
    }
    entries = next;
    clearError();
    return true;
  }

  async function commit(next, attachment = null) {
    model.encode(next);
    return receipts.withWriteLock(async () => {
      if (model.encode(model.decode(localStorage.getItem(model.STORAGE_KEY))) !== model.encode(entries)) {
        showError("Expenses changed in another tab. Reload before saving; your draft and existing receipt are unchanged.");
        return false;
      }
      const previous = entries.flatMap(entry => entry.receipt ? [entry.receipt.id] : []);
      if (attachment) {
        try {
          await receipts.put(attachment.id, attachment.file);
        } catch (cause) {
          showError(`Could not store receipt (${cause.message}). No expense changes were applied. Keep the selected file and retry.`);
          return false;
        }
      }
      if (!persist(next)) {
        if (attachment) {
          try {
            await receipts.remove([attachment.id]);
          } catch (cause) {
            showError(`${error.textContent} Unreferenced image cleanup also failed (${cause.message}); reload to retry cleanup.`);
          }
        }
        return false;
      }
      const current = new Set(next.flatMap(entry => entry.receipt ? [entry.receipt.id] : []));
      const unused = previous.filter(id => !current.has(id));
      if (unused.length) {
        try {
          await receipts.remove(unused);
        } catch (cause) {
          showError(`Expense changes were saved, but old image cleanup failed (${cause.message}). No expense references the old image. Reload to retry cleanup.`);
        }
      }
      return true;
    });
  }

  function newId() {
    let id;
    do {
      id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    } while (entries.some(entry => entry.id === id));
    return id;
  }

  form.addEventListener("submit", event => {
    event.preventDefault();
    if (busy) return;
    let entry;
    try {
      entry = model.validateExpense({
        ...entries.find(item => item.id === editingId),
        id: editingId || newId(),
        description: description.value,
        date: date.value,
        category: category.value,
        cents: model.parseAmount(amount.value)
      });
    } catch (cause) {
      showError(cause.message);
      return;
    }
    runAction(async () => {
      const wasEditing = editingId !== null;
      const next = wasEditing ? entries.map(item => item.id === editingId ? entry : item) : [...entries, entry];
      if (!await commit(next)) return;
      resetForm();
      render();
      const hiddenByFilters = !visibleEntries().some(item => item.id === entry.id);
      status.textContent = `Expense ${wasEditing ? "updated" : "added"}.${hiddenByFilters ? " It is outside the current filters; choose Show all to see it." : ""}`;
    }).then(() => { if (!busy) description.focus(); });
  });

  get("cancel").addEventListener("click", () => {
    resetForm();
    clearError();
    status.textContent = "Edit cancelled. No changes saved.";
    description.focus();
  });

  get("expenses").addEventListener("click", event => {
    const button = event.target.closest("button[data-id]");
    if (!button || busy) return;
    const entry = entries.find(item => item.id === button.dataset.id);
    if (!entry) return;
    if (button.dataset.action === "receipt") {
      receiptEntryId = entry.id;
      clearError();
      get("receipt-file").value = "";
      get("receipt-title").textContent = `Receipt: ${entry.description}`;
      dialog.showModal();
      runAction(showReceipt);
      return;
    }
    if (button.dataset.action === "edit") {
      editingId = entry.id;
      description.value = entry.description;
      date.value = entry.date;
      category.value = entry.category;
      amount.value = (entry.cents / 100).toFixed(2);
      get("form-title").textContent = "Edit expense";
      get("save").textContent = "Save changes";
      get("cancel").hidden = false;
      clearError();
      status.textContent = `Editing ${entry.description}.`;
      description.focus();
      return;
    }
    if (!window.confirm(`Delete "${entry.description}" (${money.format(entry.cents / 100)})? This cannot be undone.`)) return;
    const index = visibleEntries().findIndex(item => item.id === entry.id);
    runAction(async () => {
      if (!await commit(entries.filter(item => item.id !== entry.id))) return;
      if (editingId === entry.id) resetForm();
      render();
      status.textContent = "Expense deleted.";
    }).then(() => {
      const remaining = get("expenses").querySelectorAll('button[data-action="edit"]');
      (remaining[Math.min(index, remaining.length - 1)] || description).focus();
    });
  });

  function releasePreview() {
    get("receipt-preview").hidden = true;
    get("receipt-preview").removeAttribute("src");
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null;
  }

  async function showReceipt() {
    releasePreview();
    const entry = entries.find(item => item.id === receiptEntryId);
    get("receipt-details").textContent = entry.receipt
      ? `${entry.receipt.name} (${entry.receipt.size.toLocaleString("en-US")} bytes)`
      : "No receipt attached. Choose a fictional PNG or JPEG to attach.";
    if (!entry.receipt) return;
    const file = await receipts.get(entry.receipt.id);
    if (!file) throw new Error("Receipt image is missing. Replace it or choose Remove receipt to clear the reference. The expense is unchanged.");
    if (file.type !== entry.receipt.type || file.size !== entry.receipt.size) {
      throw new Error("Receipt image does not match its saved metadata. Replace or remove the receipt; the expense is unchanged.");
    }
    await receipts.validateImage(file);
    if (!pageActive || !dialog.open) return;
    previewUrl = URL.createObjectURL(file);
    get("receipt-preview").src = previewUrl;
    get("receipt-preview").alt = `Fictional receipt for ${entry.description}`;
    get("receipt-preview").hidden = false;
  }

  get("save-receipt").addEventListener("click", () => runAction(async () => {
    clearError();
    const file = get("receipt-file").files[0];
    if (!file) throw new Error("Choose a fictional PNG or JPEG image before saving.");
    await receipts.validateImage(file);
    const receipt = model.validateReceipt({
      id: crypto.randomUUID(), name: file.name.trim().slice(0, 120), type: file.type, size: file.size
    });
    const next = entries.map(entry => entry.id === receiptEntryId ? { ...entry, receipt } : entry);
    if (!await commit(next, { id: receipt.id, file })) return;
    get("receipt-file").value = "";
    render();
    await showReceipt();
    status.textContent = "Receipt saved in this browser.";
  }));

  get("remove-receipt").addEventListener("click", () => {
    if (busy || !window.confirm("Remove this receipt image? The expense will be kept.")) return;
    runAction(async () => {
      const next = entries.map(entry => {
        if (entry.id !== receiptEntryId) return entry;
        const { receipt, ...expense } = entry;
        return expense;
      });
      if (!await commit(next)) return;
      get("receipt-file").value = "";
      render();
      await showReceipt();
      status.textContent = "Receipt removed. Expense kept.";
    });
  });

  get("close-receipt").addEventListener("click", () => { if (!busy) dialog.close(); });
  dialog.addEventListener("cancel", event => { if (busy) event.preventDefault(); });
  dialog.addEventListener("close", () => {
    releasePreview();
    const button = [...get("expenses").querySelectorAll('button[data-action="receipt"]')]
      .find(item => item.dataset.id === receiptEntryId);
    (button || description).focus();
    receiptEntryId = null;
  });
  window.addEventListener("pagehide", () => {
    pageActive = false;
    releasePreview();
  });
  window.addEventListener("pageshow", event => {
    pageActive = true;
    if (event.persisted && dialog.open) runAction(showReceipt);
  });

  for (const input of [monthFilter, categoryFilter]) {
    input.addEventListener("change", () => {
      render();
      status.textContent = `${visibleEntries().length} expenses match the current filters.`;
    });
  }

  get("all-expenses").addEventListener("click", () => {
    monthFilter.value = "";
    categoryFilter.value = "";
    render();
    status.textContent = `Showing all ${entries.length} expenses.`;
  });

  function downloadCsv(all) {
    const selected = model.filter(all ? entries : visibleEntries());
    if (selected.some(entry => entry.receipt) &&
        !window.confirm("CSV does not include receipt images. Continue exporting expense metadata only?")) return;
    let url;
    try {
      const blob = new Blob([model.csv(selected)], { type: "text/csv;charset=utf-8" });
      url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `expenses-${all ? "all" : monthFilter.value || "filtered"}.csv`;
      document.body.append(link);
      link.click();
      link.remove();
      status.textContent = `CSV download requested for ${selected.length} expenses.`;
    } catch (cause) {
      showError(`Could not export CSV (${cause.message}).`);
    } finally {
      if (url) setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }

  get("export-filtered").addEventListener("click", () => downloadCsv(false));
  get("export-all").addEventListener("click", () => downloadCsv(true));
  window.addEventListener("storage", event => {
    if (event.key === model.STORAGE_KEY || event.key === null) {
      showError("Browser storage changed in another tab. Reload before making changes to avoid overwriting its expenses.");
    }
  });

  resetForm();
  monthFilter.value = today.slice(0, 7);
  try {
    entries = model.decode(localStorage.getItem(model.STORAGE_KEY));
  } catch (cause) {
    get("entry-fields").disabled = true;
    showError(`Could not load saved expenses (${cause.message}). Editing is disabled to protect existing data. Check browser storage access and reload. See the README for recovery steps.`);
    get("empty").textContent = "Expenses could not be loaded.";
    return;
  }
  render();
  runAction(async () => {
    const missing = await receipts.withWriteLock(() =>
      receipts.reconcile(model.decode(localStorage.getItem(model.STORAGE_KEY))));
    if (missing.length) {
      showError(`${missing.length} receipt image(s) are missing. Use Manage receipt to replace or remove them; expenses have been kept.`);
    }
  });
})();
