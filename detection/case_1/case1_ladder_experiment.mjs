/**
 * Paper Section 6 - Case 1: Runtime State Forgery under an Adaptive Adversary
 *
 * Compared models
 *  (A) Baseline (MetaTag): truth as in-DOM <meta>; node.value vs meta[content].
 *      The validation reference sits ON the DOM's mutable surface.
 *  (B) Proposed: the Section 5 model (createRegistry: indexMap + WeakNodeMap,
 *      commit-only provenance). The validation reference sits OUTSIDE the DOM.
 *      NOT reimplemented here; imported from model-core.mjs.
 *
 * Forgery cost ladder, single result set:
 *   S1-S3  direct property write            (one DOM API call)
 *   S4     property + in-DOM meta co-forge   (added DOM writes)
 *   L2     registry-entry forge attempt      (needs runtime-internal scope)
 *   L3     interaction-channel (commit) hook (needs runtime-internal scope)
 *   L4     WeakMap.prototype pollution        (needs prototype-level subversion)
 *
 * S1-S4 reproduce the original Case 1 (baseline 3/6 vs proposed 6/6).
 * L2-L4 escalate beyond the DOM API; baseline is "—" (already broken at S4).
 *
 * Verdict classification (proposed model):
 *   "Detected"   - validate() threw on the forged state itself (attack caught).
 *   "Bypassed"   - validate() passed; the forgery went undetected (attack succeeds).
 *   "Disrupted"  - validate() threw because the validation path itself was broken
 *                  (e.g. nodeToId.get neutralized), NOT because the forged state was
 *                  recognized. The forgery did NOT pass; this is an availability
 *                  impact on the validator, not a successful forgery.
 * The "reason" (error message) is recorded so Detected vs Disrupted can be told apart.
 */

import { JSDOM } from "jsdom";
import { createRegistry } from "../../model-core.mjs";
import fs from "fs";

// Save the pristine WeakMap.prototype.get so the L4 pollution can be restored.
const PRISTINE_WEAKMAP_GET = WeakMap.prototype.get;

function buildDoc() {
  const dom = new JSDOM(
    `<!doctype html><html><head></head><body>` +
    `<form id="root">` +
    `<input id="username" type="text" />` +
    `<input id="agree" type="checkbox" />` +
    `<textarea id="memo">hello world</textarea>` +
    `</form></body></html>`
  );
  return dom.window.document;
}

const INIT_USERNAME = "alice";
const INIT_AGREE = false;
const INIT_MEMO = "hello world";

function canonicalTree() {
  return {
    id: "e-root", parentId: null, order: 0, type: "form", children: [
      { id: "e-username", parentId: "e-root", order: 0, type: "input",    value: INIT_USERNAME, children: [] },
      { id: "e-agree",    parentId: "e-root", order: 1, type: "input",    checked: INIT_AGREE,  children: [] },
      { id: "e-memo",     parentId: "e-root", order: 2, type: "textarea", value: INIT_MEMO,     children: [] },
    ],
  };
}

function makeMetaTagModel(document) {
  return {
    setTruth(id, value) {
      let meta = document.querySelector(`meta[name="truth:${id}"]`);
      if (!meta) {
        meta = document.createElement("meta");
        meta.setAttribute("name", `truth:${id}`);
        document.head.appendChild(meta);
      }
      meta.setAttribute("content", String(value));
    },
    validate(id) {
      const node = document.getElementById(id);
      const meta = document.querySelector(`meta[name="truth:${id}"]`);
      const truth = meta ? meta.getAttribute("content") : null;
      if (node.type === "checkbox" || node.type === "radio") {
        const current = String(!!node.checked);
        return { valid: current === String(truth === "true") };
      }
      return { valid: String(node.value ?? "") === String(truth ?? "") };
    },
  };
}

// Returns { passed, reason }. reason is the thrown error message (or null if passed).
function proposedRun(document, registry) {
  try {
    registry.validate(document.getElementById("root"));
    return { passed: true, reason: null };
  } catch (e) {
    return { passed: false, reason: e && e.message ? e.message : String(e) };
  }
}

// Classify the proposed model's verdict for one scenario.
//   passed === true                       -> "Bypassed"  (forgery went through)
//   threw, message names the forged state -> "Detected"  (forgery caught)
//   threw, message is a broken-path error -> "Disrupted" (validator broken, not a catch)
function classifyVerdict({ passed, reason }) {
  if (passed) return "Bypassed";
  const r = reason || "";
  // "no binding" = nodeToId returned nothing because the lookup path itself was neutralized.
  const pathBroken = /no binding/i.test(r);
  return pathBroken ? "Disrupted" : "Detected";
}

const results = [];

/**
 * level     : "S1".."S4" | "L2".."L4"
 * capability: human-readable capability the attack requires
 * attackFn  : (document, U, A, M, MetaTagModel, registry) => void
 * opts.baselineNA : true for L2-L4 (baseline not applicable, shown as "—")
 * opts.probeMaps  : true for L2 (record whether indexMap is reachable from the API surface)
 */
function runScenario(level, capability, attackFn, opts = {}) {
  const document = buildDoc();
  const U = document.getElementById("username");
  const A = document.getElementById("agree");
  const M = document.getElementById("memo");
  U.value = INIT_USERNAME; A.checked = INIT_AGREE; M.value = INIT_MEMO;

  const MetaTagModel = makeMetaTagModel(document);
  MetaTagModel.setTruth("username", INIT_USERNAME);
  MetaTagModel.setTruth("agree", INIT_AGREE);
  MetaTagModel.setTruth("memo", INIT_MEMO);

  const registry = createRegistry(document);
  registry.mount(document.getElementById("root"), canonicalTree());
  registry.commit(U); registry.commit(A); registry.commit(M);

  // L2 evidence: can a DOM-API adversary even reach the registry's internal maps?
  const mapsReachable = !!registry && (("indexMap" in registry) || ("nodeToId" in registry));

  attackFn(document, U, A, M, MetaTagModel, registry);

  // Baseline: detected if ANY of the three fields mismatches its meta truth.
  let baselineDetected = null;
  if (!opts.baselineNA) {
    baselineDetected = ["username", "agree", "memo"].some(id => !MetaTagModel.validate(id).valid);
  }

  const run = proposedRun(document, registry);
  const verdict = classifyVerdict(run);

  results.push({
    level,
    capability,
    mapsReachable: opts.probeMaps ? mapsReachable : undefined,
    baseline: opts.baselineNA ? "—" : (baselineDetected ? "Detected" : "Bypassed"),
    proposed: verdict,
    reason: run.reason, // kept for transparency; tells Detected from Disrupted
  });
}

// ---------- S1-S3: direct property write (one DOM API call) ----------
runScenario("S1", "one DOM API call",
  (d, U) => { U.value = "attacker"; });

runScenario("S2", "one DOM API call",
  (d, U, A) => { A.checked = true; });

runScenario("S3", "one DOM API call",
  (d, U, A, M) => { M.value = "INJECTED"; });

// ---------- S4: property + in-DOM meta co-forge (added DOM writes) ----------
runScenario("S4", "added DOM writes",
  (d, U, A, M, Meta) => {
    U.value = "attacker"; A.checked = true; M.value = "INJECTED";
    Meta.setTruth("username", "attacker");
    Meta.setTruth("agree", true);
    Meta.setTruth("memo", "INJECTED");
  });

// ---------- L2: registry-entry forge attempt (closure unreachable via DOM API) ----------
runScenario("L2", "runtime-internal scope",
  (d, U, A, M, Meta, registry) => {
    U.value = "attacker";
    // Attacker holds only DOM + the returned API (mount/validate/commit).
    // indexMap/nodeToId live in the closure; if unreachable, no fake entity is injected.
    if (registry && "indexMap" in registry) {
      registry.indexMap.set("e-username", { id: "e-username", type: "input", value: "attacker" });
    }
  },
  { baselineNA: true, probeMaps: true });

// ---------- L3: interaction-channel (commit) hook -- assumes runtime-internal reach ----------
runScenario("L3", "patch channel function",
  (d, U, A, M, Meta, registry) => {
    U.value = "attacker";
    if (registry && typeof registry.commit === "function") {
      registry.commit(U); // driving the channel stamps the forged value as legitimate
    }
  },
  { baselineNA: true });

// ---------- L4: WeakMap.prototype pollution (RUN LAST; restored right after) ----------
runScenario("L4", "prototype-level subversion",
  (d, U, A, M, Meta, registry) => {
    U.value = "attacker";
    WeakMap.prototype.get = function () { return undefined; }; // neutralizes nodeToId.get
  },
  { baselineNA: true });

// Restore the pristine prototype immediately after the L4 measurement.
WeakMap.prototype.get = PRISTINE_WEAKMAP_GET;

// ---------- Output ----------
console.log("\n=== Case 1: Forgery Cost Ladder (S1-S4 + L2-L4) ===\n");
console.table(results.map(r => ({
  Level: r.level,
  Capability: r.capability,
  Baseline: r.baseline,
  Proposed: r.proposed,
  MapsReachable: r.mapsReachable === undefined ? "" : r.mapsReachable,
  Reason: r.reason ? r.reason.slice(0, 48) : "",
})));

// Detection summary is reported over S1-S4 ONLY (the original Case 1 metric).
const sCases = results.filter(r => /^S/.test(r.level));
const total = sCases.length;
const baseDet = sCases.filter(r => r.baseline === "Detected").length;
const propDet = sCases.filter(r => r.proposed === "Detected").length;
console.log("\n--- Detection Summary (S1-S4 only) ---");
console.log(`Scenarios            : ${total}`);
console.log(`Baseline  detection  : ${baseDet}/${total} = ${(baseDet / total * 100).toFixed(1)}%`);
console.log(`Proposed  detection  : ${propDet}/${total} = ${(propDet / total * 100).toFixed(1)}%`);

console.log("\n--- Ladder (L2-L4) ---");
results.filter(r => /^L/.test(r.level)).forEach(r => {
  console.log(`${r.level}: proposed=${r.proposed}  (${r.capability})` +
    (r.mapsReachable === undefined ? "" : `  mapsReachable=${r.mapsReachable}`) +
    (r.reason ? `  reason="${r.reason}"` : ""));
});

fs.writeFileSync("./case1_ladder_result.json", JSON.stringify(results, null, 2));
console.log("\nJSON result -> ./case1_ladder_result.json");
