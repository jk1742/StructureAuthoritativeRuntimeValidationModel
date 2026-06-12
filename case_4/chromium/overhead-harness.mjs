/* 
 * chromium/overhead-harness.mjs — overhead
 */
import { InnerHTMLSwap, KeyedReconcile, ServerIdReconcile } from "../src/models.mjs";
import { createReconstructionAuthority, createIdentityReconciler } from "../src/identity.mjs";
import { htmlN, keyedTreeN, serverIdTreeN, shapeN } from "../bench/builders.mjs";

const state = {};
const parentEl = () => document.getElementById("parent");

function setup(model, n) {
  const p = parentEl();
  p.innerHTML = "";
  const doc = document;
  state.model = model;
  state.i = 0;
  if (model === "A") {
    state.htmlA = htmlN(n, "a");
    state.htmlB = htmlN(n, "b");
    InnerHTMLSwap.apply(p, state.htmlA);
  } else if (model === "B") {
    state.treeA = keyedTreeN(n, "a");
    state.treeB = keyedTreeN(n, "b");
    KeyedReconcile.apply(p, state.treeA, doc, true);
  } else if (model === "D") {
    state.treeA = serverIdTreeN(n, "a");
    state.treeB = serverIdTreeN(n, "b");
    ServerIdReconcile.apply(p, state.treeA, doc, true);
  } else if (model === "C") {
    const authority = createReconstructionAuthority();
    const reconciler = createIdentityReconciler(authority);
    state.treeA = authority.issue("bench", shapeN(n, "a"));
    state.treeB = authority.issue("bench", shapeN(n, "b"));
    reconciler.mount(p, state.treeA, doc);
    state.reconciler = reconciler;
  }
}

function reconstructOnce() {
  const p = parentEl();
  const doc = document;
  const m = state.model;
  const useB = (state.i++ & 1) === 1;
  if (m === "A") InnerHTMLSwap.apply(p, useB ? state.htmlB : state.htmlA);
  else if (m === "B") KeyedReconcile.apply(p, useB ? state.treeB : state.treeA, doc, true);
  else if (m === "D") ServerIdReconcile.apply(p, useB ? state.treeB : state.treeA, doc, true);
  else if (m === "C") state.reconciler.reconstruct(p, useB ? state.treeB : state.treeA, doc, true);
}

function timeK(K) {
  const t0 = performance.now();
  for (let i = 0; i < K; i++) reconstructOnce();
  return performance.now() - t0;
}

window.c4setup = setup;
window.c4timeK = timeK;
window.__benchReady = true;