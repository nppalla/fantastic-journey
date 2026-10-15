"use strict";

(() => {
  const model = ExpenseModel;
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

  function showError(message) {
    status.textContent = "";
    error.textContent = message;
    error.hidden = false;
  }

  function clearError() {
    error.hidden = true;
    error.textContent = "";
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
      for (const action of ["Edit", "Delete"]) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = action;
        button.dataset.id = entry.id;
        button.dataset.action = action.toLowerCase();
        button.setAttribute("aria-label", `${action} ${entry.description}, ${entry.date}, ${money.format(entry.cents / 100)}`);
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

  function newId() {
    let id;
    do {
      id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    } while (entries.some(entry => entry.id === id));
    return id;
  }

  form.addEventListener("submit", event => {
    event.preventDefault();
    let entry;
    try {
      entry = model.validateExpense({
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
    const wasEditing = editingId !== null;
    const next = wasEditing ? entries.map(item => item.id === editingId ? entry : item) : [...entries, entry];
    if (!persist(next)) return;
    resetForm();
    render();
    const hiddenByFilters = !visibleEntries().some(item => item.id === entry.id);
    status.textContent = `Expense ${wasEditing ? "updated" : "added"}.${hiddenByFilters ? " It is outside the current filters; choose Show all to see it." : ""}`;
    description.focus();
  });

  get("cancel").addEventListener("click", () => {
    resetForm();
    clearError();
    status.textContent = "Edit cancelled. No changes saved.";
    description.focus();
  });

  get("expenses").addEventListener("click", event => {
    const button = event.target.closest("button[data-id]");
    if (!button) return;
    const entry = entries.find(item => item.id === button.dataset.id);
    if (!entry) return;
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
    if (!persist(entries.filter(item => item.id !== entry.id))) return;
    if (editingId === entry.id) resetForm();
    render();
    status.textContent = "Expense deleted.";
    const remaining = get("expenses").querySelectorAll('button[data-action="edit"]');
    (remaining[Math.min(index, remaining.length - 1)] || description).focus();
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
})();
