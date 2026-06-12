/* =====================================================================
 * react/case4_react_overhead.js — React 18.3.1 재구성 시간 참조선 (production)
 * ---------------------------------------------------------------------
 * 목적: A/B/C/D(직접 구현 코어 reconcile)와 같은 입력·같은 프로토콜(N-스케일,
 *       재사용 경로, batch K, RUNS 중앙값)로 '실 프레임워크 참조선'을 측정.
 *
 * 정직성 경계(캡션에 명시할 것):
 * '변경 있는 재구성'((가) 전부 변경)으로 직접구현 B/C/D 와 동일 조건 측정.
 *   - 두 변형(data-rev "a"/"b") 배열을 번갈아 setState → 매 flushSync 마다 React 가
 *     모든 N 개 input 의 data-rev 속성을 실제 commit(같은 key 유지=재사용, 속성만 변경).
 *   - data-rev 는 '제어 prop'이라 React 가 DOM 에 반드시 반영(비제어 defaultValue 와 달리
 *     스킵되지 않음 → 공정 비교).
 *   - 이 측정은 React 의 state→reconcile→commit '전체'를 포함한다(코어 reconcile
 *     만이 아님). 따라서 B(직접 구현)와 직접 비교가 아니라 'framework reference'.
 *   - production UMD 사용(개발 빌드 경고/체크 제외) → 실제 런타임 비용에 근접.
 *   - 재구성 1회 = flushSync(setState) 로 commit 까지 '동기' 강제한 구간.
 *     (rAF/microtask 경계 잡음 배제 → batch 측정의 전제인 정확도 확보)
 *   - 재사용 경로 = 같은 key 유지 리렌더(값만 갱신).
 *
 * 전역: window.c4react_setup(n) / window.c4react_timeK(K) / window.__reactReady
 * 드라이버(run-overhead.mjs)가 호출. React/ReactDOM 은 production UMD 전역.
 * ===================================================================== */
(function () {
  if (typeof React === "undefined" || typeof ReactDOM === "undefined") {
    window.__reactError = "React/ReactDOM 전역 없음 (vendor production UMD 확인).";
    return;
  }
  const h = React.createElement;
  const { useState } = React;
  const flushSync = ReactDOM.flushSync;

  let setItemsRef = null;
  let root = null;

  // N 개 input 을 렌더하는 리스트(직접 구현과 동일 입력: name=f{i}, 같은 key 유지)
  function App(props) {
    const [items, setItems] = useState(props.initial);
    setItemsRef = setItems;
    return h(
      "div",
      null,
      items.map((it) =>
        h("input", { key: it.key, type: "text", name: it.name, "data-rev": it.rev })
      )
    );
  }

  function makeItems(n, rev) {
    const a = [];
    for (let i = 0; i < n; i++) a.push({ key: "k" + i, name: "f" + i, rev });
    return a;
  }

  // setup: N 개 마운트(측정 밖). 재사용 입력(같은 key) 준비.
  window.c4react_setup = function (n) {
    const el = document.getElementById("root");
    if (root) root.unmount();
    root = ReactDOM.createRoot(el);
    window.__itemsA = makeItems(n, "a"); // 두 변형 미리 생성(timed 밖)
    window.__itemsB = makeItems(n, "b");
    window.__i = 0;
    flushSync(function () { root.render(h(App, { initial: window.__itemsA })); });
  };

  // 재구성 1회: 두 변형을 번갈아 → 모든 노드 data-rev 변경(전부 변경). commit 동기.
  window.c4react_timeK = function (K) {
    const t0 = performance.now();
    for (let i = 0; i < K; i++) {
      const useB = (window.__i++ & 1) === 1;
      const items = useB ? window.__itemsB : window.__itemsA;
      flushSync(function () { setItemsRef(items); });
    }
    return performance.now() - t0;
  };

  window.__reactReady = true;
})();
