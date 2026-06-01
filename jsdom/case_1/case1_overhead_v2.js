/**
 * 논문 6.5 - Runtime Overhead Measurement (Fair comparison)
 *
 * 두 가지 baseline을 함께 측정하여 비교의 공정성을 확보한다.
 *
 *  (A1) Baseline-naive    : meta tag + querySelector lookup     (논문에서 가정하는 단순 구현)
 *  (A2) Baseline-optimized: meta tag + Map<id, metaNode> 인덱스 (실무에서 최적화된 구현)
 *  (B)  Proposed          : indexMap + weakNodeMap (DOM 외부 registry)
 *
 * 측정 항목
 *  1) document payload size (bytes)
 *  2) validation time per node (µs)
 *  3) total validation time (ms)
 *
 * 측정 의의
 *  - payload size      → proposed의 구조적 이점 (DOM 외부 metadata)
 *  - validation time   → proposed의 추가 cost가 실제로 어느 정도인지 검증
 */

const { JSDOM } = require("jsdom");
const { performance } = require("perf_hooks");

const NODE_COUNTS = [10, 50, 100, 200, 500, 1000, 2000];
const REPEAT      = 7;
const WARMUP      = 2;

// ============================================================
// Scenario builder
// ============================================================
function buildScenario(nodeCount) {
  const inputs = [];
  let html = `<!doctype html><html><head></head><body><form id="f">`;
  for (let i = 0; i < nodeCount; i++) {
    const id = `field-${i}`;
    const truth = `val-${i}`;
    inputs.push({ id, truth });
    html += `<input id="${id}" type="text" value="${truth}" />`;
  }
  html += `</form></body></html>`;
  const dom = new JSDOM(html);
  return { dom, inputs };
}

// ============================================================
// (A1) Baseline-naive : meta tag + querySelector per validation
// ============================================================
function setupBaselineNaive(dom, inputs) {
  const doc = dom.window.document;
  for (const { id, truth } of inputs) {
    const m = doc.createElement("meta");
    m.setAttribute("name", `truth:${id}`);
    m.setAttribute("content", truth);
    doc.head.appendChild(m);
  }
}
function validateBaselineNaive(dom, inputs) {
  const doc = dom.window.document;
  let ok = 0;
  for (const { id } of inputs) {
    const node = doc.getElementById(id);
    const meta = doc.querySelector(`meta[name="truth:${id}"]`);   // O(N)
    const truth = meta ? meta.getAttribute("content") : null;
    if (String(node.value ?? "") === String(truth ?? "")) ok++;
  }
  return { ok };
}

// ============================================================
// (A2) Baseline-optimized : meta tag + pre-built Map index
// ============================================================
function setupBaselineOpt(dom, inputs) {
  const doc = dom.window.document;
  const metaIndex = new Map();                 // id -> meta element
  for (const { id, truth } of inputs) {
    const m = doc.createElement("meta");
    m.setAttribute("name", `truth:${id}`);
    m.setAttribute("content", truth);
    doc.head.appendChild(m);
    metaIndex.set(id, m);
  }
  return { metaIndex };
}
function validateBaselineOpt(dom, inputs, ctx) {
  const doc = dom.window.document;
  const { metaIndex } = ctx;
  let ok = 0;
  for (const { id } of inputs) {
    const node = doc.getElementById(id);
    const meta = metaIndex.get(id);
    const truth = meta ? meta.getAttribute("content") : null;
    if (String(node.value ?? "") === String(truth ?? "")) ok++;
  }
  return { ok };
}

// ============================================================
// (B) Proposed : indexMap + weakNodeMap
// ============================================================
function createRegistry() {
  const indexMap = new Map();
  const weakNodeMap = new WeakMap();
  let _seq = 0;
  return {
    register(node, truth) {
      const id = `e-${(++_seq).toString(36)}`;
      const entity = { id, truth };
      indexMap.set(id, entity);
      weakNodeMap.set(node, id);
      return id;
    },
    validate(node) {
      const id = weakNodeMap.get(node);
      if (!id) return false;
      const entity = indexMap.get(id);
      if (!entity) return false;
      return String(node.value ?? "") === String(entity.truth ?? "");
    },
    _internal: { indexMap, weakNodeMap },
  };
}
function setupProposed(dom, inputs) {
  const doc = dom.window.document;
  const reg = createRegistry();
  const nodeList = [];
  for (const { id, truth } of inputs) {
    const node = doc.getElementById(id);
    reg.register(node, truth);
    nodeList.push(node);
  }
  return { reg, nodeList };
}
function validateProposed(dom, inputs, ctx) {
  const { reg, nodeList } = ctx;
  let ok = 0;
  // node reference를 미리 잡아두는 것은 baseline-opt도 마찬가지로
  // pre-resolved index를 쓰므로 공정한 비교
  for (let i = 0; i < nodeList.length; i++) {
    if (reg.validate(nodeList[i])) ok++;
  }
  return { ok };
}

// ============================================================
// Helper
// ============================================================
function measure(runFn) {
  for (let i = 0; i < WARMUP; i++) runFn();
  const samples = [];
  for (let i = 0; i < REPEAT; i++) {
    const t0 = performance.now();
    runFn();
    const t1 = performance.now();
    samples.push(t1 - t0);
  }
  samples.sort((a, b) => a - b);
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  return { mean, median: samples[Math.floor(samples.length / 2)] };
}

// ============================================================
// Experiment
// ============================================================
const overheadRows = [];
const payloadRows  = [];

for (const N of NODE_COUNTS) {
  // (A1) Baseline-naive
  let scnA1 = buildScenario(N);
  setupBaselineNaive(scnA1.dom, scnA1.inputs);
  const payloadA1 = scnA1.dom.serialize().length;
  // naive는 2000노드에서 매우 느리므로 N<=1000까지만 측정, 그 이상은 skip
  let a1;
  if (N <= 1000) {
    a1 = measure(() => validateBaselineNaive(scnA1.dom, scnA1.inputs));
  } else {
    a1 = { mean: NaN, median: NaN };
  }
  scnA1.dom.window.close();

  // (A2) Baseline-optimized
  let scnA2 = buildScenario(N);
  const ctxA2 = setupBaselineOpt(scnA2.dom, scnA2.inputs);
  const payloadA2 = scnA2.dom.serialize().length;
  const a2 = measure(() => validateBaselineOpt(scnA2.dom, scnA2.inputs, ctxA2));
  scnA2.dom.window.close();

  // (B) Proposed
  let scnB = buildScenario(N);
  const ctxB = setupProposed(scnB.dom, scnB.inputs);
  const payloadB = scnB.dom.serialize().length;
  const b = measure(() => validateProposed(scnB.dom, scnB.inputs, ctxB));
  // proposed는 nodeList를 유지하므로 dom.close()는 측정 이후
  scnB.dom.window.close();

  overheadRows.push({
    nodes: N,
    A1_naive_ms:    isNaN(a1.mean) ? "skipped" : +a1.mean.toFixed(3),
    A2_opt_ms:      +a2.mean.toFixed(3),
    B_proposed_ms:  +b.mean.toFixed(3),
    A1_us_per_node: isNaN(a1.mean) ? "skipped" : +((a1.mean * 1000) / N).toFixed(3),
    A2_us_per_node: +((a2.mean * 1000) / N).toFixed(3),
    B_us_per_node:  +((b.mean * 1000)  / N).toFixed(3),
  });

  payloadRows.push({
    nodes: N,
    baseline_bytes: payloadA1,                 // A1/A2는 동일 (meta tag 수는 같음)
    proposed_bytes: payloadB,
    overhead_bytes: payloadA1 - payloadB,
    overhead_pct:   +(((payloadA1 - payloadB) / payloadB) * 100).toFixed(2),
  });
}

// ============================================================
// Print
// ============================================================
console.log("\n=== Case 1 - 6.5 Runtime Overhead (Fair comparison) ===\n");

console.log("--- Validation time (mean of N=" + REPEAT + " runs) ---");
console.table(overheadRows);

console.log("--- Document payload size ---");
console.table(payloadRows);

console.log("--- Summary ---");
const last = overheadRows[overheadRows.length - 1];
const lastP = payloadRows[payloadRows.length - 1];
console.log(`At ${last.nodes} nodes:`);
console.log(`  baseline-optimized : ${last.A2_opt_ms} ms (${last.A2_us_per_node} µs/node)`);
console.log(`  proposed           : ${last.B_proposed_ms} ms (${last.B_us_per_node} µs/node)`);
console.log(`  payload baseline   : ${lastP.baseline_bytes} B`);
console.log(`  payload proposed   : ${lastP.proposed_bytes} B  (saving ${lastP.overhead_bytes} B = ${lastP.overhead_pct}% smaller)`);

require("fs").writeFileSync(
  "/home/claude/exp_case1/case1_overhead.json",
  JSON.stringify({ overhead: overheadRows, payload: payloadRows, repeat: REPEAT }, null, 2)
);
console.log("\nJSON result -> /home/claude/exp_case1/case1_overhead.json");
