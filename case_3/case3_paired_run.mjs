// case3_paired_run.mjs
// Case 3 overhead (timed near-parity) — Chromium + Firefox (Playwright). JSDOM X.
import { chromium, firefox } from "playwright";
import http from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "results");
const BUDGET = { repeat: 30, runs: 10 };
const TYPES = { ".html": "text/html", ".mjs": "text/javascript", ".json": "application/json" };

function startServer(root) {
  const s = http.createServer(async (req, res) => {
    try {
      const u = decodeURIComponent(req.url.split("?")[0]);
      const fp = path.join(root, u === "/" ? "/case3_paired_harness.html" : u);
      if (!fp.startsWith(root)) { res.statusCode = 403; return res.end("no"); }
      const b = await readFile(fp);
      res.setHeader("Content-Type", TYPES[path.extname(fp)] || "application/octet-stream"); res.end(b);
    } catch { res.statusCode = 404; res.end("no"); }
  });
  return new Promise((r) => s.listen(0, "127.0.0.1", () => r(s)));
}

async function onBrowser(name, launcher, baseUrl) {
  const br = await launcher.launch(); const ver = br.version(); const pg = await br.newPage();
  await pg.goto(`${baseUrl}/case3_paired_harness.html`, { waitUntil: "load" });
  await pg.waitForFunction(() => typeof window.__runCase3Paired === "function", null, { timeout: 15000 });
  const res = await pg.evaluate(async (opts) => await window.__runCase3Paired(opts), { ...BUDGET });
  await br.close();
  return { engine: name, engineVersion: ver, ...res };
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const server = await startServer(__dirname);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const results = [];
  for (const [n, l] of [["chromium", chromium], ["firefox", firefox]]) {
    try { results.push(await onBrowser(n, l, baseUrl)); console.log(`[${n} case3] done`); }
    catch (e) { console.error(`[${n} case3] FAILED: ${e.message}`); }
  }
  for (const r of results) await writeFile(path.join(OUT, `paired_case3_${r.engine}.json`), JSON.stringify(r, null, 2));

  console.log("\n=== case3 timed: proposed/baseline ratio (near parity) ===");
  const nodes = results[0]?.rows.map((x) => x.nodes) ?? [];
  console.table(nodes.map((nd) => { const row = { nodes: nd }; for (const r of results) { const x = r.rows.find((y) => y.nodes === nd); row[r.engine] = x ? `${x.ratio_median} [${x.ratio_iqr[0]}, ${x.ratio_iqr[1]}]` : "n/a"; } return row; }));
  server.close();
}
main();
