// model-core.mjs
// Structure-authoritative validation for a single <form data-role="module"> subtree.
// Registry shape (two maps):
//   - nodeToId : WeakMap  DOM node  -> entity id        (the paper's WeakNodeMap; weak, does not block GC)
//   - indexMap : Map      entity id -> canonical entity  (id -> relation/truth metadata; enumerable)
// Removal is detected by a MARK-AND-SWEEP over indexMap (no id->node map): the forward pass
// records the entity ids it reaches, and any non-text canonical entity left unreached
// corresponds to a removed node. Node references live only in the weak nodeToId map, so a
// removed subtree stays collectible -- the property the paper's WeakNodeMap is chosen for.
// (A production implementation keeps a maintained id->node map, refreshed on every legitimate
//  mutation; this artifact omits it to show the minimal weak-binding form.)
//
// The canonical entity tree is HIERARCHICAL (children nested); on load it is walked
// once to populate indexMap, and its nodes are bound to the live DOM in tree order.
//
// The entity IS the truth: a field present on the entity must match; anything not on
// the entity (style, class, text content) is free to change on the client.
// Entity shape: { id, parentId, order, type, value?, checked?, children:[...] }
//   - type "#text": existence/order only (content not validated).
//   - value / checked: runtime-state truth, updated ONLY through commit() (the demo
//     stand-in for syncFromNode). `checked` applies to checkbox/radio, `value` to
//     other value-carrying elements. A direct DOM forgery never goes through commit,
//     so it leaves the entity truth unchanged; validate detects it as a mismatch
//     whenever the forged state differs from the committed truth. (A direct write
//     that happens to equal the committed truth produces no state difference and is
//     therefore not a forgery of state.)
// entity.id is an authority-issued id carried in canonical.json (NOT the DOM id attr).

export function createRegistry(doc) {
  const nodeToId = new WeakMap();
  const indexMap = new Map();

  // Mount: walk the canonical entity tree alongside the live DOM, in tree order.
  function mount(rootNode, rootEntity) {
    indexMap.set(rootEntity.id, rootEntity);
    nodeToId.set(rootNode, rootEntity.id);
    const childEntities = rootEntity.children || [];
    const domKids = mirrorChildren(rootNode);
    for (let i = 0; i < childEntities.length; i++) {
      if (domKids[i]) mount(domKids[i], childEntities[i]);
    }
  }

  function mirrorChildren(node) {
    // A <textarea>'s text content is its runtime-state value (validated via .value),
    // not structure, so treat it as a value-carrying leaf: do not mirror its children.
    if (node.nodeType === 1 && node.tagName.toLowerCase() === "textarea") return [];
    const out = [];
    for (const n of node.childNodes) {
      if (n.nodeType === 1) out.push(n);
      else if (n.nodeType === 3 && n.textContent.trim() !== "") out.push(n);
    }
    return out;
  }
  const nodeType = (n) => (n.nodeType === 3 ? "#text" : n.tagName.toLowerCase());

  // Forward pass. Records every reached entity id into `seen` for the removal sweep.
  function validateNode(node, seen) {
    const id = nodeToId.get(node);                       // WeakNodeMap.get
    if (id === undefined)
      throw new Error("STRUCTURAL_DEVIATION: no binding (broken identity)");
    const c = indexMap.get(id);                          // indexMap.get(id) -> canonical entity
    if (!c) throw new Error("STRUCTURAL_DEVIATION: entity id not in indexMap");
    seen.add(id);                                        // mark: this canonical entity is still present

    if (c.type !== nodeType(node))
      throw new Error(`STRUCTURAL_DEVIATION: type mismatch (expected ${c.type}, got ${nodeType(node)})`);

    // Runtime-state truth (commit-updated). The canonical entity names which
    // property carries the state: `checked` for checkbox/radio, otherwise `value`.
    // A field present on the entity must match the live node; a direct DOM forgery
    // never goes through commit and so leaves the entity truth unchanged, which is
    // detected here as a value/checked mismatch.
    if (node.nodeType === 1) {
      if (c.checked !== undefined && c.checked !== null && "checked" in node) {
        if (Boolean(node.checked) !== Boolean(c.checked))
          throw new Error(`RUNTIME_STATE_FORGERY: checked expected ${JSON.stringify(Boolean(c.checked))}, got ${JSON.stringify(Boolean(node.checked))} (not committed)`);
      } else if (c.value !== undefined && c.value !== null && "value" in node) {
        if (String(node.value) !== String(c.value))
          throw new Error(`RUNTIME_STATE_FORGERY: value expected ${JSON.stringify(c.value)}, got ${JSON.stringify(node.value)} (not committed)`);
      }
    }

    // structure: position-wise child comparison (count check catches insertion/removal-under-live-parent)
    const childEntities = c.children || [];
    const domKids = mirrorChildren(node);
    if (domKids.length !== childEntities.length)
      throw new Error(`STRUCTURAL_DEVIATION: child count mismatch (canonical ${childEntities.length}, dom ${domKids.length})`);
    for (let i = 0; i < childEntities.length; i++) {
      const ce = childEntities[i];
      const dk = domKids[i];
      if (ce.type === "#text") {
        if (!dk || dk.nodeType !== 3)
          throw new Error("STRUCTURAL_DEVIATION: text node missing/displaced");
        continue;                                        // text: existence/order only
      }
      // element identity: is the node at this slot bound to the canonical entity id?
      if (!dk || nodeToId.get(dk) !== ce.id)             // reverse lookup via WeakNodeMap (was idToNode)
        throw new Error("STRUCTURAL_DEVIATION: unauthorized/displaced child");
      validateNode(dk, seen);
    }
    return true;
  }

  // Reverse pass (mark-and-sweep): a non-text canonical entity not reached by the forward
  // pass corresponds to a node removed from the tree. No node reference is held here.
  function reverseRemovalSweep(seen) {
    for (const [id, c] of indexMap) {
      if (c.type === "#text") continue;                  // text excluded (replaced on edits)
      if (!seen.has(id))
        throw new Error(`STRUCTURAL_DEVIATION: canonical entity ${id} unreached (removed node)`);
    }
    return true;
  }

  function validate(rootNode) {
    const seen = new Set();
    validateNode(rootNode, seen);
    reverseRemovalSweep(seen);
    return true;
  }

  // commit = demo stand-in for syncFromNode: the only approved path into the
  // entity's runtime-state truth (value or checked, matching the entity shape).
  function commit(node) {
    const id = nodeToId.get(node);
    if (id === undefined) throw new Error("commit on unbound node");
    const c = indexMap.get(id);
    if (c.checked !== undefined && c.checked !== null && "checked" in node) c.checked = Boolean(node.checked);
    else if (c.value !== undefined && c.value !== null && "value" in node) c.value = String(node.value);
    return true;
  }

  return { mount, validate, commit };
}