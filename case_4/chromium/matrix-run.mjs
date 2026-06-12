/* 
 * chromium/run-matrix.mjs — Case 4 matrix driver
 */
import { chromium, firefox } from "playwright";
import { createServer } from "http";
import { readFile } from "fs/promises";
import { fileURLToPath } from "url";
import path from "path";

const dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(dir, "..");
const TYPED = "user-typed-value";

const MIME = { ".html": "text/html", ".mjs": "text/javascript", ".js": "text/javascript", ".json": "application/json" };

function startServer() {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      try {
        const urlPath = decodeURIComponent(req.url.split("?")[0]);
        const filePath = path.join(root, urlPath);
        if (!filePath.startsWith(root)) { res.writeHead(403).end(); return; }
        const body = await readFile(filePath);
        res.writeHead(200, { "Content-Type": MIME[path.extname(filePath)] || "application/octet-stream" });
        res.end(body);
      } catch {
        res.writeHead(404).end();
      }
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

const CELLS = [
  ["R1", "A", "value lost"], ["R1", "B", "preserved"], ["R1", "D", "preserved"], ["R1", "C", "preserved"],
  ["R2", "A", "discarded"], ["R2", "B", "false reuse"], ["R2", "D", "discarded"], ["R2", "C", "discarded"],
  ["R3", "A", "no impersonation / state also lost"], ["R3", "B", "forged (same key)"],
  ["R3", "D", "forged (client-reachable id)"], ["R3", "C", "forged (replayed issued id)"],
  ["R3_FAB", "C", "fabricated id rejected"],
];
const MODEL_LABEL = { A: "A innerHTML", B: "B keyed", C: "C identity", D: "D server-id" };

function outcomeOf(scenario, r) {
  if (scenario === "R1") return r.preserved ? "preserved" : "lost";
  if (scenario === "R2") return r.discarded ? "discarded" : "false-reuse";
  if (scenario === "R3_FAB") return r.verdict === "RECONSTRUCTION_REJECTED" ? "fabricated-rejected" : "fabricated-accepted";
  return r.forgerySucceeded ? "forgery-succeeded" : "forgery-blocked";
}

const server = await startServer();
const port = server.address().port;
const pageURL = `http://127.0.0.1:${port}/chromium/matrix-bench.html`;

async function runEngine(launcher, engineName) {
  const browser = await launcher.launch();
  const page = await browser.newPage();
  await page.goto(pageURL);
  await page.waitForFunction("window.__c4Ready === true");
  const rows = [];
  for (const [scenario, model, expected] of CELLS) {
    await page.evaluate(([m, s]) => window.c4_setup(m, s), [model, scenario]);
    await page.fill('input[name="user"]', TYPED);
    const measured = await page.evaluate(([m, s]) => window.c4_apply(m, s), [model, scenario]);
    rows.push({ scenario, model: MODEL_LABEL[model], expected, ...measured });
  }
  await browser.close();
  return rows;
}

const engines = {};
engines.chromium = await runEngine(chromium, "chromium");
try {
  engines.firefox = await runEngine(firefox, "firefox");
} catch (e) {
  engines.firefox = { skipped: true, reason: String((e && e.message) || e) };
}
server.close();

const rows = engines.chromium;
const table = rows.map((r) => ({
  Scenario: r.scenario, Model: r.model,
  Outcome: outcomeOf(r.scenario, r), "(hypothesis)": r.expected, Verdict: r.verdict || "-",
}));
console.log("\n=== Case 4 matrix (Chromium) ===\n");
console.table(table);
console.log("\nR3 DOM after reconstruction (Chromium):");
rows.filter((r) => r.scenario === "R3").forEach((r) => console.log(`  ${r.model}: ${r.domSummary}`));

if (Array.isArray(engines.firefox)) {
  const mism = engines.chromium.filter((c, i) => {
    const f = engines.firefox[i];
    return !f || outcomeOf(c.scenario, c) !== outcomeOf(f.scenario, f);
  });
  console.log(mism.length === 0
    ? "\nFirefox cross-check: identical outcomes on all cells."
    : `\nFirefox cross-check: ${mism.length} mismatch(es) — inspect.`);
} else {
  console.log("\nFirefox cross-check: skipped (" + engines.firefox.reason + ")");
}

const { writeFileSync } = await import("fs");
writeFileSync(
  path.join(dir, "case4_matrix_result.json"),
  JSON.stringify({ engines, timestamp: new Date().toISOString() }, null, 2)
);
console.log("\nresult -> chromium/case4_matrix_result.json");