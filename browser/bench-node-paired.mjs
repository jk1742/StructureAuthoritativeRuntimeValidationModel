import { JSDOM } from "jsdom";
import { performance } from "node:perf_hooks";
import { runPaired } from "./bench-core-paired.mjs";
const makeDoc = () => new JSDOM("<!doctype html><html><head></head><body></body></html>").window.document;
const cfg = JSON.parse(process.env.CFG || "{}");
for (const kase of (cfg.cases || ["case1","case3","case4"])) {
  const r = runPaired({ case: kase, makeDoc, now: () => performance.now(), ...cfg });
  console.log(`\n=== JSDOM ${kase} (proposed/baseline) ===`);
  console.table(r.rows);
  if (r.payload) { console.log("payload (deterministic):"); console.table(r.payload); }
}
