/*
 * react/case4_react_overhead.js — React 18.3.1
 */
(function () {
  if (typeof React === "undefined" || typeof ReactDOM === "undefined") {
    window.__reactError = "React/ReactDOM missing (vendor production UMD check).";
    return;
  }
  const h = React.createElement;
  const { useState } = React;
  const flushSync = ReactDOM.flushSync;

  let setItemsRef = null;
  let root = null;

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

  window.c4react_setup = function (n) {
    const el = document.getElementById("root");
    if (root) root.unmount();
    root = ReactDOM.createRoot(el);
    window.__itemsA = makeItems(n, "a");
    window.__itemsB = makeItems(n, "b");
    window.__i = 0;
    flushSync(function () { root.render(h(App, { initial: window.__itemsA })); });
  };

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
