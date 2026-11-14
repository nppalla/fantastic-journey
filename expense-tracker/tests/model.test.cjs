const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const vm = require("node:vm");

const context = vm.createContext({});
vm.runInContext(readFileSync(resolve(__dirname, "../model.js"), "utf8"), context);
const model = vm.runInContext("ExpenseModel", context);
const entry = (overrides = {}) => ({
  id: "test-1", description: "Paper", date: "2026-10-15", category: "Supplies", cents: 1250, ...overrides
});
const plain = value => JSON.parse(JSON.stringify(value));
const state = expenses => ({ categories: model.DEFAULT_CATEGORIES, expenses });
const encodeEntries = expenses => model.encode(state(expenses));

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
    { description: "x".repeat(121) }, { date: "bad" }, { category: "Unknown" },
    { cents: 0 }, { cents: -1 }, { cents: 1.5 }, { cents: 100000000 }, { cents: "100" }]) {
    assert.throws(() => model.validateExpense(entry(overrides)));
  }
});

test("round-trips versioned storage and rejects corrupt data without discarding entries", () => {
  const entries = [entry(), entry({ id: "test-2", cents: 1 })];
  assert.deepEqual(plain(model.decode(encodeEntries(entries)).expenses), entries);
  assert.deepEqual(plain(model.decode(null).expenses), []);
  for (const raw of ["", "{", "null", "[]", '{"version":99,"expenses":[]}',
    '{"version":1,"expenses":null}', '{"version":1,"expenses":[{}]}',
    JSON.stringify({ version: 1, expenses: [entry(), entry()] })]) {
    assert.throws(() => model.decode(raw));
  }
});

test("upgrades version-1 expenses without changing records or totals", () => {
  const expenses = [entry({ description: "  Paper  " }), entry({ id: "second", cents: 10 })];
  const decoded = model.decode(JSON.stringify({ version: 1, expenses }));
  assert.deepEqual(plain(decoded.expenses), expenses);
  const encoded = JSON.parse(model.encode(decoded));
  assert.equal(encoded.version, 3);
  assert.deepEqual(encoded.expenses, expenses);
  assert.equal(model.summarize(decoded.expenses, decoded.categories).cents, 1260);
  assert.deepEqual(encoded.categories, plain(model.DEFAULT_CATEGORIES));
});

test("receipt metadata survives saves and cannot contain invalid or duplicate references", () => {
  const receipt = { id: "receipt-1", name: "fictional.png", type: "image/png", size: model.MAX_RECEIPT_BYTES };
  const expense = entry({ receipt });
  assert.deepEqual(plain(model.decode(encodeEntries([expense])).expenses), [expense]);
  assert.deepEqual(plain(model.decode(JSON.stringify({ version: 2, expenses: [expense] })).expenses), [expense]);
  assert.equal(model.csv([expense]).includes("fictional.png"), false);
  for (const change of [{ id: "" }, { name: "" }, { name: "x".repeat(121) },
    { type: "image/svg+xml" }, { size: 0 }, { size: model.MAX_RECEIPT_BYTES + 1 },
    { size: 1.5 }, { size: "20" }]) {
    assert.throws(() => encodeEntries([entry({ receipt: { ...receipt, ...change } })]));
  }
  assert.throws(() => encodeEntries([entry({ receipt: null })]));
  assert.throws(() => encodeEntries([expense, entry({ id: "other", receipt })]));
  assert.throws(() => model.decode(JSON.stringify({ version: 1, expenses: [expense] })));
});

test("filters by month and category, sorts newest first, and does not mutate the ledger", () => {
  const entries = [entry({ id: "old", date: "2026-09-30" }),
    entry({ id: "travel", category: "Travel", date: "2026-10-17" }),
    entry({ id: "paper", date: "2026-10-01" })];
  assert.deepEqual(plain(model.filter(entries, "2026-10", "Supplies")).map(item => item.id), ["paper"]);
  assert.deepEqual(plain(model.filter(entries, "2026-10")).map(item => item.id), ["travel", "paper"]);
  assert.equal(model.filter(entries, "", "Travel").length, 1);
  assert.equal(model.filter(entries, "2027-01").length, 0);
  assert.equal(model.filter(entries).length, 3);
  assert.equal(entries[0].id, "old");
});

test("summaries use exact integer-cent arithmetic", () => {
  const summary = model.summarize([entry({ cents: 10 }), entry({ id: "two", cents: 20 }),
    entry({ id: "three", cents: 1250, category: "Travel" })]);
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

test("category names are trimmed, bounded, and unique ignoring case", () => {
  const original = state([entry()]);
  const added = model.addCategory(original, "custom", "  Equipment  ");
  assert.equal(added.categories.at(-1).name, "Equipment");
  assert.equal(original.categories.length, 5);
  assert.equal(model.addCategory(original, "long", "x".repeat(40)).categories.at(-1).name.length, 40);
  for (const name of [" ", "x".repeat(41), " supplies ", "SUPPLIES", null, 4]) {
    assert.throws(() => model.addCategory(original, "custom", name));
  }
  assert.throws(() => model.addCategory(original, "Supplies", "Equipment"));
  assert.throws(() => model.renameCategory(original, "Travel", "sUpPlIeS"));
  assert.throws(() => model.renameCategory(original, "unknown", "New"));
});

test("renaming stable IDs updates labels, sort, summary, and CSV but not expense records", () => {
  const original = state([entry(), entry({ id: "two", category: "Travel", cents: 10 })]);
  const renamed = model.renameCategory(original, "Supplies", "Zebra supplies");
  assert.deepEqual(plain(renamed.expenses), plain(original.expenses));
  assert.equal(model.summarize(renamed.expenses, renamed.categories).cents, 1260);
  assert.equal(model.summarize(renamed.expenses, renamed.categories).categories[0].category, "Zebra supplies");
  assert.equal(model.csv(renamed.expenses, renamed.categories).includes('"Zebra supplies"'), true);
  assert.equal(model.sort(renamed.expenses, "category", "ascending", renamed.categories)[0].id, "two");
  assert.deepEqual(plain(model.decode(model.encode(renamed))), plain(renamed));
});

test("category deletion requires valid explicit reassignment and retains amounts and receipts", () => {
  const receipt = { id: "image", name: "fictional.png", type: "image/png", size: 100 };
  const original = state([entry({ receipt }), entry({ id: "two", category: "Travel", cents: 10 })]);
  for (const replacement of ["", "missing", "Supplies"]) {
    assert.throws(() => model.deleteCategory(original, "Supplies", replacement));
  }
  const reassigned = model.deleteCategory(original, "Supplies", "Other");
  assert.equal(reassigned.expenses[0].category, "Other");
  assert.deepEqual(plain(reassigned.expenses[0].receipt), receipt);
  assert.equal(reassigned.categories.some(item => item.id === "Supplies"), false);
  assert.equal(model.summarize(reassigned.expenses, reassigned.categories).cents, 1260);
  assert.equal(model.deleteCategory(original, "Meals").categories.length, 4);
  assert.throws(() => model.deleteCategory({ categories: [{ id: "last", name: "Last" }], expenses: [] }, "last"));
});

test("unknown references and corrupt category data cannot be encoded or migrated", () => {
  for (const change of [
    { categories: [] }, { categories: [{ id: "bad id", name: "Bad" }] },
    { categories: [{ id: "one", name: "Name" }, { id: "two", name: "name" }] },
    { categories: [{ id: "one", name: "Name" }, { id: "one", name: "Different" }] },
    { categories: [{ id: "Supplies", name: "Supplies", future: true }] },
    { expenses: [entry({ category: "missing" })] }, { expenses: [entry({ future: true })] },
    { future: true }
  ]) {
    assert.throws(() => model.encode({ ...state([entry()]), ...change }));
    assert.throws(() => model.decode(JSON.stringify({ version: 3, ...state([entry()]), ...change })));
  }
  for (const version of [1, 2]) {
    assert.throws(() => model.decode(JSON.stringify({ version, expenses: [entry({ category: "missing" })] })));
    assert.throws(() => model.decode(JSON.stringify({ version, expenses: [entry()], unknown: true })));
  }
});

test("description search combines with filters without mutating saved data", () => {
  const entries = [entry({ id: "a", description: "Fictional PAPER" }),
    entry({ id: "b", description: "Paper ticket", category: "Travel" }),
    entry({ id: "c", description: "Paper archive", date: "2026-09-30" }),
    entry({ id: "d", description: "Pens" })];
  const before = encodeEntries(entries);
  const filtered = model.filter(entries, "2026-10", "Supplies", "  pApEr ");
  assert.deepEqual(plain(filtered).map(item => item.id), ["a"]);
  assert.equal(model.summarize(filtered).cents, 1250);
  assert.equal(model.filter(entries, "", "", "missing").length, 0);
  assert.equal(encodeEntries(entries), before);
});

test("all four sort keys support both directions with deterministic ascending ID ties", () => {
  const entries = [entry({ id: "c", description: "beta", category: "Travel", cents: 1000, date: "2026-10-16" }),
    entry({ id: "b", description: "ALPHA", cents: 200 }),
    entry({ id: "a", description: "alpha", cents: 200 }),
    entry({ id: "d", description: "gamma", category: "Other", cents: 30, date: "2026-10-14" })];
  const before = encodeEntries(entries);
  for (const [key, ascending, descending] of [
    ["date", ["d", "a", "b", "c"], ["c", "a", "b", "d"]],
    ["description", ["a", "b", "c", "d"], ["d", "c", "a", "b"]],
    ["category", ["d", "a", "b", "c"], ["c", "a", "b", "d"]],
    ["cents", ["d", "a", "b", "c"], ["c", "a", "b", "d"]]
  ]) {
    assert.deepEqual(plain(model.sort(entries, key, "ascending")).map(item => item.id), ascending);
    assert.deepEqual(plain(model.sort([...entries].reverse(), key, "descending")).map(item => item.id), descending);
  }
  assert.equal(encodeEntries(entries), before);
  assert.throws(() => model.sort(entries, "unknown"));
  assert.throws(() => model.sort(entries, "date", "unknown"));
});
