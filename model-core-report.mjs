// model-core-report.mjs  (repo ROOT — 원본 model-core.mjs 옆에 둔다)
// =====================================================================
// 원본 model-core.mjs 는 한 글자도 바꾸지 않는다. 이 파일은 그 위에 얹는
// 얇은 래퍼로, 검증 로직의 단일 출처(원본 createRegistry)를 그대로 호출한다.
//   - createReportRegistry(doc): 원본 mount/commit 노출 + validateReport 추가.
//       validateReport 는 원본 validate 의 throw 를 잡아 { valid, issues } 로 환원.
//       원본은 첫 위반에서 throw 하므로 issues 는 0 또는 1개(detected 비교엔 충분).
//   - canonicalFromForm(root): 라이브 폼 -> 공통 mount 가 받는 최소 canonical 트리.
//
// 검증(작성자 로컬):
//   import { createRegistry } from "./model-core.mjs";
//   import { createReportRegistry, canonicalFromForm } from "./model-core-report.mjs";
//   * 원본 불변: createRegistry(doc).validate(root) 는 정상 true / 위반 throw 그대로.
//   * 래퍼: createReportRegistry(doc).validateReport(root) 는 { valid, issues }.
//   * case_3 T1~T4 의 detected(=!valid) 가 기존 결과와 일치하면 통과.
// =====================================================================
import { createRegistry } from "./model-core.mjs";

// throw 메시지 -> reason 코드 (원본 메시지 문구 기반)
function reasonOf(msg) {
  if (msg.includes("no binding")) return "no_binding";
  if (msg.includes("entity id not in indexMap")) return "no_canonical_entity";
  if (msg.includes("type mismatch")) return "type_mismatch";
  if (msg.includes("RUNTIME_STATE_FORGERY: checked")) return "checked_mismatch";
  if (msg.includes("RUNTIME_STATE_FORGERY: value")) return "value_mismatch";
  if (msg.includes("child count mismatch")) return "child_count_mismatch";
  if (msg.includes("text node missing")) return "displaced_text";
  if (msg.includes("unauthorized/displaced child")) return "displaced_child";
  if (msg.includes("unreached")) return "removed";
  return "unknown";
}

// 폼 -> 최소 canonical 트리 (case_3 어댑터). value-carrying 만 value truth.
export function canonicalFromForm(root) {
  let seq = 0;
  function build(node) {
    const tag = node.tagName.toLowerCase();
    const ent = { id: `c-${++seq}`, type: tag, children: [] };
    if (tag === "input" || tag === "textarea") ent.value = String(node.value ?? "");
    if (tag !== "textarea") {
      for (const n of node.childNodes) {
        if (n.nodeType === 1) ent.children.push(build(n));
        else if (n.nodeType === 3 && n.textContent.trim() !== "")
          ent.children.push({ id: `c-${++seq}`, type: "#text", children: [] });
      }
    }
    return ent;
  }
  return build(root);
}

// 원본 createRegistry 를 호출하고, validate 를 report 형태로 감싼 객체 반환.
// mount/commit 은 원본 그대로 노출.
export function createReportRegistry(doc) {
  const reg = createRegistry(doc);
  return {
    mount: reg.mount,
    commit: reg.commit,
    // report 형태: { valid, issues:[{reason,message}] }  (원본 throw 환원)
    validateReport(rootNode) {
      try {
        reg.validate(rootNode);              // 원본 검증 그대로 호출
        return { valid: true, issues: [] };
      } catch (e) {
        return { valid: false, issues: [{ reason: reasonOf(e.message), message: e.message }] };
      }
    },
  };
}
