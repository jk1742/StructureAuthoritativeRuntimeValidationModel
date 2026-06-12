/* =====================================================================
 * chromium/overhead-harness.mjs — overhead 시간 측정 하니스 (실 Chromium)
 * ---------------------------------------------------------------------
 * src/*.mjs + bench/builders.mjs 그대로 import(측정==배포 코드 일치).
 * 드라이버가 window.c4setup / window.c4timeK 호출.
 *
 * 측정 대상: '변경 있는 재구성'(작성자 확정 (가) 전부 변경).
 *   - setup 에서 두 변형 트리(data-rev "a"/"b", 식별자 동일)를 미리 생성(timed 밖).
 *   - reconstructOnce 가 둘을 번갈아 적용 → 매 회 모든 N 노드의 data-rev 가 달라
 *     setAttribute 가 N 번 실제 발생(식별자 동일 → 재사용 경로 유지, appendChild 는
 *     위치 동일이라 skip). 즉 식별·검증 + 실제 attr 패치(N회) 비용을 함께 잰다.
 *   - skip=true: 변경 없는 속성(type/name)은 스킵, 바뀐 data-rev 만 기록 → React diff 와 동등.
 * ===================================================================== */
import { InnerHTMLSwap, KeyedReconcile, ServerIdReconcile } from "../src/models.mjs";
import { createReconstructionAuthority, createIdentityReconciler } from "../src/identity.mjs";
import { htmlN, keyedTreeN, serverIdTreeN, shapeN } from "../bench/builders.mjs";

const state = {};
const parentEl = () => document.getElementById("parent");

// 초기 mount + 재구성 입력 pre-build (모두 untimed)
function setup(model, n) {
  const p = parentEl();
  p.innerHTML = "";
  const doc = document;
  state.model = model;
  state.i = 0;
  if (model === "A") {
    state.htmlA = htmlN(n, "a");
    state.htmlB = htmlN(n, "b");
    InnerHTMLSwap.apply(p, state.htmlA);
  } else if (model === "B") {
    state.treeA = keyedTreeN(n, "a");
    state.treeB = keyedTreeN(n, "b");
    KeyedReconcile.apply(p, state.treeA, doc, true);
  } else if (model === "D") {
    state.treeA = serverIdTreeN(n, "a");
    state.treeB = serverIdTreeN(n, "b");
    ServerIdReconcile.apply(p, state.treeA, doc, true);
  } else if (model === "C") {
    const authority = createReconstructionAuthority();
    const reconciler = createIdentityReconciler(authority);
    // 같은 lineageToken → 같은 id(재사용 경로), data-rev 만 다른 두 발급분
    state.treeA = authority.issue("bench", shapeN(n, "a"));
    state.treeB = authority.issue("bench", shapeN(n, "b"));
    reconciler.mount(p, state.treeA, doc);
    state.reconciler = reconciler;
  }
}

// 재구성 1회: 두 변형을 번갈아 → 매 회 모든 노드 data-rev 변경(전부 변경).
function reconstructOnce() {
  const p = parentEl();
  const doc = document;
  const m = state.model;
  const useB = (state.i++ & 1) === 1;
  if (m === "A") InnerHTMLSwap.apply(p, useB ? state.htmlB : state.htmlA);
  else if (m === "B") KeyedReconcile.apply(p, useB ? state.treeB : state.treeA, doc, true);
  else if (m === "D") ServerIdReconcile.apply(p, useB ? state.treeB : state.treeA, doc, true);
  else if (m === "C") state.reconciler.reconstruct(p, useB ? state.treeB : state.treeA, doc, true);
}

// K회 반복 구간의 경과 ms (batch). 드라이버가 K 보정·다회 측정.
function timeK(K) {
  const t0 = performance.now();
  for (let i = 0; i < K; i++) reconstructOnce();
  return performance.now() - t0;
}

window.c4setup = setup;
window.c4timeK = timeK;
window.__benchReady = true;