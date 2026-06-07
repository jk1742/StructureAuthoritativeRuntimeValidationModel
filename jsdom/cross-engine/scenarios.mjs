// scenarios.mjs
// S4 / T1 / control detection scenarios for the live-browser cross-engine confirmation.
//
// Grounded in the live form demo (form-node/demo.html): the SAME reference model is reused
// verbatim via createRegistry from ./model-form.mjs, the SAME canonical entity shape as
// form-node/canonical.json (form > label > #text, input[value]), and the SAME verdict path
// the demo uses (registry.validate() raises on deviation, returns on a valid tree). No model
// logic is reimplemented here -- keeping measurement == implementation == reference.
//
// Each scenario (1) builds the form subtree, (2) mounts the registry against the canonical
// tree, (3) commits the initial runtime-state truth, (4) performs an attack, and (5) reports
// whether validate() raises (detected) or returns (not detected).

import { createRegistry } from "./model-core.mjs";

const INIT_VALUE = "alice";

// Canonical entity tree (authority-issued ids), identical in shape to form-node/canonical.json.
function canonicalTree() {
  return {
    id: "e-form01", parentId: null, order: 0, type: "form", children: [
      { id: "e-lbl01", parentId: "e-form01", order: 0, type: "label",
        children: [ { id: "e-txt01", parentId: "e-lbl01", order: 0, type: "#text" } ] },
      { id: "e-inp01", parentId: "e-form01", order: 1, type: "input", value: INIT_VALUE, children: [] },
    ],
  };
}

// Build the form subtree with createElement so the only text node is the label's content,
// matching the canonical tree exactly across engines (no stray whitespace text nodes).
function buildForm(doc) {
  const form = doc.createElement("form");
  form.id = "login";
  form.setAttribute("data-role", "module");
  const label = doc.createElement("label");
  label.setAttribute("for", "username");
  label.textContent = "Username";                 // the canonical #text child
  const input = doc.createElement("input");
  input.id = "username"; input.setAttribute("name", "username");
  input.type = "text"; input.value = INIT_VALUE;
  form.appendChild(label);
  form.appendChild(input);
  return { form, label, input };
}

function setup(doc) {
  const { form, label, input } = buildForm(doc);
  const registry = createRegistry(doc);
  registry.mount(form, canonicalTree());
  registry.commit(input);                          // truth := the initial value (approved path)
  return { form, label, input, registry };
}

function verdict(registry, root) {
  try { registry.validate(root); return { detected: false, reason: null }; }
  catch (e) { return { detected: true, reason: String(e && e.message ? e.message : e) }; }
}

// S4 - evasion (value + in-DOM meta co-forgery).
// A DOM-resident baseline (Case 1) trusts a <meta truth:*> reference, so forging BOTH the
// property and the meta evades it. The proposed model keeps the truth OUTSIDE the DOM: the
// forged value never passed commit, so validate() raises RUNTIME_STATE_FORGERY regardless
// of the meta co-forgery.
function scenarioS4(doc) {
  const { form, input, registry } = setup(doc);
  const host = doc.head || doc.body || form;
  const meta = doc.createElement("meta");
  meta.setAttribute("name", "truth:username");
  meta.setAttribute("content", INIT_VALUE);
  host.appendChild(meta);

  input.value = "attacker";                        // forged property (not committed)
  meta.setAttribute("content", "attacker");        // forged in-DOM reference -> evades baseline

  return { id: "S4", label: "evasion forgery (value + meta)", expected: "detected", ...verdict(registry, form) };
}

// T1 - identical-form replacement (stale-subtree). Swap the input for a new node of identical
// tag/value. The new node carries no registry binding, so the parent's child-slot identity
// check fails -> STRUCTURAL_DEVIATION. A snapshot-diff baseline sees no difference.
function scenarioT1(doc) {
  const { form, input, registry } = setup(doc);
  const fresh = doc.createElement("input");
  fresh.id = "username"; fresh.setAttribute("name", "username");
  fresh.type = "text"; fresh.value = INIT_VALUE;   // identical shape & value
  input.parentNode.replaceChild(fresh, input);

  return { id: "T1", label: "identical-form replacement", expected: "detected", ...verdict(registry, form) };
}

// control - valid state. No tampering after mount+commit; must NOT be flagged, so a model
// that always reported a deviation would visibly fail here.
function scenarioControl(doc) {
  const { form, registry } = setup(doc);
  return { id: "control", label: "valid state", expected: "not detected", ...verdict(registry, form) };
}

// Returns one row per scenario: { id, label, expected, detected, reason }.
// Browser: call with no argument (uses the ambient document). Node/JSDOM: pass a jsdom
// document so the same code path runs without a browser.
export function runDetection(doc) {
  const d = doc || (typeof document !== "undefined" ? document : undefined);
  if (!d) throw new Error("runDetection: no document available");
  return [scenarioS4(d), scenarioT1(d), scenarioControl(d)];
}
