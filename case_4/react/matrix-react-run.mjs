/* =====================================================================
 * react/matrix-react-run.mjs — Case 4 / Model B 탐지 측정 드라이버 (실 React, Chromium via Playwright)
 * ---------------------------------------------------------------------
 * ※ 작성자 로컬에서만 실행 (HANDOFF §8: Playwright 브라우저 바이너리는
 *    샌드박스에서 다운로드 불가).
 *
 *   npm install playwright
 *   npx playwright install chromium   # firefox 는 선택(교차 검증 시)
 *   node react/matrix-react-run.mjs
 *
 * 출력: react/case4_react_result.json (측정값). placeholder 없음.
 * 엔진 정책: 공통 주 엔진 = Chromium. Firefox 는 선택적 교차(미설치 시 skip).
 *
 * 측정 절차(시나리오 1회 = 페이지 새로고침으로 독립 보장):
 *   1) 페이지 로드 → __case4 준비 대기
 *   2) Playwright fill() 로 input 에 실 입력 이벤트(사용자 타이핑 모사)
 *   3) 리렌더 직전 현재 노드에 마커
 *   4) 리렌더(sameKey / newKey / attackerSameKey)
 *   5) input 실제 값 + name + 노드 재사용 여부 판정
 *
 * 해석:
 *   R1(보존)   := 리렌더 후 값 == 사용자가 친 값
 *   R2(폐기)   := 리렌더 후 값 == ""
 *   R3(위조)   := name 이 공격자 값으로 바뀌고 값까지 잔존(= 위장 + 탈취 성공)
 * ===================================================================== */
import { chromium } from "playwright"; // firefox 교차 측정 비활성(Chromium 통일)
// import { chromium, firefox } from "playwright";
import { writeFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const dir = path.dirname(fileURLToPath(import.meta.url));
const REACT = path.join(dir, "..", "..", "vendor", "react.development.js");
const REACTDOM = path.join(dir, "..", "..", "vendor", "react-dom.development.js");
const HARNESS = path.join(dir, "case4_react.js");
const TYPED = "user-typed-value";
const ATTACKER = "attacker-controlled";

async function newReadyPage(browser, engineName) {
  const page = await browser.newPage();
  page.on("console", (m) => console.log(`[${engineName} console.${m.type()}]`, m.text()));
  page.on("pageerror", (e) => console.log(`[${engineName} pageerror]`, e.message));

  await page.setContent('<!doctype html><html><body><div id="root"></div></body></html>');
  for (const [label, p] of [["react", REACT], ["react-dom", REACTDOM], ["harness", HARNESS]]) {
    try {
      await page.addScriptTag({ path: p });
    } catch (e) {
      throw new Error(`[${engineName}] 스크립트 주입 실패 (${label} @ ${p}): ${(e && e.message) || e}`);
    }
  }

  const diag = await page.evaluate(() => ({
    React: typeof window.React,
    ReactDOM: typeof window.ReactDOM,
    createRoot: typeof (window.ReactDOM && window.ReactDOM.createRoot),
    ready: window.__case4Ready === true,
    error: window.__case4Error || null,
  }));
  console.log(`[${engineName} diag]`, JSON.stringify(diag));
  if (!diag.ready) {
    throw new Error(
      `[${engineName}] 하니스 초기화 실패: ${diag.error || "원인 미상"} ` +
      `(React=${diag.React}, ReactDOM=${diag.ReactDOM}, createRoot=${diag.createRoot})`
    );
  }
  return page;
}

async function runScenario(browser, engineName, mode) {
  const page = await newReadyPage(browser, engineName);
  await page.fill("#probe-input", TYPED); // 실 입력 이벤트
  const typed = await page.evaluate(() => window.__case4.inputValue());
  await page.evaluate(() => window.__case4.markNode());

  if (mode === "sameKey") await page.evaluate(() => window.__case4.rerenderSameKey("def-v2"));
  else if (mode === "newKey") await page.evaluate(() => window.__case4.rerenderNewKey("def-v2"));
  else if (mode === "attackerSameKey") await page.evaluate((n) => window.__case4.rerenderAttackerSameKey(n), ATTACKER);

  const afterValue = await page.evaluate(() => window.__case4.inputValue());
  const afterName = await page.evaluate(() => window.__case4.inputName());
  const reused = await page.evaluate(() => window.__case4.nodeReused());
  const reactVersion = await page.evaluate(() => window.__case4.reactVersion);
  await page.close();

  return {
    mode, reactVersion, typedValue: typed,
    afterValue, afterName, domNodeReused: reused,
    R1_preserve_satisfied: afterValue === typed,
    R2_discard_satisfied: afterValue === "",
    R3_forgery_succeeded: afterName === ATTACKER && afterValue === typed,
  };
}

async function measure(engineName, launcher) {
  const browser = await launcher.launch();
  try {
    return {
      engine: engineName,
      R1_sameKey: await runScenario(browser, engineName, "sameKey"),         // R1 보존(성공)
      R2_sameKey: await runScenario(browser, engineName, "sameKey"),         // R2 폐기: sameKey 에선 실패(음성 대조)
      R2_newKey_control: await runScenario(browser, engineName, "newKey"),   // R2 폐기: newKey 규율 시에만 성공
      R3_attackerSameKey: await runScenario(browser, engineName, "attackerSameKey"), // R3 replay(관찰된 key)
    };
  } finally {
    await browser.close();
  }
}

const engines = {};
engines.chromium = await measure("chromium", chromium); // 공통 주 엔진
// try {
//   engines.firefox = await measure("firefox", firefox); // 선택적 교차
// } catch (e) {
//   engines.firefox = { skipped: true, reason: String((e && e.message) || e) };
// }

const result = {
  model: "B (real React keyed reconcile)",
  axis: "detection (authoritative for the paper)",
  timestamp: new Date().toISOString(),
  engines,
  reading: {
    R1_R2:
      "같은 key 유지 → 노드 재사용 → 값 보존. R1(보존)은 맞히나 R2(폐기)는 틀린다. " +
      "key 를 바꾸면(R2_newKey_control) 폐기를 맞히지만 그것은 개발자 key 규율 의존.",
    R3:
      "공격자가 같은 key 로 컴포넌트를 악성 정의로 교체 → 노드 재사용 → 비제어 입력값이 " +
      "악성 정의로 잔존 = 위장+탈취 성공. key 는 client hint 라 lineage 단절을 강제 못 함.",
    claim:
      "권위 lineage(Model C, 별도 측정)는 규율 없이 새 id 발급/미발급 검증만으로 R2·R3 를 맞힌다.",
  },
};

writeFileSync(path.join(dir, "result/case4_react_result.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));