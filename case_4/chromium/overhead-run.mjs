/* =====================================================================
 * chromium/run-overhead.mjs — Case 4 overhead 측정 드라이버 (실 Chromium)
 * ---------------------------------------------------------------------
 * ※ 작성자 로컬 실행 (Playwright 브라우저 바이너리는 샌드박스 다운로드 불가).
 *   npm install && npm run install:browsers && npm run overhead
 *
 * 출력: chromium/case4_overhead_result.json
 *   - time: 모델 A/B/C/D × 노드수, 재사용 경로, in-page performance.now()
 *           batch(K 자동보정) + 워밍업 3 후 15회, 중앙값 + 최소~최대 보고.
 *   - payload: bench/payload.mjs 의 실제 전송 바이트(결정적, Node 산출)를 병합.
 *   - placeholder 없음 — 전부 실측.
 * ===================================================================== */
import { chromium } from "playwright";
import { createServer } from "http";
import { readFile } from "fs/promises";
import { writeFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";
import { NODE_COUNTS } from "../bench/builders.mjs";
import { payloadSizes } from "../bench/payload.mjs";

const dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(dir, "..");
const MODELS = ["A", "B", "C", "D"];
const RUNS = 31;          // 중앙값 안정화(홀수)
const WARMUP = 3;         // JIT 안정화
const TARGET_MS = 120;    // batch 구간을 타이머 눈금·지터보다 충분히 크게
const MIN_K = 5;          // 큰 N(1회가 길어도)에서도 최소 batch 횟수 강제
const MIME = { ".html": "text/html", ".mjs": "text/javascript", ".js": "text/javascript", ".json": "application/json" };

function startServer() {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      try {
        const p = path.join(root, decodeURIComponent(req.url.split("?")[0]));
        if (!p.startsWith(root)) return res.writeHead(403).end();
        const body = await readFile(p);
        res.writeHead(200, { "Content-Type": MIME[path.extname(p)] || "application/octet-stream" });
        res.end(body);
      } catch {
        res.writeHead(404).end();
      }
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function stats0(a) {                 // 순수 중앙값(기존 median 대체, MAD용 재사용)
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function stats(a) {                  // 중앙값 + Q1/Q3/IQR + min/max + MAD + CV
  const s = [...a].sort((x, y) => x - y);
  const q = (p) => { const i=(s.length-1)*p, lo=Math.floor(i), hi=Math.ceil(i);
                     return lo===hi ? s[lo] : s[lo]+(s[hi]-s[lo])*(i-lo); };
  const med=q(0.5), q1=q(0.25), q3=q(0.75);
  const mean=s.reduce((u,v)=>u+v,0)/s.length;
  const sd=Math.sqrt(s.reduce((u,v)=>u+(v-mean)**2,0)/s.length);
  return { median_ms:med, q1_ms:q1, q3_ms:q3, iqr_ms:q3-q1,
           min_ms:s[0], max_ms:s[s.length-1],
           mad_ms:stats0(s.map(v=>Math.abs(v-med))), cv:mean? sd/mean : 0 };
}

async function calibrateK(page, model, n) {
  await page.evaluate(([m, nn]) => window.c4setup(m, nn), [model, n]);
  let K = 1;
  for (let it = 0; it < 30; it++) {
    const ms = await page.evaluate((k) => window.c4timeK(k), K);
    if (ms >= TARGET_MS) return Math.max(MIN_K, K);
    const factor = ms > 0.05 ? TARGET_MS / ms : 2;
    K = Math.max(K + 1, Math.ceil(K * Math.min(factor, 8)));
    if (K > (1 << 22)) return Math.max(MIN_K, K);
  }
  return Math.max(MIN_K, K);
}

async function measureCell(page, model, n) {
  const K = await calibrateK(page, model, n);
  await page.evaluate(([m, nn]) => window.c4setup(m, nn), [model, n]);
  for (let w = 0; w < WARMUP; w++) await page.evaluate((k) => window.c4timeK(k), K); // 워밍업 폐기
  const perIter = [];
  for (let r = 0; r < RUNS; r++) {
    const ms = await page.evaluate((k) => window.c4timeK(k), K);
    perIter.push(ms / K);
  }
  return {
    model, nodes: n, K, runs: RUNS,
    ...stats(perIter),     // median_ms·q1_ms·q3_ms·iqr_ms·min_ms·max_ms·mad_ms·cv 가 평평히 들어감
    samples_ms: perIter,
  };
}

const server = await startServer();
const port = server.address().port;
const browser = await chromium.launch();
const page = await browser.newPage();
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
await page.goto(`http://127.0.0.1:${port}/chromium/overhead-bench.html`);
await page.waitForFunction("window.__benchReady === true", { timeout: 8000 });

const time = [];
for (const model of MODELS) {
  for (const n of NODE_COUNTS) {
    const cell = await measureCell(page, model, n);
    time.push(cell);
    console.log(`${model}  N=${String(n).padEnd(4)}  K=${String(cell.K).padEnd(6)}  median=${cell.median_ms.toFixed(4)}ms  IQR=[${cell.q1_ms.toFixed(4)}, ${cell.q3_ms.toFixed(4)}]  CV=${(cell.cv*100).toFixed(0)}%`);
  }
}

await browser.close();
server.close();

const payload = NODE_COUNTS.map(payloadSizes); // 결정적, Node 산출
const result = {
  axis: "overhead",
  engine: "chromium",
  path: "reuse (steady-state)",
  note: `time: in-page performance.now, batch K (min K=${MIN_K}, target ${TARGET_MS}ms), warmup x${WARMUP} discarded, ${RUNS}-run median + IQR + MAD + CV. payload: actual transmitted bytes (deterministic).`,
  timestamp: new Date().toISOString(),
  time,
  payload,
};
writeFileSync(path.join(dir, "case4_overhead_result.json"), JSON.stringify(result, null, 2));
console.log("\nresult -> chromium/case4_overhead_result.json");
