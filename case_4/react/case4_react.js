/* =====================================================================
 * react/case4_react.js — Model B (real React keyed reconcile) under test
 * ---------------------------------------------------------------------
 * 탐지축(HANDOFF §5): 논문 Model B 수치는 '실 React'(이 하니스)로 측정한다.
 * 측정 목적: 같은 key 를 유지하는 동일 행동에서, React keyed reconcile 이
 *   R1(보존)·R2(lineage 단절)·R3(적대적 위장)에 각각 어떻게 반응하는지
 *   실 엔진(Firefox/Chromium)에서 관찰한다.
 *
 * 핵심 설계:
 *  - input 은 비제어(uncontrolled): defaultValue 만, value 미지정 → 사용자가 친
 *    DOM 값을 React 가 덮어쓰지 않는다(제어 컴포넌트면 측정 무의미).
 *  - "같은 entity 새 정의"와 "새 entity 같은 key"는 React 입장에선 구분 불가.
 *  - [R3 추가] '공격자가 같은 key 를 유지한 채 컴포넌트 정의만 악성으로 바꾸는'
 *    시나리오. React 는 같은 key 라 노드를 재사용 → 비제어 입력값이 악성 정의에
 *    그대로 옮겨붙는다 = 위장 성공. (권위 lineage 였다면 새 id 라 거부됐을 상황)
 * ===================================================================== */
(function () {
  "use strict";
  try {
    if (typeof React === "undefined" || typeof ReactDOM === "undefined") {
      throw new Error(
        "React/ReactDOM 전역이 없음. vendor/react.development.js, vendor/react-dom.development.js 가 " +
        "UMD(전역 노출) 빌드인지 확인 (React 19 는 UMD 폐지 → React 18 UMD 사용)."
      );
    }
    const h = React.createElement;
    const { useState } = React;

  let setLabel;
  let setKey;
  let setName; // [R3] input 의 name 을 공격자 값으로 바꾸는 트리거

  // 비제어 input 한 개를 담는 항목. label/name 만 props 로 바뀐다.
  function Item(props) {
    return h(
      "div",
      null,
      h("span", { className: "lbl" }, props.label),
      h("input", {
        type: "text",
        id: "probe-input",
        name: props.name || "user",
        defaultValue: "",
      })
    );
  }

  function App() {
    const [label, _setLabel] = useState("def-v1");
    const [itemKey, _setKey] = useState("k1");
    const [name, _setName] = useState("user");
    setLabel = _setLabel;
    setKey = _setKey;
    setName = _setName;
    return h("ul", null, h("li", { key: itemKey }, h(Item, { label, name })));
  }

  const root = ReactDOM.createRoot(document.getElementById("root"));
  root.render(h(App));

  // 리렌더는 비동기(배치) → rAF 2회로 flush.
  function flush() {
    return new Promise(function (resolve) {
      requestAnimationFrame(function () {
        requestAnimationFrame(resolve);
      });
    });
  }

  window.__case4 = {
    reactVersion: React.version,

    inputValue: function () {
      const el = document.getElementById("probe-input");
      return el ? el.value : null;
    },
    inputName: function () {
      const el = document.getElementById("probe-input");
      return el ? el.getAttribute("name") : null;
    },
    markNode: function () {
      const el = document.getElementById("probe-input");
      window.__probeNode = el;
      el.setAttribute("data-probe", "marked");
    },
    nodeReused: function () {
      const cur = document.getElementById("probe-input");
      return (
        window.__probeNode === cur &&
        !!cur &&
        cur.isConnected &&
        cur.getAttribute("data-probe") === "marked"
      );
    },

    // 시나리오 A(R1·R2 공유): 같은 key 유지, 새 정의로 리렌더.
    rerenderSameKey: async function (newLabel) {
      setLabel(newLabel || "def-v2");
      await flush();
    },

    // 시나리오 B(대조): key 를 'k1'→'k2'로 바꿔 리렌더.
    rerenderNewKey: async function (newLabel) {
      setKey("k2");
      setLabel(newLabel || "def-v2");
      await flush();
    },

    // 시나리오 C(R3): 같은 key 유지 + 컴포넌트를 악성 정의로 교체(name 을 공격자 값으로).
    //   → React 는 같은 key 라 노드 재사용 → 비제어 입력값이 악성 정의로 잔존 = 위장 성공.
    rerenderAttackerSameKey: async function (attackerName) {
      setName(attackerName || "attacker-controlled");
      setLabel("attacker-injected");
      await flush();
    },
  };

  window.__case4Ready = true;
  } catch (err) {
    window.__case4Error = String((err && err.stack) || err);
    // eslint-disable-next-line no-console
    console.error("[case4 harness] init failed:", window.__case4Error);
  }
})();
