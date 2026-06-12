/* =====================================================================
 * chromium/harness.mjs — 페이지 내 하니스 (실 Chromium DOM)
 * ---------------------------------------------------------------------
 * src/*.mjs 를 그대로 import 하여(단일 출처) 실 DOM 위에서 셀을 실행한다.
 * 드라이버(run-matrix.mjs)가 window.c4_setup / window.c4_apply 를 호출하고,
 * 그 사이에 Playwright fill() 로 실 입력 이벤트를 발생시킨다.
 *
 * 셀 절차(드라이버가 조율):
 *   1) c4_setup(model, scenario) — #parent 초기화 + 초기 mount (input 생성)
 *   2) (드라이버) page.fill → 실 사용자 입력 이벤트
 *   3) c4_apply(model, scenario) — 시나리오별 재구성 + 판정 반환
 * ===================================================================== */
import { InnerHTMLSwap, KeyedReconcile, ServerIdReconcile } from "../src/models.mjs";
import { createReconstructionAuthority, createIdentityReconciler } from "../src/identity.mjs";
import * as S from "../src/scenarios.mjs";

const cell = {}; // 셀 단위 상태 보관(setup → apply 사이 유지)

function parentEl() {
  return document.getElementById("parent");
}

function setup(model, scenario) {
  const p = parentEl();
  p.innerHTML = "";
  cell.authority = null;
  cell.reconciler = null;
  cell.dIds = null;
  cell.victimId = null;
  const doc = document;

  if (model === "A") {
    p.innerHTML = S.html();
  } else if (model === "B") {
    KeyedReconcile.apply(p, S.keyedTree(), doc);
  } else if (model === "D") {
    // R2 는 'new form'에 서버가 새 id 를 발급하는 상황을 만들기 위해 초기 id 를 v1 로.
    const ids =
      scenario === "R2"
        ? { user: "sid-user-v1", email: "e1", submit: "s1" }
        : { user: "sid-user", email: "sid-email", submit: "sid-submit" };
    cell.dIds = ids;
    cell.victimId = ids.user;
    ServerIdReconcile.apply(p, S.serverIdTree(ids), doc);
  } else if (model === "C") {
    const authority = createReconstructionAuthority();
    const reconciler = createIdentityReconciler(authority);
    const issued = authority.issue("form-A", S.shape());   // R3/R3_FAB 도 전체 shape mount
    reconciler.mount(p, issued, doc);
    cell.authority = authority;
    cell.reconciler = reconciler;
    cell.cIssuedUserId = issued.children[0].id;            // 관찰된 발급 id (payload 에 존재)
  }
}

function apply(model, scenario) {
  const p = parentEl();
  const doc = document;
  let verdict = null;
  let rejected = null;

  if (model === "A") {
    if (scenario === "R1") InnerHTMLSwap.apply(p, S.html(S.R1_EXTRA));
    else if (scenario === "R2") InnerHTMLSwap.apply(p, S.html());
    else InnerHTMLSwap.apply(p, `<input type="text" name="${S.ATTACKER_NAME}">`);
  } else if (model === "B") {
    if (scenario === "R1") KeyedReconcile.apply(p, S.keyedTree(S.R1_EXTRA), doc);
    else if (scenario === "R2") KeyedReconcile.apply(p, S.keyedTree(), doc); // 같은 key 유지
    else KeyedReconcile.apply(p, S.attackerKeyedTree(), doc);
  } else if (model === "D") {
    if (scenario === "R1") ServerIdReconcile.apply(p, S.serverIdTree(cell.dIds, S.R1_EXTRA), doc);
    else if (scenario === "R2") ServerIdReconcile.apply(p, S.serverIdTree({ user: "sid-user-v2", email: "e2", submit: "s2" }), doc);
    else ServerIdReconcile.apply(p, S.attackerServerIdTree(cell.victimId), doc);
  } else if (model === "C") {
    const { authority, reconciler } = cell;
    if (scenario === "R1") verdict = reconciler.reconstruct(p, authority.issue("form-A", S.shape(S.R1_EXTRA)), doc).status;
    else if (scenario === "R2") verdict = reconciler.reconstruct(p, authority.issue("form-B", S.shape()), doc).status;
    else if (scenario === "R3_FAB") {
      // C 고유: 발급된 적 없는(fabricated) id 는 권위 대장(isIssued)에서 거부
      const v = reconciler.reconstruct(p, S.attackerForgedIdTree("auth:form-A:user#9999"), doc);
      verdict = v.status;
      rejected = v.rejected;
    } else {
      // R3 공통표면: 관찰된 '발급된' id replay → B/D 와 동일하게 재사용되어 뚫림
      const replay = { children: [{ id: cell.cIssuedUserId, tag: "input",
        attrs: { type: "text", name: S.ATTACKER_NAME } }] };
      const v = reconciler.reconstruct(p, replay, doc);
      verdict = v.status; rejected = v.rejected;
    }
  }

  let res;
  if (scenario === "R1") res = S.judgePreserve(p);
  else if (scenario === "R2") res = S.judgeDiscard(p);
  else res = S.judgeForgery(p);
  return { ...res, verdict, rejected };
}

window.c4_setup = setup;
window.c4_apply = apply;
window.__c4Ready = true;
