// run_browser_detection.mjs
// Cross-environment detection reproduction (Chromium + Firefox) for the
// Structure-Authoritative Runtime Validation model.
//
// Goal: confirm that the JSDOM detection outcomes for the headline scenarios
// (Case 1 / S4 evasion, Case 3 / T1 identical-form replacement) reproduce on
// real browser engines. PROPOSED MODEL ONLY. Detection (boolean) only --- no
// timing (absolute timing is environment-dependent and is not claimed).
//
// Division of work: this runner + the harness are the execution wrapper.
// The actual S4/T1 scenario bodies are PORTED by the author from the existing
// JSDOM experiment code (case1_experiment.js / case3_experiment.js) into
// scenarios.mjs --- see the PORT markers there.
//
// Usage:
//   npm init -y
//   npm i -D playwright
//   npx playwright install chromium firefox
//   node run_browser_detection.mjs
//
// Output: ./results/browser_detection_<engine>.json  +  a console summary table.

import { chromium, firefox } from "playwright";
import http from "node:http";
import { readFile } from "node:fs/promises";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HARNESS_DIR = __dirname;            // serves this folder over http (avoids file:// module CORS)
const OUT_DIR = path.join(__dirname, "results");

// Minimal static server so ES-module imports load over http:// in both engines.
function startServer(rootDir) {
  const types = {
    ".html": "text/html",
    ".mjs": "text/javascript",
    ".js": "text/javascript",
    ".json": "application/json",
  };
  const server = http.createServer(async (req, res) => {
    try {
      const urlPath = decodeURIComponent(req.url.split("?")[0]);
      const filePath = path.join(rootDir, urlPath === "/" ? "/detection_harness.html" : urlPath);
      if (!filePath.startsWith(rootDir)) { res.statusCode = 403; return res.end("forbidden"); }
      const buf = await readFile(filePath);
      res.setHeader("Content-Type", types[path.extname(filePath)] || "application/octet-stream");
      res.end(buf);
    } catch {
      res.statusCode = 404;
      res.end("not found");
    }
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

async function runOnEngine(name, launcher, baseUrl) {
  const browser = await launcher.launch();
  const version = browser.version();
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("pageerror", (e) => consoleErrors.push(String(e)));

  await page.goto(`${baseUrl}/detection_harness.html`, { waitUntil: "load" });
  // The harness module assigns window.__runDetectionExperiment once ready.
  await page.waitForFunction(() => typeof window.__runDetectionExperiment === "function", null, { timeout: 15000 });
  const scenarioResults = await page.evaluate(async () => await window.__runDetectionExperiment());

  await browser.close();
  return {
    engine: name,
    engineVersion: version,        // recorded at run time --- do NOT hand-fill versions
    userAgentNote: "captured by Playwright at run time",
    model: "proposed (registry outside DOM)",
    scenarios: scenarioResults,
    consoleErrors,
    timestamp: new Date().toISOString(),
  };
}

function printTable(allResults) {
  console.log("\n=== Cross-environment detection (proposed model only) ===");
  const scenarioIds = allResults[0]?.scenarios.map((s) => s.id) ?? [];
  const header = ["scenario", ...allResults.map((r) => r.engine)];
  console.log(header.join("\t| "));
  for (const sid of scenarioIds) {
    const row = [sid];
    for (const r of allResults) {
      const s = r.scenarios.find((x) => x.id === sid);
      row.push(s ? (s.detected ? "Detected" : "MISSED") : "n/a");
    }
    console.log(row.join("\t| "));
  }
  console.log("\nEngine versions:");
  for (const r of allResults) console.log(`  ${r.engine}: ${r.engineVersion}`);
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const server = await startServer(HARNESS_DIR);
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const all = [];
  for (const [name, launcher] of [["chromium", chromium], ["firefox", firefox]]) {
    try {
      const r = await runOnEngine(name, launcher, baseUrl);
      all.push(r);
      await writeFile(path.join(OUT_DIR, `browser_detection_${name}.json`), JSON.stringify(r, null, 2));
      console.log(`[${name}] done (${r.engineVersion})`);
    } catch (e) {
      console.error(`[${name}] FAILED: ${e.message}`);
    }
  }
  server.close();
  if (all.length) printTable(all);
}

main();
