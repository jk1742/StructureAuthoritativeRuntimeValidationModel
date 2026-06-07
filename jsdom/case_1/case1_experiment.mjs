/**
 * Paper Section 6 - Case 1: Runtime State Forgery Detection
 *
 * Compared models
 *  (A) Baseline (MetaTag Model): truth as in-DOM <meta>, node.value vs meta[content].
 *      The validation reference sits on the DOM's mutable surface.
 *  (B) Proposed: the Section 5 model, imported from the same createRegistry the demo uses
 *      (indexMap + WeakNodeMap, commit-only provenance, structural + runtime-state checks).
 *      The validation reference sits OUTSIDE the DOM.
 *
 * The proposed model is NOT reimplemented here; this reproduces Table 2 against the paper's
 * actual model. The baseline is defined locally only as the comparison target.
 */

import { JSDOM } from "jsdom";
import { createRegistry } from "./model-core.mjs";
import fs from "fs";

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
      { id: "e-username", parentId: "e-root", order: 0, type: "input", value: INIT_USERNAME, children: [] },
      { id: "e-agree",    parentId: "e-root", order: 1, type: "input", checked: INIT_AGREE,  children: [] },
      { id: "e-memo",     parentId: "e-root", order: 2, type: "textarea", value: INIT_MEMO,  children: [] },
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
      let current;
      if (node.type === "checkbox" || node.type === "radio") {
        current = String(!!node.checked);
        const truthBool = String(truth === "true");
        return { valid: current === truthBool, domValue: current, truthValue: truthBool };
      } else {
        current = String(node.value ?? "");
        return { valid: current === String(truth ?? ""), domValue: current, truthValue: String(truth ?? "") };
      }
    },
  };
}

function proposedVerdict(document, registry, targetId, expectedTruth, isChecked) {
  const node = document.getElementById(targetId);
  let detected = false;
  try {
    registry.validate(document.getElementById("root"));
  } catch (e) {
    detected = true;
  }
  return {
    detected,
    domValue: isChecked ? !!node.checked : String(node.value ?? ""),
    truthValue: isChecked ? !!expectedTruth : String(expectedTruth ?? ""),
  };
}

const results = [];

function runScenario(name, attackFn, targets) {
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

  attackFn(document, U, A, M, MetaTagModel);

  for (const t of targets) {
    const a = MetaTagModel.validate(t.id);
    const expectedTruth = t.id === "username" ? INIT_USERNAME : t.id === "agree" ? INIT_AGREE : INIT_MEMO;
    const b = proposedVerdict(document, registry, t.id, expectedTruth, t.id === "agree");
    results.push({
      scenario: name,
      target: t.id,
      attack: t.attack,
      baseline_meta: { detected: !a.valid, domValue: a.domValue, truthValue: a.truthValue },
      proposed_registry: { detected: b.detected, domValue: b.domValue, truthValue: b.truthValue },
    });
  }
}

runScenario("S1: input.value direct forgery",
  (d, U) => { U.value = "attacker"; },
  [{ id: "username", attack: "input.value='attacker'" }]);

runScenario("S2: checkbox.checked direct forgery",
  (d, U, A) => { A.checked = true; },
  [{ id: "agree", attack: "checkbox.checked=true" }]);

runScenario("S3: textarea.value direct forgery",
  (d, U, A, M) => { M.value = "INJECTED"; },
  [{ id: "memo", attack: "textarea.value='INJECTED'" }]);

runScenario("S4: evasion - property + meta tag co-forgery",
  (d, U, A, M, Meta) => {
    U.value = "attacker"; A.checked = true; M.value = "INJECTED";
    d.querySelector('meta[name="truth:username"]').setAttribute("content", "attacker");
    d.querySelector('meta[name="truth:agree"]').setAttribute("content", "true");
    d.querySelector('meta[name="truth:memo"]').setAttribute("content", "INJECTED");
  },
  [
    { id: "username", attack: "input.value + meta both" },
    { id: "agree",    attack: "checkbox.checked + meta both" },
    { id: "memo",     attack: "textarea.value + meta both" },
  ]);

console.log("\n=== Case 1: Runtime State Forgery Detection ===\n");
console.table(results.map(r => ({
  Scenario: r.scenario,
  Target: r.target,
  Attack: r.attack,
  "Baseline(meta) Detected": r.baseline_meta.detected ? "YES" : "NO  (BYPASSED)",
  "Proposed(registry) Detected": r.proposed_registry.detected ? "YES" : "NO  (BYPASSED)",
})));

const total = results.length;
const baseDet = results.filter(r => r.baseline_meta.detected).length;
const propDet = results.filter(r => r.proposed_registry.detected).length;
console.log("\n--- Detection Summary ---");
console.log(`Total scenarios : ${total}`);
console.log(`Baseline (meta tag)  detection rate : ${baseDet}/${total} = ${(baseDet / total * 100).toFixed(1)}%`);
console.log(`Proposed (registry)  detection rate : ${propDet}/${total} = ${(propDet / total * 100).toFixed(1)}%`);

fs.writeFileSync("./case1_result.json", JSON.stringify(results, null, 2));
console.log("\nJSON result -> ./case1_result.json");
