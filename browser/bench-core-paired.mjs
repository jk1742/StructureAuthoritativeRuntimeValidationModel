// bench-core-paired.mjs
// Unified paired-ratio benchmark for Case 1 / 3 / 4. Reuses the verbatim model
// logic; the only new thing is the measurement protocol (paired adjacent
// windows -> in-place ratio -> median over many independent runs), provided by
// bench-stats.mjs. makeDoc()/now() are injected (browser or jsdom).
//
//   runPaired({ case: "case1"|"case3"|"case4", makeDoc, now, nodeCounts?, repeat?, warmup?, runs? })
//
// ratio reported = proposed / baseline, where:
//   case1: baseline = A2 optimized (meta + Map index),  proposed = B registry
//   case3: baseline = snapshot-diff validate,           proposed = identity validate
//   case4: baseline = keyed reconcile,                  proposed = identity reconcile
// case4 also returns deterministic payload (engine-independent).

import { pairedMeasure } from "./bench-stats.mjs";

const NODES = {
  case1: [10, 50, 100, 200, 500, 1000, 2000],
  case3: [10, 50, 100, 500, 1000, 2000],
  case4: [10, 50, 100, 500, 1000, 2000],
};
const utf8Len = (s) => new TextEncoder().encode(s).length;
const idem = (run) => (k) => { const a = new Array(k); for (let i = 0; i < k; i++) a[i] = run; return a; };

// ---------------- Case 1: validation time (A2 optimized vs B registry) -------
function c1Build(doc, n) {
  const form = doc.createElement("form"); form.id = "f";
  const inputs = [];
  for (let i = 0; i < n; i++) {
    const inp = doc.createElement("input"); inp.id = `field-${i}`; inp.type = "text"; inp.setAttribute("value", `val-${i}`);
    form.appendChild(inp); inputs.push({ id: `field-${i}`, truth: `val-${i}` });
  }
  doc.body.appendChild(form); return inputs;
}
function c1Baseline(makeDoc, n) { // A2 optimized: meta + Map index
  const doc = makeDoc(); const inputs = c1Build(doc, n);
  const metaIndex = new Map();
  for (const { id, truth } of inputs) { const m = doc.createElement("meta"); m.setAttribute("name", `truth:${id}`); m.setAttribute("content", truth); doc.head.appendChild(m); metaIndex.set(id, m); }
  return idem(() => { let ok = 0; for (const { id } of inputs) { const node = doc.getElementById(id); const meta = metaIndex.get(id); const t = meta ? meta.getAttribute("content") : null; if (String(node.getAttribute("value") ?? "") === String(t ?? "")) ok++; } return ok; });
}
function c1Proposed(makeDoc, n) { // B registry
  const doc = makeDoc(); const inputs = c1Build(doc, n);
  const indexMap = new Map(), weakNodeMap = new WeakMap(); let seq = 0; const nodes = [];
  for (const { id, truth } of inputs) { const node = doc.getElementById(id); const eid = `e-${(++seq).toString(36)}`; indexMap.set(eid, { truth }); weakNodeMap.set(node, eid); nodes.push(node); }
  return idem(() => { let ok = 0; for (const node of nodes) { const eid = weakNodeMap.get(node); if (!eid) continue; const e = indexMap.get(eid); if (e && String(node.getAttribute("value") ?? "") === String(e.truth ?? "")) ok++; } return ok; });
}

// ---------------- Case 3: snapshot-diff vs identity-continuity ---------------
function c3Build(doc, n) {
  const form = doc.createElement("form"); form.id = "f";
  for (let i = 0; i < n; i++) { const inp = doc.createElement("input"); inp.id = `i-${i}`; inp.type = "text"; inp.setAttribute("value", `v-${i}`); form.appendChild(inp); }
  doc.body.appendChild(form); return form;
}
function snapshot(root) { const out = []; (function w(node, p) { if (node.nodeType !== 1) return; const tag = node.tagName.toLowerCase(); const v = (tag === "input" || tag === "textarea") ? String(node.getAttribute("value") ?? "") : null; out.push({ p, tag, v }); const k = node.children; for (let i = 0; i < k.length; i++) w(k[i], p + "." + i); })(root, "0"); return out; }
function snapDiff(a, b) { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) { if (a[i].p !== b[i].p || a[i].tag !== b[i].tag || a[i].v !== b[i].v) return false; } return true; }
function c3Baseline(makeDoc, n) { const doc = makeDoc(); const root = c3Build(doc, n); const base = snapshot(root); return idem(() => { snapDiff(base, snapshot(root)); }); }
function c3Proposed(makeDoc, n) {
  const doc = makeDoc(); const root = c3Build(doc, n);
  const indexMap = new Map(), weakNodeMap = new WeakMap(); let seq = 0;
  (function reg(node) { if (node.nodeType !== 1) return; const id = `e-${(++seq).toString(36)}`; const tag = node.tagName.toLowerCase(); const truth = (tag === "input" || tag === "textarea") ? String(node.getAttribute("value") ?? "") : null; indexMap.set(id, { tag, truth }); weakNodeMap.set(node, id); const k = node.children; for (let i = 0; i < k.length; i++) reg(k[i]); })(root);
  return idem(() => { let ok = true; (function w(node) { if (node.nodeType !== 1) return; const id = weakNodeMap.get(node); if (!id) { ok = false; return; } const e = indexMap.get(id); if (!e || e.tag !== node.tagName.toLowerCase()) { ok = false; return; } if (e.truth !== null && String(node.getAttribute("value") ?? "") !== e.truth) { ok = false; return; } const k = node.children; for (let i = 0; i < k.length; i++) w(k[i]); })(root); return ok; });
}

// ---------------- Case 4: keyed vs identity reconcile (fresh per op) ----------
function c4Trees(n, extra) {
  const idc = [], kc = []; for (let i = 0; i < n; i++) { const a = { type: "text", name: `f-${i}`, value: `v-${i}` }; if (extra) a.maxlength = "64"; idc.push({ id: `e-${i}`, tag: "input", attrs: a, children: [] }); kc.push({ key: `k-${i}`, tag: "input", attrs: a, children: [] }); }
  return { id: { children: idc }, keyed: { children: kc } };
}
function freshParent(makeDoc) { const doc = makeDoc(); const f = doc.createElement("form"); f.id = "p"; doc.body.appendChild(f); return { doc, parent: f }; }
// Close a document's window if it has one (JSDOM: doc.defaultView.close releases
// memory; browser createHTMLDocument: defaultView is null -> no-op).
function closeDoc(doc) { const w = doc && doc.defaultView; if (w && typeof w.close === "function") { try { w.close(); } catch {} } }
function applyKeyed(parent, tree, doc) {
  (function rec(pd, kids) { const ex = new Map(); for (let i = 0; i < pd.children.length; i++) { const c = pd.children[i]; const k = c.getAttribute("data-key"); if (k) ex.set(k, c); } const used = new Set(), fin = [];
    for (const nc of kids) { let node = ex.get(nc.key); if (node) { for (const k of Object.keys(nc.attrs || {})) node.setAttribute(k, nc.attrs[k]); used.add(nc.key); } else { node = doc.createElement(nc.tag); if (nc.key) node.setAttribute("data-key", nc.key); for (const k of Object.keys(nc.attrs || {})) node.setAttribute(k, nc.attrs[k]); } fin.push(node); if (nc.children && nc.children.length) rec(node, nc.children); }
    for (const [k, nd] of ex) if (!used.has(k) && nd.parentNode) nd.parentNode.removeChild(nd); for (const nd of fin) pd.appendChild(nd); })(parent, tree.children || []);
}
function makeIdentityReconciler() {
  const indexMap = new Map(), weakNodeMap = new WeakMap();
  function mount(parent, tree, doc) { (function b(kids, pd) { for (const e of kids) { const el = doc.createElement(e.tag); for (const k of Object.keys(e.attrs || {})) el.setAttribute(k, e.attrs[k]); indexMap.set(e.id, { node: el }); weakNodeMap.set(el, e.id); pd.appendChild(el); if (e.children && e.children.length) b(e.children, el); } })(tree.children || [], parent); }
  function reconstruct(parent, tree, doc) { (function rec(pd, kids) { const ns = new Set(), fin = []; for (const nc of kids) { ns.add(nc.id); let node; const ex = indexMap.get(nc.id); if (ex) { node = ex.node; for (const k of Object.keys(nc.attrs || {})) node.setAttribute(k, nc.attrs[k]); } else { node = doc.createElement(nc.tag); for (const k of Object.keys(nc.attrs || {})) node.setAttribute(k, nc.attrs[k]); indexMap.set(nc.id, { node }); weakNodeMap.set(node, nc.id); } fin.push({ node, e: nc }); }
    const exNodes = []; for (let i = 0; i < pd.children.length; i++) exNodes.push(pd.children[i]); for (const on of exNodes) { const oid = weakNodeMap.get(on); if (oid && !ns.has(oid)) { indexMap.delete(oid); if (on.parentNode) on.parentNode.removeChild(on); } }
    for (const { node, e } of fin) { pd.appendChild(node); if (e.children && e.children.length) rec(node, e.children); } })(parent, tree.children || []); }
  return { mount, reconstruct };
}
// Case 4 reuses ONE document per node count and builds a fresh <form> subtree
// per op (cheap), instead of a new JSDOM document per op (expensive + leaky).
// cleanup() detaches the per-window forms after timing.
function c4BaselineBatch(makeDoc, n) {
  const keyed = c4Trees(n, false).keyed, k1 = c4Trees(n, true).keyed;
  const doc = makeDoc();
  return (k) => {
    const forms = new Array(k);
    for (let j = 0; j < k; j++) { const f = doc.createElement("form"); doc.body.appendChild(f); applyKeyed(f, keyed, doc); forms[j] = f; }
    const runs = forms.map((f) => () => applyKeyed(f, k1, doc));
    return { runs, cleanup: () => { for (const f of forms) if (f.parentNode) f.parentNode.removeChild(f); } };
  };
}
function c4ProposedBatch(makeDoc, n) {
  const id = c4Trees(n, false).id, i1 = c4Trees(n, true).id;
  const doc = makeDoc();
  return (k) => {
    const forms = new Array(k); const runs = new Array(k);
    for (let j = 0; j < k; j++) { const f = doc.createElement("form"); doc.body.appendChild(f); const rec = makeIdentityReconciler(); rec.mount(f, id, doc); forms[j] = f; runs[j] = () => rec.reconstruct(f, i1, doc); }
    return { runs, cleanup: () => { for (const f of forms) if (f.parentNode) f.parentNode.removeChild(f); } };
  };
}

export function runPaired({ case: kase, makeDoc, now, nodeCounts, repeat = 30, warmup = 3, runs = 10, targetMs = 5 } = {}) {
  if (typeof makeDoc !== "function" || typeof now !== "function") throw new Error("runPaired: makeDoc()/now() required");
  const counts = nodeCounts || NODES[kase];
  if (!counts) throw new Error("runPaired: unknown case " + kase);

  const rows = [];
  for (const n of counts) {
    let prepareBaseline, prepareProposed;
    // build prepareBatch per case
    if (kase === "case1") { prepareBaseline = c1Baseline(makeDoc, n); prepareProposed = c1Proposed(makeDoc, n); }
    else if (kase === "case3") { prepareBaseline = c3Baseline(makeDoc, n); prepareProposed = c3Proposed(makeDoc, n); }
    else if (kase === "case4") { prepareBaseline = c4BaselineBatch(makeDoc, n); prepareProposed = c4ProposedBatch(makeDoc, n); }

    const m = pairedMeasure({ prepareBaseline, prepareProposed, now, repeat, warmup, runs, targetMs });
    rows.push({ nodes: n, ratio_median: m.ratio.median, ratio_iqr: [m.ratio.q1, m.ratio.q3], baseline_ms_median: m.baseline_ms.median, proposed_ms_median: m.proposed_ms.median });
  }

  const result = { case: kase, paired: "proposed/baseline", rows, config: { nodeCounts: counts, repeat, warmup, runs, targetMs } };

  if (kase === "case4") {
    result.payload = counts.map((n) => { const t = c4Trees(n, true); const html = (function (m) { let h = ""; for (let i = 0; i < m; i++) h += `<input type="text" name="f-${i}" value="v-${i}" maxlength="64">`; return h; })(n); const kb = utf8Len(JSON.stringify(t.keyed)), ib = utf8Len(JSON.stringify(t.id)); return { nodes: n, innerHTML_bytes: utf8Len(html), keyed_bytes: kb, identity_bytes: ib, identity_vs_keyed_pct: +(((ib - kb) / kb) * 100).toFixed(2) }; });
  }
  return result;
}
