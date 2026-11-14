"use strict";

async function checkCategoriesAndSearch(frame, check, load, idle) {
  const key = "fantastic-journey.expenses.v1";
  const get = id => frame.contentDocument.getElementById(id);
  const win = () => frame.contentWindow;
  const saved = () => JSON.parse(localStorage.getItem(key));
  const change = (id, value, event = "change") => {
    get(id).value = value;
    get(id).dispatchEvent(new (win().Event)(event, { bubbles: true }));
  };
  const click = async id => { get(id).click(); await idle(); };
  const manage = id => change("manage-category", id);
  const name = value => { get("category-name").value = value; };
  const labels = id => [...get(id).options].map(option => option.textContent);
  const rows = () => [...get("expenses").rows].map(row => row.cells[1].textContent);
  const old = { version: 1, expenses: [
    { id: "paper", description: "Paper", date: "2026-11-12", category: "Supplies", cents: 1000 },
    { id: "clips", description: "PAPER clips", date: "2026-11-12", category: "Supplies", cents: 200 },
    { id: "ticket", description: "Paper ticket", date: "2026-11-12", category: "Travel", cents: 300 },
    { id: "old", description: "Paper archive", date: "2026-10-12", category: "Supplies", cents: 50 }
  ] };
  const raw = JSON.stringify(old);
  localStorage.setItem(key, raw);
  await load();
  frame.style.width = "1000px";
  get("all-expenses").click();
  check(localStorage.getItem(key) === raw && get("total").textContent === "$15.50",
    "version-1 migration reads every expense and does not write until a successful action");
  get("expenses").querySelector('button[data-id="paper"][data-action="edit"]').click();
  get("description").value = "Retained category draft";
  manage("supplies");
  name(" Stationery ");
  await click("rename-category");
  check(saved().version === 3 && saved().expenses.length === 4 &&
    saved().expenses.find(entry => entry.id === "paper").categoryId === "supplies" &&
    saved().categories.find(category => category.id === "supplies").name === "Stationery",
    "rename commits safe migration with stable category identifiers");
  check(get("description").value === "Retained category draft" && get("category").value === "supplies" &&
    !get("cancel").hidden && get("total").textContent === "$15.50",
    "rename preserves in-progress edits and financial totals");
  check(labels("category").includes("Stationery") && labels("category-filter").includes("Stationery") &&
    get("breakdown").textContent.includes("Stationery"),
    "renamed categories appear consistently in form, filter, ledger and breakdown");

  const beforeDuplicate = localStorage.getItem(key);
  name(" STATIONERY ");
  await click("add-category");
  check(get("error").textContent.includes("already exists") && localStorage.getItem(key) === beforeDuplicate,
    "case-insensitive category duplicates are rejected without changing saved data");
  name(" ".repeat(3));
  await click("add-category");
  check(get("error").textContent.includes("1 and 40") && localStorage.getItem(key) === beforeDuplicate,
    "whitespace-only category names produce actionable errors");
  name("Office rent");
  await click("add-category");
  const rent = saved().categories.find(category => category.name === "Office rent").id;
  check(labels("category").includes("Office rent") && saved().categories.length === 6,
    "adding a category assigns a stable identifier and updates controls");

  manage("supplies");
  await click("delete-category");
  check(get("error").textContent.includes("in use") && saved().categories.length === 6,
    "in-use deletion requires explicit reassignment, not an automatic fallback");
  change("reassign-category", rent);
  win().confirm = () => false;
  await click("delete-category");
  check(saved().categories.length === 6, "canceling category deletion preserves all data");
  win().confirm = () => true;
  const originalSet = win().Storage.prototype.setItem;
  const beforeDelete = localStorage.getItem(key);
  win().Storage.prototype.setItem = () => { throw new Error("Category quota"); };
  await click("delete-category");
  check(localStorage.getItem(key) === beforeDelete && get("category").value === "supplies" &&
    get("description").value === "Retained category draft" && get("error").textContent.includes("Category quota"),
    "failed category reassignment retains categories, expenses and the draft");
  win().Storage.prototype.setItem = originalSet;
  await click("delete-category");
  check(!saved().categories.some(category => category.id === "supplies") &&
    saved().expenses.filter(entry => entry.categoryId === rent).length === 3 &&
    get("category").value === rent && get("description").value === "Retained category draft" &&
    get("total").textContent === "$15.50",
    "explicit reassignment atomically updates saved expenses and the draft without changing totals");
  get("description").value = "Paper";
  get("expense-form").requestSubmit();
  await idle();
  check(saved().expenses.length === 4 && saved().expenses.find(entry => entry.id === "paper").categoryId === rent &&
    get("cancel").hidden, "saving a reassigned edit uses its custom category without duplicating the expense");
  const beforeRename = localStorage.getItem(key);
  manage(rent);
  name("Rent renamed");
  win().Storage.prototype.setItem = () => { throw new Error("Rename quota"); };
  await click("rename-category");
  check(localStorage.getItem(key) === beforeRename && labels("category").includes("Office rent") &&
    get("category-name").value === "Rent renamed", "failed rename keeps original names and retry input");
  name("New category");
  await click("add-category");
  check(localStorage.getItem(key) === beforeRename && get("category-name").value === "New category",
    "failed category addition does not create an unsaved category");
  win().Storage.prototype.setItem = originalSet;
  await load();
  get("all-expenses").click();
  check(saved().categories.some(category => category.id === rent) && !labels("category").includes("Supplies") &&
    get("total").textContent === "$15.50", "custom categories and reassigned expenses survive reload");

  get("expenses").querySelector('button[data-id="paper"][data-action="edit"]').click();
  get("description").value = "Search draft";
  const unchanged = localStorage.getItem(key);
  change("month-filter", "2026-11");
  change("category-filter", rent);
  change("description-search", "  pApEr ", "input");
  check(get("count").textContent === "2" && get("total").textContent === "$12.00" &&
    get("breakdown").textContent.includes("Office rent: $12.00"),
    "description search combines case-insensitively with month/category totals and breakdown");
  await click("sort-amount");
  check(rows().join("|") === "PAPER clips|Paper" &&
    get("sort-amount").closest("th").getAttribute("aria-sort") === "ascending" &&
    get("view-status").textContent.includes("2 matching") && get("view-status").textContent.includes("amount ascending"),
    "amount sorting uses numeric cents and announces direction and matching count");

  let blob;
  win().URL.createObjectURL = value => { blob = value; return "blob:test"; };
  win().URL.revokeObjectURL = () => {};
  win().HTMLAnchorElement.prototype.click = () => {};
  await click("export-filtered");
  const csv = await blob.text();
  check(csv.indexOf('"PAPER clips"') < csv.indexOf('"Paper"') && csv.includes('"Office rent"') &&
    !csv.includes("Paper ticket") && !csv.includes("Paper archive"),
    "filtered CSV preserves the exact searched/sorted view and custom category names");
  await click("sort-amount");
  check(rows().join("|") === "Paper|PAPER clips" && get("view-status").textContent.includes("descending"),
    "repeated sort activation reverses the numeric order");
  for (const field of ["date", "description", "category"]) {
    await click(`sort-${field}`);
    check(get(`sort-${field}`).closest("th").getAttribute("aria-sort") === "ascending",
      `${field} sort exposes aria-sort on its active column`);
  }
  check(get("description").value === "Search draft" && !get("cancel").hidden &&
    localStorage.getItem(key) === unchanged, "search, filters, sorting and CSV never write records or discard edits");
  change("description-search", "no such entry", "input");
  check(get("count").textContent === "0" && get("total").textContent === "$0.00" &&
    !get("empty").hidden && get("export-filtered").disabled && !get("export-all").disabled &&
    get("view-status").textContent.includes("0 matching"), "zero matches have accessible feedback and empty filtered summaries");
  await click("all-expenses");
  check(get("description-search").value === "" && rows().length === 4,
    "Show all clears search and both filters while keeping the selected sort");
  await click("sort-amount");
  await click("export-all");
  const allCsv = await blob.text();
  check(allCsv.indexOf('"Paper archive"') < allCsv.indexOf('"PAPER clips"') &&
    allCsv.indexOf('"PAPER clips"') < allCsv.indexOf('"Paper ticket"') &&
    allCsv.indexOf('"Paper ticket"') < allCsv.indexOf('"Paper"'),
    "all CSV ignores filters but follows the active numeric sort");

  const bad = saved();
  bad.expenses.push({ id: "bad-category", description: "Keep me", date: "2026-11-12", categoryId: "missing", cents: 1 });
  const corrupt = JSON.stringify(bad);
  localStorage.setItem(key, corrupt);
  await load();
  check(get("entry-fields").disabled && get("category-fields").disabled &&
    get("error").textContent.includes("unknown category") && localStorage.getItem(key) === corrupt,
    "an unknown category protects the entire ledger and disables category writes");
}
