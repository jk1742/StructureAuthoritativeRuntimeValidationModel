/* =====================================================================
 * case3_experiment.mjs — Case 3 detection 러너 (Chromium 대표 / Firefox 교차)
 * ---------------------------------------------------------------------
 * 엔진 정책: Chromium = headline(대표), Firefox = 교차검증. (양엔진)
 *   JSDOM 참조는 비대표라 본 러너에서 분리 — 필요 시 case3_experiment_jsdom.mjs 로
 *   단독 실행(non-cited reference). 본문은 양엔진(Chromium, Firefox)만 인용한다.
 * 폴더를 loopback HTTP로 서빙 → harness.html 을 각 엔진에서 열어 __runCase3() 호출.
 *
 * 로컬 실행:
 *   npm install playwright ;npx playwright install chromium firefox
 *   node case3_experiment.mjs
 * 출력: results/case3_<engine>.json + 합산 검증 테이블.
 * ===================================================================== */
import { chromium, firefox } from "playwright";
import http from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "results");
// model-core 2종은 case_3 밖(repo 루트)에 있어 정적 서버 루트 밖 → 라우트로 서빙.
// scenarios-case3.js 의 import 경로(../../model-core-report.mjs)는 Node 에선 맞고,
// 브라우저에선 /model-core-report.mjs 로 클램프되므로 그 라우트를 제공한다(import 무수정).
const findFirst = (c) => { for (const p of c) if (existsSync(p)) return path.resolve(p); return null; };
const MODEL_CORE = findFirst([path.join(__dirname, "..", "model-core.mjs"), path.join(__dirname, "..", "..", "model-core.mjs")]);
const MODEL_REPORT = findFirst([path.join(__dirname, "..", "model-core-report.mjs"), path.join(__dirname, "..", "..", "model-core-report.mjs")]);

function startServer(root) {
  const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json" };
  const s = http.createServer(async (req, res) => {
    try {
      const u = decodeURIComponent(req.url.split("?")[0]);
      if (u === "/model-core.mjs" && MODEL_CORE) { res.setHeader("Content-Type", "text/javascript"); return res.end(await readFile(MODEL_CORE)); }
      if (u === "/model-core-report.mjs" && MODEL_REPORT) { res.setHeader("Content-Type", "text/javascript"); return res.end(await readFile(MODEL_REPORT)); }
      const fp = path.join(root, u === "/" ? "/harness.html" : u);
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
  await pg.goto(`${baseUrl}/harness.html`, { waitUntil: "load" });
  await pg.waitForFunction(() => window.__case3Ready === true, null, { timeout: 15000 });
  const rows = await pg.evaluate(() => window.__runCase3());
  await br.close();
  return { engine: name, engineVersion: ver, rows };
}

function summarize(rows) {
  return rows.every(
    (r) => r.snapshot.detected === r.snapshot.expected && r.identity.detected === r.identity.expected
  );
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const server = await startServer(__dirname);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const results = [];

  // 1) Chromium — 대표(headline)
  try { results.push(await onBrowser("chromium", chromium, baseUrl)); console.log("[chromium] done"); }
  catch (e) { console.error(`[chromium] FAILED: ${e.message}`); }

  // 2) Firefox — 교차검증
  try { results.push(await onBrowser("firefox", firefox, baseUrl)); console.log("[firefox] done"); }
  catch (e) { console.error(`[firefox] FAILED: ${e.message}`); }

  for (const r of results) {
    await writeFile(path.join(OUT, `case3_${r.engine}.json`), JSON.stringify(r, null, 2));
  }

  const DESC = {
    T1: "identical-form replacement",
    T2: "genuine no-op (control)",
    T3: "value mutation",
    T4: "structural insertion",
  };
  const mark = (cell, isAttack) => cell.detected ? "Detected" : (isAttack ? "missed" : "(valid)");
  const expectOf = (r) => {
    const a = r.snapshot.expected, b = r.identity.expected;
    if (!a && !b) return "neither";
    if (a && b) return "both";
    return b ? "B detects" : "A detects";
  };

  const base = results[0]?.rows ?? [];
  const enginesAgree = results.every((res) =>
    res.rows.every((o) => {
      const r = base.find((x) => x.id === o.id);
      return r && o.snapshot.detected === r.snapshot.detected && o.identity.detected === r.identity.detected;
    })
  );
  const verline = results.map((r) => `${r.engine} ${r.engineVersion}`).join(" / ");

  console.log("\n=== Case 3 detection (snapshot-diff vs identity continuity) ===");
  console.log(enginesAgree
    ? `  confirmed identical on ${verline}`
    : `  WARNING: engines disagree — see result/*.json`);

  console.table(base.map((r) => {
    const isAttack = r.snapshot.expected || r.identity.expected;
    const ok = r.snapshot.detected === r.snapshot.expected && r.identity.detected === r.identity.expected;
    return {
      scenario: `${r.id}  ${DESC[r.id] || r.label}`,
      "snapshot-diff": mark(r.snapshot, isAttack),
      "identity": mark(r.identity, isAttack),
      expected: expectOf(r),
      ok: ok ? "OK" : "FAIL",
    };
  }));

  const allOk = results.every((r) => summarize(r.rows));
  console.log(allOk ? "ALL ENGINES MATCH EXPECTATIONS" : "MISMATCH PRESENT");
  server.close();
}

main();