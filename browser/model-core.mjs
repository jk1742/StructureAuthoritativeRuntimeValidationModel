// model-core.mjs
// Minimal reference implementation of the validation model AS DESCRIBED IN THE PAPER:
//   - Algorithm 1 "Canonical Structure Validation"
//   - Section 4.1 registry: entity tree + indexMap + WeakNodeMap
// Self-contained and independent of the production framework (which is large and
// server-entangled, and unsuitable as a demonstration artifact). The canonical
// relations AND the truth value live OUTSIDE the DOM, in closure scope --- exactly
// the property the paper claims. Verdict convention: return true on VALID, throw on
// STRUCTURAL_DEVIATION / RUNTIME_STATE_FORGERY.

export function createRegistry() {
  // indexMap: entity.id -> canonical entity {id, parentId, order, truth}
  const indexMap = new Map();
  // WeakNodeMap: live DOM node -> entity.id  (binding kept outside the DOM)
  const weakNodeMap = new WeakMap();

  function register(node, { id, parentId = null, order = 0, truth = null }) {
    indexMap.set(id, { id, parentId, order, truth });
    weakNodeMap.set(node, id);
    return indexMap.get(id);
  }

  // Resolve the node's CURRENT parent id / sibling order THROUGH the registry,
  // so an unbound parent reads as null (cannot be forged from the DOM side).
  function currentParentId(node) {
    const p = node.parentElement;
    if (!p) return null;
    const pid = weakNodeMap.get(p);
    return pid === undefined ? null : pid;
  }
  function currentOrder(node) {
    const p = node.parentElement;
    return p ? Array.prototype.indexOf.call(p.children, node) : 0;
  }

  // Algorithm 1: Canonical Structure Validation. true = VALID; throw = STRUCTURAL_DEVIATION.
  function validateStructure(node) {
    const id = weakNodeMap.get(node);                                   // step 1
    if (id === undefined)
      throw new Error("STRUCTURAL_DEVIATION: no WeakNodeMap binding (broken identity)"); // step 2
    const canonical = indexMap.get(id);                                 // step 3
    if (!canonical)
      throw new Error("STRUCTURAL_DEVIATION: entity id not in indexMap"); // step 4
    if (currentParentId(node) !== canonical.parentId)                   // step 5
      throw new Error("STRUCTURAL_DEVIATION: parent reference mismatch");
    if (currentOrder(node) !== canonical.order)                         // step 6
      throw new Error("STRUCTURAL_DEVIATION: sibling sequence mismatch");
    for (const child of node.children) validateStructure(child);        // step 7 (recurse)
    return true;                                                        // step 8: VALID
  }

  // Case 1 runtime-state validation: truth is read from the registry (closure), NOT
  // the DOM, so a direct DOM-property forgery (and any in-DOM meta forgery) cannot
  // taint it. true = VALID; throw = RUNTIME_STATE_FORGERY.
  function validateRuntimeState(node, currentValue) {
    const id = weakNodeMap.get(node);
    if (id === undefined) throw new Error("STRUCTURAL_DEVIATION: no WeakNodeMap binding");
    const canonical = indexMap.get(id);
    if (!canonical) throw new Error("STRUCTURAL_DEVIATION: entity id not in indexMap");
    if (canonical.truth !== currentValue)
      throw new Error(
        `RUNTIME_STATE_FORGERY: registry.truth=${JSON.stringify(canonical.truth)} dom=${JSON.stringify(currentValue)}`
      );
    return true;
  }

  // Interaction propagation channel: the ONLY legitimate path that updates truth.
  // (A direct DOM forgery never goes through here, which is why it is detected.)
  function commit(node, newValue) {
    const id = weakNodeMap.get(node);
    if (id === undefined) throw new Error("commit on unbound node");
    indexMap.get(id).truth = newValue;
  }

  return { register, validateStructure, validateRuntimeState, commit };
}
