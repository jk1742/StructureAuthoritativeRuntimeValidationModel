// run_paired.mjs — paired ratio (proposed/baseline) across THREE environments:
// JSDOM (local) + Chromium + Firefox (Playwright), with median + IQR over
// independent runs. Per-case budget: case1/case3 = 30x10; case4 (expensive
// reconstruction) = 15x5.
//
// Usage: npm i -D playwright jsdom && npx playwright install chromium firefox && node run_paired.mjs
// Output: results/paired_<case>_<engine>.json + combined ratio tables.
import { chromium, firefox } from "playwright";
import http from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { performance } from "node:perf_hooks";
import { runPaired } from "./bench-core-paired.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "results");
const CASES = ["case1", "case3", "case4"];
const BUDGET = { case1: { repeat: 30, runs: 10 }, case3: { repeat: 30, runs: 10 }, case4: { repeat: 15, runs: 5 } };

function startServer(root) {
  const types = { ".html": "text/html", ".mjs": "text/javascript", ".json": "application/json" };
  const s = http.createServer(async (req, res) => {
    try {
      const u = decodeURIComponent(req.url.split("?")[0]);
      const fp = path.join(root, u === "/" ? "/benchmark_paired_harness.html" : u);
      if (!fp.startsWith(root)) { res.statusCode = 403; return res.end("no"); }
      const b = await readFile(fp); res.setHeader("Content-Type", types[path.extname(fp)] || "application/octet-stream"); res.end(b);
    } catch { res.statusCode = 404; res.end("no"); }
  });
  return new Promise((r) => s.listen(0, "127.0.0.1", () => r(s)));
}

async function onBrowser(name, launcher, baseUrl, kase) {
  const br = await launcher.launch(); const ver = br.version(); const pg = await br.newPage();
  await pg.goto(`${baseUrl}/benchmark_paired_harness.html`, { waitUntil: "load" });
  await pg.waitForFunction(() => typeof window.__runPaired === "function", null, { timeout: 15000 });
  const res = await pg.evaluate(async (opts) => await window.__runPaired(opts), { case: kase, ...BUDGET[kase] });
  await br.close();
  return { engine: name, engineVersion: ver, ...res };
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const server = await startServer(__dirname);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const makeJsdom = () => new JSDOM("<!doctype html><html><head></head><body></body></html>").window.document;

  for (const kase of CASES) {
    const results = [];
    // JSDOM (local)
    try {
      const j = runPaired({ case: kase, makeDoc: makeJsdom, now: () => performance.now(), ...BUDGET[kase] });
      results.push({ engine: "jsdom", engineVersion: process.version, ...j });
      console.log(`[jsdom ${kase}] done`);
    } catch (e) { console.error(`[jsdom ${kase}] FAILED: ${e.message}`); }
    // Chromium + Firefox
    for (const [n, l] of [["chromium", chromium], ["firefox", firefox]]) {
      try { results.push(await onBrowser(n, l, baseUrl, kase)); console.log(`[${n} ${kase}] done`); }
      catch (e) { console.error(`[${n} ${kase}] FAILED: ${e.message}`); }
    }
    for (const r of results) await writeFile(path.join(OUT, `paired_${kase}_${r.engine}.json`), JSON.stringify(r, null, 2));
    // combined ratio table
    console.log(`\n=== ${kase}: proposed/baseline ratio (median [IQR]) ===`);
    const nodes = results[0]?.rows.map((x) => x.nodes) ?? [];
    const tbl = nodes.map((nd) => { const row = { nodes: nd }; for (const r of results) { const x = r.rows.find((y) => y.nodes === nd); row[r.engine] = x ? `${x.ratio_median} [${x.ratio_iqr[0]}, ${x.ratio_iqr[1]}]` : "n/a"; } return row; });
    console.table(tbl);
  }
  server.close();
}
main();
