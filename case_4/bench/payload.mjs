/* =====================================================================
 * bench/payload.mjs — 전송 payload 크기(바이트) 측정 (Node 전용)
 * ---------------------------------------------------------------------
 * 실행: node bench/payload.mjs   (또는 npm run payload)
 * 출력: bench/case4_payload_result.json
 *
 * 측정: 각 모델이 '클라이언트로 전송하는 형식'의 UTF-8 바이트.
 *   A : InnerHTMLSwap 이 받는 HTML 문자열 (작성자 확정)
 *   B : keyed 트리 JSON (data-key)
 *   D : server-id 트리 JSON
 *   C : 권위 발급 트리 JSON — lineage(id + revision) + tag + attrs + children 포함
 *       (revision 은 lineage 의 절반이라 전송 필수. 빼면 lineage 무너짐 — 작성자 확정)
 *
 * payload 는 환경 무관(결정적)이라 브라우저 불필요, Node 에서 1회 산출.
 * placeholder 없음 — 실제 직렬화 바이트.
 * ===================================================================== */
import { writeFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";
import { createReconstructionAuthority } from "../src/identity.mjs";
import { htmlN, keyedTreeN, serverIdTreeN, shapeN, reactPropsN, NODE_COUNTS } from "./builders.mjs";

const B = (s) => Buffer.byteLength(s, "utf8");

export function payloadSizes(n) {
  const a = B(htmlN(n));
  const b = B(JSON.stringify(keyedTreeN(n)));
  const d = B(JSON.stringify(serverIdTreeN(n)));
  // C: 권위가 stamp 한 트리(id+revision 포함)를 그대로 직렬화
  const authority = createReconstructionAuthority();
  const stamped = authority.issue("bench", shapeN(n));
  const c = B(JSON.stringify(stamped));
  const rct = B(JSON.stringify(reactPropsN(n))); // React props-data(참조)
  return { nodes: n, A_html: a, B_keyed: b, D_serverId: d, C_identity: c, React_props: rct };
}

const dir = path.dirname(fileURLToPath(import.meta.url));
const rows = NODE_COUNTS.map(payloadSizes);

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log("\n=== Case 4 payload size (UTF-8 bytes) ===\n");
  console.table(
    rows.map((r) => ({
      nodes: r.nodes,
      "A html": r.A_html,
      "B keyed": r.B_keyed,
      "D server-id": r.D_serverId,
      "C identity": r.C_identity,
      "React props": r.React_props,
      "C vs B": ((r.C_identity / r.B_keyed - 1) * 100).toFixed(1) + "%",
      "A vs B": ((r.A_html / r.B_keyed - 1) * 100).toFixed(1) + "%",
    }))
  );
  writeFileSync(
    path.join(dir, "case4_payload_result.json"),
    JSON.stringify({ axis: "payload", unit: "utf8-bytes", timestamp: new Date().toISOString(), rows }, null, 2)
  );
  console.log("\nresult -> bench/case4_payload_result.json");
}
