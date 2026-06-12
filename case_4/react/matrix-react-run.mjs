/* 
 * react/matrix-react-run.mjs — Case 4 / Model B ( React, Chromium via Playwright)
 */
import { chromium } from "playwright";
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
      throw new Error(`[${engineName}] script inject failed (${label} @ ${p}): ${(e && e.message) || e}`);
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
      `[${engineName}] failed initialize: ${diag.error || "error"} ` +
      `(React=${diag.React}, ReactDOM=${diag.ReactDOM}, createRoot=${diag.createRoot})`
    );
  }
  return page;
}

async function runScenario(browser, engineName, mode) {
  const page = await newReadyPage(browser, engineName);
  await page.fill("#probe-input", TYPED);
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
      R1_sameKey: await runScenario(browser, engineName, "sameKey"),         
      R2_sameKey: await runScenario(browser, engineName, "sameKey"),         
      R2_newKey_control: await runScenario(browser, engineName, "newKey"),   
      R3_attackerSameKey: await runScenario(browser, engineName, "attackerSameKey"),
    };
  } finally {
    await browser.close();
  }
}

const engines = {};
engines.chromium = await measure("chromium", chromium);
// try {
//   engines.firefox = await measure("firefox", firefox);
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
      "Same key kept -> node reused -> value preserved. Correct on R1 (preserve) but wrong on R2 (discard). Changing the key (R2_newKey_control) gets the discard right, but that relies on developer key discipline.",
    R3:
      "Attacker replaces the component with a malicious definition under the same key -> node reused -> uncontrolled input value persists into the malicious definition = spoofing + hijack succeeds. A key is a client hint and cannot force a lineage break.",
    claim:
      "An authority lineage (Model C, measured separately) gets R2 and R3 right with no discipline required, by issuing a new id / verifying non-issuance alone.",
  },
};

writeFileSync(path.join(dir, "result/case4_react_result.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));