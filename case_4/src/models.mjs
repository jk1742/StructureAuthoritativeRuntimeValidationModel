/* =====================================================================
 * src/models.mjs — Baseline reconcilers (Model A / B / D)
 * ---------------------------------------------------------------------
 * 비교 대상 baseline 3종. 권위 모델 C 는 src/identity.mjs 에 분리.
 *
 *   A. innerHTML swap   — 정합성 기준 없음(완전 재생성)
 *   B. keyed reconcile  — 정합성 기준 = developer 제공 key (hint)
 *   D. server-id reconcile — 정합성 기준 = server 발급 id (응답에 실려 옴 = client-reachable)
 *
 * B 와 D 는 알고리즘이 동일하고 '매칭 식별자'만 다르다(key vs server-id).
 * 이 동일성이 핵심: 두 모델 모두 식별자를 응답에서 그대로 신뢰하므로 R3 에서
 * 공격자가 식별자를 위조하면 그대로 뚫린다. (HANDOFF case4-extension §2)
 *
 * ※ 측정축 주의(HANDOFF §5): 논문 탐지 수치의 Model B 는 '실 React'(react/)로
 *   측정한다. 본 JSDOM 구현 B 는 로직/판정 정의 검증용(비대표 참조).
 * ===================================================================== */

// (A) innerHTML swap — HTMX hx-swap=innerHTML 패턴의 최소형
export const InnerHTMLSwap = {
  apply(parent, newHtml) {
    parent.innerHTML = newHtml;
  },
};

// B/D 공통 reconcile 본체. domAttr = DOM 속성명, treeField = 엔티티 필드명.
function reconcileByAttr(parentDom, newChildren, domAttr, treeField, doc, skip = false) {
  const existing = new Map();
  for (const ch of Array.from(parentDom.children)) {
    const k = ch.getAttribute(domAttr);
    if (k) existing.set(k, ch);
  }
  const used = new Set();
  const finalNodes = [];

  for (const nc of newChildren) {
    const matchKey = nc[treeField];
    let node = existing.get(matchKey);
    if (node) {
      // 같은 식별자 → 재사용(attribute patch). 사용자 입력값/노드 그대로 잔존.
      for (const a of Object.keys(nc.attrs || {})) {
        if (skip && node.getAttribute(a) === String(nc.attrs[a])) continue; // ① 변경 없으면 스킵
        node.setAttribute(a, nc.attrs[a]);
      }
      used.add(matchKey);
    } else {
      node = doc.createElement(nc.tag);
      if (matchKey != null) node.setAttribute(domAttr, matchKey);
      for (const a of Object.keys(nc.attrs || {})) node.setAttribute(a, nc.attrs[a]);
    }
    finalNodes.push(node);
  }
  for (const [k, n] of existing) if (!used.has(k) && n.parentNode) n.remove();
  for (let i = 0; i < finalNodes.length; i++) { // ② 이미 제자리면 appendChild 스킵
    const n = finalNodes[i];
    if (skip && parentDom.children[i] === n) continue;
    parentDom.appendChild(n);
  }
}

// (B) keyed reconcile — 매칭 식별자 = data-key
export const KeyedReconcile = {
  apply(parent, tree, doc, skip = false) {
    reconcileByAttr(parent, tree.children || [], "data-key", "key", doc, skip);
  },
};

// (D) server-id reconcile — 매칭 식별자 = data-server-id (응답이 실어 보냄)
export const ServerIdReconcile = {
  apply(parent, tree, doc, skip = false) {
    reconcileByAttr(parent, tree.children || [], "data-server-id", "serverId", doc, skip);
  },
};
