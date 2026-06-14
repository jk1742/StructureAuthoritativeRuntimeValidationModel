# Structure-Authoritative Runtime Validation for Mutable Web Interfaces

Anonymous artifact for double-blind review.

This repository contains the experiments behind the paper. The architecture treats the
browser DOM as an untrusted attack surface and moves the basis for judging legitimacy
**off** that surface: structural legitimacy is judged against a Canonical Structure
Registry (CSR) held in an application-held closure the surface cannot reach — its lineage
issued by an **External Authority** outside the runtime — and runtime-state legitimacy by
interaction provenance.

All detection verdicts are **rendering-independent** and reproduce identically on
**Chromium 148** (Blink/V8) and **Firefox 150** (Gecko/SpiderMonkey). The shared truth
model lives in the top-level `model-core.mjs`.

For a one-page summary of all results, open **`results_dashboard.html`**.

## Repository layout

```
model-core.mjs            shared canonical-structure registry (CSR)
results_dashboard.html    combined Tables 2–4 summary
case_1/                   in-DOM baseline vs. off-surface validation  (paper Table 2)
case_3/                   snapshot-diff vs. identity continuity        (paper Table 3)
case_4/                   component reconstruction consistency         (paper Table 4)
```

## Environment

Results were produced under the following environment:

| | |
|---|---|
| CPU | Intel Core i7-8565U (4 cores / 8 threads, base 1.80 GHz) |
| RAM | 15.8 GB |
| OS | Windows 11 (64-bit) |
| Power plan | High performance, CPU turbo disabled (clock held near base) |
| Node.js | v22.14.0 |
| Engines | Chromium 148.0.7778.96, Firefox 150.0.2 |
| Browser driver | Playwright 1.60.0 |
| React reference | React 18.3.1 (Case 4 overhead reference) |

This is a mobile-class CPU. For the committed runs, CPU turbo was disabled so the
clock stays near its base frequency, which reduces run-to-run drift in the median. The
paired protocol additionally times baseline and proposed in **adjacent windows** and
forms the ratio in place, so any residual momentary clock variation cancels. Reported
ratios are therefore robust to clock variation; re-running on other hardware is
expected to change absolute times but not the ratios or the order.

Detection verdicts are rendering-independent and reproduce identically across both
engines; only overhead timings depend on the machine above, which is why they are
reported as a ratio to the keyed-reconcile baseline (B = 1.0).

---

## Case 1 — In-DOM baseline vs. off-surface validation *(Table 2)*

Tests the validation model against the conventional approach of embedding the truth value
as in-DOM `<meta>` metadata. Establishes that a reference held **off** the DOM surface, in
an application-held closure, resists tampering that defeats an in-DOM reference, and that
the interaction channel admits or refuses a state change **by provenance (`isTrusted`)**,
not by value.

A capability ladder, identical outcomes on both engines:

| Level | Attack | Baseline (in-DOM) | Proposed (off-surface) |
|-------|--------|-------------------|------------------------|
| S1–S3 | property tamper (one field) | Detected (partial) | Detected |
| S4    | property + forged `<meta>` reference | **Bypassed** | Detected |
| S5    | synthetic-event channel laundering (`dispatchEvent`, `isTrusted=false`) | Bypassed | **Detected (refused)** |
| T0    | genuine user typing (`pressSequentially`, `isTrusted=true`) | — | **Accepted (valid)** |
| L2    | counterfeit entity into the closure | — | Detected (`mapsReachable=false`) |
| L3    | drive the channel from inside (excluded by threat model) | — | Bypassed |
| L4    | prototype pollution of the validator path | — | Disrupted (no forgery passes) |
| L5    | compromised External Authority | — | Undetected **by design** (threat-model boundary, not a measured attack) |

**Headline:** across the six field-level instances (S1–S3 and the three S4 fields), the
in-DOM baseline detects **3 of 6**, the proposed model **6 of 6**.

**S5 + T0 are a pair:** the same forged value is refused on a synthetic
(`isTrusted=false`) event (S5) but a genuine (`isTrusted=true`) input is accepted (T0) —
the channel gates on **provenance**, not value.

**Payload anchor:** with truth held off the DOM, the proposed document carries no
per-field metadata and serializes to about **half** the baseline's (`0.52×`). The paper
cites only this deterministic payload ratio, not a timed speed claim (the proposed model
does strictly more work — a full structure walk — at the same `O(N)`).

**Files**

| File | Role |
|------|------|
| `case1_ladder_bench.html` | Browser harness; event-delegation **channel gate** (`isTrusted !== true` → refuse) between bootstrap commit and `window.__app`. |
| `case1_ladder_browser_experiment.mjs` | Drives S1–S5, L2–L4, T0 in real Chromium/Firefox; emits the ladder result JSON. |
| `case1_bench_core.mjs` | Timed overhead + payload (paper cites payload only). |
| `bench-stats.mjs` | Shared paired-ratio measurement (median + IQR, 30×10). |
| `case1_paired_harness.html`, `case1_paired_run.mjs` | Paired timing harness. |
| `result/case1_ladder_result_browser.json` | Ladder verdicts (S1–S5, L2–L4, T0) per engine. |
| `result/case1_paired_chromium.json`, `result/case1_paired_firefox.json` | Timing/payload results. |

`commit()` and `model-core.mjs` are **unchanged** by the gate — the provenance check lives
at the event-delegation entry point in the harness, not in the registry.

**Run:** # from case_1/ `node case1_ladder_browser_experiment.mjs`

---

## Case 3 — Snapshot-diff vs. identity continuity *(Table 3)*

Contrasts a flat **snapshot-diff** baseline with the model's **identity-continuity**
notion on a structurally minimal pair of models. Identity continuity retains every
detection the snapshot approach offers **on this set**, while additionally catching an
identical-form replacement the snapshot misses.

| Scenario | Description | Snapshot-diff | Identity continuity |
|----------|-------------|---------------|---------------------|
| T1 | identical-form replacement (same tag/attrs/value, new node) | **missed** | **detected** |
| T2 | genuine no-op (control) | valid (no-op) | valid (no-op) |
| T3 | value mutation | detected | detected |
| T4 | structural insertion | detected | detected |

**Decisive scenario (T1):** a node is removed and a new node carrying the same tag,
attributes, and value is inserted. A flat snapshot is byte-identical before and after, so
the diff reports no mismatch. The new node, however, is never bound to the entity
registered at registration time, so no entity id is recovered through the **WeakNodeMap**
and the model judges the identity as broken (the stale-subtree case).

The snapshot baseline is the **identity-blind minimum**, not a strawman: it correctly
detects T3 and T4; the two models diverge only on T1. Both walk the tree at `O(N)`, so the
overhead ratio is near parity — detection, not a single overhead figure, is this case's claim.

**Files**

| File | Role |
|------|------|
| `case3_experiment_jsdom.mjs`, `case3_experiment.mjs` | Run T1–T4 for both models; emit detection verdicts. |
| `scenarios-case3.js` | T1–T4 scenario definitions. |
| `snapshotBaseline.js` | Flat snapshot capture + diff (identity-blind baseline). |
| `case3_bench_core.mjs` | Timed overhead (snapshot-diff vs. identity walk). |
| `bench-stats.mjs` | Shared paired-ratio measurement. |
| `case3_paired_harness.html`, `case3_paired_run.mjs`, `harness.html` | Timing harnesses. |
| `generate_case3_figures.mjs` | Detection figure (SVG). |
| `results/case3_chromium.json`, `results/case3_firefox.json` | Detection verdicts per engine. |
| `results/paired_case3_chromium.json`, `results/paired_case3_firefox.json` | Timing results. |
| `results/case3_fig1_detection.svg` | Detection figure. |

**Run:** # from case_3/ `node case3_experiment_jsdom.mjs`

---

## Case 4 — Component reconstruction consistency *(Table 4)*

Isolates what an authority-issued lineage provides that a client hint cannot: it enforces
**both** the preservation and the deliberate break of state identity, and it **rejects an
identifier the External Authority never issued** — a distinction a developer key or a
server id cannot draw.

Four models under four scenarios (verdicts from the matrix result JSON):

| Model (basis) | R1 preserve | R2 discard | R3 replay (issued id) | Fabricated id (never issued) |
|---------------|-------------|------------|-----------------------|------------------------------|
| A. innerHTML swap (none) | value lost | discarded (incidental) | no identity | no identity |
| B. keyed reconcile (developer key) | preserved | false reuse | forged | **cannot reject** |
| D. server-issued id (server id) | preserved | discarded | forged | **cannot reject** |
| **C. identity reconcile (authority lineage)** | preserved | discarded | forged* | **rejected** |

- **R1 (preserve):** a new definition of the *same* entity after the user typed — the
  entered value must survive.
- **R2 (discard):** a visually identical form of a *new* entity lineage — the prior value
  must be discarded. A developer key that stays the same triggers false reuse (B).
- **R3 replay (issued id):** replay of a legitimately issued identifier is a **common
  surface** — C is reused and forged like B and D, *not* claimed to be resisted.
- **Fabricated id (never issued):** only a basis that consults the issuing authority can
  refuse an identifier it never issued. In the result JSON, C emits
  `RECONSTRUCTION_REJECTED` for `R3_FAB` (`isIssued` check); B and D have no ledger to do so.

\* C's distinction is **not** resisting replay (the common surface) but rejecting a
**fabricated** identifier (the adjacent column).

**Overhead (Figure 2):** the reconcile variants (keyed B, identity C, server-id D) and a
production React 18.3.1 reference all track the keyed baseline (B = 1.0) at the same `O(N)`
cost; only innerHTML swap (A) runs consistently higher.

**Files**

| File | Role |
|------|------|
| `chromium/matrix-run.mjs`, `chromium/matrix-harness.mjs`, `chromium/matrix-bench.html` | Run the R1/R2/R3/R3_FAB × model matrix. |
| `chromium/case4_matrix_result.json` | Reconstruction verdicts (incl. `R3_FAB` → `RECONSTRUCTION_REJECTED` for C). |
| `chromium/overhead-run.mjs`, `chromium/overhead-harness.mjs`, `chromium/overhead-bench.html` | Overhead (reconstruction time vs. node count). |
| `chromium/case4_overhead_result.json` | Per-model medians over 31 runs. |
| `bench/builders.mjs` | Tree builders (keyed, server-id, identity, React props). |
| `bench/payload.mjs` | Serialized payload per model. |
| `figures/generate_overhead_figure.mjs`, `figures/case4_overhead.svg` | Overhead figure. |

**Run:**
```
# from case_4/
node chromium/matrix-run.mjs      # reconstruction matrix
node chromium/overhead-run.mjs    # overhead
```

**Scope:** the reconstruction outcome is conditional on a Reconstruction Authority that
issues a correct canonical lineage, and concerns **detection** (admit/reject), not
prevention or remediation. A compromised External Authority is outside the threat model.
