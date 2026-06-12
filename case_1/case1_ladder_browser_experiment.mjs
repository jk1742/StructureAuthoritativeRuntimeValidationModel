/*
 * case_1/browser/case1_ladder_browser_run.mjs  (self-serving + 6-instance 측정)
 * ===========================================================================
 * Paper Section 6 - Case 1 Forgery Cost Ladder — cross-engine driver.
 * 정적 서버 내장(별도 서버 불필요), 출력 폴더 자동 생성, import 경로 절대화.
 *
 * v2 변경점: S4 를 필드별(username/agree/memo)로 펼쳐 6-instance 를 in-engine 측정.
 *   - 한 필드만 (값+meta) 위조 → 그 필드는 meta 와 일치(baseline Bypassed),
 *     registry 는 commit 진리값과 달라 검출(proposed Detected).
 *   - 이로써 "3 of 6 / all six" 와 Table 2 의 (×3 fields) 가 양엔진 실측으로 남고,
 *     case1_result.json(JSDOM 6-instance)을 제거할 수 있다.
 *
 *   설치: npm install playwright ; npx playwright install chromium firefox
 *   실행(인자 없이, case_1/ 에서):  node case1_ladder_browser_run.mjs
 *   산출: ./result/case1_ladder_result_browser.json  ({ engines{}, detection6{} })
 *
 * 검증 게이트(양 엔진 동일, 이전 결과와 일치):
 *   S1-S3 Detected/Detected | S4 Bypassed/Detected | L2 mapsReachable=false Detected
 *   L3 Bypassed | L4 Disrupted | detection6: baseline 3/6, proposed 6/6
 * ===========================================================================
 */
import http from "http";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import path from "path";
import { chromium, firefox } from "playwright";

const args = process.argv.slice(2);
const findFirst = (c) => { for (const p of c) if (existsSync(p)) return path.resolve(p); return null; };

const MODEL_CORE = args[0] || findFirst(["./model-core.mjs", "../model-core.mjs", "../../model-core.mjs"]);
const BENCH_HTML = args[1] || findFirst([
  "./case1_ladder_bench.html", "./browser/case1_ladder_bench.html",
  "./case1_ladder_browser_bench.html", "./browser/case1_ladder_browser_bench.html",
]);
const OUT = args[2] || "./result/case1_ladder_result_browser.json";

if (!MODEL_CORE) { console.error("[err] model-core.mjs not found — pass as arg1"); process.exit(1); }
if (!BENCH_HTML) { console.error("[err] bench html not found — pass as arg2"); process.exit(1); }

const modelSrc = readFileSync(MODEL_CORE, "utf8");
// 벤치의 ...model-core.mjs import 를 절대 라우트로 정규화(상대경로 깨짐 방지)
const benchSrc = readFileSync(BENCH_HTML, "utf8")
  .replace(/(from\s+["'])[^"']*model-core\.mjs(["'])/g, "$1/model-core.mjs$2");

const startServer = () => new Promise((resolve) => {
  const srv = http.createServer((req, res) => {
    const url = (req.url || "/").split("?")[0];
    if (url === "/model-core.mjs") { res.writeHead(200, { "Content-Type": "text/javascript" }); return res.end(modelSrc); }
    if (url === "/" || url.endsWith(".html")) { res.writeHead(200, { "Content-Type": "text/html" }); return res.end(benchSrc); }
    res.writeHead(404); res.end("not found");
  });
  srv.listen(0, "127.0.0.1", () => resolve(srv));
});

// DOM-confined 공격자(page.evaluate; document/window 만)
const ATTACKERS = {
  S1: () => { document.getElementById("username").value = "attacker"; },
  S2: () => { document.getElementById("agree").checked = true; },
  S3: () => { document.getElementById("memo").value = "INJECTED"; },
  S4: () => {
    document.getElementById("username").value = "attacker";
    document.getElementById("agree").checked = true;
    document.getElementById("memo").value = "INJECTED";
    document.querySelector('meta[name="truth:username"]').setAttribute("content", "attacker");
    document.querySelector('meta[name="truth:agree"]').setAttribute("content", "true");
    document.querySelector('meta[name="truth:memo"]').setAttribute("content", "INJECTED");
  },
  // S4 필드별(한 필드만 값+meta 위조) — 6-instance 측정용
  S4_username: () => { document.getElementById("username").value = "attacker"; document.querySelector('meta[name="truth:username"]').setAttribute("content", "attacker"); },
  S4_agree:    () => { document.getElementById("agree").checked = true;        document.querySelector('meta[name="truth:agree"]').setAttribute("content", "true"); },
  S4_memo:     () => { document.getElementById("memo").value = "INJECTED";      document.querySelector('meta[name="truth:memo"]').setAttribute("content", "INJECTED"); },
  L2: () => {
    document.getElementById("username").value = "attacker";
    const has = (o) => o && (("indexMap" in o) || ("nodeToId" in o));
    const reachable = has(window) || has(window.__app);   // createRegistry 가 maps 미노출 → false
    if (reachable) { try { (window.indexMap || window.__app.indexMap).set("e-username", { id: "e-username", type: "input", value: "attacker" }); } catch (_) {} }
    return { mapsReachable: reachable };
  },
  L4: () => { WeakMap.prototype.get = function () { return undefined; }; },
};

const classify = ({ passed, reason }) => passed ? "Bypassed" : (/no binding/i.test(reason || "") ? "Disrupted" : "Detected");

async function freshPage(context, BENCH) {
  const page = await context.newPage();
  await page.goto(BENCH, { waitUntil: "load" });
  await page.waitForFunction(() => window.__ready === true);
  return page;
}

async function runEngine(name, launcher, BENCH) {
  const browser = await launcher.launch();
  const context = await browser.newContext();
  const rows = [];
  for (const level of ["S1", "S2", "S3", "S4", "L2", "L4"]) {
    const page = await freshPage(context, BENCH);
    const extra = await page.evaluate(ATTACKERS[level]);
    const baselineNA = /^L/.test(level);
    const baseline = baselineNA ? "—" : ((await page.evaluate(() => window.__app.metaDetected())) ? "Detected" : "Bypassed");
    const run = await page.evaluate(() => window.__app.verdict());     // validate 는 읽기전용 → 1회 호출
    rows.push({ level, baseline, proposed: classify(run), mapsReachable: level === "L2" ? !!(extra && extra.mapsReachable) : undefined, reason: run.reason });
    await page.close();
  }
  // L3: 위협모델 배제 등급 — 시연
  {
    const page = await freshPage(context, BENCH);
    await page.evaluate(() => { document.getElementById("username").value = "attacker"; });
    await page.evaluate(() => window.__app.__demoInsideChannelDrive("username"));
    const run = await page.evaluate(() => window.__app.verdict());
    rows.push({ level: "L3", baseline: "—", proposed: classify(run), reason: run.reason, scope: "inside (excluded by threat model)" });
    await page.close();
  }
  // 6-instance: S1,S2,S3 + S4 필드별 3개 (in-engine 측정 → case1_result.json 대체)
  const six = [];
  for (const inst of ["S1", "S2", "S3", "S4_username", "S4_agree", "S4_memo"]) {
    const page = await freshPage(context, BENCH);
    await page.evaluate(ATTACKERS[inst]);
    const baseline = (await page.evaluate(() => window.__app.metaDetected())) ? "Detected" : "Bypassed";
    const proposed = classify(await page.evaluate(() => window.__app.verdict()));
    six.push({ instance: inst, baseline, proposed });
    await page.close();
  }
  await browser.close();
  return { rows, six };
}

const server = await startServer();
const BENCH = `http://127.0.0.1:${server.address().port}/bench.html`;
console.log(`[server] model-core=${path.basename(MODEL_CORE)} bench=${path.basename(BENCH_HTML)} → ${BENCH}`);

const result = { case: "case1-ladder", bench: BENCH, timestamp: new Date().toISOString(), engines: {}, detection6: {} };
for (const [n, l] of [["chromium", chromium], ["firefox", firefox]]) {
  try { const r = await runEngine(n, l, BENCH); result.engines[n] = r.rows; result.detection6[n] = r.six; console.log(`[${n}] done`); }
  catch (e) { console.error(`[${n}] FAILED: ${e.message}`); }
}
server.close();

mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true });
writeFileSync(OUT, JSON.stringify(result, null, 2));

for (const [name, rows] of Object.entries(result.engines)) {
  const g = (lv) => rows.find((r) => r.level === lv) || {};
  const six = result.detection6[name] || [];
  const bd = six.filter((x) => x.baseline === "Detected").length;
  const pd = six.filter((x) => x.proposed === "Detected").length;
  console.log(`[${name}] L2 mapsReachable=${g("L2").mapsReachable}  L3=${g("L3").proposed}  L4=${g("L4").proposed}  | detection6 baseline ${bd}/6 proposed ${pd}/6`);
}
console.log(`→ ${OUT}`);