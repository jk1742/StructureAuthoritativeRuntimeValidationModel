/* 
 * src/identity.mjs — Reconstruction Authority + Identity Reconciler (Model C)
 */

export function createReconstructionAuthority() {
  // lineageToken -> { ids: Map<slot, id>, revision }
  const lineages = new Map();
  const issuedIds = new Set();
  let idCounter = 0;

  function issue(lineageToken, shape) {
    let lineage = lineages.get(lineageToken);
    if (!lineage) {
      lineage = { ids: new Map(), revision: 0 };
      lineages.set(lineageToken, lineage);
    }
    lineage.revision += 1;

    function stamp(node) {
      let id = lineage.ids.get(node.slot);
      if (!id) {
        id = `auth:${lineageToken}:${node.slot}#${++idCounter}`;
        lineage.ids.set(node.slot, id);
        issuedIds.add(id);
      }
      return {
        id,
        tag: node.tag,
        attrs: node.attrs || {},
        revision: lineage.revision,
        children: (node.children || []).map(stamp),
      };
    }
    return { children: (shape.children || []).map(stamp) };
  }

  function isIssued(id) {
    return issuedIds.has(id);
  }

  return { issue, isIssued};
}

export function createIdentityReconciler(authority) {
  const indexMap = new Map(); // entity.id -> { entity, node }
  const weakNodeMap = new WeakMap(); // node -> entity.id

  function mount(parent, tree, doc) {
    function build(e) {
      const el = doc.createElement(e.tag);
      for (const a of Object.keys(e.attrs || {})) el.setAttribute(a, e.attrs[a]);
      indexMap.set(e.id, { entity: e, node: el });
      weakNodeMap.set(el, e.id);
      for (const c of e.children || []) el.appendChild(build(c));
      return el;
    }
    for (const c of tree.children || []) parent.appendChild(build(c));
  }

  /**
   *   { status, reused[], created[], rejected[{ position, staleId, canonicalId, reason, action }] }
   *   reason: "new-lineage"(R2) | "forged-id-not-issued"(R3)
   *   action: "recreated"(R2) | "discarded"(R3)
   */
  function reconstruct(parent, newTree, doc, skip = false) {
    const verdict = { status: "RECONSTRUCTED", reused: [], created: [], rejected: [] };
    const newChildren = newTree.children || [];
    const stale = Array.from(parent.children);
    const newIdSet = new Set();
    const preserveStaleIds = new Set();
    const finalNodes = [];

    newChildren.forEach((nc, i) => {
      newIdSet.add(nc.id);
      const hit = indexMap.get(nc.id);
      const authentic = authority.isIssued(nc.id);

      if (hit && authentic) {
        const node = hit.node;
        for (const a of Object.keys(nc.attrs || {})) {
          if (skip && node.getAttribute(a) === String(nc.attrs[a])) continue;
          node.setAttribute(a, nc.attrs[a]);
        }
        weakNodeMap.set(node, nc.id);
        verdict.reused.push(nc.id);
        finalNodes.push(node);
      } else if (authentic) {
        const prior = stale[i];
        if (prior) {
          const priorId = weakNodeMap.get(prior);
          if (priorId && priorId !== nc.id) {
            verdict.status = "RECONSTRUCTION_REJECTED";
            verdict.rejected.push({ position: i, staleId: priorId, canonicalId: nc.id, reason: "new-lineage", action: "recreated" });
          }
        }
        const node = doc.createElement(nc.tag);
        for (const a of Object.keys(nc.attrs || {})) node.setAttribute(a, nc.attrs[a]);
        indexMap.set(nc.id, { entity: nc, node });
        weakNodeMap.set(node, nc.id);
        verdict.created.push(nc.id);
        finalNodes.push(node);
      } else {
        const prior = stale[i];
        const priorId = prior ? weakNodeMap.get(prior) : null;
        verdict.status = "RECONSTRUCTION_REJECTED";
        verdict.rejected.push({ position: i, staleId: priorId || null, canonicalId: nc.id, reason: "forged-id-not-issued", action: "discarded" });
        newIdSet.delete(nc.id);
        if (prior && priorId) { preserveStaleIds.add(priorId); finalNodes.push(prior); }
      }
    });

    for (const old of stale) {
      const oid = weakNodeMap.get(old);
      if (oid && !newIdSet.has(oid) && !preserveStaleIds.has(oid)) {
        indexMap.delete(oid);
        if (old.parentNode) old.remove();
      }
    }
    for (let i = 0; i < finalNodes.length; i++) {
      const n = finalNodes[i];
      if (skip && parent.children[i] === n) continue;
      parent.appendChild(n);
    }
    return verdict;
  }

  return { mount, reconstruct};
}
