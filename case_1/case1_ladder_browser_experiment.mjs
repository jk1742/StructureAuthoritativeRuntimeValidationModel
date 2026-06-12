/*
 * case_1/browser/case1_ladder_browser_run.mjs  (self-serving + 6-instance)
 * Paper Section 6 - Case 1 Forgery Cost Ladder — cross-engine driver.
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
  S4_username: () => { document.getElementById("username").value = "attacker"; document.querySelector('meta[name="truth:username"]').setAttribute("content", "attacker"); },
  S4_agree:    () => { document.getElementById("agree").checked = true;        document.querySelector('meta[name="truth:agree"]').setAttribute("content", "true"); },
  S4_memo:     () => { document.getElementById("memo").value = "INJECTED";      document.querySelector('meta[name="truth:memo"]').setAttribute("content", "INJECTED"); },
  S5_synthetic: () => {
    const n = document.getElementById("username");
    n.value = "attacker";
    document.querySelector('meta[name="truth:username"]').setAttribute("content", "attacker");
    n.dispatchEvent(new Event("input", { bubbles: true }));   // isTrusted === false
  },
  L2: () => {
    document.getElementById("username").value = "attacker";
    const has = (o) => o && (("indexMap" in o) || ("nodeToId" in o));
    const reachable = has(window) || has(window.__app);   // createRegistry maps
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
  for (const level of ["S1", "S2", "S3", "S4", "S5_synthetic", "L2", "L4"]) {
    const page = await freshPage(context, BENCH);
    const extra = await page.evaluate(ATTACKERS[level]);
    const baselineNA = /^L/.test(level);
    const baseline = baselineNA ? "—" : ((await page.evaluate(() => window.__app.metaDetected())) ? "Detected" : "Bypassed");
    const run = await page.evaluate(() => window.__app.verdict());
    rows.push({ level, baseline, proposed: classify(run), mapsReachable: level === "L2" ? !!(extra && extra.mapsReachable) : undefined, reason: run.reason });
    await page.close();
  }
  {
    const page = await freshPage(context, BENCH);
    await page.evaluate(() => { document.getElementById("username").value = "attacker"; });
    await page.evaluate(() => window.__app.__demoInsideChannelDrive("username"));
    const run = await page.evaluate(() => window.__app.verdict());
    rows.push({ level: "L3", baseline: "—", proposed: classify(run), reason: run.reason, scope: "inside (excluded by threat model)" });
    await page.close();
  }
  {
    const page = await freshPage(context, BENCH);
    await page.locator("#username").pressSequentially("alice2");  // isTrusted=true
    const run = await page.evaluate(() => window.__app.verdict());
    rows.push({ level: "T0_genuine", baseline: "—",
                proposed: run.passed ? "Accepted(valid)" : "FALSE-POSITIVE",
                reason: run.reason });
    await page.close();
  }
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
  console.log(`[${name}] S5=${g("S5_synthetic").baseline}/${g("S5_synthetic").proposed}  L2 mapsReachable=${g("L2").mapsReachable}  L3=${g("L3").proposed}  L4=${g("L4").proposed}  | detection6 baseline ${bd}/6 proposed ${pd}/6`);
}
console.log(`→ ${OUT}`);
