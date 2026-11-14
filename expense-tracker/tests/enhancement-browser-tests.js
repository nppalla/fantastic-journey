"use strict";

async function checkEnhancements(frame, check, load, idle) {
  const key = "fantastic-journey.expenses.v1";
  const get = id => frame.contentDocument.getElementById(id);
  const win = () => frame.contentWindow;
  const saved = () => JSON.parse(localStorage.getItem(key));
  const rows = () => [...get("expenses").children];
  const rowIds = () => rows().map(row => row.querySelector("button").dataset.id).join();
  const change = (id, value, type = "change") => {
    get(id).value = value;
    get(id).dispatchEvent(new (win().Event)(type, { bubbles: true }));
  };
  const manage = id => {
    get("category-form").closest("details").open = true;
    change("managed-category", id);
  };
  const saveCategory = async name => {
    get("category-name").value = name;
    get("category-form").requestSubmit();
    await idle();
  };
  const sort = key => frame.contentDocument.querySelector(`button[data-sort="${key}"]`).click();
  const entries = [
    { id: "b", description: "PAPER", date: "2026-11-12", category: "Supplies", cents: 200 },
    { id: "a", description: "paper", date: "2026-11-12", category: "Supplies", cents: 200 },
    { id: "c", description: "Paper ticket", date: "2026-11-13", category: "Travel", cents: 1000 },
    { id: "d", description: "Pens", date: "2026-10-12", category: "Supplies", cents: 30 }
  ];
  const legacy = JSON.stringify({ version: 1, expenses: entries });
  localStorage.setItem(key, legacy);
  frame.style.width = "1000px";
  await load();
  get("all-expenses").click();
  check(localStorage.getItem(key) === legacy && get("total").textContent === "$14.30",
    "version-1 category migration loads all entries without writing or changing totals");
  check([...get("category").options].slice(1).map(option => option.text).join() === "Supplies,Travel,Meals,Software,Other",
    "legacy categories appear consistently in the expense form");

  rows().find(row => row.querySelector("button").dataset.id === "a").querySelector("button").click();
  get("description").value = "Unsaved paper draft";
  get("amount").value = "9.87";
  const draft = () => [get("description").value, get("amount").value, get("category").value, get("date").value].join("|");
  const originalDraft = draft();
  change("month-filter", "2026-11");
  change("category-filter", "Supplies");
  change("description-search", "pApEr", "input");
  check(rowIds() === "a,b" && get("count").textContent === "2" && get("total").textContent === "$4.00" &&
    get("breakdown").textContent.includes("Supplies: $4.00"),
    "case-insensitive search combines with month and category and keeps summaries consistent");
  check(get("view-status").textContent.includes("2 matching entries") &&
    get("view-status").textContent.includes("descending"), "matching count and active direction are announced");
  sort("cents");
  check(rowIds() === "a,b", "equal numeric amounts use ascending stable IDs");
  change("description-search", "no match", "input");
  check(!get("empty").hidden && get("count").textContent === "0" && get("total").textContent === "$0.00" &&
    !get("breakdown").children.length && get("export-filtered").disabled && !get("export-all").disabled,
    "no search matches shows a useful empty state, zero totals, and disabled filtered export");
  get("all-expenses").click();
  check(!get("description-search").value && !get("category-filter").value && !get("month-filter").value,
    "Show all clears search and both filters");
  check(rowIds() === "d,a,b,c", "ascending amounts compare integer cents rather than display strings");
  sort("cents");
  check(rowIds() === "c,a,b,d", "descending numeric sort retains deterministic ties");
  sort("description");
  check(rowIds() === "a,b,c,d", "description sort ignores case and uses stable ID ties");
  sort("category");
  check(rowIds() === "a,b,d,c", "category sort uses displayed names");
  sort("date");
  check(rowIds() === "d,a,b,c", "date sort supports ascending dates and stable ties");
  sort("date");
  check(rowIds() === "c,a,b,d", "date sort supports descending dates");
  check(draft() === originalDraft && !get("cancel").hidden && localStorage.getItem(key) === legacy,
    "search, filters, and all sort controls preserve edits and never save view state into records");

  manage("Supplies");
  const originalLegacySet = win().Storage.prototype.setItem;
  win().Storage.prototype.setItem = () => { throw new Error("Migration quota reached"); };
  await saveCategory("Migration retry");
  check(localStorage.getItem(key) === legacy && get("category-name").value === "Migration retry" &&
    draft() === originalDraft && get("category").selectedOptions[0].textContent === "Supplies" &&
    get("error").textContent.includes("No changes"),
    "failed legacy migration preserves raw version-1 data, category labels, and both drafts");
  win().Storage.prototype.setItem = originalLegacySet;
  manage("");
  await saveCategory("  Equipment  ");
  const customId = saved().categories.find(item => item.name === "Equipment").id;
  check(saved().version === 3 && saved().expenses.length === 4 && get("category").querySelector(`option[value="${customId}"]`) &&
    get("category-filter").querySelector(`option[value="${customId}"]`),
    "adding a trimmed custom category migrates to version 3 and populates form and filter");
  const beforeDuplicate = localStorage.getItem(key);
  await saveCategory("eQUIPment");
  check(get("error").textContent.includes("already exists") && localStorage.getItem(key) === beforeDuplicate &&
    get("category-name").value === "eQUIPment", "case-insensitive category duplicates retain the draft and saved data");
  get("category-name").value = "x".repeat(41);
  get("category-form").requestSubmit();
  await idle();
  check(get("error").textContent.includes("40") && localStorage.getItem(key) === beforeDuplicate,
    "overlength programmatic category input is rejected at the documented 40-character boundary");
  await saveCategory(" ");
  check(get("error").textContent.includes("1 to 40") && localStorage.getItem(key) === beforeDuplicate,
    "whitespace-only category names are rejected visibly");

  manage("Supplies");
  change("category-filter", "Supplies");
  const beforeRename = saved().expenses;
  await saveCategory("Materials");
  check(saved().categories.find(item => item.id === "Supplies").name === "Materials" &&
    JSON.stringify(saved().expenses) === JSON.stringify(beforeRename) && draft() === originalDraft &&
    get("category").selectedOptions[0].textContent === "Materials" &&
    get("category-filter").selectedOptions[0].textContent === "Materials" &&
    rows().every(row => row.children[2].textContent === "Materials") &&
    get("breakdown").textContent.includes("Materials: $4.30"),
    "rename keeps stable IDs, financial records, and expense draft while updating every label");

  let downloaded;
  win().URL.createObjectURL = blob => { downloaded = blob; return "blob:test"; };
  win().URL.revokeObjectURL = () => {};
  win().HTMLAnchorElement.prototype.click = () => {};
  sort("cents");
  change("description-search", "paper", "input");
  get("export-filtered").click();
  let csv = await downloaded.text();
  check(csv.includes('"Materials"') && !csv.includes('"Travel"') &&
    csv.indexOf('"paper"') < csv.indexOf('"PAPER"') && !csv.includes('"Pens"'),
    "filtered CSV uses renamed labels, exactly the searched rows, and visible tie order");
  get("export-all").click();
  csv = await downloaded.text();
  check(csv.indexOf('"Pens"') < csv.indexOf('"paper"') && csv.indexOf('"Paper ticket"') > csv.indexOf('"PAPER"'),
    "all CSV ignores filters but keeps the selected numeric sort order");

  const originalSet = win().Storage.prototype.setItem;
  const beforeFailure = localStorage.getItem(key);
  win().Storage.prototype.setItem = () => { throw new Error("Category quota reached"); };
  await saveCategory("Failed rename");
  check(localStorage.getItem(key) === beforeFailure && get("error").textContent.includes("No changes") &&
    get("category-name").value === "Failed rename" && draft() === originalDraft &&
    get("category").selectedOptions[0].textContent === "Materials",
    "failed category rename preserves category labels, expense draft, and category draft");
  manage("");
  await saveCategory("Failed add");
  check(localStorage.getItem(key) === beforeFailure && get("category-name").value === "Failed add",
    "failed category add retains saved categories and the retry name");
  manage("Supplies");
  get("delete-category").click();
  await idle();
  check(get("error").textContent.includes("replacement") && localStorage.getItem(key) === beforeFailure,
    "deleting an in-use or draft category requires an explicit replacement");
  change("replacement-category", customId);
  win().confirm = () => false;
  get("delete-category").click();
  await idle();
  check(localStorage.getItem(key) === beforeFailure, "canceling category reassignment leaves records untouched");
  win().confirm = () => true;
  get("delete-category").click();
  await idle();
  check(localStorage.getItem(key) === beforeFailure && draft() === originalDraft &&
    get("replacement-category").value === customId && get("error").textContent.includes("No changes"),
    "failed category deletion applies neither reassignment nor draft changes and retains the replacement choice");
  win().Storage.prototype.setItem = originalSet;
  get("delete-category").click();
  await idle();
  check(!saved().categories.some(item => item.id === "Supplies") &&
    saved().expenses.filter(item => item.category === customId).length === 3 &&
    get("category").value === customId && get("category-filter").value === customId &&
    get("description").value === "Unsaved paper draft" && get("amount").value === "9.87" && !get("cancel").hidden,
    "confirmed reassignment updates saved expenses, selected filter, and only the category of the unsaved draft");
  get("expense-form").requestSubmit();
  await idle();
  check(saved().expenses.find(item => item.id === "a").description === "Unsaved paper draft" &&
    saved().expenses.find(item => item.id === "a").category === customId,
    "a reassigned in-progress edit still saves against its original stable expense ID");
  await load();
  get("all-expenses").click();
  check(saved().categories.find(item => item.id === customId).name === "Equipment" &&
    ![...get("category").options].some(option => option.value === "Supplies") && get("total").textContent === "$22.17",
    "custom categories and reassignment survive reload with exact totals");
  manage("Meals");
  win().confirm = () => true;
  get("delete-category").click();
  await idle();
  check(!saved().categories.some(item => item.id === "Meals") && saved().expenses.length === 4,
    "an unused category can be deleted without reassignment or losing expenses");

  const latest = saved();
  latest.categories.find(item => item.id === "Other").name = "Another tab";
  localStorage.setItem(key, JSON.stringify(latest));
  manage("Travel");
  await saveCategory("Stale rename");
  check(get("error").textContent.includes("another tab") &&
    saved().categories.find(item => item.id === "Travel").name === "Travel",
    "category-only changes from another tab reject stale writes even when expenses did not change");

  await load();
  get("all-expenses").click();
  const receiptButton = get("expenses").querySelector('button[data-action="receipt"]');
  const receiptEntryId = receiptButton.dataset.id;
  receiptButton.click();
  await idle();
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 8;
  const png = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
  const transfer = new (win().DataTransfer)();
  transfer.items.add(new (win().File)([png], "fictional.png", { type: "image/png" }));
  get("receipt-file").files = transfer.files;
  get("save-receipt").click();
  await idle();
  const receiptId = saved().expenses.find(item => item.id === receiptEntryId).receipt.id;
  await new Promise(resolve => {
    get("receipt-dialog").addEventListener("close", resolve, { once: true });
    get("close-receipt").click();
  });
  const receiptCategoryId = saved().expenses.find(item => item.id === receiptEntryId).category;
  manage(receiptCategoryId);
  await saveCategory("Renamed with receipt");
  change("replacement-category", "Other");
  win().confirm = () => true;
  get("delete-category").click();
  await idle();
  check(saved().expenses.find(item => item.id === receiptEntryId).receipt.id === receiptId,
    "category rename and reassignment preserve receipt references");
  await load();
  get("all-expenses").click();
  get("expenses").querySelector(`button[data-action="receipt"][data-id="${receiptEntryId}"]`).click();
  await idle();
  check(!get("receipt-preview").hidden, "receipt bytes remain previewable after category rename, deletion, and reload");
  await new Promise(resolve => {
    get("receipt-dialog").addEventListener("close", resolve, { once: true });
    get("close-receipt").click();
  });

  for (const mutate of [
    data => { data.expenses[0].category = "unknown"; },
    data => { data.categories.push({ ...data.categories[0] }); },
    data => { data.expenses[0].futureField = "preserve me"; }
  ]) {
    const data = saved();
    mutate(data);
    const corrupt = JSON.stringify(data);
    localStorage.setItem(key, corrupt);
    await load();
    check(get("entry-fields").disabled && get("category-fields").disabled && !get("error").hidden &&
      get("error").textContent.includes("recovery") && localStorage.getItem(key) === corrupt,
      "unknown references or corrupt categories disable writes and preserve raw storage for recovery");
    check(await win().eval("ExpenseReceipts").get(receiptId),
      "corrupt expense metadata cannot trigger deletion of existing receipt bytes");
    localStorage.setItem(key, JSON.stringify({ version: 3, categories: latest.categories, expenses: latest.expenses }));
  }
}
