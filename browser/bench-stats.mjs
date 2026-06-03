// bench-stats.mjs
// Shared paired-ratio measurement + multi-run aggregation for all cases.
//
// WHY paired: measuring baseline and proposed in ADJACENT timed windows and
// taking the ratio in place cancels common-mode factors (CPU frequency scaling,
// momentary load) that otherwise inflate run-to-run ratio variance.
//
// WHY median + IQR over many runs: the dominant noise is systematic (JIT state,
// GC, scheduler), which repetition within one run does not remove. So we repeat
// the WHOLE measurement as `runs` independent rounds and report the median and
// inter-quartile range across runs --- robust to the outlier-shaped noise we saw.
//
// Per-window timing is auto-calibrated past the engine's clamped performance.now()
// resolution (inner repeat K), so each timed window is meaningful even when one
// pass would read as 0.

export const DEFAULT_REPEAT = 30; // paired ratios per run
export const DEFAULT_WARMUP = 3;
export const DEFAULT_RUNS = 10; // independent rounds (run-to-run variance)

// Time one window: K auto-calibrated, returns per-op ms.
// `prepareBatch(k)` returns { runs, cleanup? }: runs is an array of k run-closures
// (build time EXCLUDED from timing); cleanup() (optional) releases per-context
// resources AFTER timing (e.g. JSDOM window.close() to avoid heap growth). For
// idempotent ops build ONE context and return k closures over it; for mutating
// ops build k FRESH contexts.
function timeWindow(prepareBatch, now, targetMs) {
  let k = 1;
  for (;;) {
    const batch = prepareBatch(k);
    const runs = Array.isArray(batch) ? batch : batch.runs;
    const cleanup = Array.isArray(batch) ? null : batch.cleanup;
    const t0 = now();
    for (let i = 0; i < runs.length; i++) runs[i]();
    const dt = now() - t0;
    if (cleanup) cleanup();
    if (dt >= targetMs || k >= 2000) return dt / runs.length;
    const factor = dt > 0 ? Math.ceil((targetMs / dt) * 1.2) : 8;
    k = Math.max(k + 1, k * factor);
  }
}

function quantile(sorted, q) {
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}
function summarize(values) {
  const s = [...values].sort((a, b) => a - b);
  return {
    median: +quantile(s, 0.5).toFixed(4),
    q1: +quantile(s, 0.25).toFixed(4),
    q3: +quantile(s, 0.75).toFixed(4),
    min: +s[0].toFixed(4),
    max: +s[s.length - 1].toFixed(4),
    n: s.length,
  };
}

// Paired ratio measurement for ONE node count.
//   prepareBaseline / prepareProposed: prepareBatch(k) -> array of k run-closures.
// Returns { ratio: {median,q1,q3,...}, baseline_ms: {...}, proposed_ms: {...} }
// where ratio = proposed / baseline, computed PER paired window then aggregated.
export function pairedMeasure({ prepareBaseline, prepareProposed, now, repeat = DEFAULT_REPEAT, warmup = DEFAULT_WARMUP, runs = DEFAULT_RUNS, targetMs = 5 }) {
  const makeBaselineRun = prepareBaseline, makeProposedRun = prepareProposed;
  // warmup (untimed)
  for (let w = 0; w < warmup; w++) { timeWindow(makeBaselineRun, now, targetMs); timeWindow(makeProposedRun, now, targetMs); }

  const runRatios = [];   // median ratio per independent run
  const runBase = [];     // median baseline ms per run
  const runProp = [];     // median proposed ms per run
  for (let r = 0; r < runs; r++) {
    const ratios = [], bases = [], props = [];
    for (let i = 0; i < repeat; i++) {
      // adjacent windows -> in-place ratio cancels common-mode factors
      const b = timeWindow(makeBaselineRun, now, targetMs);
      const p = timeWindow(makeProposedRun, now, targetMs);
      bases.push(b); props.push(p);
      if (b > 0) ratios.push(p / b);
    }
    ratios.sort((a, b) => a - b); bases.sort((a, b) => a - b); props.sort((a, b) => a - b);
    runRatios.push(quantile(ratios, 0.5));
    runBase.push(quantile(bases, 0.5));
    runProp.push(quantile(props, 0.5));
  }
  return {
    ratio: summarize(runRatios),       // proposed / baseline across runs
    baseline_ms: summarize(runBase),
    proposed_ms: summarize(runProp),
    config: { repeat, warmup, runs, targetMs },
  };
}
