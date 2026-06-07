// run_browser_detection.mjs — cross-engine detection confirmation.
// Mirrors run_paired.mjs: serve browser/ over loopback, drive the harness on Chromium and
// Firefox via Playwright, capture each engine version at run time, and write
// results/browser_detection_<engine>.json. A local JSDOM pass is included as the reference
// row (engine-independent; detection is a boolean), matching run_paired's three-environment
// shape.
//
// Usage: npm i -D playwright jsdom && npx playwright install chromium firefox
//        node run_browser_detection.mjs
// Output: results/browser_detection_{jsdom,chromium,firefox}.json + a combined verdict table.
import { chromium, firefox } from "playwright";
import http from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { runDetection } from "./scenarios.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "results");

function startServer(root) {
  const types = { ".html": "text/html", ".mjs": "text/javascript", ".json": "application/json" };
  const s = http.createServer(async (req, res) => {
    try {
      const u = decodeURIComponent(req.url.split("?")[0]);
      const fp = path.join(root, u === "/" ? "/detection_harness.html" : u);
      if (!fp.startsWith(root)) { res.statusCode = 403; return res.end("no"); }
      const b = await readFile(fp);
      res.setHeader("Content-Type", types[path.extname(fp)] || "application/octet-stream");
      res.end(b);
    } catch { res.statusCode = 404; res.end("no"); }
  });
  return new Promise((r) => s.listen(0, "127.0.0.1", () => r(s)));
}

async function onBrowser(name, launcher, baseUrl) {
  const br = await launcher.launch();
  const ver = br.version();
  const pg = await br.newPage();
  await pg.goto(`${baseUrl}/detection_harness.html`, { waitUntil: "load" });
  await pg.waitForFunction(() => typeof window.__runDetection === "function", null, { timeout: 15000 });
  const rows = await pg.evaluate(() => window.__runDetection());
  await br.close();
  return { engine: name, engineVersion: ver, rows };
}

function summarize(rows) {
  // every scenario's verdict must equal its expectation
  return rows.every((r) => r.detected === (r.expected === "detected"));
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const server = await startServer(__dirname);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const results = [];

  // JSDOM (local reference) — detection is engine-independent, so this is the ground truth.
  try {
    const doc = new JSDOM("<!doctype html><html><head></head><body></body></html>").window.document;
    results.push({ engine: "jsdom", engineVersion: process.version, rows: runDetection(doc) });
    console.log("[jsdom] done");
  } catch (e) { console.error(`[jsdom] FAILED: ${e.message}`); }

  // Chromium + Firefox (live engines).
  for (const [n, l] of [["chromium", chromium], ["firefox", firefox]]) {
    try { results.push(await onBrowser(n, l, baseUrl)); console.log(`[${n}] done`); }
    catch (e) { console.error(`[${n}] FAILED: ${e.message}`); }
  }

  for (const r of results) {
    await writeFile(path.join(OUT, `browser_detection_${r.engine}.json`), JSON.stringify(r, null, 2));
  }

  // combined verdict table (one row per scenario, one column per engine)
  console.log("\n=== cross-engine detection (Detected / not detected) ===");
  const ids = results[0]?.rows.map((x) => x.id) ?? [];
  const tbl = ids.map((id) => {
    const row = { scenario: id };
    for (const r of results) {
      const x = r.rows.find((y) => y.id === id);
      row[r.engine] = x ? (x.detected ? "Detected" : "not detected") : "n/a";
    }
    return row;
  });
  console.table(tbl);

  const allOk = results.every((r) => summarize(r.rows));
  console.log(allOk ? "ALL ENGINES MATCH EXPECTATIONS" : "MISMATCH PRESENT");
  server.close();
}

main();
