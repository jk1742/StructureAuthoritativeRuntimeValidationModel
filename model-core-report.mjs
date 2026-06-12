// model-core-report.mjs  (repo ROOT)

import { createRegistry } from "./model-core.mjs";

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

export function createReportRegistry(doc) {
  const reg = createRegistry(doc);
  return {
    mount: reg.mount,
    commit: reg.commit,
    validateReport(rootNode) {
      try {
        reg.validate(rootNode);
        return { valid: true, issues: [] };
      } catch (e) {
        return { valid: false, issues: [{ reason: reasonOf(e.message), message: e.message }] };
      }
    },
  };
}
