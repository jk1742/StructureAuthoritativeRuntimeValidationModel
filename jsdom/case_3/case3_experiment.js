/**
 * Case 3: Snapshot Diff vs Identity Continuity
 *
 * Compared models (both minimal)
 *  (A) Snapshot-diff Baseline
 *      - serialize the DOM tree into a flat snapshot at registration time
 *        ([{path, tag, value}, ...])
 *      - on validation, re-serialize the current DOM and compare by diff
 *      - shape-based comparison
 *
 *  (B) Identity Continuity (Proposed, lightweight)
 *      - indexMap     : id -> entity { id, tag, truth, parentId, idx }
 *      - weakNodeMap  : node -> id
 *      - on validation, check the current DOM node keeps the same binding to its registration-time entity
 *      - identity-based comparison (whether the WeakNodeMap binding is preserved)
 *
 * Scenarios
 *  T1. Identical replacement
 *      - replace with a subtree of identical tag/value/structure
 *      - Snapshot-diff: VALID (false pass)
 *      - Identity:      INVALID (binding break detected)
 *
 *  T2. Genuine no-op
 *      - change nothing (control)
 *      - both models VALID
 *
 *  T3. Value mutation
 *      - simple tampering of input.value
 *      - both models detect INVALID
 *
 *  T4. Structural insertion
 *      - insert a new node
 *      - both models detect INVALID
 */

const { JSDOM } = require("jsdom");
const { performance } = require("perf_hooks");

// ============================================================
// (A) Snapshot-diff Baseline
// ============================================================
const SnapshotBaseline = {
  /**
   * Serialize the DOM tree into a flat array
   * path: child-index path from the root
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
   * Compute the diff between two snapshots
   * - same path with different tag/value -> mismatch
   * - present on only one side -> mismatch
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
    if (!id) return false;                   // identity binding broken
    const entity = indexMap.get(id);
    if (!entity) return false;
    if (entity.tag !== node.tagName.toLowerCase()) return false;
    if (entity.truth !== null) {
      const cur = String(node.value ?? "");
      if (cur !== entity.truth) return false;
    }
    return true;
  }

  /**
   * Forward Structure Validation + Removal Sweep (paper Algorithm 1 / 1b)
   *
   * Forward pass (traverse the DOM from the root)
   *   1) WeakNodeMap.get(node) == null            -> binding_broken (STRUCTURAL_DEVIATION)
   *   2) indexMap.get(id) == null                 -> no_canonical_entity
   *   3) tag mismatch                            -> tag_mismatch
   *   4) parent binding != canonical parentId      -> parent_mismatch
   *   5) sibling order != canonical idx            -> order_mismatch
   *   6) runtime truth mismatch                  -> value_mismatch
   *   - mark passed entities as reached (reachability marking)
   *   - do not descend below a node whose binding is broken
   *   - sibling position is passed from the traversal loop index (O(1)/node) -> overall O(N)
   *
   * Removal Sweep
   *   - canonical entities not reached -> removed (registered but vanished nodes)
   */
  function validateAll(root) {
    const issues = [];
    const reached = new Set();

    function walk(node, isRoot, posInParent) {
      if (node.nodeType !== 1) return;

      const id = weakNodeMap.get(node);
      if (!id) {
        // identity binding broken (e.g., a new node swapped in with identical shape)
        issues.push({ tag: node.tagName.toLowerCase(), reason: "binding_broken" });
        return;
      }
      const entity = indexMap.get(id);
      if (!entity) {
        issues.push({ id, reason: "no_canonical_entity" });
        return;
      }
      reached.add(id);

      if (entity.tag !== node.tagName.toLowerCase()) {
        issues.push({ id, reason: "tag_mismatch" });
      }

      // parent / sibling order (root is exempt: registered with parentId=null)
      if (!isRoot) {
        const parentNode = node.parentNode;
        const parentId =
          parentNode && parentNode.nodeType === 1 ? weakNodeMap.get(parentNode) : null;
        if (parentId !== entity.parentId) {
          issues.push({ id, reason: "parent_mismatch" });
        }
        if (posInParent !== entity.idx) {
          issues.push({ id, reason: "order_mismatch" });
        }
      }

      // runtime state (truth)
      if (entity.truth !== null) {
        const cur = String(node.value ?? "");
        if (cur !== entity.truth) {
          issues.push({ id, reason: "value_mismatch" });
        }
      }

      const kids = node.children;
      for (let i = 0; i < kids.length; i++) walk(kids[i], false, i);
    }

    walk(root, true, 0);

    // Removal Sweep : entities registered but not reached in the forward pass
    for (const [id, entity] of indexMap) {
      if (!reached.has(id)) {
        issues.push({ id, reason: "removed", tag: entity.tag });
      }
    }

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

    // attack: replace the input#user node with a new node of identical shape
    const oldUser = dom.window.document.getElementById("user");
    const newUser = dom.window.document.createElement("input");
    newUser.id = "user";
    newUser.type = "text";
    newUser.value = "alice"; // identical value
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

  // T2. Genuine no-op (control)
  {
    const dom = buildBase();
    const root = dom.window.document.getElementById("f");
    const snap = SnapshotBaseline.snapshot(root);
    const reg = createIdentityRegistry();
    reg.register(root, null, 0);

    // change nothing
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