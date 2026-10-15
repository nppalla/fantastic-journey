"use strict";

const ExpenseModel = (() => {
  const CATEGORIES = Object.freeze(["Supplies", "Travel", "Meals", "Software", "Other"]);
  const STORAGE_KEY = "fantastic-journey.expenses.v1";
  const MAX_CENTS = 99999999;

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
      cents: expense.cents
    };
  }

  function validateEntries(entries) {
    if (!Array.isArray(entries)) throw new Error("Saved expenses must be a list.");
    const ids = new Set();
    let total = 0;
    return entries.map(entry => {
      const expense = validateExpense(entry);
      if (ids.has(expense.id)) throw new Error("Saved expenses contain duplicate identifiers.");
      ids.add(expense.id);
      total += expense.cents;
      if (!Number.isSafeInteger(total)) throw new Error("The combined expense total is too large.");
      return expense;
    });
  }

  function decode(raw) {
    if (raw === null) return [];
    const saved = JSON.parse(raw);
    if (!saved || saved.version !== 1) throw new Error("Saved expense data has an unsupported format.");
    return validateEntries(saved.expenses);
  }

  function encode(entries) {
    return JSON.stringify({ version: 1, expenses: validateEntries(entries) });
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

  return Object.freeze({ CATEGORIES, STORAGE_KEY, parseAmount, isDate, validateExpense, decode, encode, filter, summarize, csv });
})();
