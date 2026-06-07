/**
 * Case 3 - Performance measurement  (PROVENANCE ONLY - SUPERSEDED)
 *
 * Single-run timing script, superseded by the paired protocol. The source of truth
 * for the paper's / dashboard's overhead (time) is browser/run_paired.mjs and
 * browser/results/paired_case3_*.json. This is a JSDOM-only, non-paired measurement,
 * so do not cite these numbers as headline performance. (see the artifact README)
 *
 * Compares the validation cost of the two models by node count:
 *  - Snapshot-diff : re-serialize the whole tree + Map diff on every validation
 *  - Identity      : walk from the root with WeakNodeMap.get + structure/value check + removal sweep
 *
 * The Identity validateAll used here is identical to the extended algorithm in
 * case3_experiment.js (Forward Structure Validation + Removal Sweep; sibling position
 * comes from the traversal index, O(1)). The timed path does not diverge from the
 * experiment, and the whole pass stays O(N).
 *
 * Measured items
 *  1) setup time      : initial registration cost (snapshot build or entity register)
 *  2) validate time   : cost of one full validation
 *  3) memory hint     : snapshot needs memory proportional to trees per epoch
 *
 * Node count : 10, 50, 100, 500, 1000, 2000
 */

const { JSDOM } = require("jsdom");
const { performance } = require("perf_hooks");

const NODE_COUNTS = [10, 50, 100, 500, 1000, 2000];
const REPEAT = 7;
const WARMUP = 2;

// ============================================================
// Snapshot-diff Baseline (lightweight)
// ============================================================
function snapshot(root) {
  const out = [];
  function walk(node, path) {
    if (node.nodeType !== 1) return;
    const tag = node.tagName.toLowerCase();
    const value = (tag === "input" || tag === "textarea") ? String(node.value ?? "") : null;
    out.push({ path: path, tag, value });
    const kids = node.children;
    for (let i = 0; i < kids.length; i++) {
      walk(kids[i], path + "." + i);
    }
  }
  walk(root, "0");
  return out;
}
function snapshotDiff(prev, curr) {
  // lightest diff: compare path/tag/value at the same index position
  if (prev.length !== curr.length) return false;
  for (let i = 0; i < prev.length; i++) {
    const p = prev[i], c = curr[i];
    if (p.path !== c.path || p.tag !== c.tag || p.value !== c.value) return false;
  }
  return true;
}

// ============================================================
// Identity Continuity Registry
// ============================================================
function createIdentityRegistry() {
  const indexMap = new Map();
  const weakNodeMap = new WeakMap();
  let _seq = 0;

  function register(node, parentId, idx) {
    if (node.nodeType !== 1) return null;
    const id = `e-${(++_seq).toString(36)}`;
    const tag = node.tagName.toLowerCase();
    const truth = (tag === "input" || tag === "textarea") ? String(node.value ?? "") : null;
    indexMap.set(id, { id, tag, truth, parentId, idx });
    weakNodeMap.set(node, id);
    const kids = node.children;
    for (let i = 0; i < kids.length; i++) {
      register(kids[i], id, i);
    }
    return id;
  }

  // identical to case3_experiment.js: Forward Structure Validation + Removal Sweep
  // (sibling position passed from the traversal index -> O(1)/node -> overall O(N))
  function validateAll(root) {
    let ok = true;
    const reached = new Set();
    function walk(node, isRoot, pos) {
      if (node.nodeType !== 1) return;
      const id = weakNodeMap.get(node);
      if (!id) { ok = false; return; }
      const entity = indexMap.get(id);
      if (!entity) { ok = false; return; }
      reached.add(id);
      if (entity.tag !== node.tagName.toLowerCase()) ok = false;
      if (!isRoot) {
        const p = node.parentNode;
        const pid = p && p.nodeType === 1 ? weakNodeMap.get(p) : null;
        if (pid !== entity.parentId) ok = false;
        if (pos !== entity.idx) ok = false;
      }
      if (entity.truth !== null) {
        const cur = String(node.value ?? "");
        if (cur !== entity.truth) ok = false;
      }
      const kids = node.children;
      for (let i = 0; i < kids.length; i++) walk(kids[i], false, i);
    }
    walk(root, true, 0);
    // Removal Sweep
    for (const [id] of indexMap) {
      if (!reached.has(id)) ok = false;
    }
    return ok;
  }

  return { register, validateAll };
}

// ============================================================
// Scenario builder
// ============================================================
function buildLargeForm(n) {
  let html = `<!doctype html><html><head></head><body><form id="f">`;
  for (let i = 0; i < n; i++) {
    html += `<input id="i-${i}" type="text" value="v-${i}" />`;
  }
  html += `</form></body></html>`;
  return new JSDOM(html);
}

// ============================================================
// Measurement
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
  return samples.reduce((a, b) => a + b, 0) / samples.length;
}

// ============================================================
// Experiment
// ============================================================
const rows = [];

for (const N of NODE_COUNTS) {
  // (A) Snapshot
  const domA = buildLargeForm(N);
  const rootA = domA.window.document.getElementById("f");
  const setupA = measure(() => snapshot(rootA));
  const snap = snapshot(rootA);
  const validateA = measure(() => {
    const curr = snapshot(rootA);
    snapshotDiff(snap, curr);
  });
  domA.window.close();

  // (B) Identity
  const domB = buildLargeForm(N);
  const rootB = domB.window.document.getElementById("f");
  let regB;
  const setupB = measure(() => {
    regB = createIdentityRegistry();
    regB.register(rootB, null, 0);
  });
  // measure validate using the finally set-up registry
  regB = createIdentityRegistry();
  regB.register(rootB, null, 0);
  const validateB = measure(() => regB.validateAll(rootB));
  domB.window.close();

  rows.push({
    nodes: N,
    snapshot_setup_ms: +setupA.toFixed(3),
    identity_setup_ms: +setupB.toFixed(3),
    snapshot_validate_ms: +validateA.toFixed(3),
    identity_validate_ms: +validateB.toFixed(3),
    snapshot_us_per_node: +((validateA * 1000) / N).toFixed(3),
    identity_us_per_node: +((validateB * 1000) / N).toFixed(3),
    speedup_x: +(validateA / validateB).toFixed(2),
  });
}

console.log("\n=== Case 3 Performance ===\n");
console.table(rows);

const last = rows[rows.length - 1];
console.log("--- Summary ---");
console.log(`At ${last.nodes} nodes:`);
console.log(`  Snapshot-diff validate : ${last.snapshot_validate_ms} ms (${last.snapshot_us_per_node} µs/node)`);
console.log(`  Identity      validate : ${last.identity_validate_ms} ms (${last.identity_us_per_node} µs/node)`);
console.log(`  Speedup of identity    : ${last.speedup_x}x`);

require("fs").writeFileSync(
  "./case3_overhead.json",
  JSON.stringify(rows, null, 2)
);
console.log("\nJSON result -> ./case3_overhead.json");
