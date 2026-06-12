// case1_bench_core.mjs
// Case 1 ONLY — runtime overhead (timed) + serialized payload.
import { pairedMeasure } from "./bench-stats.mjs";
import { createRegistry } from "../../model-core.mjs";

export const NODES_CASE1 = [10, 50, 100, 200, 500, 1000, 2000];
const utf8Len = (s) => new TextEncoder().encode(s).length;
const idem = (run) => (k) => { const a = new Array(k); for (let i = 0; i < k; i++) a[i] = run; return a; };
function closeDoc(doc) { const w = doc && doc.defaultView; if (w && typeof w.close === "function") { try { w.close(); } catch {} } }
function withDispose(prep, ...docs) { prep.dispose = () => { for (const d of docs) closeDoc(d); }; return prep; }

function c1Build(doc, n) {
  const form = doc.createElement("form"); form.id = "f"; const inputs = [];
  for (let i = 0; i < n; i++) {
    const inp = doc.createElement("input"); inp.id = `field-${i}`; inp.type = "text"; inp.setAttribute("value", `val-${i}`);
    form.appendChild(inp); inputs.push({ id: `field-${i}`, truth: `val-${i}` });
  }
  doc.body.appendChild(form); return { form, inputs };
}

function canonicalTree(n) {
  const children = [];
  for (let i = 0; i < n; i++) children.push({ id: `e-field-${i}`, parentId: "e-root", order: i, type: "input", value: `val-${i}`, children: [] });
  return { id: "e-root", parentId: null, order: 0, type: "form", children };
}

function c1Baseline(makeDoc, n) {
  const doc = makeDoc(); const { inputs } = c1Build(doc, n);
  const metaIndex = new Map();
  for (const { id, truth } of inputs) { const m = doc.createElement("meta"); m.setAttribute("name", `truth:${id}`); m.setAttribute("content", truth); doc.head.appendChild(m); metaIndex.set(id, m); }
  return withDispose(idem(() => {
    let ok = 0;
    for (const { id } of inputs) {
      const node = doc.getElementById(id);
      const t = metaIndex.get(id).getAttribute("content");
      if (String(node.getAttribute("value") ?? "") === String(t ?? "")) ok++;
    }
    return ok;
  }), doc);
}

function c1Proposed(makeDoc, n) {
  const doc = makeDoc(); const { form, inputs } = c1Build(doc, n);
  const reg = createRegistry(doc);
  reg.mount(form, canonicalTree(n));
  for (const { id } of inputs) reg.commit(doc.getElementById(id));
  reg.validate(form);
  return withDispose(idem(() => { reg.validate(form); }), doc);
}

function c1Payload(makeDoc, counts) {
  return counts.map((n) => {
    const baseDoc = makeDoc(); const { inputs } = c1Build(baseDoc, n);
    for (const { id, truth } of inputs) { const m = baseDoc.createElement("meta"); m.setAttribute("name", `truth:${id}`); m.setAttribute("content", truth); baseDoc.head.appendChild(m); }
    const propDoc = makeDoc(); c1Build(propDoc, n);
    const baseBytes = utf8Len(baseDoc.documentElement.outerHTML);
    const propBytes = utf8Len(propDoc.documentElement.outerHTML);
    closeDoc(baseDoc); closeDoc(propDoc);
    return { nodes: n, baseline_nodes: 2 * n, proposed_nodes: n, baseline_bytes: baseBytes, proposed_bytes: propBytes, proposed_vs_baseline_ratio: +(propBytes / baseBytes).toFixed(4) };
  });
}

export function runCase1Paired({ makeDoc, now, nodeCounts, repeat = 30, warmup = 3, runs = 10, targetMs = 5 } = {}) {
  if (typeof makeDoc !== "function" || typeof now !== "function") throw new Error("runCase1Paired: makeDoc()/now() required");
  const counts = nodeCounts || NODES_CASE1;

  const rows = [];
  for (const n of counts) {
    if (typeof console !== "undefined") console.error?.(`[case1] n=${n} ...`);
    const prepareBaseline = c1Baseline(makeDoc, n);
    const prepareProposed = c1Proposed(makeDoc, n);
    const m = pairedMeasure({ prepareBaseline, prepareProposed, now, repeat, warmup, runs, targetMs });
    prepareBaseline.dispose?.(); prepareProposed.dispose?.();
    rows.push({ nodes: n, ratio_median: m.ratio.median, ratio_iqr: [m.ratio.q1, m.ratio.q3], baseline_ms_median: m.baseline_ms.median, proposed_ms_median: m.proposed_ms.median });
  }

  const payload = c1Payload(makeDoc, counts);
  return { case: "case1", paired: "proposed/baseline", note: "timed: real validate (structure+state) vs state-only baseline; ratio>=1 by design, O(N). Paper cites payload only.", rows, payload, config: { nodeCounts: counts, repeat, warmup, runs, targetMs } };
}
