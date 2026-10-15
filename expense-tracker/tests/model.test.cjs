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
  assert.deepEqual(plain(model.decode(model.encode(entries))), entries);
  assert.deepEqual(plain(model.decode(null)), []);
  for (const raw of ["", "{", "null", "[]", '{"version":2,"expenses":[]}',
    '{"version":1,"expenses":null}', '{"version":1,"expenses":[{}]}',
    JSON.stringify({ version: 1, expenses: [entry(), entry()] })]) {
    assert.throws(() => model.decode(raw));
  }
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
