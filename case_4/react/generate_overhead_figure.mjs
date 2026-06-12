/* =====================================================================
 * figures/generate_overhead_figure.mjs — Case 4 비율 그래프 (이중 세로축)
 * ---------------------------------------------------------------------
 * 실행: node figures/generate_overhead_figure.mjs [overhead_result.json]
 * 출력: figures/case4_overhead.svg
 *
 * 설계:
 *  - 모두 B(keyed) 대비 '비율'. 공통 1.0 기준선 하나로 두 축을 같이 읽음(분별력↑).
 *  - 좌축: median 재구성 시간 비율(/B). 우축: payload 바이트 비율(/B).
 *  - 시간=실선 마커, payload=점선 + 빈(hollow) 마커 로 한 흑백 평면에서 구분.
 *  - 1.0 기준선(B). 시간은 B·C·D 가 1.0 근처(동률), A 가 ~0.65. payload 는 C ~1.61,
 *    D ~1.08, A ~0.46 로 분리.
 *  - 데이터 주도(JSON median_ms·payload 바이트). placeholder 없음.
 * ===================================================================== */
import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const dir = path.dirname(fileURLToPath(import.meta.url));
const inPath = process.argv[2] || path.join(dir, "..", "chromium", "case4_overhead_result.json");
const data = JSON.parse(readFileSync(inPath, "utf8"));

const tByM = {}; for (const r of data.time) { const k = r.model.trim()[0]; (tByM[k] ||= {})[r.nodes] = r.median_ms; }
const pByN = {}; for (const r of data.payload) pByN[r.nodes] = r;

// React 참조선(있으면 병합): react/case4_react_overhead_result.json
let reactTime = null, reactPay = null;
try {
  const rPath = process.argv[3] || path.join(dir, "..", "react", "case4_react_overhead_result.json");
  const rd = JSON.parse(readFileSync(rPath, "utf8"));
  reactTime = {}; for (const r of rd.time) reactTime[r.nodes] = r.median_ms;
  reactPay = {}; for (const r of rd.payload) reactPay[r.nodes] = r.React_props;
} catch { /* React 결과 없으면 A·B·C·D 만 그림 */ }

const PKEY = { A: "A_html", B: "B_keyed", C: "C_identity", D: "D_serverId" };
const Ns = data.payload.map((r) => r.nodes).sort((a, b) => a - b);

const MODELS = [
  { id: "A", label: "A. innerHTML", marker: "tri" },
  { id: "B", label: "B. keyed", marker: "sq" },
  { id: "C", label: "C. identity", marker: "circ" },
  { id: "D", label: "D. server-id", marker: "dia" },
];
const tRatio = (m, n) => tByM[m][n] / tByM["B"][n];
const pRatio = (m, n) => pByN[n][PKEY[m]] / pByN[n]["B_keyed"];

// 좌/우 축 동일 비율 스케일(공통 1.0) — 데이터 최대(payload C 1.61)·최소(A 0.45) 포괄
const RMIN = 0.4, RMAX = 1.7;
const W = 600, H = 380, m = { l: 56, r: 200, t: 22, b: 50 };
const pw = W - m.l - m.r, ph = H - m.t - m.b;
const xmin = Math.min(...Ns), xmax = Math.max(...Ns);
const lx = (x) => m.l + (Math.log10(x) - Math.log10(xmin)) / (Math.log10(xmax) - Math.log10(xmin)) * pw;
const yr = (r) => m.t + (RMAX - r) / (RMAX - RMIN) * ph;
const S = "#000";
const out = [];
out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="Helvetica, Arial, sans-serif">`);
out.push(`<rect width="${W}" height="${H}" fill="#fff"/>`);
out.push(`<rect x="${m.l}" y="${m.t}" width="${pw}" height="${ph}" fill="none" stroke="${S}"/>`);

// 1.0 기준선
out.push(`<line x1="${m.l}" y1="${yr(1).toFixed(1)}" x2="${m.l + pw}" y2="${yr(1).toFixed(1)}" stroke="${S}" stroke-width="1" stroke-dasharray="4 2"/>`);
out.push(`<text x="${m.l + pw - 4}" y="${yr(1) - 4}" font-size="8" fill="${S}" text-anchor="end">B = 1.0 (baseline)</text>`);

// y 눈금(비율) — 양 축 동일
for (const r of [0.5, 0.75, 1.0, 1.25, 1.5]) {
  const Y = yr(r);
  out.push(`<line x1="${m.l - 4}" y1="${Y}" x2="${m.l}" y2="${Y}" stroke="${S}"/>`);
  out.push(`<line x1="${m.l + pw}" y1="${Y}" x2="${m.l + pw + 4}" y2="${Y}" stroke="${S}"/>`);
  out.push(`<text x="${m.l - 7}" y="${Y + 3}" font-size="9" fill="${S}" text-anchor="end">${r.toFixed(2)}</text>`);
  out.push(`<text x="${m.l + pw + 7}" y="${Y + 3}" font-size="9" fill="${S}">${r.toFixed(2)}</text>`);
}
// x 눈금
for (const n of Ns) {
  const X = lx(n);
  out.push(`<line x1="${X}" y1="${m.t + ph}" x2="${X}" y2="${m.t + ph + 4}" stroke="${S}"/>`);
  out.push(`<text x="${X}" y="${m.t + ph + 16}" font-size="9" fill="${S}" text-anchor="middle">${n}</text>`);
}
out.push(`<text x="${m.l + pw / 2}" y="${H - 8}" font-size="10" fill="${S}" text-anchor="middle">number of nodes (log)</text>`);
out.push(`<text x="14" y="${m.t + ph / 2}" font-size="10" fill="${S}" text-anchor="middle" transform="rotate(-90 14 ${m.t + ph / 2})">reconstruction time ratio (/B)</text>`);
out.push(`<text x="${m.l + pw + 36}" y="${m.t + ph / 2}" font-size="10" fill="${S}" text-anchor="middle" transform="rotate(90 ${m.l + pw + 36} ${m.t + ph / 2})">payload size ratio (/B)</text>`);

function mk(kind, x, y, hollow) {
  const f = hollow ? "#fff" : S, sw = hollow ? 1.2 : 0;
  if (kind === "sq") return `<rect x="${x - 3}" y="${y - 3}" width="6" height="6" fill="${f}" stroke="${S}" stroke-width="${sw}"/>`;
  if (kind === "circ") return `<circle cx="${x}" cy="${y}" r="3.2" fill="${f}" stroke="${S}" stroke-width="${hollow ? 1.2 : 1}"/>`;
  if (kind === "tri") return `<path d="M${x} ${y - 3.6} L${x + 3.3} ${y + 2.8} L${x - 3.3} ${y + 2.8} Z" fill="${f}" stroke="${S}" stroke-width="${sw}"/>`;
  if (kind === "dia") return `<path d="M${x} ${y - 4} L${x + 3.4} ${y} L${x} ${y + 4} L${x - 3.4} ${y} Z" fill="${f}" stroke="${S}" stroke-width="${sw}"/>`;
  return "";
}
function series(ratioFn, dash, hollow) {
  for (const mo of MODELS) {
    if (mo.id === "B") continue; // B는 기준선(1.0)이라 생략
    const d = Ns.map((n, i) => `${i ? "L" : "M"}${lx(n).toFixed(1)} ${yr(ratioFn(mo.id, n)).toFixed(1)}`).join(" ");
    out.push(`<path d="${d}" fill="none" stroke="${S}" stroke-width="1.3" ${dash ? `stroke-dasharray="${dash}"` : ""}/>`);
    for (const n of Ns) out.push(mk(mo.marker, lx(n), yr(ratioFn(mo.id, n)), hollow));
  }
}
// 시간(실선·채운 마커), payload(점선·빈 마커)
series(tRatio, "", false);
series(pRatio, "2 2", true);

// React 참조선(있으면): 별(star) 마커. 시간=실선, payload=점선. B 대비 비율.
function star(x, y) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const ang = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 ? 2.2 : 4.6;
    pts.push(`${(x + r * Math.cos(ang)).toFixed(1)},${(y + r * Math.sin(ang)).toFixed(1)}`);
  }
  return `<polygon points="${pts.join(" ")}" fill="#000"/>`;
}
if (reactTime) {
  const dt = Ns.map((n, i) => `${i ? "L" : "M"}${lx(n).toFixed(1)} ${yr(reactTime[n] / tByM["B"][n]).toFixed(1)}`).join(" ");
  out.push(`<path d="${dt}" fill="none" stroke="${S}" stroke-width="1.5"/>`);
  for (const n of Ns) out.push(star(lx(n), yr(reactTime[n] / tByM["B"][n])));
  const dp = Ns.map((n, i) => `${i ? "L" : "M"}${lx(n).toFixed(1)} ${yr(reactPay[n] / pByN[n]["B_keyed"]).toFixed(1)}`).join(" ");
  out.push(`<path d="${dp}" fill="none" stroke="${S}" stroke-width="1.5" stroke-dasharray="2 2"/>`);
  for (const n of Ns) out.push(star(lx(n), yr(reactPay[n] / pByN[n]["B_keyed"])));
}

// 범례
let Y = m.t + 4; const X = m.l + pw + 50;
out.push(`<text x="${X}" y="${Y}" font-size="9" fill="${S}" font-weight="bold">time (solid, filled)</text>`); Y += 15;
for (const mo of MODELS) { if (mo.id === "B") continue;
  out.push(`<line x1="${X}" y1="${Y}" x2="${X + 18}" y2="${Y}" stroke="${S}" stroke-width="1.3"/>`);
  out.push(mk(mo.marker, X + 9, Y, false));
  out.push(`<text x="${X + 24}" y="${Y + 3}" font-size="8.5" fill="${S}">${mo.label}</text>`); Y += 14; }
Y += 6;
out.push(`<text x="${X}" y="${Y}" font-size="9" fill="${S}" font-weight="bold">payload (dashed, hollow)</text>`); Y += 15;
for (const mo of MODELS) { if (mo.id === "B") continue;
  out.push(`<line x1="${X}" y1="${Y}" x2="${X + 18}" y2="${Y}" stroke="${S}" stroke-width="1.3" stroke-dasharray="2 2"/>`);
  out.push(mk(mo.marker, X + 9, Y, true));
  out.push(`<text x="${X + 24}" y="${Y + 3}" font-size="8.5" fill="${S}">${mo.label}</text>`); Y += 14; }

if (reactTime) {
  Y += 6;
  out.push(`<text x="${X}" y="${Y}" font-size="9" fill="${S}" font-weight="bold">React 18.3.1 (reference)</text>`); Y += 14;
  out.push(`<line x1="${X}" y1="${Y}" x2="${X + 18}" y2="${Y}" stroke="${S}" stroke-width="1.5"/>`);
  out.push(star(X + 9, Y));
  out.push(`<text x="${X + 24}" y="${Y + 3}" font-size="8.5" fill="${S}">time (full re-render)</text>`); Y += 14;
  out.push(`<line x1="${X}" y1="${Y}" x2="${X + 18}" y2="${Y}" stroke="${S}" stroke-width="1.5" stroke-dasharray="2 2"/>`);
  out.push(star(X + 9, Y));
  out.push(`<text x="${X + 24}" y="${Y + 3}" font-size="8.5" fill="${S}">payload (props)</text>`); Y += 14;
}

out.push(`</svg>`);
writeFileSync(path.join(dir, "case4_overhead.svg"), out.join("\n"));
console.log("written -> figures/case4_overhead.svg");
