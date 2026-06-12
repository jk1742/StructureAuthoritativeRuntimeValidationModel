/*
 * react/case4_react.js — Model B (real React keyed reconcile) under test
 */
(function () {
  "use strict";
  try {
    if (typeof React === "undefined" || typeof ReactDOM === "undefined") {
      throw new Error(
        "React/ReactDOM missing."
      );
    }
    const h = React.createElement;
    const { useState } = React;

  let setLabel;
  let setKey;
  let setName;

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

    rerenderSameKey: async function (newLabel) {
      setLabel(newLabel || "def-v2");
      await flush();
    },

    rerenderNewKey: async function (newLabel) {
      setKey("k2");
      setLabel(newLabel || "def-v2");
      await flush();
    },

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
