/**
 * Case 4 - Performance measurement
 *
 * 3-way 비교 : innerHTML swap, keyed reconcile, identity reconciliation
 *
 * 측정 항목
 *  1) Reconstruction time (ms)        : 노드 수별 reconstruction 1회 비용
 *  2) Payload size (bytes)             : server -> client 전송 크기
 *                                         - innerHTML : HTML fragment
 *                                         - keyed     : JSON entity tree (with key)
 *                                         - identity  : JSON entity tree (with id)
 *
 * Node count : 10, 50, 100, 500, 1000, 2000
 */

const { JSDOM } = require("jsdom");
const { performance } = require("perf_hooks");

const NODE_COUNTS = [10, 50, 100, 500, 1000, 2000];
const REPEAT = 7;
const WARMUP = 2;

// ============================================================
// Tree builders
// ============================================================
function buildIdentityTree(n) {
  const children = [];
  for (let i = 0; i < n; i++) {
    children.push({
      id: `e-${i}`,
      tag: "input",
      attrs: { type: "text", name: `f-${i}`, value: `v-${i}` },
      children: [],
    });
  }
  return { children };
}
function buildKeyedTree(n) {
  const children = [];
  for (let i = 0; i < n; i++) {
    children.push({
      key: `k-${i}`,
      tag: "input",
      attrs: { type: "text", name: `f-${i}`, value: `v-${i}` },
      children: [],
    });
  }
  return { children };
}
function buildHTMLFragment(n) {
  let html = "";
  for (let i = 0; i < n; i++) {
    html += `<input type="text" name="f-${i}" value="v-${i}">`;
  }
  return html;
}

// 같은 entity 의 attribute만 변경된 reconstruction 입력
function buildUpdatedIdentityTree(n) {
  const children = [];
  for (let i = 0; i < n; i++) {
    children.push({
      id: `e-${i}`,
      tag: "input",
      attrs: { type: "text", name: `f-${i}`, value: `v-${i}`, maxlength: "64" },
      children: [],
    });
  }
  return { children };
}
function buildUpdatedKeyedTree(n) {
  const children = [];
  for (let i = 0; i < n; i++) {
    children.push({
      key: `k-${i}`,
      tag: "input",
      attrs: { type: "text", name: `f-${i}`, value: `v-${i}`, maxlength: "64" },
      children: [],
    });
  }
  return { children };
}
function buildUpdatedHTMLFragment(n) {
  let html = "";
  for (let i = 0; i < n; i++) {
    html += `<input type="text" name="f-${i}" value="v-${i}" maxlength="64">`;
  }
  return html;
}

// ============================================================
// Models (case4_experiment.js와 동일, 단독 사용을 위해 인라인)
// ============================================================
function applyInnerHTML(parent, newHtml) {
  parent.innerHTML = newHtml;
}

function applyKeyed(parent, newTree, doc) {
  function reconcileChildren(parentDom, newChildren) {
    const existing = new Map();
    for (let i = 0; i < parentDom.children.length; i++) {
      const ch = parentDom.children[i];
      const k = ch.getAttribute("data-key");
      if (k) existing.set(k, ch);
    }
    const used = new Set();
    const finalNodes = [];
    for (const newChild of newChildren) {
      let node = existing.get(newChild.key);
      if (node) {
        for (const k of Object.keys(newChild.attrs || {})) {
          node.setAttribute(k, newChild.attrs[k]);
        }
        used.add(newChild.key);
      } else {
        node = doc.createElement(newChild.tag);
        if (newChild.key) node.setAttribute("data-key", newChild.key);
        for (const k of Object.keys(newChild.attrs || {})) {
          node.setAttribute(k, newChild.attrs[k]);
        }
      }
      finalNodes.push(node);
      if (newChild.children && newChild.children.length > 0) {
        reconcileChildren(node, newChild.children);
      }
    }
    for (const [k, n] of existing) {
      if (!used.has(k) && n.parentNode) n.parentNode.removeChild(n);
    }
    for (const n of finalNodes) parentDom.appendChild(n);
  }
  reconcileChildren(parent, newTree.children || []);
}

function createIdentityReconciler() {
  const indexMap = new Map();
  const weakNodeMap = new WeakMap();

  function mount(parent, tree, doc) {
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
    for (const child of tree.children || []) {
      parent.appendChild(build(child));
    }
  }

  function reconstruct(parent, newTree, doc) {
    function reconcile(parentDom, newChildren) {
      const newIdSet = new Set();
      const finalNodes = [];
      for (const newChild of newChildren) {
        newIdSet.add(newChild.id);
        let node;
        const existing = indexMap.get(newChild.id);
        if (existing) {
          node = existing.node;
          for (const k of Object.keys(newChild.attrs || {})) {
            node.setAttribute(k, newChild.attrs[k]);
          }
          existing.entity = newChild;
        } else {
          node = doc.createElement(newChild.tag);
          for (const k of Object.keys(newChild.attrs || {})) {
            node.setAttribute(k, newChild.attrs[k]);
          }
          indexMap.set(newChild.id, { entity: newChild, node });
          weakNodeMap.set(node, newChild.id);
        }
        finalNodes.push({ node, entity: newChild });
      }
      const existingNodes = [];
      for (let i = 0; i < parentDom.children.length; i++) existingNodes.push(parentDom.children[i]);
      for (const oldNode of existingNodes) {
        const oldId = weakNodeMap.get(oldNode);
        if (oldId && !newIdSet.has(oldId)) {
          indexMap.delete(oldId);
          if (oldNode.parentNode) oldNode.parentNode.removeChild(oldNode);
        }
      }
      for (const { node, entity } of finalNodes) {
        parentDom.appendChild(node);
        if (entity.children && entity.children.length > 0) {
          reconcile(node, entity.children);
        }
      }
    }
    reconcile(parent, newTree.children || []);
  }

  return { mount, reconstruct };
}

// ============================================================
// Timing helper
// ============================================================
function measure(setup, run) {
  for (let i = 0; i < WARMUP; i++) {
    const ctx = setup();
    run(ctx);
    if (ctx.cleanup) ctx.cleanup();
  }
  const samples = [];
  for (let i = 0; i < REPEAT; i++) {
    const ctx = setup();
    const t0 = performance.now();
    run(ctx);
    const t1 = performance.now();
    samples.push(t1 - t0);
    if (ctx.cleanup) ctx.cleanup();
  }
  samples.sort((a, b) => a - b);
  return samples.reduce((a, b) => a + b, 0) / samples.length;
}

// ============================================================
// Experiment
// ============================================================
const rows = [];
const payloadRows = [];

for (const N of NODE_COUNTS) {
  // ---- payload size ----
  const idTree = buildIdentityTree(N);
  const updatedIdTree = buildUpdatedIdentityTree(N);
  const keyedTree = buildKeyedTree(N);
  const updatedKeyedTree = buildUpdatedKeyedTree(N);
  const html = buildHTMLFragment(N);
  const updatedHtml = buildUpdatedHTMLFragment(N);

  payloadRows.push({
    nodes: N,
    innerHTML_bytes:  Buffer.byteLength(updatedHtml, "utf8"),
    keyed_bytes:      Buffer.byteLength(JSON.stringify(updatedKeyedTree), "utf8"),
    identity_bytes:   Buffer.byteLength(JSON.stringify(updatedIdTree), "utf8"),
  });

  // ---- reconstruction time ----

  // (A) innerHTML
  const tA = measure(
    () => {
      const dom = new JSDOM(`<!doctype html><html><body><form id="p"></form></body></html>`);
      const doc = dom.window.document;
      const parent = doc.getElementById("p");
      parent.innerHTML = html;
      return { parent, doc, dom, cleanup: () => dom.window.close() };
    },
    (ctx) => applyInnerHTML(ctx.parent, updatedHtml)
  );

  // (B) keyed reconcile
  const tB = measure(
    () => {
      const dom = new JSDOM(`<!doctype html><html><body><form id="p"></form></body></html>`);
      const doc = dom.window.document;
      const parent = doc.getElementById("p");
      applyKeyed(parent, keyedTree, doc);
      return { parent, doc, dom, cleanup: () => dom.window.close() };
    },
    (ctx) => applyKeyed(ctx.parent, updatedKeyedTree, ctx.doc)
  );

  // (C) identity reconciliation
  const tC = measure(
    () => {
      const dom = new JSDOM(`<!doctype html><html><body><form id="p"></form></body></html>`);
      const doc = dom.window.document;
      const parent = doc.getElementById("p");
      const reconciler = createIdentityReconciler();
      reconciler.mount(parent, idTree, doc);
      return { parent, doc, reconciler, dom, cleanup: () => dom.window.close() };
    },
    (ctx) => ctx.reconciler.reconstruct(ctx.parent, updatedIdTree, ctx.doc)
  );

  rows.push({
    nodes: N,
    innerHTML_ms:    +tA.toFixed(3),
    keyed_ms:        +tB.toFixed(3),
    identity_ms:     +tC.toFixed(3),
    innerHTML_us_per_node: +((tA * 1000) / N).toFixed(3),
    keyed_us_per_node:     +((tB * 1000) / N).toFixed(3),
    identity_us_per_node:  +((tC * 1000) / N).toFixed(3),
  });
}

console.log("\n=== Case 4 Performance ===\n");

console.log("--- Reconstruction time (mean of " + REPEAT + " runs) ---");
console.table(rows);

console.log("\n--- Payload size ---");
console.table(payloadRows);

const last = rows[rows.length - 1];
const lastP = payloadRows[payloadRows.length - 1];
console.log("\n--- Summary at " + last.nodes + " nodes ---");
console.log(`  innerHTML swap     : ${last.innerHTML_ms} ms / ${(lastP.innerHTML_bytes/1000).toFixed(1)} KB`);
console.log(`  keyed reconcile    : ${last.keyed_ms} ms / ${(lastP.keyed_bytes/1000).toFixed(1)} KB`);
console.log(`  identity (proposed): ${last.identity_ms} ms / ${(lastP.identity_bytes/1000).toFixed(1)} KB`);

require("fs").writeFileSync(
  "/home/claude/exp_case1/case4_overhead.json",
  JSON.stringify({ time: rows, payload: payloadRows }, null, 2)
);
console.log("\nJSON result -> /home/claude/exp_case1/case4_overhead.json");
