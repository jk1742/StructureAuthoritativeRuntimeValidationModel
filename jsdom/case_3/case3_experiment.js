/**
 * Case 3: Snapshot Diff vs Identity Continuity
 *
 * 비교 모델 (둘 다 최소 구조)
 *  (A) Snapshot-diff Baseline
 *      - 등록 시점에 DOM tree를 평면 snapshot으로 직렬화
 *        ([{path, tag, value}, ...])
 *      - 검증 시 현재 DOM을 다시 직렬화하여 diff 비교
 *      - 형태(shape) 기반 비교
 *
 *  (B) Identity Continuity (Proposed, 경량)
 *      - indexMap     : id -> entity { id, tag, truth, parentId, idx }
 *      - weakNodeMap  : node -> id
 *      - 검증 시 현재 DOM node가 등록 시점의 entity와 동일한 binding을 유지하는지 검사
 *      - identity 기반 비교 (WeakNodeMap binding 유지 여부)
 *
 * 시나리오
 *  T1. Identical replacement
 *      - 동일한 tag/value/structure의 subtree로 교체
 *      - Snapshot-diff: VALID (잘못 통과)
 *      - Identity:      INVALID (binding 단절 탐지)
 *
 *  T2. Genuine no-op
 *      - 아무것도 바꾸지 않음 (대조군)
 *      - 두 모델 모두 VALID
 *
 *  T3. Value mutation
 *      - input.value를 단순 변조
 *      - 두 모델 모두 INVALID 탐지
 *
 *  T4. Structural insertion
 *      - 새 node 삽입
 *      - 두 모델 모두 INVALID 탐지
 */

const { JSDOM } = require("jsdom");
const { performance } = require("perf_hooks");

// ============================================================
// (A) Snapshot-diff Baseline
// ============================================================
const SnapshotBaseline = {
  /**
   * DOM tree를 평면 배열로 직렬화
   * path: root부터의 child index 경로
   */
  snapshot(root) {
    const out = [];
    function walk(node, path) {
      if (node.nodeType !== 1) return;
      const tag = node.tagName.toLowerCase();
      const value = (tag === "input" || tag === "textarea") ? String(node.value ?? "") : null;
      out.push({ path: path.join("."), tag, value });
      const kids = node.children;
      for (let i = 0; i < kids.length; i++) {
        walk(kids[i], path.concat(i));
      }
    }
    walk(root, [0]);
    return out;
  },

  /**
   * 두 snapshot의 diff를 계산
   * - 같은 path에 다른 tag/value -> mismatch
   * - 한쪽에만 존재 -> mismatch
   */
  diff(prev, curr) {
    const mismatches = [];
    const prevMap = new Map(prev.map(e => [e.path, e]));
    const currMap = new Map(curr.map(e => [e.path, e]));
    for (const [path, p] of prevMap) {
      const c = currMap.get(path);
      if (!c) { mismatches.push({ type: "removed", path }); continue; }
      if (c.tag !== p.tag || c.value !== p.value) {
        mismatches.push({ type: "changed", path });
      }
    }
    for (const [path] of currMap) {
      if (!prevMap.has(path)) mismatches.push({ type: "added", path });
    }
    return mismatches;
  },

  validate(prevSnap, root) {
    const curr = this.snapshot(root);
    const m = this.diff(prevSnap, curr);
    return { valid: m.length === 0, mismatches: m };
  },
};

// ============================================================
// (B) Identity Continuity (Proposed)
// ============================================================
function createIdentityRegistry() {
  const indexMap   = new Map();   // id -> entity
  const weakNodeMap = new WeakMap();  // node -> id
  let _seq = 0;

  function register(node, parentId, idx) {
    if (node.nodeType !== 1) return null;
    const id = `e-${(++_seq).toString(36)}`;
    const tag = node.tagName.toLowerCase();
    const truth = (tag === "input" || tag === "textarea") ? String(node.value ?? "") : null;
    indexMap.set(id, { id, tag, truth, parentId, idx, childIds: [] });
    weakNodeMap.set(node, id);

    const parent = indexMap.get(parentId);
    if (parent) parent.childIds.push(id);

    const kids = node.children;
    for (let i = 0; i < kids.length; i++) {
      register(kids[i], id, i);
    }
    return id;
  }

  function validateNode(node) {
    if (node.nodeType !== 1) return true;
    const id = weakNodeMap.get(node);
    if (!id) return false;                   // identity binding 단절
    const entity = indexMap.get(id);
    if (!entity) return false;
    if (entity.tag !== node.tagName.toLowerCase()) return false;
    if (entity.truth !== null) {
      const cur = String(node.value ?? "");
      if (cur !== entity.truth) return false;
    }
    return true;
  }

  function validateAll(root) {
    const issues = [];
    function walk(node) {
      if (node.nodeType !== 1) return;
      if (!validateNode(node)) {
        issues.push({ tag: node.tagName.toLowerCase(), reason: "identity_or_value" });
      }
      // identity가 끊긴 노드의 children은 더 깊이 들어가지 않음 (불필요한 cascade 방지)
      const id = weakNodeMap.get(node);
      if (id) {
        const kids = node.children;
        for (let i = 0; i < kids.length; i++) walk(kids[i]);
      }
    }
    walk(root);
    return { valid: issues.length === 0, issues };
  }

  return { register, validateNode, validateAll, _internal: { indexMap, weakNodeMap } };
}

// ============================================================
// Scenario builder
// ============================================================
function buildBase() {
  const dom = new JSDOM(`<!doctype html><html><head></head><body>
    <form id="f">
      <input id="user" type="text" value="alice" />
      <input id="agree" type="checkbox" />
      <textarea id="memo">hello</textarea>
    </form>
  </body></html>`);
  return dom;
}

// ============================================================
// Run scenarios
// ============================================================
function runScenarios() {
  const results = [];

  // T1. Identical replacement
  {
    const dom = buildBase();
    const root = dom.window.document.getElementById("f");
    // setup
    const snap = SnapshotBaseline.snapshot(root);
    const reg = createIdentityRegistry();
    reg.register(root, null, 0);

    // attack: input#user 노드를 완전히 동일한 형태의 신규 노드로 교체
    const oldUser = dom.window.document.getElementById("user");
    const newUser = dom.window.document.createElement("input");
    newUser.id = "user";
    newUser.type = "text";
    newUser.value = "alice"; // 동일 value
    oldUser.parentNode.replaceChild(newUser, oldUser);

    const a = SnapshotBaseline.validate(snap, root);
    const b = reg.validateAll(root);

    results.push({
      scenario: "T1: identical-form replacement",
      description: "subtree를 완전히 동일한 tag/value로 교체",
      snapshot_diff: { detected: !a.valid, mismatches: a.mismatches.length },
      identity:      { detected: !b.valid, issues: b.issues.length },
    });
    dom.window.close();
  }

  // T2. Genuine no-op (대조군)
  {
    const dom = buildBase();
    const root = dom.window.document.getElementById("f");
    const snap = SnapshotBaseline.snapshot(root);
    const reg = createIdentityRegistry();
    reg.register(root, null, 0);

    // 아무것도 변경하지 않음
    const a = SnapshotBaseline.validate(snap, root);
    const b = reg.validateAll(root);

    results.push({
      scenario: "T2: genuine no-op (control)",
      description: "변경 없음",
      snapshot_diff: { detected: !a.valid, mismatches: a.mismatches.length },
      identity:      { detected: !b.valid, issues: b.issues.length },
    });
    dom.window.close();
  }

  // T3. Value mutation
  {
    const dom = buildBase();
    const root = dom.window.document.getElementById("f");
    const snap = SnapshotBaseline.snapshot(root);
    const reg = createIdentityRegistry();
    reg.register(root, null, 0);

    dom.window.document.getElementById("user").value = "attacker";

    const a = SnapshotBaseline.validate(snap, root);
    const b = reg.validateAll(root);

    results.push({
      scenario: "T3: value mutation",
      description: "input.value direct alteration",
      snapshot_diff: { detected: !a.valid, mismatches: a.mismatches.length },
      identity:      { detected: !b.valid, issues: b.issues.length },
    });
    dom.window.close();
  }

  // T4. Structural insertion
  {
    const dom = buildBase();
    const root = dom.window.document.getElementById("f");
    const snap = SnapshotBaseline.snapshot(root);
    const reg = createIdentityRegistry();
    reg.register(root, null, 0);

    const newNode = dom.window.document.createElement("input");
    newNode.type = "hidden";
    newNode.value = "INJECT";
    root.appendChild(newNode);

    const a = SnapshotBaseline.validate(snap, root);
    const b = reg.validateAll(root);

    results.push({
      scenario: "T4: unauthorized structural insertion",
      description: "신규 input node 삽입",
      snapshot_diff: { detected: !a.valid, mismatches: a.mismatches.length },
      identity:      { detected: !b.valid, issues: b.issues.length },
    });
    dom.window.close();
  }

  return results;
}

// ============================================================
// Output
// ============================================================
const results = runScenarios();

console.log("\n=== Case 3 - Identity Continuity vs Snapshot Diff ===\n");

console.table(results.map(r => ({
  Scenario: r.scenario,
  "Snapshot-diff": r.snapshot_diff.detected ? "Detected" : "MISSED",
  "Identity":      r.identity.detected ? "Detected" : "MISSED",
})));

console.log("\n--- Detailed ---");
for (const r of results) {
  console.log(`\n[${r.scenario}]`);
  console.log(`  description : ${r.description}`);
  console.log(`  snapshot-diff: ${r.snapshot_diff.detected ? "Detected" : "MISSED"} (${r.snapshot_diff.mismatches} mismatches)`);
  console.log(`  identity     : ${r.identity.detected ? "Detected" : "MISSED"} (${r.identity.issues} issues)`);
}

require("fs").writeFileSync(
  "./case3_result.json",
  JSON.stringify(results, null, 2)
);
console.log("\nJSON result -> ./case3_result.json");
