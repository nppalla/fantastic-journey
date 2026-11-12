"use strict";

const ExpenseModel = (() => {
  const CATEGORIES = Object.freeze(["Supplies", "Travel", "Meals", "Software", "Other"]);
  const STORAGE_KEY = "fantastic-journey.expenses.v1";
  const MAX_CENTS = 99999999;
  const MAX_RECEIPT_BYTES = 2 * 1024 * 1024;

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

  function validateExpense(expense) {
    if (!expense || typeof expense !== "object" ||
        typeof expense.id !== "string" || !/^[a-z0-9-]{1,80}$/i.test(expense.id) ||
        typeof expense.description !== "string" ||
        !expense.description.trim() || expense.description.length > 120 ||
        !isDate(expense.date) || !CATEGORIES.includes(expense.category) ||
        !Number.isSafeInteger(expense.cents) || expense.cents < 1 || expense.cents > MAX_CENTS) {
      throw new Error("Invalid expense. Check the description, date, category, and amount.");
    }
    return {
      id: expense.id,
      description: expense.description.trim(),
      date: expense.date,
      category: expense.category,
      cents: expense.cents,
      ...(expense.receipt === undefined ? {} : { receipt: validateReceipt(expense.receipt) })
    };
  }

  function validateEntries(entries) {
    if (!Array.isArray(entries)) throw new Error("Saved expenses must be a list.");
    const ids = new Set();
    const receipts = new Set();
    let total = 0;
    return entries.map(entry => {
      const expense = validateExpense(entry);
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
    if (raw === null) return [];
    const saved = JSON.parse(raw);
    if (!saved || ![1, 2].includes(saved.version)) throw new Error("Saved expense data has an unsupported format.");
    if (saved.version === 1 && Array.isArray(saved.expenses) &&
        saved.expenses.some(entry => entry && entry.receipt !== undefined)) {
      throw new Error("Version-1 expenses cannot contain receipt references. See the README for recovery steps.");
    }
    return validateEntries(saved.expenses);
  }

  function encode(entries) {
    return JSON.stringify({ version: 2, expenses: validateEntries(entries) });
  }

  function filter(entries, month = "", category = "") {
    return entries.filter(entry => (!month || entry.date.startsWith(`${month}-`)) &&
      (!category || entry.category === category))
      .sort((a, b) => b.date.localeCompare(a.date) || a.description.localeCompare(b.description));
  }

  function summarize(entries) {
    const categories = CATEGORIES.map(category => ({
      category,
      cents: entries.filter(entry => entry.category === category).reduce((sum, entry) => sum + entry.cents, 0)
    }));
    return { count: entries.length, cents: categories.reduce((sum, entry) => sum + entry.cents, 0), categories };
  }

  function csv(entries) {
    function cell(value) {
      let text = String(value);
      // Quoting alone does not stop spreadsheets from evaluating formulas.
      if (/^[\s\u0000-\u001f]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
      return `"${text.replaceAll('"', '""')}"`;
    }
    const rows = [["Date", "Description", "Category", "Amount (USD)"],
      ...entries.map(entry => [entry.date, entry.description, entry.category, (entry.cents / 100).toFixed(2)])];
    return "\uFEFF" + rows.map(row => row.map(cell).join(",")).join("\r\n") + "\r\n";
  }

  return Object.freeze({ CATEGORIES, STORAGE_KEY, MAX_RECEIPT_BYTES, parseAmount, isDate, validateReceipt,
    validateExpense, decode, encode, filter, summarize, csv });
})();
