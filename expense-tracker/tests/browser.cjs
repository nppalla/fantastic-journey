const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { spawn } = require("node:child_process");

const root = path.resolve(__dirname, "../..");
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

async function main() {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "expense-tracker-browser-"));
  const server = http.createServer(async (request, response) => {
    const pathname = new URL(request.url, "http://localhost").pathname;
    const file = path.resolve(root, `.${pathname}`);
    if (!file.startsWith(`${root}${path.sep}`)) {
      response.writeHead(403).end();
      return;
    }
    try {
      const body = await fs.readFile(file);
      response.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream" });
      response.end(body);
    } catch (error) {
      response.writeHead(error.code === "ENOENT" ? 404 : 500).end(error.message);
    }
  });
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    await runBrowser(profile, `http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await fs.rm(profile, { recursive: true, force: true });
  }
}

async function runBrowser(profile, origin) {
  const browser = spawn(process.env.CHROMIUM_BIN || "chromium", [
    "--headless", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
    "--no-first-run", "--no-default-browser-check", `--user-data-dir=${profile}`,
    "--remote-debugging-pipe", "about:blank"
  ], { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"] });
  let sequence = 0;
  let buffer = "";
  let stderr = "";
  let sessionId;
  const pending = new Map();
  const listeners = new Set();
  browser.stderr.on("data", data => { stderr += data; });
  const fail = error => {
    for (const { reject } of pending.values()) reject(error);
    pending.clear();
    for (const listener of listeners) listener(null, error);
    listeners.clear();
  };
  browser.once("error", fail);
  const closed = new Promise(resolve => browser.once("close", () => {
    fail(new Error(`Chromium closed before checks finished: ${stderr}`));
    resolve();
  }));
  const timer = setTimeout(() => {
    fail(new Error("Chromium checks timed out after 90 seconds."));
    browser.kill();
  }, 90000);
  browser.stdio[4].on("data", data => {
    buffer += data.toString();
    let end;
    while ((end = buffer.indexOf("\0")) !== -1) {
      const message = JSON.parse(buffer.slice(0, end));
      buffer = buffer.slice(end + 1);
      if (message.id) {
        const request = pending.get(message.id);
        pending.delete(message.id);
        if (!request) continue;
        if (message.error) request.reject(new Error(message.error.message));
        else request.resolve(message.result);
      } else {
        for (const listener of listeners) listener(message);
      }
    }
  });
  const send = (method, params = {}, session = sessionId) => new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    browser.stdio[3].write(JSON.stringify({ id, method, params, sessionId: session }) + "\0");
  });
  const evaluate = async expression => {
    const response = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (response.exceptionDetails) {
      throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
    }
    return response.result.value;
  };
  const navigate = async url => {
    const loaded = new Promise((resolve, reject) => {
      const listener = (message, error) => {
        if (error || (message.sessionId === sessionId && message.method === "Page.loadEventFired")) {
          listeners.delete(listener);
          if (error) reject(error);
          else resolve();
        }
      };
      listeners.add(listener);
    });
    await send("Page.navigate", { url });
    await loaded;
  };
  const wait = async expression => {
    for (let i = 0; i < 1000; i++) {
      const value = await evaluate(expression);
      if (value) return value;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    const state = await evaluate(`JSON.stringify({
      focus: document.activeElement?.outerHTML, error: document.getElementById("error")?.textContent,
      busy: document.body.dataset.busy, dialog: document.getElementById("receipt-dialog")?.open
    })`);
    throw new Error(`Browser condition did not finish: ${expression}\n${state}`);
  };
  const press = async (key, code, windowsVirtualKeyCode, modifiers = 0) => {
    for (const type of ["keyDown", "keyUp"]) {
      const text = type === "keyDown" ? (key === "Enter" ? "\r" : key === " " ? " " : undefined) : undefined;
      await send("Input.dispatchKeyEvent", { type, key, code, windowsVirtualKeyCode, modifiers, text });
    }
  };
  try {
    const { targetId } = await send("Target.createTarget", { url: "about:blank" }, undefined);
    ({ sessionId } = await send("Target.attachToTarget", { targetId, flatten: true }, undefined));
    await send("Page.enable");
    await send("Page.bringToFront");
    await navigate(`${origin}/expense-tracker/tests/browser.html`);
    const report = await wait(`(() => {
      const result = document.getElementById("results");
      return result.dataset.status !== "running" && { status: result.dataset.status, text: result.textContent };
    })()`);
    console.log(report.text);
    if (report.status !== "passed") throw new Error(`Browser checks ${report.status}.`);

    await navigate(`${origin}/expense-tracker/index.html`);
    await wait('document.body.dataset.busy !== "true"');
    await evaluate(`(async () => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 8;
      const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
      await ExpenseReceipts.withWriteLock(async () => {
        await ExpenseReceipts.put("keyboard-image", blob);
        localStorage.setItem(ExpenseModel.STORAGE_KEY, ExpenseModel.encode([{
          id: "keyboard", description: "Fictional keyboard receipt", date: "2026-11-12", category: "Other", cents: 100,
          receipt: { id: "keyboard-image", name: "fictional.png", type: "image/png", size: blob.size }
        }]));
      });
    })()`);
    await navigate(`${origin}/expense-tracker/index.html`);
    await wait('document.body.dataset.busy !== "true"');
    await evaluate('document.getElementById("all-expenses").click(); document.querySelector(\'button[data-action="receipt"]\').focus()');
    await press("Enter", "Enter", 13);
    await wait('document.getElementById("receipt-dialog").open && document.body.dataset.busy !== "true"');
    if (!await evaluate('!document.getElementById("receipt-preview").hidden && document.activeElement.id === "close-receipt"')) {
      throw new Error("Keyboard opening must show the preview and focus its close button.");
    }
    for (const id of ["remove-receipt", "save-receipt", "receipt-file"]) {
      await press("Tab", "Tab", 9, 8);
      if (!await evaluate(`document.activeElement.id === "${id}"`)) throw new Error(`Shift+Tab must reach ${id} in the modal.`);
    }
    for (const id of ["save-receipt", "remove-receipt", "close-receipt"]) {
      await press("Tab", "Tab", 9);
      if (!await evaluate(`document.activeElement.id === "${id}"`)) throw new Error(`Tab must reach ${id} in the modal.`);
    }
    await press("Escape", "Escape", 27);
    await wait(`!document.getElementById("receipt-dialog").open &&
      document.activeElement.dataset.action === "receipt" &&
      !document.getElementById("receipt-preview").hasAttribute("src")`);
    await press("Enter", "Enter", 13);
    await wait('document.getElementById("receipt-dialog").open && document.body.dataset.busy !== "true"');
    await press(" ", "Space", 32);
    await wait('!document.getElementById("receipt-dialog").open && !document.getElementById("receipt-preview").hasAttribute("src")');
    console.log("PASS real keyboard Enter, Tab/Shift+Tab receipt controls, Escape, Space, and focus restoration");
  } finally {
    clearTimeout(timer);
    browser.kill();
    await closed;
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
