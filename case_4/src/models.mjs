/* 
 * src/models.mjs — Baseline reconcilers (Model A / B / D)
 */

export const InnerHTMLSwap = {
  apply(parent, newHtml) {
    parent.innerHTML = newHtml;
  },
};

function reconcileByAttr(parentDom, newChildren, domAttr, treeField, doc, skip = false) {
  const existing = new Map();
  for (const ch of Array.from(parentDom.children)) {
    const k = ch.getAttribute(domAttr);
    if (k) existing.set(k, ch);
  }
  const used = new Set();
  const finalNodes = [];

  for (const nc of newChildren) {
    const matchKey = nc[treeField];
    let node = existing.get(matchKey);
    if (node) {
      for (const a of Object.keys(nc.attrs || {})) {
        if (skip && node.getAttribute(a) === String(nc.attrs[a])) continue;
        node.setAttribute(a, nc.attrs[a]);
      }
      used.add(matchKey);
    } else {
      node = doc.createElement(nc.tag);
      if (matchKey != null) node.setAttribute(domAttr, matchKey);
      for (const a of Object.keys(nc.attrs || {})) node.setAttribute(a, nc.attrs[a]);
    }
    finalNodes.push(node);
  }
  for (const [k, n] of existing) if (!used.has(k) && n.parentNode) n.remove();
  for (let i = 0; i < finalNodes.length; i++) {
    const n = finalNodes[i];
    if (skip && parentDom.children[i] === n) continue;
    parentDom.appendChild(n);
  }
}

export const KeyedReconcile = {
  apply(parent, tree, doc, skip = false) {
    reconcileByAttr(parent, tree.children || [], "data-key", "key", doc, skip);
  },
};

export const ServerIdReconcile = {
  apply(parent, tree, doc, skip = false) {
    reconcileByAttr(parent, tree.children || [], "data-server-id", "serverId", doc, skip);
  },
};
