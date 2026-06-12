/* 
 * bench/payload.mjs — payload
 */
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
  const authority = createReconstructionAuthority();
  const stamped = authority.issue("bench", shapeN(n));
  const c = B(JSON.stringify(stamped));
  const rct = B(JSON.stringify(reactPropsN(n)));
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
