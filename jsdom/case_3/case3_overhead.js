/**
 * Case 3 - Performance measurement
 *
 * 두 모델의 검증 비용을 노드 수별로 비교
 *  - Snapshot-diff : 매 검증마다 전체 트리 재직렬화 + Map diff
 *  - Identity      : root부터 walk하며 WeakNodeMap.get + value check
 *
 * 측정 항목
 *  1) setup time      : 초기 등록(snapshot 생성 또는 entity register) 비용
 *  2) validate time   : 1회 전체 검증 비용
 *  3) memory hint     : snapshot은 trees per epoch 만큼 메모리 필요
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
  // 가장 가벼운 diff: 같은 인덱스 위치에서 path/tag/value 비교
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

  function register(node, parentId) {
    if (node.nodeType !== 1) return null;
    const id = `e-${(++_seq).toString(36)}`;
    const tag = node.tagName.toLowerCase();
    const truth = (tag === "input" || tag === "textarea") ? String(node.value ?? "") : null;
    indexMap.set(id, { id, tag, truth, parentId });
    weakNodeMap.set(node, id);
    const kids = node.children;
    for (let i = 0; i < kids.length; i++) {
      register(kids[i], id);
    }
    return id;
  }

  function validateAll(root) {
    let ok = true;
    function walk(node) {
      if (node.nodeType !== 1) return;
      const id = weakNodeMap.get(node);
      if (!id) { ok = false; return; }
      const entity = indexMap.get(id);
      if (!entity) { ok = false; return; }
      if (entity.tag !== node.tagName.toLowerCase()) { ok = false; return; }
      if (entity.truth !== null) {
        const cur = String(node.value ?? "");
        if (cur !== entity.truth) { ok = false; return; }
      }
      const kids = node.children;
      for (let i = 0; i < kids.length; i++) walk(kids[i]);
    }
    walk(root);
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
    regB.register(rootB, null);
  });
  // 최종 setup된 reg를 사용해 validate 측정
  regB = createIdentityRegistry();
  regB.register(rootB, null);
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
