/* react/run-overhead-react.mjs — React 18.3.1 */
import { chromium } from "playwright";
import { readFile } from "fs/promises";
import { writeFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";
import { NODE_COUNTS, reactPropsN } from "../bench/builders.mjs";

const dir = path.dirname(fileURLToPath(import.meta.url));
const RUNS = 31;
const WARMUP = 3;
const TARGET_MS = 120;
const MIN_K = 5;
const B = (s) => Buffer.byteLength(s, "utf8");

function stats0(a) { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
function stats(a) {
  const s = [...a].sort((x, y) => x - y);
  const q = (p) => { const i = (s.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i); return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (i - lo); };
  const med = q(0.5), q1 = q(0.25), q3 = q(0.75);
  const mean = s.reduce((u, v) => u + v, 0) / s.length;
  const sd = Math.sqrt(s.reduce((u, v) => u + (v - mean) ** 2, 0) / s.length);
  return { median_ms: med, q1_ms: q1, q3_ms: q3, iqr_ms: q3 - q1, min_ms: s[0], max_ms: s[s.length - 1], mad_ms: stats0(s.map((v) => Math.abs(v - med))), cv: mean ? sd / mean : 0 };
}

async function calibrateK(page, n) {
  await page.evaluate((nn) => window.c4react_setup(nn), n);
  let K = 1;
  for (let it = 0; it < 30; it++) {
    const ms = await page.evaluate((k) => window.c4react_timeK(k), K);
    if (ms >= TARGET_MS) return Math.max(MIN_K, K);
    const factor = ms > 0.05 ? TARGET_MS / ms : 2;
    K = Math.max(K + 1, Math.ceil(K * Math.min(factor, 8)));
    if (K > (1 << 22)) return Math.max(MIN_K, K);
  }
  return Math.max(MIN_K, K);
}

async function measureCell(page, n) {
  const K = await calibrateK(page, n);
  await page.evaluate((nn) => window.c4react_setup(nn), n);
  for (let w = 0; w < WARMUP; w++) await page.evaluate((k) => window.c4react_timeK(k), K);
  const perIter = [];
  for (let r = 0; r < RUNS; r++) {
    const ms = await page.evaluate((k) => window.c4react_timeK(k), K);
    perIter.push(ms / K);
  }
  return { model: "React", nodes: n, K, runs: RUNS, ...stats(perIter), samples_ms: perIter };
}

const browser = await chromium.launch();
const page = await browser.newPage();
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
await page.setContent('<!doctype html><html><body><div id="root"></div></body></html>');
await page.addScriptTag({ path: path.join(dir, "..", "..", "vendor", "react.production.min.js") });
await page.addScriptTag({ path: path.join(dir, "..", "..", "vendor", "react-dom.production.min.js") });
await page.addScriptTag({ path: path.join(dir, "case4_react_overhead.js") });
await page.waitForFunction("window.__reactReady === true", { timeout: 8000 }).catch(async () => {
  const err = await page.evaluate(() => window.__reactError || "unknown");
  throw new Error("React harness ready fail: " + err);
});

const time = [];
for (const n of NODE_COUNTS) {
  const cell = await measureCell(page, n);
  time.push(cell);
  console.log(`React  N=${String(n).padEnd(4)}  K=${String(cell.K).padEnd(6)}  median=${cell.median_ms.toFixed(4)}ms  CV=${(cell.cv * 100).toFixed(0)}%`);
}
await browser.close();

const payload = NODE_COUNTS.map((n) => ({ nodes: n, React_props: B(JSON.stringify(reactPropsN(n))) }));
const result = {
  axis: "overhead-react-reference",
  engine: "chromium",
  react: "18.3.1 production UMD",
  measure: "flushSync(setState) commit-synchronous; full React re-render (not core-only). framework reference.",
  path: "reuse (same key)",
  protocol: `batch K (min ${MIN_K}, target ${TARGET_MS}ms), warmup x${WARMUP} discarded, ${RUNS}-run median + IQR + CV`,
  timestamp: new Date().toISOString(),
  time,
  payload,
};
writeFileSync(path.join(dir, "result/case4_react_overhead_result.json"), JSON.stringify(result, null, 2));
console.log("\nresult -> react/case4_react_overhead_result.json");
