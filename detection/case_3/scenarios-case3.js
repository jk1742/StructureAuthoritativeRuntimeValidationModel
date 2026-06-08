/* =====================================================================
 * scenarios-case3.js — T1~T4 시나리오 (doc 주입형, 엔진 비의존)
 * ---------------------------------------------------------------------
 * 원본(case3_experiment.js)의 시나리오 의미를 그대로 보존하되, JSDOM 하드와이어
 * 대신 doc를 주입받아 createElement로 폼을 짓는다. node.children는 텍스트 노드를
 * 제외하므로 공백 차이가 없어 Chromium/Firefox/JSDOM에서 동일 트리가 된다.
 *
 * 모델:
 *   (A) SnapshotBaseline       : ./snapshotBaseline.js  (case_3 전용 baseline)
 *   (B) identity continuity    : 공통 model-core.mjs 의 createRegistry 를
 *                                model-core-report.mjs(래퍼)로 호출. 검증 로직은
 *                                단일 출처(원본)이며, throw 를 {valid,issues} 로 환원.
 *                                폼→canonical 변환은 canonicalFromForm 헬퍼가 담당.
 *
 * 각 시나리오의 expected (논문 Case 3):
 *   T1 identical replacement : A(snapshot) MISSED  / B(identity) Detected   ← 판별점
 *   T2 no-op (control)       : A not detected      / B not detected
 *   T3 value mutation        : A Detected          / B Detected
 *   T4 structural insertion  : A Detected          / B Detected
 * ===================================================================== */
import { SnapshotBaseline } from "./snapshotBaseline.js";
import { createReportRegistry, canonicalFromForm } from "../../model-core-report.mjs";

// 원본 buildBase()의 트리를 createElement로 동일 재현:
//   form#f > input#user[text=alice], input#agree[checkbox], textarea#memo[value=hello]
function buildForm(doc) {
  const form = doc.createElement("form"); form.id = "f";
  const user = doc.createElement("input"); user.id = "user"; user.type = "text"; user.value = "alice";
  const agree = doc.createElement("input"); agree.id = "agree"; agree.type = "checkbox";
  const memo = doc.createElement("textarea"); memo.id = "memo"; memo.value = "hello";
  form.appendChild(user); form.appendChild(agree); form.appendChild(memo);
  return form;
}

// host: 폼을 잠시 붙일 컨테이너(브라우저=document.body, JSDOM=document.body)
function mountFresh(doc, host) {
  const form = buildForm(doc);
  host.appendChild(form);
  return form;
}

// B 모델 등록: 공통 mount 에 변조-전 라이브 상태를 canonical 트리로 굳혀 바인딩.
// 반드시 변조 전에 호출해야 등록 시점 truth 가 정확하다.
function registerB(doc, root) {
  const reg = createReportRegistry(doc);
  reg.mount(root, canonicalFromForm(root));
  return reg;
}

function rowOf(id, label, expectedA, expectedB, a, b) {
  return {
    id, label,
    snapshot: { detected: !a.valid, mismatches: a.mismatches.length, expected: expectedA },
    // report 래퍼는 첫 위반만 담으므로 issues.length 는 0 또는 1 (detected 비교엔 충분)
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
    const reg = registerB(doc, root);            // 변조 전 등록

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
    const reg = registerB(doc, root);            // 변조 전 등록

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
    const reg = registerB(doc, root);            // 변조 전 등록

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
