// case1_paired_run.mjs
// Case 1 overhead(timed) + payload — Chromium + Firefox (Playwright).
import { chromium, firefox } from "playwright";
import http from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "result");
const BUDGET = { repeat: 30, runs: 10 };
const TYPES = { ".html": "text/html", ".mjs": "text/javascript", ".json": "application/json" };

const findFirst = (c) => { for (const p of c) if (existsSync(p)) return path.resolve(p); return null; };
const MODEL_CORE = process.argv[2] || findFirst([
  path.join(__dirname, "model-core.mjs"),
  path.join(__dirname, "..", "model-core.mjs"),
  path.join(__dirname, "..", "..", "model-core.mjs"),
]);
if (!MODEL_CORE) { console.error("[err] model-core.mjs not found — pass its path as arg1"); process.exit(1); }

function startServer(root, modelCorePath) {
  const s = http.createServer(async (req, res) => {
    try {
      const u = decodeURIComponent(req.url.split("?")[0]);
      if (u === "/model-core.mjs") {
        const b = await readFile(modelCorePath);
        res.setHeader("Content-Type", "text/javascript"); return res.end(b);
      }
      const fp = path.join(root, u === "/" ? "/case1_paired_harness.html" : u);
      if (!fp.startsWith(root)) { res.statusCode = 403; return res.end("no"); }
      const b = await readFile(fp);
      res.setHeader("Content-Type", TYPES[path.extname(fp)] || "application/octet-stream"); res.end(b);
    } catch { res.statusCode = 404; res.end("no"); }
  });
  return new Promise((r) => s.listen(0, "127.0.0.1", () => r(s)));
}

async function onBrowser(name, launcher, baseUrl) {
  const br = await launcher.launch(); const ver = br.version(); const pg = await br.newPage();
  await pg.goto(`${baseUrl}/case1_paired_harness.html`, { waitUntil: "load" });
  await pg.waitForFunction(() => typeof window.__runCase1Paired === "function", null, { timeout: 15000 });
  const res = await pg.evaluate(async (opts) => await window.__runCase1Paired(opts), { ...BUDGET });
  await br.close();
  return { engine: name, engineVersion: ver, ...res };
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const server = await startServer(__dirname, MODEL_CORE);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  console.log(`[server] model-core=${path.basename(MODEL_CORE)} → ${baseUrl}`);
  const results = [];
  for (const [n, l] of [["chromium", chromium], ["firefox", firefox]]) {
    try { results.push(await onBrowser(n, l, baseUrl)); console.log(`[${n} case1] done`); }
    catch (e) { console.error(`[${n} case1] FAILED: ${e.message}`); }
  }
  for (const r of results) await writeFile(path.join(OUT, `case1_paired_${r.engine}.json`), JSON.stringify(r, null, 2));

  console.log("\n=== case1 timed: proposed/baseline (ratio>=1 by design; 본문 비인용) ===");
  const nodes = results[0]?.rows.map((x) => x.nodes) ?? [];
  console.table(nodes.map((nd) => { const row = { nodes: nd }; for (const r of results) { const x = r.rows.find((y) => y.nodes === nd); row[r.engine] = x ? `${x.ratio_median} [${x.ratio_iqr[0]}, ${x.ratio_iqr[1]}]` : "n/a"; } return row; }));
  if (results[0]?.payload) { console.log("payload (deterministic — 본문 0.52x):"); console.table(results[0].payload.map((p) => ({ nodes: p.nodes, ratio: p.proposed_vs_baseline_ratio }))); }
  server.close();
}
main();
