/* =====================================================================
 * src/identity.mjs — Reconstruction Authority + Identity Reconciler (Model C)
 * ---------------------------------------------------------------------
 * 권위 모델 C 의 핵심 전제(논문 §4.2): entity id 는 client/developer 가 발급하는
 * hint(=keyed 의 key)가 아니라, 외부 권위가 발급하는 단방향 lineage 의 일부다.
 * 따라서 권위는 reconciler/test 와 분리된 별개 actor 다.
 *
 * 기존 case4_experiment.js 대비 [추가]:
 *   - issuedIds(Set) + isIssued(id): 권위 발급 대장. 재구성기가 reuse 직전 검증.
 *   - reconstruct 의 위조(권위 미발급 id) 분기: reject-and-DROP.
 *
 * ★ 위협 모델 결정(작성자 확정): 공격자는 same-origin 권한으로 재구성 응답을
 *   임의 합성·주입할 수 있으나, 권위의 발급 대장(서버측 비밀)에는 도달 못 한다.
 *   권위 id 탈취는 Case 1 L5(권위 손상=supply-chain)로 위협모델 경계 밖.
 *   (HANDOFF_2026-06-08_day5.md "Undetected by design" 경계 행과 통일)
 *
 * ★ 재구성 처리 결정(작성자 확정): "검출되면 폐기한다(reject-and-drop)".
 *   권위 미발급 id 가 검출되면 위조 subtree 를 생성/바인딩하지 않고 폐기하며,
 *   같은 위치의 정당한 이전 노드는 보존한다(위조 응답이 live DOM 을 훼손 못 함).
 * ===================================================================== */

export function createReconstructionAuthority() {
  // lineageToken -> { ids: Map<slot, id>, revision }
  const lineages = new Map();
  const issuedIds = new Set(); // 권위가 실제 발급한 id 전체(발급 대장)
  let idCounter = 0;

  // shape(클라이언트 제출, id 없음): { children: [{ slot, tag, attrs, children? }] }
  // 반환: id 가 찍힌 엔티티 트리(재구성기가 소비하는 형식)
  function issue(lineageToken, shape) {
    let lineage = lineages.get(lineageToken);
    if (!lineage) {
      lineage = { ids: new Map(), revision: 0 }; // 새 lineage = 이전과 단절
      lineages.set(lineageToken, lineage);
    }
    lineage.revision += 1;

    function stamp(node) {
      let id = lineage.ids.get(node.slot);
      if (!id) {
        id = `auth:${lineageToken}:${node.slot}#${++idCounter}`;
        lineage.ids.set(node.slot, id);
        issuedIds.add(id); // 발급 시 대장 등록
      }
      return {
        id, // authority-issued (클라이언트가 직접 못 씀)
        tag: node.tag,
        attrs: node.attrs || {},
        revision: lineage.revision,
        children: (node.children || []).map(stamp),
      };
    }
    return { children: (shape.children || []).map(stamp) };
  }

  // 권위 발급 검증 — 외부 비밀(대장) 대조. 공격자는 이 함수/대장을 못 만진다.
  function isIssued(id) {
    return issuedIds.has(id);
  }

  return { issue, isIssued, _lineages: lineages };
}

export function createIdentityReconciler(authority) {
  const indexMap = new Map(); // entity.id -> { entity, node }
  const weakNodeMap = new WeakMap(); // node -> entity.id

  function mount(parent, tree, doc) {
    function build(e) {
      const el = doc.createElement(e.tag);
      for (const a of Object.keys(e.attrs || {})) el.setAttribute(a, e.attrs[a]);
      indexMap.set(e.id, { entity: e, node: el });
      weakNodeMap.set(el, e.id);
      for (const c of e.children || []) el.appendChild(build(c));
      return el;
    }
    for (const c of tree.children || []) parent.appendChild(build(c));
  }

  /**
   * 반환 verdict (FrameCover Algorithm 2 어휘 정렬):
   *   { status, reused[], created[], rejected[{ position, staleId, canonicalId, reason, action }] }
   *   reason: "new-lineage"(정상 R2) | "forged-id-not-issued"(R3 위조)
   *   action: "recreated"(R2) | "discarded"(R3)
   */
  function reconstruct(parent, newTree, doc) {
    const verdict = { status: "RECONSTRUCTED", reused: [], created: [], rejected: [] };
    const newChildren = newTree.children || [];
    const stale = Array.from(parent.children);
    const newIdSet = new Set();
    const preserveStaleIds = new Set(); // 위조 거부 시 보존할 이전 정당 노드 id
    const finalNodes = [];

    newChildren.forEach((nc, i) => {
      newIdSet.add(nc.id);
      const hit = indexMap.get(nc.id);
      const authentic = authority.isIssued(nc.id); // 권위 발급 검증

      if (hit && authentic) {
        // (1) R1 정상 연속성: 권위 발급 같은 id → 재사용
        const node = hit.node;
        for (const a of Object.keys(nc.attrs || {})) node.setAttribute(a, nc.attrs[a]);
        weakNodeMap.set(node, nc.id);
        verdict.reused.push(nc.id);
        finalNodes.push(node);
      } else if (authentic) {
        // (2) R2 정상 새 lineage: 권위 발급된 다른 id → 새 노드 생성(이전 노드 폐기)
        const prior = stale[i];
        if (prior) {
          const priorId = weakNodeMap.get(prior);
          if (priorId && priorId !== nc.id) {
            verdict.status = "RECONSTRUCTION_REJECTED";
            verdict.rejected.push({ position: i, staleId: priorId, canonicalId: nc.id, reason: "new-lineage", action: "recreated" });
          }
        }
        const node = doc.createElement(nc.tag);
        for (const a of Object.keys(nc.attrs || {})) node.setAttribute(a, nc.attrs[a]);
        indexMap.set(nc.id, { entity: nc, node });
        weakNodeMap.set(node, nc.id);
        verdict.created.push(nc.id);
        finalNodes.push(node);
      } else {
        // (3) R3 위조: 권위 미발급 id 검출 → 폐기(reject-and-drop). 생성/바인딩 안 함.
        const prior = stale[i];
        const priorId = prior ? weakNodeMap.get(prior) : null;
        verdict.status = "RECONSTRUCTION_REJECTED";
        verdict.rejected.push({ position: i, staleId: priorId || null, canonicalId: nc.id, reason: "forged-id-not-issued", action: "discarded" });
        newIdSet.delete(nc.id); // 위조 id 는 보존 대상이 아님
        if (prior && priorId) { preserveStaleIds.add(priorId); finalNodes.push(prior); }
      }
    });

    // 새 트리에 없고 보존 대상도 아닌 이전 노드만 제거
    for (const old of stale) {
      const oid = weakNodeMap.get(old);
      if (oid && !newIdSet.has(oid) && !preserveStaleIds.has(oid)) {
        indexMap.delete(oid);
        if (old.parentNode) old.remove();
      }
    }
    for (const n of finalNodes) parent.appendChild(n);
    return verdict;
  }

  return { mount, reconstruct, _internal: { indexMap, weakNodeMap } };
}
