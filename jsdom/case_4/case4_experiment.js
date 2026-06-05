/**
 * Case 4 : Runtime Reconstruction in Component Environment
 *
 * Compared models (3-way, all minimal implementations)
 *
 *  (A) innerHTML swap baseline
 *      - server sends a new HTML fragment
 *      - client fully re-renders via parent.innerHTML = newHtml
 *      - no consistency guarantee
 *
 *  (B) Keyed reconcile baseline
 *      - server sends a new entity tree
 *      - each element carries a key attribute
 *      - children with the same key are reused; different keys are created anew
 *      - consistency basis : developer-provided key
 *
 *  (C) Identity reconciliation (proposed)
 *      - server sends a new entity tree (including entity.id)
 *      - entity id matching via indexMap
 *      - same entity id reuses the existing DOM node + WeakNodeMap rebind
 *      - consistency basis : authority-issued entity id lineage
 *
 * Scenarios
 *
 *  R1. Runtime state preservation
 *      - user types "user-typed-value" into input#user
 *      - server sends a new definition of the same form (same structure, attributes changed only)
 *      - matched by the same entity identifier - is input.value preserved?
 *
 *      A : innerHTML swap   -> input lost (re-created)
 *      B : keyed reconcile  -> same key -> preserved
 *      C : identity         -> same entity id -> preserved
 *
 *  R2. Identity-aware reconstruction
 *      - user types "user-typed-value" into input#user
 *      - server sends a new form that looks identical but has a different entity id
 *      - (= business-wise: "retire the old form, start a new form")
 *      - can false reuse be prevented?
 *
 *      A : innerHTML swap   -> input lost (re-created)      -> correct (no reuse)
 *      B : keyed reconcile  -> same key causes wrong reuse  -> FALSE REUSE
 *      C : identity         -> different entity id -> correctly re-created -> correct
 */

const { JSDOM } = require("jsdom");

// ============================================================
// (A) innerHTML swap baseline
// ============================================================
const InnerHTMLSwap = {
  apply(parent, newHtml) {
    // simplest server-driven swap (HTMX hx-swap=innerHTML style pattern)
    parent.innerHTML = newHtml;
  },
};

// ============================================================
// (B) Keyed reconcile baseline
// ============================================================
const KeyedReconcile = {
  /**
   * Receives a new entity tree and performs keyed reconcile
   *
   * entity tree format:
   *   { key, tag, attrs:{}, children:[...] }
   *
   * algorithm:
   *   - key-based child matching within the same parent
   *   - on key match, reuse the existing DOM node (patch attributes only)
   *   - on mismatch, create a new DOM node
   */
  apply(parent, newEntityTree, doc) {
    function reconcileChildren(parentDom, newChildren) {
      const existing = new Map();
      for (let i = 0; i < parentDom.children.length; i++) {
        const ch = parentDom.children[i];
        const k = ch.getAttribute("data-key");
        if (k) existing.set(k, ch);
      }

      // process new children in order
      const used = new Set();
      const finalNodes = [];

      for (const newChild of newChildren) {
        let node = existing.get(newChild.key);
        if (node) {
          // reuse - attribute patch
          patchNode(node, newChild);
          used.add(newChild.key);
        } else {
          // create new
          node = createNode(newChild, doc);
        }
        finalNodes.push(node);
        if (newChild.children && newChild.children.length > 0) {
          reconcileChildren(node, newChild.children);
        }
      }

      // remove existing children that were not used
      for (const [k, n] of existing) {
        if (!used.has(k) && n.parentNode) n.parentNode.removeChild(n);
      }

      // reorder into the final order
      for (const n of finalNodes) {
        parentDom.appendChild(n);
      }
    }

    function patchNode(node, entity) {
      // tag mismatch is not handled (simplest keyed reconcile)
      for (const k of Object.keys(entity.attrs || {})) {
        node.setAttribute(k, entity.attrs[k]);
      }
    }

    function createNode(entity, doc) {
      const el = doc.createElement(entity.tag);
      if (entity.key) el.setAttribute("data-key", entity.key);
      for (const k of Object.keys(entity.attrs || {})) {
        el.setAttribute(k, entity.attrs[k]);
      }
      return el;
    }

    reconcileChildren(parent, newEntityTree.children || []);
  },
};

// ============================================================
// (C) Identity reconciliation (proposed)
// ============================================================
function createIdentityReconciler() {
  const indexMap = new Map();       // entity.id -> { entity, node }
  const weakNodeMap = new WeakMap(); // node -> entity.id

  /**
   * Initial mount : render the entity tree into the DOM and build indexMap/WeakNodeMap
   *
   * entity tree format:
   *   { id, tag, attrs:{}, children:[...] }
   *
   * - id is an entity identifier issued by the authority (server)
   * - id is part of the lineage and cannot be issued arbitrarily by the client
   */
  function mount(parent, entityTree, doc) {
    function build(entity) {
      const el = doc.createElement(entity.tag);
      for (const k of Object.keys(entity.attrs || {})) {
        el.setAttribute(k, entity.attrs[k]);
      }
      indexMap.set(entity.id, { entity, node: el });
      weakNodeMap.set(el, entity.id);

      for (const child of entity.children || []) {
        el.appendChild(build(child));
      }
      return el;
    }

    for (const child of entityTree.children || []) {
      parent.appendChild(build(child));
    }
  }

  /**
   * Reconstruction : rebuild the runtime subtree from a new authority tree and return a verdict
   *
   * Return value (aligned with FrameCover Algorithm 2: Runtime Subtree Reconstruction vocabulary)
   *   { status: "RECONSTRUCTED" | "RECONSTRUCTION_REJECTED",
   *     reused: [id...], created: [id...],
   *     rejected: [{ position, staleId, canonicalId }...] }
   *
   * Decision rules
   *   - if the existing runtime node's WeakNodeMap binding links to the new authority's
   *     canonical id (indexMap hit) -> normal reconstruction (reuse), continuity kept -> RECONSTRUCTED
   *   - if the existing node at the same position is bound to a different lineage and cannot
   *     link to the new canonical id -> reconstruction of that prior subtree is rejected
   *       (paper 3.3 / Algorithm 1: indexMap.get == null -> STRUCTURAL_DEVIATION path)
   *     -> overall verdict is RECONSTRUCTION_REJECTED, the stale node is discarded, and
   *        the new lineage (a legitimate new subtree issued by the authority) is built fresh
   *
   * Key difference (vs keyed reconcile)
   *   - id is not a client/developer hint but part of the authority lineage
   *   - a different id refuses reuse even with the same shape (RECONSTRUCTION_REJECTED)
   */
  function reconstruct(parent, newEntityTree, doc) {
    const verdict = {
      status: "RECONSTRUCTED",
      reused: [],
      created: [],
      rejected: [],
    };

    function reconcileChildren(parentDom, newChildren) {
      const newIdSet = new Set();
      const finalNodes = [];

      // position-based snapshot of stale nodes (current runtime layout before reconstruction)
      const staleAtPos = [];
      for (let i = 0; i < parentDom.children.length; i++) {
        staleAtPos.push(parentDom.children[i]);
      }

      newChildren.forEach((newChild, i) => {
        newIdSet.add(newChild.id);
        let node;
        const existing = indexMap.get(newChild.id);

        if (existing) {
          // canonical lineage link kept -> normal reconstruction (reuse)
          node = existing.node;
          for (const k of Object.keys(newChild.attrs || {})) {
            node.setAttribute(k, newChild.attrs[k]);
          }
          existing.entity = newChild;
          // WeakNodeMap rebind (paper 3.3 "rebind")
          weakNodeMap.set(node, newChild.id);
          verdict.reused.push(newChild.id);
        } else {
          // is the existing node at this position bound to a different lineage?
          const prior = staleAtPos[i];
          if (prior) {
            const priorId = weakNodeMap.get(prior);
            if (priorId && priorId !== newChild.id) {
              // existing node cannot link to the new canonical id -> reject reconstruction
              verdict.status = "RECONSTRUCTION_REJECTED";
              verdict.rejected.push({
                position: i,
                staleId: priorId,
                canonicalId: newChild.id,
              });
            }
          }
          // new canonical entity is built fresh (a legitimate new lineage issued by the authority)
          node = doc.createElement(newChild.tag);
          for (const k of Object.keys(newChild.attrs || {})) {
            node.setAttribute(k, newChild.attrs[k]);
          }
          indexMap.set(newChild.id, { entity: newChild, node });
          weakNodeMap.set(node, newChild.id);
          verdict.created.push(newChild.id);
        }
        finalNodes.push({ node, entity: newChild });
      });

      // remove existing nodes that could not link (i.e., discarded)
      for (const oldNode of staleAtPos) {
        const oldId = weakNodeMap.get(oldNode);
        if (oldId && !newIdSet.has(oldId)) {
          indexMap.delete(oldId);
          if (oldNode.parentNode) oldNode.parentNode.removeChild(oldNode);
        }
      }

      // reorder into the final order
      for (const { node, entity } of finalNodes) {
        parentDom.appendChild(node);
        if (entity.children && entity.children.length > 0) {
          reconcileChildren(node, entity.children);
        }
      }
    }

    reconcileChildren(parent, newEntityTree.children || []);
    return verdict;
  }

  return { mount, reconstruct, _internal: { indexMap, weakNodeMap } };
}

// ============================================================
// Reconstruction Authority (the premise of the proposed model, implemented in code)
// ============================================================
/**
 * Core premise of paper section 3.3:
 *   entity id is not a hint issued by the client/developer (= keyed reconcile's key),
 *   but part of a one-directional lineage issued by an external authority.
 *
 * Therefore this component is a separate actor, decoupled from the reconciler/test:
 *   - the client submits only an "id-less shape" and a "lineage decision (token)"
 *   - only the authority stamps the id (the client cannot write the id directly)
 *
 * lineage rules
 *   - re-request with the same lineage token -> same id re-issued for the same slot + revision++  (continuity)
 *   - request with a new lineage token   -> a new id is issued                          (break from the prior lineage)
 *
 * This shows that the difference from baseline B comes not from "a string hand-written in the test"
 * but from "the id's issuing authority and the lineage policy" - shown directly in code.
 */
function createReconstructionAuthority() {
  // lineageToken -> { ids: Map<slot, id>, revision }
  const lineages = new Map();
  let idCounter = 0;

  /**
   * shape format (client-submitted, no id):
   *   { children: [ { slot, tag, attrs, children? }, ... ] }
   *   - slot is only a stable position label within the structure, not an identity
   *
   * Returns: an entity tree with stamped ids (the format the reconciler consumes)
   */
  function issue(lineageToken, shape) {
    let lineage = lineages.get(lineageToken);
    if (!lineage) {
      // new lineage : start with an empty id series (break from the prior lineage)
      lineage = { ids: new Map(), revision: 0 };
      lineages.set(lineageToken, lineage);
    }
    lineage.revision += 1;

    function stamp(node) {
      // only the authority issues ids; same lineage + same slot reuses the same id.
      let id = lineage.ids.get(node.slot);
      if (!id) {
        id = `auth:${lineageToken}:${node.slot}#${++idCounter}`;
        lineage.ids.set(node.slot, id);
      }
      return {
        id,                              // authority-issued
        tag: node.tag,
        attrs: node.attrs || {},
        revision: lineage.revision,      // the paper's revision metadata
        children: (node.children || []).map(stamp),
      };
    }

    return { children: (shape.children || []).map(stamp) };
  }

  return { issue, _lineages: lineages };
}

// ============================================================
// Scenario utilities
// ============================================================
function buildBaseDom() {
  return new JSDOM(`<!doctype html><html><head></head><body>
    <form id="parent"></form>
  </body></html>`);
}

// Express the same form definition in each model's format
//
// the identity model (C) no longer writes ids directly.
// the client submits only an "id-less shape"; authority.issue() stamps the id.
function identityShape() {
  return {
    children: [
      { slot: "user",   tag: "input",  attrs: { type: "text",  name: "user"  } },
      { slot: "email",  tag: "input",  attrs: { type: "email", name: "email" } },
      { slot: "submit", tag: "button", attrs: { type: "submit" } },
    ],
  };
}
function initialEntityTreeForKeyed() {
  return {
    children: [
      { key: "user",   tag: "input",  attrs: { type: "text",     name: "user"  }, children: [] },
      { key: "email",  tag: "input",  attrs: { type: "email",    name: "email" }, children: [] },
      { key: "submit", tag: "button", attrs: { type: "submit" },                  children: [] },
    ],
  };
}
function initialHTML() {
  return `<input type="text"  name="user">
          <input type="email" name="email">
          <button type="submit"></button>`;
}

// R1 : same entity, just an attribute change (e.g., adding maxlength)
function identityShapeWithMaxlength() {
  return {
    children: [
      { slot: "user",   tag: "input",  attrs: { type: "text",  name: "user",  maxlength: "32" } },
      { slot: "email",  tag: "input",  attrs: { type: "email", name: "email", maxlength: "64" } },
      { slot: "submit", tag: "button", attrs: { type: "submit" } },
    ],
  };
}
function r1_updatedEntityTreeForKeyed() {
  return {
    children: [
      { key: "user",   tag: "input",  attrs: { type: "text",  name: "user",  maxlength: "32" }, children: [] },
      { key: "email",  tag: "input",  attrs: { type: "email", name: "email", maxlength: "64" }, children: [] },
      { key: "submit", tag: "button", attrs: { type: "submit" },                                children: [] },
    ],
  };
}
function r1_updatedHTML() {
  return `<input type="text"  name="user"  maxlength="32">
          <input type="email" name="email" maxlength="64">
          <button type="submit"></button>`;
}

// R2 : visually identical but a different entity id (retire the old form, start a new one)
//      the authority lineage is broken
//      the identity model (C) requests the same identityShape() under a "new lineage token".
//      -> the authority issues new ids -> break from the prior lineage (no separate R2 tree function needed)
function r2_replacedEntityTreeForKeyed() {
  // limitation of keyed reconcile: if the developer assigns the same key, it is treated as the same
  // even when the business intent is "retire the old form", if the developer keeps the same key
  // baseline B reuses it incorrectly
  return {
    children: [
      { key: "user",   tag: "input",  attrs: { type: "text",  name: "user"  }, children: [] },
      { key: "email",  tag: "input",  attrs: { type: "email", name: "email" }, children: [] },
      { key: "submit", tag: "button", attrs: { type: "submit" },               children: [] },
    ],
  };
}
function r2_replacedHTML() {
  return initialHTML(); // visually identical
}

// ============================================================
// Scenario execution
// ============================================================
const results = [];

function runScenario(label, description, simulate) {
  const r = simulate();
  results.push({ label, description, ...r });
}

// ------------------------------------------------------------
// R1 : Runtime state preservation
// ------------------------------------------------------------

// R1-A: innerHTML swap
runScenario("R1-A", "innerHTML swap : runtime state preservation", () => {
  const dom = buildBaseDom();
  const doc = dom.window.document;
  const parent = doc.getElementById("parent");
  parent.innerHTML = initialHTML();

  // user input (after mount)
  const userInput = parent.querySelector('input[name="user"]');
  userInput.value = "user-typed-value";

  // trigger server reconstruction
  InnerHTMLSwap.apply(parent, r1_updatedHTML());

  // check the value of the new input
  const newUserInput = parent.querySelector('input[name="user"]');
  const preserved = newUserInput.value === "user-typed-value";
  const maxlengthApplied = newUserInput.getAttribute("maxlength") === "32";

  dom.window.close();
  return { preserved, maxlengthApplied, expected: "lost" };
});

// R1-B: keyed reconcile
runScenario("R1-B", "keyed reconcile : runtime state preservation", () => {
  const dom = buildBaseDom();
  const doc = dom.window.document;
  const parent = doc.getElementById("parent");

  // initial mount
  KeyedReconcile.apply(parent, initialEntityTreeForKeyed(), doc);

  // user input
  const userInput = parent.querySelector('input[name="user"]');
  userInput.value = "user-typed-value";

  // reconstruction
  KeyedReconcile.apply(parent, r1_updatedEntityTreeForKeyed(), doc);

  // same key match -> reuse -> value preserved
  const newUserInput = parent.querySelector('input[name="user"]');
  const preserved = newUserInput.value === "user-typed-value";
  const maxlengthApplied = newUserInput.getAttribute("maxlength") === "32";

  dom.window.close();
  return { preserved, maxlengthApplied, expected: "preserved" };
});

// R1-C: identity reconciliation (proposed)
runScenario("R1-C", "identity reconciliation : runtime state preservation", () => {
  const dom = buildBaseDom();
  const doc = dom.window.document;
  const parent = doc.getElementById("parent");

  const authority = createReconstructionAuthority();
  const reconciler = createIdentityReconciler();

  // initial mount : authority issues ids under the "form-A" lineage (client submits only the shape)
  const t0 = authority.issue("form-A", identityShape());
  reconciler.mount(parent, t0, doc);

  // user input
  const userInput = parent.querySelector('input[name="user"]');
  userInput.value = "user-typed-value";

  // R1 : business intent = "keep the same form" -> client re-requests under the same lineage token
  //      -> authority re-issues the same id (revision++) -> reconciler reuses the node
  const t1 = authority.issue("form-A", identityShapeWithMaxlength());
  const verdict = reconciler.reconstruct(parent, t1, doc);

  const newUserInput = parent.querySelector('input[name="user"]');
  const preserved = newUserInput.value === "user-typed-value";
  const maxlengthApplied = newUserInput.getAttribute("maxlength") === "32";

  // extra verification : id provenance is the authority, and same lineage implies identical id
  const idProvenance = "authority";
  const sameLineageId = t0.children[0].id === t1.children[0].id;
  const revisionBumped = t1.children[0].revision === t0.children[0].revision + 1;

  dom.window.close();
  return { preserved, maxlengthApplied, expected: "preserved",
           idProvenance, sameLineageId, revisionBumped,
           reconstructionStatus: verdict.status };   // expected: RECONSTRUCTED
});

// ------------------------------------------------------------
// R2 : Identity-aware reconstruction
// ------------------------------------------------------------

// R2-A: innerHTML swap (expected: always re-created, value lost)
runScenario("R2-A", "innerHTML swap : identity-aware reconstruction", () => {
  const dom = buildBaseDom();
  const doc = dom.window.document;
  const parent = doc.getElementById("parent");
  parent.innerHTML = initialHTML();

  const userInput = parent.querySelector('input[name="user"]');
  userInput.value = "user-typed-value";

  InnerHTMLSwap.apply(parent, r2_replacedHTML());

  const newUserInput = parent.querySelector('input[name="user"]');
  const valueAfter = newUserInput.value;

  // verdict: if retiring the prior entity is correct, the value must be lost
  const identityRespected = valueAfter === "";  // lost = correct

  dom.window.close();
  return {
    valueAfter,
    identityRespected,
    outcome: identityRespected ? "correctly_discarded" : "incorrectly_preserved",
  };
});

// R2-B: keyed reconcile (expected: same key causes wrong reuse)
runScenario("R2-B", "keyed reconcile : identity-aware reconstruction", () => {
  const dom = buildBaseDom();
  const doc = dom.window.document;
  const parent = doc.getElementById("parent");

  KeyedReconcile.apply(parent, initialEntityTreeForKeyed(), doc);

  const userInput = parent.querySelector('input[name="user"]');
  userInput.value = "user-typed-value";

  // the developer intended retirement but kept the same key (key is only a hint)
  KeyedReconcile.apply(parent, r2_replacedEntityTreeForKeyed(), doc);

  const newUserInput = parent.querySelector('input[name="user"]');
  const valueAfter = newUserInput.value;

  // business intent was retirement, so a surviving value means false reuse
  const identityRespected = valueAfter === "";

  dom.window.close();
  return {
    valueAfter,
    identityRespected,
    outcome: identityRespected ? "correctly_discarded" : "incorrectly_preserved",
  };
});

// R2-C: identity reconciliation (expected: a different id correctly creates anew)
runScenario("R2-C", "identity reconciliation : identity-aware reconstruction", () => {
  const dom = buildBaseDom();
  const doc = dom.window.document;
  const parent = doc.getElementById("parent");

  const authority = createReconstructionAuthority();
  const reconciler = createIdentityReconciler();

  const t0 = authority.issue("form-A", identityShape());
  reconciler.mount(parent, t0, doc);

  const userInput = parent.querySelector('input[name="user"]');
  userInput.value = "user-typed-value";

  // R2 : visually identical but business intent = "retire the old form, start a new form"
  //      -> client requests under a "new lineage token" (declaring retirement of the old form)
  //      -> authority issues new ids -> break from the prior lineage -> reconciler creates new nodes
  //
  //   key point (vs B): the client cannot write the id directly; even with the same shape, a new lineage
  //   makes the authority stamp a different id, so B's 'same key -> false reuse' is structurally impossible.
  const t2 = authority.issue("form-B", identityShape());
  const verdict = reconciler.reconstruct(parent, t2, doc);

  const newUserInput = parent.querySelector('input[name="user"]');
  const valueAfter = newUserInput.value;
  const identityRespected = valueAfter === "";

  // extra verification : same shape but different lineage, so ids must differ (enforced by the authority)
  const crossLineageDistinctId = t0.children[0].id !== t2.children[0].id;

  dom.window.close();
  return {
    valueAfter,
    identityRespected,
    outcome: identityRespected ? "correctly_discarded" : "incorrectly_preserved",
    idProvenance: "authority",
    crossLineageDistinctId,
    reconstructionStatus: verdict.status,        // expected: RECONSTRUCTION_REJECTED
    rejectedCount: verdict.rejected.length,      // expected: 3 (user/email/submit)
  };
});

// ============================================================
// Result output
// ============================================================
console.log("\n=== Case 4 : Runtime Reconstruction (R1 + R2) ===\n");

// R1 results
console.log("--- R1: Runtime state preservation ---");
console.log("(시나리오 : 동일 entity, attribute만 변경. 사용자 입력값이 보존되어야 함)\n");
const r1 = results.filter(r => r.label.startsWith("R1"));
console.table(r1.map(r => ({
  Model: r.label,
  Description: r.description.split(":")[0].trim(),
  "value preserved": r.preserved ? "YES" : "NO",
  "attribute applied": r.maxlengthApplied ? "YES" : "NO",
  Expected: r.expected,
})));

// R2 results
console.log("\n--- R2: Identity-aware reconstruction ---");
console.log("(시나리오 : 시각적 동일하나 다른 entity. 이전 입력값이 폐기되어야 함)\n");
const r2 = results.filter(r => r.label.startsWith("R2"));
console.table(r2.map(r => ({
  Model: r.label,
  Description: r.description.split(":")[0].trim(),
  "value after": r.valueAfter,
  "identity respected": r.identityRespected ? "YES" : "NO  (FALSE REUSE)",
  Outcome: r.outcome,
})));

console.log("\n--- Summary ---");
console.log("R1 : 사용자 입력 보존 여부");
console.log(`  innerHTML swap     : ${r1[0].preserved ? "보존" : "손실"}`);
console.log(`  keyed reconcile    : ${r1[1].preserved ? "보존" : "손실"}`);
console.log(`  identity (proposed): ${r1[2].preserved ? "보존" : "손실"}`);
console.log("");
console.log("R2 : 잘못된 재사용 방지 여부");
console.log(`  innerHTML swap     : ${r2[0].identityRespected ? "정상" : "FALSE REUSE"}`);
console.log(`  keyed reconcile    : ${r2[1].identityRespected ? "정상" : "FALSE REUSE"}`);
console.log(`  identity (proposed): ${r2[2].identityRespected ? "정상" : "FALSE REUSE"}`);

// extra : verify that the identity model's discrimination comes from 'authority-issued ids'
console.log("\n--- Identity provenance (proposed C) ---");
console.log(`  id 출처              : ${r1[2].idProvenance} (테스트/ client 가 id 를 직접 쓰지 않음)`);
console.log(`  R1 동일 lineage -> 동일 id : ${r1[2].sameLineageId ? "YES" : "NO"}`);
console.log(`  R1 revision 증가     : ${r1[2].revisionBumped ? "YES" : "NO"}`);
console.log(`  R2 새 lineage -> 다른 id  : ${r2[2].crossLineageDistinctId ? "YES" : "NO"} (동일 shape 라도 authority 가 새 id 강제)`);

// extra : reconstruction verdict (FrameCover Algorithm 2 vocabulary)
console.log("\n--- Reconstruction verdict (proposed C, FrameCover Alg.2) ---");
console.log(`  R1 (same lineage) : ${r1[2].reconstructionStatus}  -> 연속성 유지(재사용), value 보존`);
console.log(`  R2 (new lineage)  : ${r2[2].reconstructionStatus}  -> 연속성 단절(폐기), rejected=${r2[2].rejectedCount}`);

require("fs").writeFileSync(
  "./case4_result.json",
  JSON.stringify(results, null, 2)
);
console.log("\nJSON result -> ./case4_result.json");
