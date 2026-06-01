# Structure-Authoritative Runtime Validation — Artifact

Reference implementation and reproduction scripts for the evaluation in the paper.
The artifact demonstrates that a structure-authoritative model — one that keeps the
canonical structure registry and the runtime *truth* **outside** the live DOM —
detects runtime state forgery and stale-subtree replacement that DOM-resident
baselines miss, and reconstructs components while both preserving runtime state and
discarding identity that no longer holds.

No personally identifying information is included; all paths are relative.

## Repository layout

```
.
├── README.md
├── results_dashboard.html              # results overview (open from the repo root)
│
├── browser/                            # live-browser cross-engine confirmation (ES modules)
│   ├── detection_harness.html          # interactive: S4 / T1 / control, or ?auto=1
│   ├── model-core.mjs                  # minimal reference implementation (no dependencies)
│   ├── scenarios.mjs                   # S4 / T1 / control scenario definitions
│   ├── run_browser_detection.mjs # Playwright runner (Chromium + Firefox)
│   ├── package.json
│   └── results/                        # captured measurements
│       ├── browser_detection_chromium.json
│       └── browser_detection_firefox.json
│
└── jsdom/                              # primary JSDOM experiments (CommonJS)
    ├── case_1/                         # Case 1 — Runtime State Forgery Detection
    │   ├── case1_experiment.js         # S1–S4 detection
    │   ├── case1_overhead_v2.js        # validation time + payload
    │   ├── generate_figures_svg.js     # figures from the JSON results
    │   ├── case1_result.json / case1_overhead.json
    │   └── case1_fig1_detection.svg / case1_fig2_validation_time.svg / case1_fig3_payload_size.svg
    ├── case_3/                         # Case 3 — Snapshot Diff vs. Identity Continuity
    │   ├── case3_experiment.js / case3_overhead.js
    │   ├── generate_case3_figures.js
    │   ├── case3_result.json / case3_overhead.json
    │   └── case3_fig1_detection.svg
    └── case_4/                         # Case 4 — Component Reconstruction Consistency
        ├── case4_experiment.js / case4_overhead.js
        ├── generate_case4_figures.js
        ├── case4_result.json / case4_overhead.json
        └── case4_fig1_detection.svg / case4_fig2_reconstruction_time.svg / case4_fig3_payload_size.svg
```

## Results at a glance

Open `results_dashboard.html` **from the repository root** (so the relative figure
paths resolve). It collects the detection tables for Case 1 / 3 / 4, the cross-engine
confirmation, and the overhead figures.

Headline outcomes:

- **Case 1 (S4 evasion):** when the attacker forges both the property *and* the in-DOM
  `<meta>` the baseline relies on, the baseline is **bypassed**; the registry model
  (truth outside the DOM) still **detects** it.
- **Case 3 (T1 stale-subtree):** an identical-form replacement is **missed** by
  snapshot-diff but **detected** by identity continuity (broken node→entity binding).
- **Case 4 (R1/R2):** only identity reconciliation both **preserves** runtime state (R1)
  and **discards** stale state under a new authority-issued identity (R2).
- **Cross-engine:** S4 and T1 reproduce identically on Chromium 148 and Firefox 150.

## Reproduce

### A. Interactive demo (live browser)

The harness uses ES modules, so it must be served over HTTP (opening the file
directly with `file://` is blocked by the browser's module CORS policy).

```bash
# from the repo root, serve the browser/ folder with any static server, e.g.
npx serve browser
# then open the printed URL and load detection_harness.html
```

Use the **S4 / T1 / control** buttons to trigger each case and read the verdict
(`Detected` / `not detected`) with its reason. Append `?auto=1` to the URL to run all
three on load.

### B. Cross-engine confirmation (automated)

```bash
cd browser
npm install
npx playwright install        # downloads Chromium and Firefox
node run_browser_detection.mjs
```

This serves the harness, runs the scenarios on both engines, and writes
`results/browser_detection_<engine>.json` (engine versions are captured at run time).

### C. JSDOM case experiments

Each case folder is self-contained. Install `jsdom` once, then run the scripts:

```bash
cd jsdom/case_1
npm install jsdom
node case1_experiment.js        # -> case1_result.json   (detection)
node case1_overhead_v2.js       # -> case1_overhead.json  (timing + payload)
node generate_figures_svg.js    # -> the case1_*.svg figures
```

Case 3 and Case 4 follow the same pattern with their respective
`*_experiment.js`, `*_overhead.js`, and `generate_*figures.js` scripts.

## Paper ↔ code mapping

The minimal reference implementation lives in `browser/model-core.mjs`. The mapping
below ties the model in the paper to the symbols you can read there.

| Concept in the paper | Symbol in `model-core.mjs` |
|---|---|
| Registry kept outside the DOM | `createRegistry()` |
| WeakNodeMap (live node → entity id) | `weakNodeMap` |
| indexMap (entity id → canonical entity) | `indexMap` |
| Runtime *truth* outside the DOM | held in the registry closure (never in the DOM) |
| Canonical structure validation (parent → sibling → recurse) | `validateStructure()` |
| Runtime state validation | `validateRuntimeState()` |
| Interaction propagation channel | `commit()` |

The JSDOM case experiments use the same structure inline (`createRegistry`,
`indexMap`, `weakNodeMap`) so each case is runnable on its own.

## Notes on scope

- The browser runs report **detection only**. Absolute timing is environment-dependent
  and is **not** claimed across engines; the overhead figures are from JSDOM.
- The control scenario is included so that an implementation that always reports a
  deviation would visibly fail it.
