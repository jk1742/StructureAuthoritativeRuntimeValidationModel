/* run-jsdom.mjs — 브라우저 없이 JSDOM으로 로직 검증/참조 산출.
 *   npm install jsdom && node run-jsdom.mjs
 * expected와 불일치 시 비정상 종료. */
import { JSDOM } from "jsdom";
import { runCase3 } from "./scenarios-case3.js";

const doc = new JSDOM("<!doctype html><html><head></head><body></body></html>").window.document;
const rows = runCase3(doc);

const DESC = {
  T1: "identical-form replacement",
  T2: "genuine no-op (control)",
  T3: "value mutation",
  T4: "structural insertion",
};
const mark = (cell, isAttack) => cell.detected ? "Detected" : (isAttack ? "missed" : "(valid)");

console.log("\n=== Case 3 detection — JSDOM reference (no browser) ===");
console.table(rows.map((r) => {
  const isAttack = r.snapshot.expected || r.identity.expected;
  const ok = r.snapshot.detected === r.snapshot.expected && r.identity.detected === r.identity.expected;
  return {
    scenario: `${r.id}  ${DESC[r.id] || r.label}`,
    "snapshot-diff": mark(r.snapshot, isAttack),
    "identity": mark(r.identity, isAttack),
    ok: ok ? "OK" : "FAIL",
  };
}));

const ok = rows.every((r) =>
  r.snapshot.detected === r.snapshot.expected && r.identity.detected === r.identity.expected);
console.log(ok ? "JSDOM reference: ALL MATCH EXPECTATIONS" : "JSDOM reference: MISMATCH");
process.exit(ok ? 0 : 1);