// scenarios.mjs
// S4 (Case 1, evasion forgery) and T1 (Case 3, identical-form replacement),
// run against a LIVE browser DOM using the minimal reference implementation in
// model-core.mjs (faithful to Algorithm 1 + Section 4.1). PROPOSED MODEL ONLY.
// Detection (boolean) only --- no timing. Fully concrete: no production framework,
// no placeholders.
//
// Verdict convention (from model-core.mjs): validate* returns true on VALID and
// throws on a deviation, so a throw is recorded as detected:true.

import { createRegistry } from "./model-core.mjs";

const stage = document.getElementById("stage");

function capture(id, scenario, expected, fn) {
  try {
    fn(); // true on VALID; throws on deviation
    return { id, scenario, expected, detected: false, detail: "no deviation (VALID)" };
  } catch (e) {
    return { id, scenario, expected, detected: true, detail: String(e && e.message ? e.message : e) };
  }
}

// ---------------------------------------------------------------------------
// S4 --- Case 1: evasion forgery.
// Attacker forges the DOM property AND an in-DOM meta reference. The proposed
// model reads truth from the registry (closure, outside the DOM), so neither
// forgery can taint it. Expected: Detected.
// ---------------------------------------------------------------------------
function scenarioS4() {
  stage.innerHTML = "";
  const reg = createRegistry();

  const root = document.createElement("div");
  stage.appendChild(root);
  const input = document.createElement("input");
  input.value = "legit";
  root.appendChild(input);

  reg.register(root,  { id: "root", parentId: null,   order: 0 });
  reg.register(input, { id: "f1",   parentId: "root", order: 0, truth: "legit" });

  // S4 attack: tamper the DOM property directly (not via the propagation channel)...
  input.value = "attacker";
  // ...and forge the in-DOM validation reference too (defeats equality-on-DOM baselines).
  const meta = document.createElement("meta");
  meta.setAttribute("name", "truth:f1");
  meta.setAttribute("content", "attacker");
  document.head.appendChild(meta);

  // Proposed model compares against registry truth ("legit"), not the DOM/meta:
  return reg.validateRuntimeState(input, input.value); // throws => detected
}

// ---------------------------------------------------------------------------
// T1 --- Case 3: identical-form replacement (the key cross-engine check).
// Remove the registered node; insert a NEW node with identical tag/attr/value.
// The new node has no WeakNodeMap binding => broken identity. This exercises
// WeakMap semantics, which JSDOM only approximates. Expected: Detected.
// ---------------------------------------------------------------------------
function scenarioT1() {
  stage.innerHTML = "";
  const reg = createRegistry();

  const root = document.createElement("div");
  stage.appendChild(root);
  const original = document.createElement("input");
  original.type = "text";
  original.value = "x";
  root.appendChild(original);

  reg.register(root,     { id: "root", parentId: null,   order: 0 });
  reg.register(original, { id: "g1",   parentId: "root", order: 0 });

  // T1 attack: remove the registered node, insert an identical-form new node.
  root.removeChild(original);
  const replacement = document.createElement("input");
  replacement.type = "text";
  replacement.value = "x"; // identical form
  root.appendChild(replacement);

  // The replacement carries no WeakNodeMap binding => identity broken.
  return reg.validateStructure(replacement); // throws => detected
}

// Sanity control: a genuinely valid state must NOT be flagged (guards against a
// trivially-always-throwing implementation). Expected: not detected.
function scenarioControl() {
  stage.innerHTML = "";
  const reg = createRegistry();
  const root = document.createElement("div");
  stage.appendChild(root);
  const input = document.createElement("input");
  input.value = "legit";
  root.appendChild(input);
  reg.register(root,  { id: "root", parentId: null,   order: 0 });
  reg.register(input, { id: "f1",   parentId: "root", order: 0, truth: "legit" });
  reg.validateStructure(root);
  return reg.validateRuntimeState(input, input.value); // VALID => returns true
}

window.__runDetectionExperiment = async function () {
  return [
    capture("S4",      "Case 1 evasion forgery (value + meta)", "Detected",     scenarioS4),
    capture("T1",      "Case 3 identical-form replacement",     "Detected",     scenarioT1),
    capture("control", "valid state (no tampering)",            "not detected", scenarioControl),
  ];
};
