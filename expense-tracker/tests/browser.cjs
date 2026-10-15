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
    const url = `http://127.0.0.1:${server.address().port}/expense-tracker/tests/browser.html`;
    const html = await new Promise((resolve, reject) => {
      const browser = spawn(process.env.CHROMIUM_BIN || "chromium", [
        "--headless", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
        "--no-first-run", "--no-default-browser-check", `--user-data-dir=${profile}`,
        "--dump-dom", "--virtual-time-budget=15000", url
      ]);
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => {
        browser.kill();
        reject(new Error("Chromium checks timed out after 45 seconds."));
      }, 45000);
      browser.stdout.on("data", data => { stdout += data; });
      browser.stderr.on("data", data => { stderr += data; });
      browser.once("error", error => { clearTimeout(timer); reject(error); });
      browser.once("close", code => {
        clearTimeout(timer);
        if (code !== 0) reject(new Error(`Chromium exited ${code}: ${stderr}`));
        else resolve(stdout);
      });
    });
    const report = html.match(/<pre id="results" data-status="([^"]+)">([\s\S]*?)<\/pre>/);
    if (!report) throw new Error(`Missing browser check report:\n${html}`);
    console.log(report[2].replaceAll("&gt;", ">").replaceAll("&lt;", "<").replaceAll("&amp;", "&"));
    if (report[1] !== "passed") throw new Error(`Browser checks ${report[1]}.`);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await fs.rm(profile, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
