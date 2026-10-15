"use strict";

(async () => {
  const key = "fantastic-journey.expenses.v1";
  const frame = document.getElementById("app");
  const output = document.getElementById("results");
  const results = [];
  let doc;
  let win;
  const get = id => doc.getElementById(id);
  const check = (condition, message) => {
    if (!condition) throw new Error(message);
    results.push(`PASS ${message}`);
  };
  const saved = () => JSON.parse(localStorage.getItem(key)).expenses;
  const rowButtons = action => [...get("expenses").querySelectorAll(`button[data-action="${action}"]`)];
  const change = (id, value) => {
    get(id).value = value;
    get(id).dispatchEvent(new win.Event("change", { bubbles: true }));
  };
  const load = () => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("App frame did not load")), 5000);
    frame.onload = () => {
      clearTimeout(timer);
      win = frame.contentWindow;
      doc = frame.contentDocument;
      resolve();
    };
    frame.src = `../index.html?check=${Date.now()}-${Math.random()}`;
  });
  function add(description, amount, category = "Supplies", date = get("date").value) {
    get("description").value = description;
    get("amount").value = amount;
    get("category").value = category;
    get("date").value = date;
    get("expense-form").requestSubmit();
  }

  try {
    const homeResponse = await fetch("../../index.html");
    const home = new DOMParser().parseFromString(await homeResponse.text(), "text/html");
    const links = [...home.querySelectorAll("a.card")].map(link => link.getAttribute("href"));
    check(homeResponse.ok && ["block-drop/index.html", "merge-2048/index.html", "expense-tracker/index.html"]
      .every(link => links.includes(link)), "homepage links to both existing games and the new sample");
    for (const link of links) {
      const page = await fetch(`../../${link}`);
      check(page.ok, `sample link resolves: ${link}`);
    }
    localStorage.removeItem(key);
    await load();
    check(get("empty").textContent.includes("No expenses yet"), "empty state is useful");
    check(get("export-all").disabled && get("export-filtered").disabled, "empty exports are disabled");
    check(get("month-filter").value === get("date").value.slice(0, 7), "initial month uses the local date");
    const today = get("date").value;
    const otherMonth = today.slice(5, 7) === "01" ? `${today.slice(0, 4)}-02-01` : `${today.slice(0, 4)}-01-01`;

    add("Paper", "0.10");
    add("Pens", "0.20");
    check(get("total").textContent === "$0.30", "decimal amounts sum exactly");
    check(saved().length === 2 && saved()[0].cents === 10, "expenses persist as integer cents");
    check(doc.activeElement === get("description"), "adding returns focus to the form");

    rowButtons("edit")[0].click();
    check(!get("cancel").hidden && get("save").textContent === "Save changes", "edit mode is visible");
    get("description").value = "Updated paper";
    get("amount").value = "2.50";
    get("expense-form").requestSubmit();
    check(get("total").textContent === "$2.70" && saved().length === 2, "editing replaces rather than duplicates");
    rowButtons("edit")[0].click();
    get("amount").value = "999";
    get("cancel").click();
    check(get("total").textContent === "$2.70" && get("cancel").hidden, "cancel leaves the ledger unchanged");

    add("Train", "10.00", "Travel", otherMonth);
    check(get("count").textContent === "2" && get("status").textContent.includes("outside"), "hidden additions explain filters");
    get("all-expenses").click();
    check(get("count").textContent === "3" && get("total").textContent === "$12.70", "Show all clears both filters");
    change("category-filter", "Travel");
    check(get("count").textContent === "1" && get("total").textContent === "$10.00", "category filter updates totals");
    change("month-filter", today.slice(0, 7));
    check(!get("empty").hidden && get("export-filtered").disabled && !get("export-all").disabled,
      "combined filters and empty filtered export work");
    get("all-expenses").click();

    win.confirm = () => false;
    rowButtons("delete")[0].click();
    check(saved().length === 3, "cancelled deletion keeps the expense");
    win.confirm = () => true;
    rowButtons("delete")[0].click();
    check(saved().length === 2 && doc.activeElement.dataset.action === "edit", "confirmed deletion persists and restores focus");

    add('<img src=x onerror="window.injected=true">', "1.00", "Other");
    check(!get("expenses").querySelector("img") && !win.injected, "descriptions render as text, not markup");
    await load();
    get("all-expenses").click();
    check(saved().length === 3 && get("count").textContent === "3", "reload restores the ledger");

    const beforeInvalid = localStorage.getItem(key);
    add("Bad precision", "1.234");
    check(localStorage.getItem(key) === beforeInvalid && !get("amount").validity.valid,
      "native validation rejects fractional cents");
    get("description").value = "   ";
    get("amount").value = "1";
    get("expense-form").requestSubmit();
    check(!get("error").hidden && localStorage.getItem(key) === beforeInvalid, "whitespace-only description shows an error");

    const originalSet = win.Storage.prototype.setItem;
    win.Storage.prototype.setItem = () => { throw new win.DOMException("Quota reached", "QuotaExceededError"); };
    add("Retained draft", "5.00");
    check(!get("error").hidden && get("error").textContent.includes("No changes") &&
      get("description").value === "Retained draft" && localStorage.getItem(key) === beforeInvalid,
      "storage failure retains the draft and existing ledger");
    win.Storage.prototype.setItem = originalSet;
    get("expense-form").requestSubmit();
    check(saved().length === 4 && get("error").hidden, "retry after storage recovery saves once");

    add("=SUM(1,2)", "3.40", "Software");
    let downloaded;
    let filename;
    win.URL.createObjectURL = blob => { downloaded = blob; return "blob:test"; };
    win.URL.revokeObjectURL = () => {};
    win.HTMLAnchorElement.prototype.click = function () { filename = this.download; };
    change("category-filter", "Software");
    get("export-filtered").click();
    let csv = await downloaded.text();
    check(csv.includes('"\'=SUM(1,2)"') && csv.includes('"3.40"') && !csv.includes('"Train"'),
      "filtered CSV contains only matching entries and neutralizes formulas");
    check(filename.endsWith(".csv"), "CSV download has a filename");
    get("export-all").click();
    csv = await downloaded.text();
    check(csv.includes('"Retained draft"') && filename === "expenses-all.csv", "all-CSV export ignores current filters");

    const stale = localStorage.getItem(key);
    const external = JSON.parse(stale);
    external.expenses.push({ id: "external", description: "Another tab", date: today, category: "Other", cents: 100 });
    localStorage.setItem(key, JSON.stringify(external));
    add("Stale write", "7.00");
    check(get("error").textContent.includes("another tab") && saved().length === 6 &&
      !saved().some(entry => entry.description === "Stale write"), "stale writes do not overwrite another tab");

    localStorage.setItem(key, "{corrupt");
    await load();
    check(get("entry-fields").disabled && !get("error").hidden && localStorage.getItem(key) === "{corrupt",
      "corrupt storage is reported and never overwritten");
    localStorage.setItem(key, JSON.stringify({ version: 2, expenses: [] }));
    await load();
    check(get("entry-fields").disabled && get("error").textContent.includes("unsupported"), "unknown storage version disables editing");

    localStorage.removeItem(key);
    await load();
    const originalGet = win.Storage.prototype.getItem;
    win.Storage.prototype.getItem = () => { throw new win.DOMException("Access denied", "SecurityError"); };
    // Re-run the page script in this realm to exercise blocked storage on initialization.
    const script = doc.createElement("script");
    script.src = "app.js";
    await new Promise((resolve, reject) => {
      script.onload = resolve;
      script.onerror = reject;
      doc.body.append(script);
    });
    check(get("entry-fields").disabled && get("error").textContent.includes("Access denied"), "blocked storage is explicit at startup");
    win.Storage.prototype.getItem = originalGet;

    await load();
    frame.style.width = "320px";
    check(doc.documentElement.scrollWidth <= 320, "mobile layout has no page-wide horizontal overflow");
    add("Mobile expense", "12.00");
    check(doc.documentElement.scrollWidth <= 320 && get("table-wrap").scrollWidth > 0,
      "populated mobile table stays within its scroll region");

    output.dataset.status = "passed";
    output.textContent = `${results.join("\n")}\n${results.length} browser checks passed.`;
  } catch (cause) {
    output.dataset.status = "failed";
    output.textContent = `${results.join("\n")}\nFAIL ${cause.stack || cause}`;
  } finally {
    frame.src = "about:blank";
    localStorage.removeItem(key);
  }
})();
