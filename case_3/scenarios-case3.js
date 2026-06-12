/* 
 * scenarios-case3.js — T1~T4 scenarios
 *   T1 identical replacement : A(snapshot) MISSED  / B(identity) Detected 
 *   T2 no-op (control)       : A not detected      / B not detected
 *   T3 value mutation        : A Detected          / B Detected
 *   T4 structural insertion  : A Detected          / B Detected
 */
import { SnapshotBaseline } from "./snapshotBaseline.js";
import { createReportRegistry, canonicalFromForm } from "../../model-core-report.mjs";

//   form#f > input#user[text=alice], input#agree[checkbox], textarea#memo[value=hello]
function buildForm(doc) {
  const form = doc.createElement("form"); form.id = "f";
  const user = doc.createElement("input"); user.id = "user"; user.type = "text"; user.value = "alice";
  const agree = doc.createElement("input"); agree.id = "agree"; agree.type = "checkbox";
  const memo = doc.createElement("textarea"); memo.id = "memo"; memo.value = "hello";
  form.appendChild(user); form.appendChild(agree); form.appendChild(memo);
  return form;
}

// host
function mountFresh(doc, host) {
  const form = buildForm(doc);
  host.appendChild(form);
  return form;
}

function registerB(doc, root) {
  const reg = createReportRegistry(doc);
  reg.mount(root, canonicalFromForm(root));
  return reg;
}

function rowOf(id, label, expectedA, expectedB, a, b) {
  return {
    id, label,
    snapshot: { detected: !a.valid, mismatches: a.mismatches.length, expected: expectedA },
    identity: { detected: !b.valid, issues: b.issues.length, expected: expectedB },
  };
}

export function runCase3(doc) {
  const host = doc.body || doc.documentElement;
  const rows = [];

  // T1. Identical replacement
  {
    const root = mountFresh(doc, host);
    const snap = SnapshotBaseline.snapshot(root);
    const reg = registerB(doc, root);            

    const oldUser = root.querySelector("#user");
    const newUser = doc.createElement("input");
    newUser.id = "user"; newUser.type = "text"; newUser.value = "alice"; // identical shape & value
    oldUser.parentNode.replaceChild(newUser, oldUser);

    const a = SnapshotBaseline.validate(snap, root);
    const b = reg.validateReport(root);
    rows.push(rowOf("T1", "identical-form replacement", false, true, a, b));
    host.removeChild(root);
  }

  // T2. Genuine no-op (control)
  {
    const root = mountFresh(doc, host);
    const snap = SnapshotBaseline.snapshot(root);
    const reg = registerB(doc, root);

    const a = SnapshotBaseline.validate(snap, root);
    const b = reg.validateReport(root);
    rows.push(rowOf("T2", "genuine no-op (control)", false, false, a, b));
    host.removeChild(root);
  }

  // T3. Value mutation
  {
    const root = mountFresh(doc, host);
    const snap = SnapshotBaseline.snapshot(root);
    const reg = registerB(doc, root);

    root.querySelector("#user").value = "attacker";

    const a = SnapshotBaseline.validate(snap, root);
    const b = reg.validateReport(root);
    rows.push(rowOf("T3", "value mutation", true, true, a, b));
    host.removeChild(root);
  }

  // T4. Structural insertion
  {
    const root = mountFresh(doc, host);
    const snap = SnapshotBaseline.snapshot(root);
    const reg = registerB(doc, root);

    const inject = doc.createElement("input");
    inject.type = "hidden"; inject.value = "INJECT";
    root.appendChild(inject);

    const a = SnapshotBaseline.validate(snap, root);
    const b = reg.validateReport(root);
    rows.push(rowOf("T4", "unauthorized structural insertion", true, true, a, b));
    host.removeChild(root);
  }

  return rows;
}
