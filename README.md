# Structure-Authoritative Runtime Validation — Artifact

Reference implementation and reproduction scripts for the evaluation in the paper.
The artifact demonstrates that a structure-authoritative model — one that keeps the
canonical structure registry and the runtime *truth* **outside** the live DOM —
detects runtime state forgery and stale-subtree replacement that DOM-resident
baselines miss, and reconstructs components while both preserving runtime state and
discarding identity that no longer holds.

It also reports the **overhead** of the model as a proposed-to-baseline **ratio**,
measured on Chromium, Firefox, and JSDOM. Because absolute timings are
machine-dependent, the ratio and the asymptotic order are the claim — not absolute
milliseconds.

No personally identifying information is included; all paths are relative.

## Repository layout

```
.
├── README.md
├── results_dashboard.html              # results overview (self-contained; loads Chart.js from a CDN)
│
├── browser/                            # reference implementation + overhead measurement (ES modules)
│   ├── model-core.mjs                  # minimal reference implementation (no dependencies)
│   │
│   ├── bench-stats.mjs                 # paired-ratio measurement + median/IQR aggregation
│   ├── bench-core-paired.mjs           # unified paired core for Case 1 / 3 / 4 (+ payload)
│   ├── benchmark-paired.mjs            # browser wrapper (window.__runPaired)
│   ├── benchmark_paired_harness.html
│   ├── run_paired.mjs                  # ⭐ overhead runner: JSDOM + Chromium + Firefox, all cases
│   ├── bench-node-paired.mjs           # JSDOM-only paired runner (quick local check)
│   │
│   ├── package.json
│   └── results/                        # captured overhead measurements (committed JSON)
│       └── paired_case{1,3,4}_{chromium,firefox,jsdom}.json
│
├── jsdom/                              # per-case detection experiments + live-browser cross-engine confirmation
│   ├── case_1/        case1_experiment.mjs, case1_result.json
│   ├── case_3/        case3_experiment.js, case3_result.json, case3_fig1_detection.svg, case3_overhead.{js,json}, ...
│   ├── case_4/        case4_experiment.js, case4_result.json, case4_fig1_detection.svg, case4_overhead.{js,json}, ...
│   └── cross-engine/                   # ⭐ live-browser detection (Playwright)
│       ├── scenarios.mjs               # S4 / T1 / control, reusing the demo's registry model
│       ├── detection_harness.html      # harness loaded by the Playwright detection runner
│       ├── run_browser_detection.mjs   # ⭐ detection runner: JSDOM + Chromium + Firefox
│       ├── model-core.mjs              # registry reused by the harness (value-only variant)
│       ├── package.json
│       └── results/browser_detection_{chromium,firefox,jsdom}.json
│
└── form-node/                              # interactive browser demo (login form)
    ├── demo.html                           # ⭐ the interactive demo entry point
    ├── model-core.mjs                      # demo registry (createRegistry)
    └── canonical.json                      # authority-issued entity tree (static stand-in)
```

> **Overhead source of truth.** All timing/payload numbers in the paper and in
> `results_dashboard.html` come from the **paired runner** (`browser/run_paired.mjs`,
> `browser/results/paired_*.json`). The `jsdom/case_*/` folders provide the
> **detection** experiments and detection figures, and `jsdom/cross-engine/` provides
> the live-browser cross-engine confirmation; any earlier single-run timing scripts in
> the case folders are superseded by the paired protocol and retained only for
> provenance.

## Results at a glance

Open `results_dashboard.html` in any browser. It is self-contained (the result
numbers are embedded inline); the only external dependency is the Chart.js CDN, so an
internet connection is needed to render the charts. It collects the detection tables
for Case 1 / 3 / 4, the cross-engine confirmation, and the overhead **ratio** tables
(median; the IQR for each point is in the committed JSON).

Headline outcomes:

- **Case 1 (S4 evasion):** when the attacker forges both the property *and* the in-DOM
  `<meta>` the baseline relies on, the baseline is **bypassed**; the registry model
  (truth outside the DOM) still **detects** it. Validation time: proposed runs at about
  roughly 0.7× (Chromium) / 0.45–0.5× (Firefox) of the baseline at 2,000 nodes, same O(N) order
  (proposed is faster because it avoids a per-field DOM read).
- **Case 3 (T1 stale-subtree):** an identical-form replacement is **missed** by
  snapshot-diff but **detected** by identity continuity. Validation runs the **full
  Algorithm 1** (forward structure validation + removal sweep) and stays at **near
  parity** with snapshot-diff in the same O(N) order on the production engines (Firefox's
  sub-millisecond timings are coarsely quantized; JSDOM is not performance-representative
  and varies more widely between runs). The **detection result — not a single overhead
  figure — is the claim for
  this case.**
- **Case 4 (R1/R2):** only identity reconciliation both **preserves** runtime state (R1)
  and **discards** stale state under a new authority-issued identity (R2). Reconstruction
  cost stays within roughly 15–20% of keyed reconcile on the production engines (JSDOM varies more widely);
  payloads differ by under 1%.
- **Cross-engine:** S4 and T1 reproduce identically on Chromium 148 and Firefox 150
  (and JSDOM), with the control scenario reporting *not detected* on every engine.

## Reproduce

### A. Interactive demo (live browser)

The interactive demo is **`form-node/demo.html`**: a login form whose canonical
entity tree is fetched from `canonical.json` and registered *outside* the DOM on
load. It uses ES modules and `fetch`, so it must be served over HTTP (`file://` is
blocked by the browser's module/fetch policy).

```bash
# from the repo root, serve the form-node/ folder with any static server, e.g.
npx serve form-node
# then open the printed URL and load demo.html
```

Tamper with the form from the console (change a `value` without `commit`, or move/
replace a node), then click **Validate** to read the verdict and its reason. This is
the hands-on counterpart to the automated detection run in step B.

### B. Cross-engine detection (automated)

```bash
cd jsdom/cross-engine
npm install
npm run setup                     # playwright install — downloads Chromium and Firefox
npm run detect                    # -> results/browser_detection_<engine>.json
# (equivalently: node run_browser_detection.mjs)
```

### C. Overhead — paired ratio across three environments

```bash
cd browser
npm install                       # jsdom + playwright
npx playwright install chromium firefox
npm run paired                    # -> results/paired_<case>_<engine>.json (JSDOM + Chromium + Firefox)
npm run paired:jsdom              # JSDOM-only quick check (no browsers)
```

The paired runner times the proposed and baseline operations in **adjacent windows**
and forms the ratio in place, so common-mode clock variation cancels. It reports the
median with IQR over independent runs (30 paired windows × 10 runs for all three
cases; Case 4 additionally uses 10 warmup windows). Budgets are set per case in
`run_paired.mjs` (`BUDGET`).

### D. JSDOM detection experiments + figures

```bash
cd jsdom/case_1
npm install                 # installs jsdom (required; skipping it gives "Cannot find module 'jsdom'")
npm run experiment          # prints the detection table and rewrites case1_result.json
```

Case 3 and Case 4 follow the same `npm run experiment` pattern. **Case 3 and Case 4**
additionally provide `npm run figures` (regenerates `caseN_fig1_detection.svg`) and
`npm run overhead` (single-run JSDOM timing/payload that is **provenance only** and
superseded by the paired runner above — see *Case 4 detail* below). Case 1 carries the
detection experiment only (no figure or overhead script).

## Paper ↔ code mapping

The minimal reference implementation lives in `browser/model-core.mjs`.

| Concept in the paper | Symbol in `model-core.mjs` |
|---|---|
| Registry kept outside the DOM | `createRegistry()` |
| Registration of a subtree against its canonical tree | `mount()` |
| WeakNodeMap (live node → entity id) | `nodeToId` (a `WeakMap`) |
| indexMap (entity id → canonical entity) | `indexMap` |
| Runtime *truth* outside the DOM | held in the registry closure (never in the DOM) |
| Canonical structure validation (type / parent / sibling order / child-count) | `validate()` → `validateNode()` (forward pass) + `reverseRemovalSweep()` (removal sweep) |
| Runtime state validation (value vs committed truth) | `validateNode()` (raises `RUNTIME_STATE_FORGERY`) |
| Interaction propagation channel | `commit()` |

Overhead measurement per case (in `bench-core-paired.mjs`): Case 1 = closure registry
vs optimized in-DOM metadata index; Case 3 = registry walk vs snapshot re-serialize+diff;
Case 4 = identity-issued reconcile vs keyed reconcile (+ deterministic payload).

| Paper | Detection | Overhead |
|---|---|---|
| §6 Case 1 | `jsdom/case_1/` | `browser/results/paired_case1_*.json` |
| §6 Case 3 | `jsdom/case_3/` | `browser/results/paired_case3_*.json` |
| §6 Case 4 | `jsdom/case_4/` | `browser/results/paired_case4_*.json` |
| cross-engine | `jsdom/cross-engine/run_browser_detection.mjs` | — |

### Case 4 detail — reconstruction verdict & id provenance

Case 4 (`jsdom/case_4/`) compares three reconstruction models — innerHTML swap, keyed
reconcile, identity reconciliation — under R1 (same entity, attribute change → state
**must survive**) and R2 (visually identical form under a **new** authority-issued
identity → stale state **must be discarded**). Only identity reconciliation satisfies
both (see the Case 4 headline above and `case4_fig1_detection.svg`).

- **Reconstruction verdict.** `reconstruct()` returns a status in the paper's Runtime
  Subtree Reconstruction vocabulary: `RECONSTRUCTED` (the existing node links to the new
  authority-issued lineage → reused, **R1**) or `RECONSTRUCTION_REJECTED` (the node
  cannot link to the new canonical id → discarded and rebuilt, **R2**). This is the
  boolean signal for the case: keyed reconcile silently reuses where identity
  reconciliation rejects.
- **ID provenance (non-circular).** The discriminating identifier is **not** a string manually written by the test. Instead, identifiers are issued by an in-process `createReconstructionAuthority()`: the client submits only a `slot` (position label) and a **lineage token**, while the authority assigns `entity.id` (same token → same id with `revision increment`; new token → new id). Consequently, in R2, an identical shape under a new lineage receives a **different** identifier, preventing identity reconciliation from falling into the false-reuse behavior of keyed models. This behavior is verified at runtime through `idProvenance`, `sameLineageId`, and `crossLineageDistinctId` in case4_result.json. The authority serves as an in-process stand-in for the external precondition described in *Notes on scope*.
## Measurement environment

The committed `results/paired_*.json` were produced on:

| | |
|---|---|
| CPU | Intel Core i7-8565U (4 cores / 8 threads, base 1.80 GHz) |
| RAM | 15.8 GB |
| OS | Windows 11 (64-bit) |
| Power plan | High performance, CPU turbo disabled (clock held near base) |
| Node.js | v22.14.0 |
| Engines | Chromium 148.0.7778.96, Firefox 150.0.2 |

This is a mobile-class CPU. For the committed runs, CPU turbo was disabled so the
clock stays near its base frequency, which reduces run-to-run drift in the median. The
paired protocol additionally times baseline and proposed in **adjacent windows** and
forms the ratio in place, so any residual momentary clock variation cancels. Reported
ratios are therefore robust to clock variation; re-running on other hardware is
expected to change absolute times but not the ratios or the order.

JSDOM is a JavaScript reimplementation of the DOM and is **not** performance-
representative: some of its DOM operations scale super-linearly where the production
engines stay linear, so JSDOM is reported as a cross-check on direction and order, not
as a representative timing curve. The two production engines (Chromium, Firefox) are
the headline.

## Notes on scope

- **Overhead claim.** The claim is the **ratio** and the **asymptotic order**, both
  hardware-independent. Absolute milliseconds appear only inside the JSON and are
  specific to the machine above; do not compare them across environments.
- **Detection vs timing.** Detection is a boolean and reproduces identically across
  engines and engine versions; timing ratios may shift with version, engine, and (for
  Case 3) node count, but the order is stable.
- The control scenario is included so that an implementation that always reports a
  deviation would visibly fail it.
- The interactive demo (`form-node/demo.html`) registers a canonical entity tree
  loaded from `canonical.json`, a
  **static stand-in for an authority-issued entity-id lineage** — in a deployment the
  lineage originates from an external Reconstruction Authority, which this demo does
  not implement.
- `entity.id` is an **authority-issued id** carried in `canonical.json`, *not* the DOM
  `id` attribute.
- Validation trusts the **node ↔ canonical-entity binding**, not the node's tag/shape.
- **What the demo shows:** detection *after the registry is established* — structural
  deviation (type / parent / order / child-count) and runtime-state forgery (a `value`
  change that did not pass `commit`), performed from the console **after load**.
- **What the demo does not show (out of scope, by the paper's trust model):** that the
  authority is external, or that its issuance/delivery is tamper-proof. The authority is
  a **trust assumption / precondition**, not a protected target. Load-time tampering
  (e.g. intercepting the canonical fetch) is out of scope.
