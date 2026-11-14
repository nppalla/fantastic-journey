const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const vm = require("node:vm");

const context = vm.createContext({});
vm.runInContext(readFileSync(resolve(__dirname, "../model.js"), "utf8"), context);
const model = vm.runInContext("ExpenseModel", context);
const entry = (overrides = {}) => ({
  id: "test-1", description: "Paper", date: "2026-10-15", categoryId: "supplies", cents: 1250, ...overrides
});
const plain = value => JSON.parse(JSON.stringify(value));
const document = (expenses = [], categories = model.DEFAULT_CATEGORIES) => ({ expenses, categories });
const legacy = expense => {
  const { categoryId, ...fields } = expense;
  return { ...fields, category: model.categoryLabel(model.DEFAULT_CATEGORIES, categoryId) };
};

test("parses exact cents and both amount boundaries", () => {
  for (const [input, expected] of [["0.01", 1], ["0.10", 10], ["0.2", 20], ["12", 1200],
    ["12.34", 1234], [" 1.50 ", 150], ["999999.99", 99999999]]) {
    assert.equal(model.parseAmount(input), expected);
  }
});

test("rejects invalid, nonpositive, overprecision, and out-of-range amounts", () => {
  for (const input of ["", " ", "0", "0.00", "-1", "1.234", "1,000", "1e2", "Infinity",
    "NaN", "1000000", ".50", "1.", "12usd", null, 5]) {
    assert.throws(() => model.parseAmount(input));
  }
});

test("validates actual calendar dates including leap years", () => {
  for (const date of ["2024-02-29", "1000-01-01", "9999-12-31", "2026-10-15"]) {
    assert.equal(model.isDate(date), true);
  }
  for (const date of ["2026-02-29", "2026-02-30", "2026-04-31", "2026-13-01",
    "2026-00-01", "2026-01-00", "0999-12-31", "2026-1-1", "", null]) {
    assert.equal(model.isDate(date), false);
  }
});

test("validates expense fields and trims descriptions without interpreting markup", () => {
  assert.equal(model.validateExpense(entry({ description: "  Paper  " })).description, "Paper");
  assert.equal(model.validateExpense(entry({ description: "<img src=x>" })).description, "<img src=x>");
  for (const overrides of [{ id: "" }, { id: "bad id" }, { description: " " },
    { description: "x".repeat(121) }, { date: "bad" }, { categoryId: "Unknown" },
    { cents: 0 }, { cents: -1 }, { cents: 1.5 }, { cents: 100000000 }, { cents: "100" }]) {
    assert.throws(() => model.validateExpense(entry(overrides)));
  }
});

test("round-trips versioned storage and rejects corrupt data without discarding entries", () => {
  const entries = [entry(), entry({ id: "test-2", cents: 1 })];
  assert.deepEqual(plain(model.decode(model.encode(document(entries)))).expenses, entries);
  assert.deepEqual(plain(model.decode(null)).expenses, []);
  for (const raw of ["", "{", "null", "[]", '{"version":99,"expenses":[]}',
    '{"version":1,"expenses":null}', '{"version":1,"expenses":[{}]}',
    JSON.stringify({ version: 1, expenses: [legacy(entry()), legacy(entry())] })]) {
    assert.throws(() => model.decode(raw));
  }
});

test("upgrades version-1 expenses without changing records or totals", () => {
  const expenses = [entry(), entry({ id: "second", cents: 10 })];
  const decoded = model.decode(JSON.stringify({ version: 1, expenses: expenses.map(legacy) }));
  assert.deepEqual(plain(decoded).expenses, expenses);
  const encoded = JSON.parse(model.encode(decoded));
  assert.equal(encoded.version, 3);
  assert.deepEqual(encoded.expenses, expenses);
  assert.equal(model.summarize(decoded.expenses, decoded.categories).cents, 1260);
});

test("receipt metadata survives saves and cannot contain invalid or duplicate references", () => {
  const receipt = { id: "receipt-1", name: "fictional.png", type: "image/png", size: model.MAX_RECEIPT_BYTES };
  const expense = entry({ receipt });
  assert.deepEqual(plain(model.decode(model.encode(document([expense])))).expenses, [expense]);
  const v2 = model.decode(JSON.stringify({ version: 2, expenses: [legacy(expense)] }));
  assert.deepEqual(plain(v2.expenses), [expense]);
  assert.equal(model.csv([expense]).includes("fictional.png"), false);
  for (const change of [{ id: "" }, { name: "" }, { name: "x".repeat(121) },
    { type: "image/svg+xml" }, { size: 0 }, { size: model.MAX_RECEIPT_BYTES + 1 },
    { size: 1.5 }, { size: "20" }]) {
    assert.throws(() => model.encode(document([entry({ receipt: { ...receipt, ...change } })])));
  }
  assert.throws(() => model.encode(document([entry({ receipt: null })])));
  assert.throws(() => model.encode(document([expense, entry({ id: "other", receipt })])));
  assert.throws(() => model.decode(JSON.stringify({ version: 1, expenses: [legacy(expense)] })));
});

test("filters by month and category, sorts newest first, and does not mutate the ledger", () => {
  const entries = [entry({ id: "old", date: "2026-09-30" }),
    entry({ id: "travel", categoryId: "travel", date: "2026-10-17" }),
    entry({ id: "paper", date: "2026-10-01" })];
  assert.deepEqual(plain(model.filter(entries, "2026-10", "supplies")).map(item => item.id), ["paper"]);
  assert.deepEqual(plain(model.filter(entries, "2026-10")).map(item => item.id), ["travel", "paper"]);
  assert.equal(model.filter(entries, "", "travel").length, 1);
  assert.equal(model.filter(entries, "2027-01").length, 0);
  assert.equal(model.filter(entries).length, 3);
  assert.equal(entries[0].id, "old");
});

test("summaries use exact integer-cent arithmetic", () => {
  const summary = model.summarize([entry({ cents: 10 }), entry({ id: "two", cents: 20 }),
    entry({ id: "three", cents: 1250, categoryId: "travel" })]);
  assert.equal(summary.count, 3);
  assert.equal(summary.cents, 1280);
  assert.equal(summary.categories.find(item => item.category === "Supplies").cents, 30);
  assert.equal(summary.categories.find(item => item.category === "Travel").cents, 1250);
  assert.equal(model.summarize([]).cents, 0);
});

test("CSV includes BOM, CRLF, quoted fields, escaped quotes, and exact USD amounts", () => {
  const result = model.csv([entry({ description: 'Paper, "A4"\npack', cents: 10 })]);
  assert.equal(result, '\uFEFF"Date","Description","Category","Amount (USD)"\r\n' +
    '"2026-10-15","Paper, ""A4""\npack","Supplies","0.10"\r\n');
  assert.equal(model.csv([entry({ cents: 99999999 })]).includes('"999999.99"'), true);
});

test("CSV neutralizes spreadsheet formulas, including whitespace-prefixed formulas", () => {
  for (const description of ["=1+1", "+SUM(A1)", "-1+1", "@SUM(A1)", "  =1+1", "\t=1", "\r=1", "\n=1"]) {
    assert.equal(model.csv([entry({ description })]).includes(`"'${description}"`), true);
  }
  assert.equal(model.csv([entry({ description: "Regular expense" })]).includes('"Regular expense"'), true);
});

test("category names are trimmed, bounded and case-insensitively unique", () => {
  const initial = document([entry()]);
  const added = model.addCategory(initial, "  Office rent  ", "rent");
  assert.equal(added.categories.at(-1).name, "Office rent");
  assert.equal(model.addCategory(initial, "x".repeat(40), "boundary").categories.at(-1).name.length, 40);
  for (const name of ["", " ", "x".repeat(41), " supplies ", "SUPPLIES"]) {
    assert.throws(() => model.addCategory(initial, name, "new"));
  }
  assert.throws(() => model.addCategory(initial, "New", "supplies"));
  assert.throws(() => model.renameCategory(initial, "missing", "New"));
  assert.throws(() => model.renameCategory(initial, "supplies", "TRAVEL"));
  assert.equal(initial.categories.length, 5);
});

test("rename preserves stable IDs, expenses, receipt metadata and totals across reload", () => {
  const receipt = { id: "receipt-1", name: "fictional.png", type: "image/png", size: 100 };
  const initial = document([entry({ receipt })]);
  const renamed = model.renameCategory(initial, "supplies", " Stationery ");
  assert.deepEqual(plain(renamed.expenses), plain(initial.expenses));
  const reloaded = model.decode(model.encode(renamed));
  assert.equal(model.categoryLabel(reloaded.categories, "supplies"), "Stationery");
  assert.equal(model.summarize(reloaded.expenses, reloaded.categories).cents, 1250);
  assert.equal(model.filter(reloaded.expenses, "", "supplies").length, 1);
  assert.ok(model.csv(reloaded.expenses, reloaded.categories).includes('"Stationery"'));
});

test("in-use category deletion requires explicit valid reassignment and preserves amounts", () => {
  const initial = document([entry(), entry({ id: "two", categoryId: "travel", cents: 10 })]);
  assert.throws(() => model.deleteCategory(initial, "supplies"), /in use/);
  assert.throws(() => model.deleteCategory(initial, "supplies", "supplies"), /different/);
  assert.throws(() => model.deleteCategory(initial, "supplies", "unknown"));
  assert.throws(() => model.deleteCategory(initial, "unknown"));
  const deleted = model.deleteCategory(initial, "supplies", "travel");
  assert.deepEqual(plain(deleted.expenses).map(expense => expense.categoryId), ["travel", "travel"]);
  assert.equal(model.summarize(deleted.expenses, deleted.categories).cents, 1260);
  assert.equal(model.decode(model.encode(deleted)).categories.some(category => category.id === "supplies"), false);
  const one = document([], [{ id: "last", name: "Last" }]);
  assert.throws(() => model.deleteCategory(one, "last"), /at least one/);
  assert.equal(model.deleteCategory(initial, "other").categories.length, 4);
});

test("malformed or unknown categories fail the entire load instead of dropping expenses", () => {
  const good = entry();
  for (const data of [
    { version: 1, expenses: [legacy(good), { ...legacy(good), id: "bad", category: "Unknown" }] },
    { version: 3, ...document([good, entry({ id: "bad", categoryId: "unknown" })]) },
    { version: 3, ...document([good], []) },
    { version: 3, ...document([good], [{ id: "supplies", name: "X" }, { id: "supplies", name: "Y" }]) },
    { version: 3, ...document([], [{ id: "x", name: "X" }, { id: "y", name: "x" }]) }
  ]) assert.throws(() => model.decode(JSON.stringify(data)));
});

test("search combines month/category with case-insensitive description matching", () => {
  const entries = [entry(), entry({ id: "two", description: "PAPER clips", cents: 10 }),
    entry({ id: "travel", description: "paper ticket", categoryId: "travel" }),
    entry({ id: "old", description: "Paper last month", date: "2026-09-01" })];
  const before = JSON.stringify(entries);
  const selected = model.filter(entries, "2026-10", "supplies", "  pApEr ");
  assert.deepEqual(plain(selected).map(expense => expense.id), ["test-1", "two"]);
  assert.equal(model.summarize(selected).cents, 1260);
  assert.equal(model.filter(entries, "2026-10", "supplies", "none").length, 0);
  assert.equal(JSON.stringify(entries), before);
});

test("all sort columns and directions use numeric cents and deterministic equal-value ties", () => {
  const entries = [entry({ id: "z", description: "Equal", cents: 1000 }),
    entry({ id: "a", description: "equal", cents: 200 }),
    entry({ id: "b", description: "Equal", cents: 200 })];
  const ids = (field, direction) => plain(model.sort(entries, model.DEFAULT_CATEGORIES, field, direction)).map(entry => entry.id);
  assert.deepEqual(ids("amount", "ascending"), ["a", "b", "z"]);
  assert.deepEqual(ids("amount", "descending"), ["z", "a", "b"]);
  for (const field of ["date", "description", "category"]) {
    for (const direction of ["ascending", "descending"]) assert.deepEqual(ids(field, direction), ["a", "b", "z"]);
  }
  const varied = [entry({ id: "z", description: "Z", categoryId: "travel", date: "2026-10-16" }),
    entry({ id: "a", description: "A", categoryId: "meals", date: "2026-10-01" })];
  for (const field of ["date", "description", "category"]) {
    assert.equal(model.sort(varied, model.DEFAULT_CATEGORIES, field, "ascending")[0].id, "a");
    assert.equal(model.sort(varied, model.DEFAULT_CATEGORIES, field, "descending")[0].id, "z");
  }
  assert.deepEqual(entries.map(entry => entry.id), ["z", "a", "b"]);
  assert.throws(() => model.sort(entries, model.DEFAULT_CATEGORIES, "unknown"));
});

test("CSV preserves the selected ordering and guards custom category formulas", () => {
  const data = model.renameCategory(document([entry({ id: "big", cents: 1000 }),
    entry({ id: "small", cents: 200 })]), "supplies", "=1+1");
  const selected = model.sort(data.expenses, data.categories, "amount", "ascending");
  const output = model.csv(selected, data.categories);
  assert.ok(output.indexOf('"2.00"') < output.indexOf('"10.00"'));
  assert.ok(output.includes('"\'=1+1"'));
});
