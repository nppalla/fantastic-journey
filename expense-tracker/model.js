"use strict";

const ExpenseModel = (() => {
  const CATEGORIES = Object.freeze(["Supplies", "Travel", "Meals", "Software", "Other"]);
  const DEFAULT_CATEGORIES = Object.freeze(CATEGORIES.map(name => Object.freeze({ id: name, name })));
  const STORAGE_KEY = "fantastic-journey.expenses.v1";
  const MAX_CENTS = 99999999;
  const MAX_RECEIPT_BYTES = 2 * 1024 * 1024;
  const MAX_CATEGORY_LENGTH = 40;
  const validId = value => typeof value === "string" && /^[a-z0-9-]{1,80}$/i.test(value);

  function checkKeys(value, allowed) {
    if (!value || typeof value !== "object" || Array.isArray(value) ||
        Object.keys(value).some(key => !allowed.includes(key))) {
      throw new Error("Unknown or corrupt saved fields. Preserve browser storage and see the README for recovery steps.");
    }
  }

  function validateCategoryName(value) {
    if (typeof value !== "string" || !value.trim() || value.trim().length > MAX_CATEGORY_LENGTH) {
      throw new Error(`Enter a category name from 1 to ${MAX_CATEGORY_LENGTH} characters after trimming.`);
    }
    return value.trim();
  }

  function validateCategories(categories) {
    if (!Array.isArray(categories) || !categories.length) throw new Error("Keep at least one category.");
    const ids = new Set();
    const names = new Set();
    return categories.map(category => {
      checkKeys(category, ["id", "name"]);
      if (!validId(category.id) || ids.has(category.id)) throw new Error("Invalid or duplicate category identifier.");
      const name = validateCategoryName(category.name);
      if (names.has(name.toLowerCase())) throw new Error("A category with that name already exists (ignoring case).");
      ids.add(category.id);
      names.add(name.toLowerCase());
      return { id: category.id, name };
    });
  }

  function categoryName(categories, id) {
    const category = categories.find(item => item.id === id);
    if (!category) throw new Error("Unknown category reference. Preserve saved data and see the README for recovery steps.");
    return category.name;
  }

  function validateReceipt(receipt) {
    checkKeys(receipt, ["id", "name", "type", "size"]);
    if (!receipt || typeof receipt !== "object" ||
        typeof receipt.id !== "string" || !/^[a-z0-9-]{1,80}$/i.test(receipt.id) ||
        typeof receipt.name !== "string" || !receipt.name.trim() || receipt.name.length > 120 ||
        !["image/png", "image/jpeg"].includes(receipt.type) ||
        !Number.isSafeInteger(receipt.size) || receipt.size < 1 || receipt.size > MAX_RECEIPT_BYTES) {
      throw new Error("Invalid receipt metadata. Preserve browser storage and see the README for recovery steps.");
    }
    return { id: receipt.id, name: receipt.name, type: receipt.type, size: receipt.size };
  }

  function parseAmount(value) {
    if (typeof value !== "string" || !/^\d{1,6}(\.\d{1,2})?$/.test(value.trim())) {
      throw new Error("Enter an amount with at most two decimal places, such as 12.50.");
    }
    const [whole, fraction = ""] = value.trim().split(".");
    const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
    if (cents < 1 || cents > MAX_CENTS) {
      throw new Error("The amount must be between 0.01 and 999999.99 USD.");
    }
    return cents;
  }

  function isDate(value) {
    if (typeof value !== "string" || !/^[1-9]\d{3}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }

  function validateExpense(expense, categories = DEFAULT_CATEGORIES) {
    checkKeys(expense, ["id", "description", "date", "category", "cents", "receipt"]);
    if (!expense || typeof expense !== "object" ||
        typeof expense.id !== "string" || !/^[a-z0-9-]{1,80}$/i.test(expense.id) ||
        typeof expense.description !== "string" ||
        !expense.description.trim() || expense.description.length > 120 ||
        !isDate(expense.date) ||
        !Number.isSafeInteger(expense.cents) || expense.cents < 1 || expense.cents > MAX_CENTS) {
      throw new Error("Invalid expense. Check the description, date, category, and amount.");
    }
    categoryName(categories, expense.category);
    return {
      id: expense.id,
      description: expense.description.trim(),
      date: expense.date,
      category: expense.category,
      cents: expense.cents,
      ...(expense.receipt === undefined ? {} : { receipt: validateReceipt(expense.receipt) })
    };
  }

  function validateEntries(entries, categories) {
    if (!Array.isArray(entries)) throw new Error("Saved expenses must be a list.");
    const ids = new Set();
    const receipts = new Set();
    let total = 0;
    return entries.map(entry => {
      const expense = validateExpense(entry, categories);
      if (ids.has(expense.id)) throw new Error("Saved expenses contain duplicate identifiers.");
      ids.add(expense.id);
      if (expense.receipt) {
        if (receipts.has(expense.receipt.id)) throw new Error("Saved expenses contain duplicate receipt identifiers.");
        receipts.add(expense.receipt.id);
      }
      total += expense.cents;
      if (!Number.isSafeInteger(total)) throw new Error("The combined expense total is too large.");
      return { ...expense, description: entry.description };
    });
  }

  function decode(raw) {
    if (raw === null) return { categories: validateCategories(DEFAULT_CATEGORIES), expenses: [] };
    const saved = JSON.parse(raw);
    if (!saved || ![1, 2, 3].includes(saved.version)) throw new Error("Saved expense data has an unsupported format.");
    checkKeys(saved, saved.version === 3 ? ["version", "categories", "expenses"] : ["version", "expenses"]);
    if (saved.version === 1 && Array.isArray(saved.expenses) &&
        saved.expenses.some(entry => entry && entry.receipt !== undefined)) {
      throw new Error("Version-1 expenses cannot contain receipt references. See the README for recovery steps.");
    }
    const categories = validateCategories(saved.version === 3 ? saved.categories : DEFAULT_CATEGORIES);
    return { categories, expenses: validateEntries(saved.expenses, categories) };
  }

  function validateState(state) {
    checkKeys(state, ["categories", "expenses"]);
    const categories = validateCategories(state.categories);
    return { categories, expenses: validateEntries(state.expenses, categories) };
  }

  function encode(state) {
    return JSON.stringify({ version: 3, ...validateState(state) });
  }

  function addCategory(state, id, name) {
    return validateState({ ...state, categories: [...state.categories, { id, name }] });
  }

  function renameCategory(state, id, name) {
    categoryName(state.categories, id);
    return validateState({ ...state, categories: state.categories.map(item => item.id === id ? { id, name } : item) });
  }

  function deleteCategory(state, id, replacementId = "") {
    categoryName(state.categories, id);
    if (state.expenses.some(entry => entry.category === id) && !replacementId) {
      throw new Error("Choose a replacement category explicitly before deleting a category with expenses.");
    }
    if (replacementId) {
      categoryName(state.categories, replacementId);
      if (id === replacementId) throw new Error("Choose a different replacement category.");
    }
    return validateState({
      categories: state.categories.filter(item => item.id !== id),
      expenses: state.expenses.map(entry => entry.category === id ? { ...entry, category: replacementId } : entry)
    });
  }

  function sort(entries, key = "date", direction = "descending", categories = DEFAULT_CATEGORIES) {
    if (!["date", "description", "category", "cents"].includes(key) ||
        !["ascending", "descending"].includes(direction)) throw new Error("Choose a supported column and sort direction.");
    const textCompare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
    const value = entry => key === "category" ? categoryName(categories, entry.category).toLowerCase() :
      key === "description" ? entry.description.toLowerCase() : entry[key];
    return [...entries].sort((a, b) => {
      const comparison = key === "cents" ? a.cents - b.cents : textCompare(value(a), value(b));
      return (direction === "ascending" ? comparison : -comparison) || textCompare(a.id, b.id);
    });
  }

  function filter(entries, month = "", category = "", search = "",
    key = "date", direction = "descending", categories = DEFAULT_CATEGORIES) {
    const query = search.trim().toLowerCase();
    return sort(entries.filter(entry => (!month || entry.date.startsWith(`${month}-`)) &&
      (!category || entry.category === category) && entry.description.toLowerCase().includes(query)),
    key, direction, categories);
  }

  function summarize(entries, categoryList = DEFAULT_CATEGORIES) {
    const categories = categoryList.map(category => ({
      category: category.name,
      cents: entries.filter(entry => entry.category === category.id).reduce((sum, entry) => sum + entry.cents, 0)
    }));
    return { count: entries.length, cents: categories.reduce((sum, entry) => sum + entry.cents, 0), categories };
  }

  function csv(entries, categories = DEFAULT_CATEGORIES) {
    function cell(value) {
      let text = String(value);
      // Quoting alone does not stop spreadsheets from evaluating formulas.
      if (/^[\s\u0000-\u001f]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
      return `"${text.replaceAll('"', '""')}"`;
    }
    const rows = [["Date", "Description", "Category", "Amount (USD)"],
      ...entries.map(entry => [entry.date, entry.description, categoryName(categories, entry.category), (entry.cents / 100).toFixed(2)])];
    return "\uFEFF" + rows.map(row => row.map(cell).join(",")).join("\r\n") + "\r\n";
  }

  return Object.freeze({ CATEGORIES, DEFAULT_CATEGORIES, STORAGE_KEY, MAX_RECEIPT_BYTES, MAX_CATEGORY_LENGTH,
    parseAmount, isDate, validateReceipt, validateCategoryName, categoryName, addCategory, renameCategory,
    deleteCategory, validateExpense, decode, encode, filter, sort, summarize, csv });
})();
