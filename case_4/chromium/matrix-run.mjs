/* =====================================================================
 * chromium/run-matrix.mjs — Case 4 매트릭스 드라이버 (공통 엔진: 실 Chromium)
 * ---------------------------------------------------------------------
 * ※ 작성자 로컬에서 실행 (HANDOFF §8: Playwright 브라우저 바이너리는
 *    샌드박스에서 다운로드 불가).
 *
 *   npm install playwright
 *   npx playwright install chromium
 *   node chromium/run-matrix.mjs
 *
 * 출력: chromium/case4_matrix_result.json (측정값). placeholder 없음.
 *
 * 측정 범위: 모델 A/B/C/D × 시나리오 R1/R2/R3.
 *   - 공통 엔진 = 실 Chromium DOM (JSDOM 사용 안 함).
 *   - src/*.mjs 를 단일 출처로 페이지에 import (측정==구현 코드 일치, HANDOFF §8).
 *   - 'expected'는 HANDOFF §2 의 '가설' 라벨일 뿐, 실제 outcome 은 실행 산출.
 *   - Model B 는 최소 구현 keyed(로직 확인). 논문 Model B 탐지 수치는
 *     react/ 의 실 React 측정이 권위 (HANDOFF §5).
 *
 * 의존성 없는 임시 정적 서버를 띄워 http 로 로드한다(파일:// 모듈 CORS 회피).
 * ===================================================================== */
import { chromium, firefox } from "playwright";
import { createServer } from "http";
import { readFile } from "fs/promises";
import { fileURLToPath } from "url";
import path from "path";

const dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(dir, ".."); // 패키지 루트 (src/ 도 서빙)
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
  ["R3_FAB", "C", "fabricated id rejected"],   // C 고유: B/D 는 대장 없어 거부 불가(구조적)
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
    await page.fill('input[name="user"]', TYPED); // 실 입력 이벤트
    const measured = await page.evaluate(([m, s]) => window.c4_apply(m, s), [model, scenario]);
    rows.push({ scenario, model: MODEL_LABEL[model], expected, ...measured });
  }
  await browser.close();
  return rows;
}

const engines = {};
engines.chromium = await runEngine(chromium, "chromium"); // 주 엔진
try {
  engines.firefox = await runEngine(firefox, "firefox");  // 탐지 교차(결정적 로직 → 동일 기대)
} catch (e) {
  engines.firefox = { skipped: true, reason: String((e && e.message) || e) };
}
server.close();

// 콘솔 표는 주 엔진(Chromium) 기준
const rows = engines.chromium;
const table = rows.map((r) => ({
  Scenario: r.scenario, Model: r.model,
  Outcome: outcomeOf(r.scenario, r), "(hypothesis)": r.expected, Verdict: r.verdict || "-",
}));
console.log("\n=== Case 4 matrix (Chromium) ===\n");
console.table(table);
console.log("\nR3 DOM after reconstruction (Chromium):");
rows.filter((r) => r.scenario === "R3").forEach((r) => console.log(`  ${r.model}: ${r.domSummary}`));

// 엔진 간 outcome 일치 점검(탐지 동일성 확인)
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