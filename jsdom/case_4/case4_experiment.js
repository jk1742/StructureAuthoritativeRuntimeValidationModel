/**
 * Case 4 : Runtime Reconstruction in Component Environment
 *
 * 비교 모델 (3-way, 모두 최소 구조)
 *
 *  (A) innerHTML swap baseline
 *      - server가 새 HTML fragment를 보냄
 *      - client는 parent.innerHTML = newHtml 으로 전체 재생성
 *      - 정합성 보장 없음
 *
 *  (B) Keyed reconcile baseline
 *      - server가 새 entity tree를 보냄
 *      - 각 element는 key attribute를 가짐
 *      - 동일 key의 child는 재사용, 다른 key는 새로 생성
 *      - 정합성 기준 : developer-provided key
 *
 *  (C) Identity reconciliation (proposed)
 *      - server가 새 entity tree를 보냄 (entity.id 포함)
 *      - indexMap 기반 entity id 매칭
 *      - 동일 entity id면 기존 DOM node 재사용 + WeakNodeMap rebind
 *      - 정합성 기준 : authority-issued entity id lineage
 *
 * 시나리오
 *
 *  R1. Runtime state preservation
 *      - 사용자가 input#user 에 "user-typed-value" 입력
 *      - server가 같은 form의 새 정의를 내려보냄 (구조 동일, attribute만 변경)
 *      - 동일 entity 식별자로 매칭되어 input.value 가 보존되는가?
 *
 *      A : innerHTML swap   -> 입력 손실 (재생성)
 *      B : keyed reconcile  -> key 동일 -> 보존
 *      C : identity         -> entity id 동일 -> 보존
 *
 *  R2. Identity-aware reconstruction
 *      - 사용자가 input#user 에 "user-typed-value" 입력
 *      - server가 시각적으로 동일하지만 다른 entity id 를 가진 새 form 을 내려보냄
 *      - (= business 차원에서 "이전 form은 폐기, 새 form 시작" 을 의미)
 *      - 잘못된 재사용을 막을 수 있는가?
 *
 *      A : innerHTML swap   -> 입력 손실 (재생성)        -> 정상 (재사용 안함)
 *      B : keyed reconcile  -> key 가 동일하면 잘못 재사용 -> FALSE REUSE
 *      C : identity         -> entity id 다름 -> 정확히 새로 생성 -> 정상
 */

const { JSDOM } = require("jsdom");

// ============================================================
// (A) innerHTML swap baseline
// ============================================================
const InnerHTMLSwap = {
  apply(parent, newHtml) {
    // 가장 단순한 server-driven swap (HTMX hx-swap=innerHTML 류 패턴)
    parent.innerHTML = newHtml;
  },
};

// ============================================================
// (B) Keyed reconcile baseline
// ============================================================
const KeyedReconcile = {
  /**
   * 새 entity tree를 받아 keyed reconcile 수행
   *
   * entity tree 형식:
   *   { key, tag, attrs:{}, children:[...] }
   *
   * 알고리즘:
   *   - 동일 parent 안에서 key 기반 child 매칭
   *   - key 일치 시 기존 DOM node 재사용 (attribute만 patch)
   *   - 불일치 시 새 DOM node 생성
   */
  apply(parent, newEntityTree, doc) {
    function reconcileChildren(parentDom, newChildren) {
      const existing = new Map();
      for (let i = 0; i < parentDom.children.length; i++) {
        const ch = parentDom.children[i];
        const k = ch.getAttribute("data-key");
        if (k) existing.set(k, ch);
      }

      // 새 children 순서대로 처리
      const used = new Set();
      const finalNodes = [];

      for (const newChild of newChildren) {
        let node = existing.get(newChild.key);
        if (node) {
          // 재사용 - attribute patch
          patchNode(node, newChild);
          used.add(newChild.key);
        } else {
          // 새로 생성
          node = createNode(newChild, doc);
        }
        finalNodes.push(node);
        if (newChild.children && newChild.children.length > 0) {
          reconcileChildren(node, newChild.children);
        }
      }

      // 사용되지 않은 기존 children 제거
      for (const [k, n] of existing) {
        if (!used.has(k) && n.parentNode) n.parentNode.removeChild(n);
      }

      // 최종 순서로 재배열
      for (const n of finalNodes) {
        parentDom.appendChild(n);
      }
    }

    function patchNode(node, entity) {
      // tag mismatch는 다루지 않음 (가장 단순한 keyed reconcile)
      for (const k of Object.keys(entity.attrs || {})) {
        node.setAttribute(k, entity.attrs[k]);
      }
    }

    function createNode(entity, doc) {
      const el = doc.createElement(entity.tag);
      if (entity.key) el.setAttribute("data-key", entity.key);
      for (const k of Object.keys(entity.attrs || {})) {
        el.setAttribute(k, entity.attrs[k]);
      }
      return el;
    }

    reconcileChildren(parent, newEntityTree.children || []);
  },
};

// ============================================================
// (C) Identity reconciliation (proposed)
// ============================================================
function createIdentityReconciler() {
  const indexMap = new Map();       // entity.id -> { entity, node }
  const weakNodeMap = new WeakMap(); // node -> entity.id

  /**
   * 최초 mount : entity tree를 DOM에 반영하고 indexMap/WeakNodeMap 구축
   *
   * entity tree 형식:
   *   { id, tag, attrs:{}, children:[...] }
   *
   * - id 는 authority(server)가 발급한 entity 식별자
   * - id 는 lineage 의 일부이며 client 가 임의로 발급할 수 없음
   */
  function mount(parent, entityTree, doc) {
    function build(entity) {
      const el = doc.createElement(entity.tag);
      for (const k of Object.keys(entity.attrs || {})) {
        el.setAttribute(k, entity.attrs[k]);
      }
      indexMap.set(entity.id, { entity, node: el });
      weakNodeMap.set(el, entity.id);

      for (const child of entity.children || []) {
        el.appendChild(build(child));
      }
      return el;
    }

    for (const child of entityTree.children || []) {
      parent.appendChild(build(child));
    }
  }

  /**
   * Reconstruction : 새 entity tree 적용
   *
   * 알고리즘
   *   - 새 entity tree 의 각 entity 에 대해
   *     - indexMap 에 동일 id 가 있으면 기존 node 재사용 (binding 유지)
   *     - 없으면 새 node 생성 + 등록
   *   - 사용되지 않은 기존 entity 는 unbind 후 제거
   *
   * 핵심 차이점 (vs keyed reconcile)
   *   - id 는 client/developer 가 제공한 hint 가 아니라
   *     authority lineage 의 일부
   *   - 동일 id 는 동일 entity 의 연속성을 *보장* (단방향 lineage)
   *   - 다른 id 면 같은 형태여도 별개 entity 로 처리
   */
  function reconstruct(parent, newEntityTree, doc) {
    function reconcileChildren(parentDom, newChildren) {
      const newIdSet = new Set();
      const finalNodes = [];

      for (const newChild of newChildren) {
        newIdSet.add(newChild.id);
        let node;
        const existing = indexMap.get(newChild.id);
        if (existing) {
          // 재사용 - identity binding 유지
          node = existing.node;
          // attrs patch
          for (const k of Object.keys(newChild.attrs || {})) {
            node.setAttribute(k, newChild.attrs[k]);
          }
          existing.entity = newChild;
        } else {
          // 새 entity 생성
          node = doc.createElement(newChild.tag);
          for (const k of Object.keys(newChild.attrs || {})) {
            node.setAttribute(k, newChild.attrs[k]);
          }
          indexMap.set(newChild.id, { entity: newChild, node });
          weakNodeMap.set(node, newChild.id);
        }
        finalNodes.push({ node, entity: newChild });
      }

      // 사용되지 않은 entity 식별 후 제거
      const existingInParent = [];
      for (let i = 0; i < parentDom.children.length; i++) {
        existingInParent.push(parentDom.children[i]);
      }
      for (const oldNode of existingInParent) {
        const oldId = weakNodeMap.get(oldNode);
        if (oldId && !newIdSet.has(oldId)) {
          indexMap.delete(oldId);
          if (oldNode.parentNode) oldNode.parentNode.removeChild(oldNode);
        }
      }

      // 최종 순서로 재배열
      for (const { node, entity } of finalNodes) {
        parentDom.appendChild(node);
        if (entity.children && entity.children.length > 0) {
          reconcileChildren(node, entity.children);
        }
      }
    }

    reconcileChildren(parent, newEntityTree.children || []);
  }

  return { mount, reconstruct, _internal: { indexMap, weakNodeMap } };
}

// ============================================================
// 시나리오 유틸
// ============================================================
function buildBaseDom() {
  return new JSDOM(`<!doctype html><html><head></head><body>
    <form id="parent"></form>
  </body></html>`);
}

// 동일한 form 정의를 각 모델 형식으로 표현
function initialEntityTreeForIdentity() {
  return {
    children: [
      { id: "e-user",   tag: "input",    attrs: { type: "text",     name: "user"  }, children: [] },
      { id: "e-email",  tag: "input",    attrs: { type: "email",    name: "email" }, children: [] },
      { id: "e-submit", tag: "button",   attrs: { type: "submit" },                  children: [] },
    ],
  };
}
function initialEntityTreeForKeyed() {
  return {
    children: [
      { key: "user",   tag: "input",  attrs: { type: "text",     name: "user"  }, children: [] },
      { key: "email",  tag: "input",  attrs: { type: "email",    name: "email" }, children: [] },
      { key: "submit", tag: "button", attrs: { type: "submit" },                  children: [] },
    ],
  };
}
function initialHTML() {
  return `<input type="text"  name="user">
          <input type="email" name="email">
          <button type="submit"></button>`;
}

// R1 : 같은 entity, 단순히 attribute 변경 (예 : maxlength 추가)
function r1_updatedEntityTreeForIdentity() {
  return {
    children: [
      { id: "e-user",   tag: "input",  attrs: { type: "text",  name: "user",  maxlength: "32" }, children: [] },
      { id: "e-email",  tag: "input",  attrs: { type: "email", name: "email", maxlength: "64" }, children: [] },
      { id: "e-submit", tag: "button", attrs: { type: "submit" },                                children: [] },
    ],
  };
}
function r1_updatedEntityTreeForKeyed() {
  return {
    children: [
      { key: "user",   tag: "input",  attrs: { type: "text",  name: "user",  maxlength: "32" }, children: [] },
      { key: "email",  tag: "input",  attrs: { type: "email", name: "email", maxlength: "64" }, children: [] },
      { key: "submit", tag: "button", attrs: { type: "submit" },                                children: [] },
    ],
  };
}
function r1_updatedHTML() {
  return `<input type="text"  name="user"  maxlength="32">
          <input type="email" name="email" maxlength="64">
          <button type="submit"></button>`;
}

// R2 : 시각적으로 동일하나 다른 entity id (이전 form 폐기, 새 form 시작)
//      authority lineage 가 끊긴 상황
function r2_replacedEntityTreeForIdentity() {
  return {
    children: [
      // entity id 가 모두 새로 발급됨 (e-user2 등)
      { id: "e-user2",   tag: "input",  attrs: { type: "text",  name: "user"  }, children: [] },
      { id: "e-email2",  tag: "input",  attrs: { type: "email", name: "email" }, children: [] },
      { id: "e-submit2", tag: "button", attrs: { type: "submit" },               children: [] },
    ],
  };
}
function r2_replacedEntityTreeForKeyed() {
  // keyed reconcile 의 한계: developer가 같은 key를 부여하면 같은 것으로 간주
  // 실제로 비즈니스에서 "이전 form 폐기"임에도 developer 가 key 를 동일하게 유지하면
  // baseline B 는 잘못 재사용
  return {
    children: [
      { key: "user",   tag: "input",  attrs: { type: "text",  name: "user"  }, children: [] },
      { key: "email",  tag: "input",  attrs: { type: "email", name: "email" }, children: [] },
      { key: "submit", tag: "button", attrs: { type: "submit" },               children: [] },
    ],
  };
}
function r2_replacedHTML() {
  return initialHTML(); // 시각적으로 동일
}

// ============================================================
// 시나리오 실행
// ============================================================
const results = [];

function runScenario(label, description, simulate) {
  const r = simulate();
  results.push({ label, description, ...r });
}

// ------------------------------------------------------------
// R1 : Runtime state preservation
// ------------------------------------------------------------

// R1-A: innerHTML swap
runScenario("R1-A", "innerHTML swap : runtime state preservation", () => {
  const dom = buildBaseDom();
  const doc = dom.window.document;
  const parent = doc.getElementById("parent");
  parent.innerHTML = initialHTML();

  // 사용자 입력 (mount 후)
  const userInput = parent.querySelector('input[name="user"]');
  userInput.value = "user-typed-value";

  // server reconstruction 발동
  InnerHTMLSwap.apply(parent, r1_updatedHTML());

  // 새 input 의 value 확인
  const newUserInput = parent.querySelector('input[name="user"]');
  const preserved = newUserInput.value === "user-typed-value";
  const maxlengthApplied = newUserInput.getAttribute("maxlength") === "32";

  dom.window.close();
  return { preserved, maxlengthApplied, expected: "lost" };
});

// R1-B: keyed reconcile
runScenario("R1-B", "keyed reconcile : runtime state preservation", () => {
  const dom = buildBaseDom();
  const doc = dom.window.document;
  const parent = doc.getElementById("parent");

  // 초기 mount
  KeyedReconcile.apply(parent, initialEntityTreeForKeyed(), doc);

  // 사용자 입력
  const userInput = parent.querySelector('input[name="user"]');
  userInput.value = "user-typed-value";

  // reconstruction
  KeyedReconcile.apply(parent, r1_updatedEntityTreeForKeyed(), doc);

  // 동일 key 매칭 -> 재사용 -> value 보존
  const newUserInput = parent.querySelector('input[name="user"]');
  const preserved = newUserInput.value === "user-typed-value";
  const maxlengthApplied = newUserInput.getAttribute("maxlength") === "32";

  dom.window.close();
  return { preserved, maxlengthApplied, expected: "preserved" };
});

// R1-C: identity reconciliation (proposed)
runScenario("R1-C", "identity reconciliation : runtime state preservation", () => {
  const dom = buildBaseDom();
  const doc = dom.window.document;
  const parent = doc.getElementById("parent");

  const reconciler = createIdentityReconciler();
  reconciler.mount(parent, initialEntityTreeForIdentity(), doc);

  // 사용자 입력
  const userInput = parent.querySelector('input[name="user"]');
  userInput.value = "user-typed-value";

  // reconstruction (동일 entity id 유지)
  reconciler.reconstruct(parent, r1_updatedEntityTreeForIdentity(), doc);

  const newUserInput = parent.querySelector('input[name="user"]');
  const preserved = newUserInput.value === "user-typed-value";
  const maxlengthApplied = newUserInput.getAttribute("maxlength") === "32";

  dom.window.close();
  return { preserved, maxlengthApplied, expected: "preserved" };
});

// ------------------------------------------------------------
// R2 : Identity-aware reconstruction
// ------------------------------------------------------------

// R2-A: innerHTML swap (예상: 항상 재생성, value 손실)
runScenario("R2-A", "innerHTML swap : identity-aware reconstruction", () => {
  const dom = buildBaseDom();
  const doc = dom.window.document;
  const parent = doc.getElementById("parent");
  parent.innerHTML = initialHTML();

  const userInput = parent.querySelector('input[name="user"]');
  userInput.value = "user-typed-value";

  InnerHTMLSwap.apply(parent, r2_replacedHTML());

  const newUserInput = parent.querySelector('input[name="user"]');
  const valueAfter = newUserInput.value;

  // 판정: 이전 entity 폐기가 정상이면 value는 손실되어야 함
  const identityRespected = valueAfter === "";  // 손실 = 정상

  dom.window.close();
  return {
    valueAfter,
    identityRespected,
    outcome: identityRespected ? "correctly_discarded" : "incorrectly_preserved",
  };
});

// R2-B: keyed reconcile (예상: key 같으면 잘못 재사용)
runScenario("R2-B", "keyed reconcile : identity-aware reconstruction", () => {
  const dom = buildBaseDom();
  const doc = dom.window.document;
  const parent = doc.getElementById("parent");

  KeyedReconcile.apply(parent, initialEntityTreeForKeyed(), doc);

  const userInput = parent.querySelector('input[name="user"]');
  userInput.value = "user-typed-value";

  // developer가 이전 폐기를 의도했지만 key를 동일하게 유지함 (key는 hint일 뿐)
  KeyedReconcile.apply(parent, r2_replacedEntityTreeForKeyed(), doc);

  const newUserInput = parent.querySelector('input[name="user"]');
  const valueAfter = newUserInput.value;

  // 비즈니스 의도는 폐기였으므로 value가 살아남으면 false reuse
  const identityRespected = valueAfter === "";

  dom.window.close();
  return {
    valueAfter,
    identityRespected,
    outcome: identityRespected ? "correctly_discarded" : "incorrectly_preserved",
  };
});

// R2-C: identity reconciliation (예상: id가 다르면 정확히 새로 생성)
runScenario("R2-C", "identity reconciliation : identity-aware reconstruction", () => {
  const dom = buildBaseDom();
  const doc = dom.window.document;
  const parent = doc.getElementById("parent");

  const reconciler = createIdentityReconciler();
  reconciler.mount(parent, initialEntityTreeForIdentity(), doc);

  const userInput = parent.querySelector('input[name="user"]');
  userInput.value = "user-typed-value";

  // authority가 새 lineage의 entity를 발급 (id가 다름)
  reconciler.reconstruct(parent, r2_replacedEntityTreeForIdentity(), doc);

  const newUserInput = parent.querySelector('input[name="user"]');
  const valueAfter = newUserInput.value;

  // id가 다르므로 새 node 생성 -> 비즈니스 의도(폐기) 정확히 반영
  const identityRespected = valueAfter === "";

  dom.window.close();
  return {
    valueAfter,
    identityRespected,
    outcome: identityRespected ? "correctly_discarded" : "incorrectly_preserved",
  };
});

// ============================================================
// 결과 출력
// ============================================================
console.log("\n=== Case 4 : Runtime Reconstruction (R1 + R2) ===\n");

// R1 결과
console.log("--- R1: Runtime state preservation ---");
console.log("(시나리오 : 동일 entity, attribute만 변경. 사용자 입력값이 보존되어야 함)\n");
const r1 = results.filter(r => r.label.startsWith("R1"));
console.table(r1.map(r => ({
  Model: r.label,
  Description: r.description.split(":")[0].trim(),
  "value preserved": r.preserved ? "YES" : "NO",
  "attribute applied": r.maxlengthApplied ? "YES" : "NO",
  Expected: r.expected,
})));

// R2 결과
console.log("\n--- R2: Identity-aware reconstruction ---");
console.log("(시나리오 : 시각적 동일하나 다른 entity. 이전 입력값이 폐기되어야 함)\n");
const r2 = results.filter(r => r.label.startsWith("R2"));
console.table(r2.map(r => ({
  Model: r.label,
  Description: r.description.split(":")[0].trim(),
  "value after": r.valueAfter,
  "identity respected": r.identityRespected ? "YES" : "NO  (FALSE REUSE)",
  Outcome: r.outcome,
})));

console.log("\n--- Summary ---");
console.log("R1 : 사용자 입력 보존 여부");
console.log(`  innerHTML swap     : ${r1[0].preserved ? "보존" : "손실"}`);
console.log(`  keyed reconcile    : ${r1[1].preserved ? "보존" : "손실"}`);
console.log(`  identity (proposed): ${r1[2].preserved ? "보존" : "손실"}`);
console.log("");
console.log("R2 : 잘못된 재사용 방지 여부");
console.log(`  innerHTML swap     : ${r2[0].identityRespected ? "정상" : "FALSE REUSE"}`);
console.log(`  keyed reconcile    : ${r2[1].identityRespected ? "정상" : "FALSE REUSE"}`);
console.log(`  identity (proposed): ${r2[2].identityRespected ? "정상" : "FALSE REUSE"}`);

require("fs").writeFileSync(
  "/home/claude/exp_case1/case4_result.json",
  JSON.stringify(results, null, 2)
);
console.log("\nJSON result -> /home/claude/exp_case1/case4_result.json");
