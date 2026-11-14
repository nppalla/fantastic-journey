"use strict";

const ExpenseModel = (() => {
  const CATEGORIES = Object.freeze(["Supplies", "Travel", "Meals", "Software", "Other"]);
  const DEFAULT_CATEGORIES = Object.freeze(CATEGORIES.map(name => Object.freeze({ id: name.toLowerCase(), name })));
  const STORAGE_KEY = "fantastic-journey.expenses.v1";
  const MAX_CENTS = 99999999;
  const MAX_RECEIPT_BYTES = 2 * 1024 * 1024;
  const MAX_CATEGORY_LENGTH = 40;

  function categoryName(value) {
    if (typeof value !== "string" || !value.trim() || value.trim().length > MAX_CATEGORY_LENGTH) {
      throw new Error("Enter a category name between 1 and 40 characters (excluding surrounding spaces).");
    }
    return value.trim();
  }

  function validateCategories(categories) {
    if (!Array.isArray(categories) || !categories.length) throw new Error("Keep at least one valid category.");
    const ids = new Set();
    const names = new Set();
    return categories.map(category => {
      if (!category || typeof category.id !== "string" || !/^[a-z0-9-]{1,80}$/i.test(category.id)) {
        throw new Error("Invalid saved category identifier. Preserve storage and see the README for recovery.");
      }
      const name = categoryName(category.name);
      const folded = name.toLowerCase();
      if (ids.has(category.id)) throw new Error("Saved categories contain duplicate identifiers.");
      if (names.has(folded)) throw new Error("A category with that name already exists. Choose a different name.");
      ids.add(category.id);
      names.add(folded);
      return { id: category.id, name };
    });
  }

  function validateReceipt(receipt) {
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
    if (!expense || typeof expense !== "object" ||
        typeof expense.id !== "string" || !/^[a-z0-9-]{1,80}$/i.test(expense.id) ||
        typeof expense.description !== "string" ||
        !expense.description.trim() || expense.description.length > 120 ||
        !isDate(expense.date) ||
        !Number.isSafeInteger(expense.cents) || expense.cents < 1 || expense.cents > MAX_CENTS) {
      throw new Error("Invalid expense. Check the description, date, category, and amount.");
    }
    if (!categories.some(category => category.id === expense.categoryId)) {
      throw new Error("Expense references an unknown category. Preserve saved data and restore its category before reloading; see the README.");
    }
    return {
      id: expense.id,
      description: expense.description.trim(),
      date: expense.date,
      categoryId: expense.categoryId,
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
      return expense;
    });
  }

  function decode(raw) {
    if (raw === null) return { categories: validateCategories(DEFAULT_CATEGORIES), expenses: [] };
    const saved = JSON.parse(raw);
    if (!saved || ![1, 2, 3].includes(saved.version)) throw new Error("Saved expense data has an unsupported format.");
    if (saved.version === 3) return validateDocument(saved);
    if (saved.version === 1 && Array.isArray(saved.expenses) &&
        saved.expenses.some(entry => entry && entry.receipt !== undefined)) {
      throw new Error("Version-1 expenses cannot contain receipt references. See the README for recovery steps.");
    }
    if (!Array.isArray(saved.expenses)) throw new Error("Saved expenses must be a list.");
    const expenses = saved.expenses.map(entry => {
      const category = DEFAULT_CATEGORIES.find(category => category.name === entry?.category);
      if (!category) throw new Error("Saved expense has an unknown category. Preserve storage and repair the original data; see the README.");
      const { category: legacyCategory, ...expense } = entry;
      return { ...expense, categoryId: category.id };
    });
    return validateDocument({ categories: DEFAULT_CATEGORIES, expenses });
  }

  function validateDocument(document) {
    if (!document || typeof document !== "object") throw new Error("Invalid saved expense document.");
    const categories = validateCategories(document.categories);
    return { categories, expenses: validateEntries(document.expenses, categories) };
  }

  function encode(document) {
    return JSON.stringify({ version: 3, ...validateDocument(document) });
  }

  function addCategory(document, name, id) {
    return validateDocument({ ...document, categories: [...document.categories, { id, name }] });
  }

  function renameCategory(document, id, name) {
    if (!document.categories.some(category => category.id === id)) throw new Error("Choose a category to rename.");
    return validateDocument({ ...document,
      categories: document.categories.map(category => category.id === id ? { id, name } : category) });
  }

  function deleteCategory(document, id, replacement = "") {
    if (!document.categories.some(category => category.id === id)) throw new Error("Choose a category to delete.");
    if (document.categories.length === 1) throw new Error("Keep at least one category. Add another before deleting this one.");
    if (replacement && !document.categories.some(category => category.id === replacement && category.id !== id)) {
      throw new Error("Choose a different existing category for reassignment.");
    }
    if (document.expenses.some(entry => entry.categoryId === id) && !replacement) {
      throw new Error("This category is in use. Explicitly choose a replacement category before deleting it.");
    }
    return validateDocument({
      categories: document.categories.filter(category => category.id !== id),
      expenses: document.expenses.map(entry => entry.categoryId === id ? { ...entry, categoryId: replacement } : entry)
    });
  }

  function categoryLabel(categories, id) {
    const category = categories.find(category => category.id === id);
    if (!category) throw new Error("Unknown category. Restore its saved definition before continuing.");
    return category.name;
  }

  function sort(entries, categories = DEFAULT_CATEGORIES, field = "date", direction = "descending") {
    if (!["date", "description", "category", "amount"].includes(field) ||
        !["ascending", "descending"].includes(direction)) throw new Error("Choose a valid sort column and direction.");
    const value = entry => field === "amount" ? entry.cents :
      field === "category" ? categoryLabel(categories, entry.categoryId) : entry[field];
    return [...entries].sort((a, b) => {
      const primary = field === "amount" ? value(a) - value(b) : value(a).localeCompare(value(b), "en", { sensitivity: "base" });
      // Ties always use description then stable ID ascending, regardless of primary direction.
      return primary * (direction === "ascending" ? 1 : -1) ||
        a.description.localeCompare(b.description, "en", { sensitivity: "base" }) || a.id.localeCompare(b.id, "en");
    });
  }

  function filter(entries, month = "", category = "", search = "", categories = DEFAULT_CATEGORIES,
      field = "date", direction = "descending") {
    const query = search.trim().toLowerCase();
    return sort(entries.filter(entry => (!month || entry.date.startsWith(`${month}-`)) &&
      (!category || entry.categoryId === category) && entry.description.toLowerCase().includes(query)), categories, field, direction);
  }

  function summarize(entries, definitions = DEFAULT_CATEGORIES) {
    const categories = definitions.map(category => ({
      category: category.name,
      cents: entries.filter(entry => entry.categoryId === category.id).reduce((sum, entry) => sum + entry.cents, 0)
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
      ...entries.map(entry => [entry.date, entry.description, categoryLabel(categories, entry.categoryId), (entry.cents / 100).toFixed(2)])];
    return "\uFEFF" + rows.map(row => row.map(cell).join(",")).join("\r\n") + "\r\n";
  }

  return Object.freeze({ CATEGORIES, DEFAULT_CATEGORIES, STORAGE_KEY, MAX_RECEIPT_BYTES, MAX_CATEGORY_LENGTH,
    categoryName, addCategory, renameCategory, deleteCategory, categoryLabel, sort, parseAmount, isDate, validateReceipt,
    validateExpense, decode, encode, filter, summarize, csv });
})();
