// case3_bench_core.mjs
// Case 3 ONLY — runtime overhead (timed): snapshot-diff baseline vs identity-continuity.
import { pairedMeasure } from "./bench-stats.mjs";

export const NODES_CASE3 = [10, 50, 100, 200, 500, 1000, 2000];
const idem = (run) => (k) => { const a = new Array(k); for (let i = 0; i < k; i++) a[i] = run; return a; };
function closeDoc(doc) { const w = doc && doc.defaultView; if (w && typeof w.close === "function") { try { w.close(); } catch {} } }
function withDispose(prep, ...docs) { prep.dispose = () => { for (const d of docs) closeDoc(d); }; return prep; }

function c3Build(doc, n) {
  const form = doc.createElement("form"); form.id = "f";
  for (let i = 0; i < n; i++) { const inp = doc.createElement("input"); inp.id = `field-${i}`; inp.type = "text"; inp.setAttribute("value", `val-${i}`); form.appendChild(inp); }
  doc.body.appendChild(form); return form;
}
function snapshot(root) {
  const out = [];
  (function w(node, p) {
    if (node.nodeType !== 1) return;
    const tag = node.tagName.toLowerCase();
    const v = (tag === "input" || tag === "textarea") ? String(node.getAttribute("value") ?? "") : null;
    out.push({ p, tag, v });
    const k = node.children; for (let i = 0; i < k.length; i++) w(k[i], p + "." + i);
  })(root, "0");
  return out;
}
function snapDiff(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) { if (a[i].p !== b[i].p || a[i].tag !== b[i].tag || a[i].v !== b[i].v) return false; }
  return true;
}
// baseline: snapshot + diff (tree walk)
function c3Baseline(makeDoc, n) {
  const doc = makeDoc(); const root = c3Build(doc, n); const base = snapshot(root);
  return withDispose(idem(() => { snapDiff(base, snapshot(root)); }), doc);
}
// proposed: identity-continuity walk (tree walk + WeakMap/Map binding check)
function c3Proposed(makeDoc, n) {
  const doc = makeDoc(); const root = c3Build(doc, n);
  const indexMap = new Map(), weakNodeMap = new WeakMap(); let seq = 0;
  (function reg(node) {
    if (node.nodeType !== 1) return;
    const id = `e-${(++seq).toString(36)}`; const tag = node.tagName.toLowerCase();
    const truth = (tag === "input" || tag === "textarea") ? String(node.getAttribute("value") ?? "") : null;
    indexMap.set(id, { tag, truth }); weakNodeMap.set(node, id);
    const k = node.children; for (let i = 0; i < k.length; i++) reg(k[i]);
  })(root);
  return withDispose(idem(() => {
    let ok = true;
    (function w(node) {
      if (node.nodeType !== 1) return;
      const id = weakNodeMap.get(node); if (!id) { ok = false; return; }
      const e = indexMap.get(id);
      if (!e || e.tag !== node.tagName.toLowerCase()) { ok = false; return; }
      if (e.truth !== null && String(node.getAttribute("value") ?? "") !== e.truth) { ok = false; return; }
      const k = node.children; for (let i = 0; i < k.length; i++) w(k[i]);
    })(root);
    return ok;
  }), doc);
}

export function runCase3Paired({ makeDoc, now, nodeCounts, repeat = 30, warmup = 3, runs = 10, targetMs = 5 } = {}) {
  if (typeof makeDoc !== "function" || typeof now !== "function") throw new Error("runCase3Paired: makeDoc()/now() required");
  const counts = nodeCounts || NODES_CASE3;
  const rows = [];
  for (const n of counts) {
    if (typeof console !== "undefined") console.error?.(`[case3] n=${n} ...`);
    const prepareBaseline = c3Baseline(makeDoc, n);
    const prepareProposed = c3Proposed(makeDoc, n);
    const m = pairedMeasure({ prepareBaseline, prepareProposed, now, repeat, warmup, runs, targetMs });
    prepareBaseline.dispose?.(); prepareProposed.dispose?.();
    rows.push({ nodes: n, ratio_median: m.ratio.median, ratio_iqr: [m.ratio.q1, m.ratio.q3], baseline_ms_median: m.baseline_ms.median, proposed_ms_median: m.proposed_ms.median });
  }
  return { case: "case3", paired: "proposed/baseline", note: "both baseline (snapshot-diff) and proposed (identity walk) traverse the full tree per call; ratio ~1 (near parity) is a fair result, not an artifact. O(N).", rows, config: { nodeCounts: counts, repeat, warmup, runs, targetMs } };
}
