/* =====================================================================
 * figures/generate_overhead_figure.mjs — Case 4 재구성 시간 비율 그래프
 * ---------------------------------------------------------------------
 * 실행: node figures/generate_overhead_figure.mjs [overhead.json] [react.json]
 * 출력: figures/case4_overhead.svg
 *
 * 설계:
 *  - 시간 비율 전용(payload 제외). 모두 B(keyed) 대비 비율, 공통 1.0 기준선.
 *  - [변경] median 선 + IQR 수염(q1~q3) 동시 표시. 비율은 stat/median(B) 일관.
 *  - [변경] 계열별 가로 dodge(±px)로 클러스터 수염 겹침 방지(캡션 명시).
 *  - [변경] B(keyed)도 사각 마커 + 수염으로 표시(기준선 노이즈 폭 가시화).
 *  - y축 자동 확대: median·q1·q3 전체 범위에 맞춰 [floor, ceil](0.05 단위).
 *  - 흑백, 마커+선스타일. React 는 production 전체 re-render 참조선(별 마커).
 *  - 데이터 주도(median_ms / q1_ms / q3_ms). placeholder 없음.
 * ===================================================================== */
import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const dir = path.dirname(fileURLToPath(import.meta.url));
const inPath = process.argv[2] || path.join(dir, "..", "chromium", "case4_overhead_result.json");
const data = JSON.parse(readFileSync(inPath, "utf8"));
const tByM = {};
for (const r of data.time) { const k = r.model.trim()[0]; (tByM[k] ||= {})[r.nodes] = { med: r.median_ms, q1: r.q1_ms, q3: r.q3_ms }; }

let reactTime = null;
try {
  const rPath = process.argv[3] || path.join(dir, "..", "react", "case4_react_overhead_result.json");
  const rd = JSON.parse(readFileSync(rPath, "utf8"));
  reactTime = {}; for (const r of rd.time) reactTime[r.nodes] = { med: r.median_ms, q1: r.q1_ms, q3: r.q3_ms };
} catch { /* React 없으면 A·B·C·D 만 */ }

const Ns = Object.keys(tByM["B"]).map(Number).sort((a, b) => a - b);

// 그릴 계열 정의: dodge(dx, px) / 마커 / 선스타일. line:false 면 선 생략(기준선 위 마커만).
// 순서 = 그리기·범례 순서(C 가 마지막 = 최상단으로 강조).
const SERIES = [];
SERIES.push({ id: "A", label: "A. innerHTML swap", marker: "tri", dash: "1 3", dx: -8, line: true, w: 1.4 });
if (reactTime) SERIES.push({ id: "React", label: "React 18.3.1 (ref.)", marker: "star", dash: "", dx: 8, line: true, w: 1.5 });
SERIES.push({ id: "D", label: "D. server-id reconcile", marker: "dia", dash: "2 2", dx: 4, line: true, w: 1.4 });
SERIES.push({ id: "B", label: "B. keyed reconcile (= 1.0)", marker: "sq", dash: "4 2", dx: -4, line: false, w: 1.4 });
SERIES.push({ id: "C", label: "C. identity reconcile", marker: "circ", dash: "5 3", dx: 0, line: true, w: 1.4 });

const stat = (id, n) => (id === "React" ? reactTime[n] : tByM[id][n]);
const medB = (n) => tByM["B"][n].med;
const rMed = (id, n) => stat(id, n).med / medB(n);
const rLo = (id, n) => stat(id, n).q1 / medB(n);
const rHi = (id, n) => stat(id, n).q3 / medB(n);

// y축 자동 확대 (median·q1·q3 전체 → 0.05 단위 여백)
const all = [1.0];
for (const s of SERIES) for (const n of Ns) all.push(rMed(s.id, n), rLo(s.id, n), rHi(s.id, n));
const RMIN = Math.floor((Math.min(...all) - 0.04) * 20) / 20;
const RMAX = Math.ceil((Math.max(...all) + 0.04) * 20) / 20;

const W = 560, H = 360, m = { l: 60, r: 180, t: 22, b: 50 };
const pw = W - m.l - m.r, ph = H - m.t - m.b;
const xpad = 14; // 데이터 점을 축 안쪽으로 inset → dodge 가 축 밖으로 안 새게
const xmin = Math.min(...Ns), xmax = Math.max(...Ns);
const lx = (x) => m.l + xpad + (Math.log10(x) - Math.log10(xmin)) / (Math.log10(xmax) - Math.log10(xmin)) * (pw - 2 * xpad);
const yr = (r) => m.t + (RMAX - r) / (RMAX - RMIN) * ph;
const S = "#000";
const out = [];
out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="Helvetica, Arial, sans-serif">`);
out.push(`<rect width="${W}" height="${H}" fill="#fff"/>`);
out.push(`<rect x="${m.l}" y="${m.t}" width="${pw}" height="${ph}" fill="none" stroke="${S}"/>`);

// 1.0 기준선
out.push(`<line x1="${m.l}" y1="${yr(1).toFixed(1)}" x2="${m.l + pw}" y2="${yr(1).toFixed(1)}" stroke="${S}" stroke-width="1" stroke-dasharray="4 2"/>`);

// y 눈금 (0.05 단위)
for (let r = RMIN; r <= RMAX + 1e-9; r += 0.05) {
  const Y = yr(r);
  out.push(`<line x1="${m.l - 4}" y1="${Y}" x2="${m.l}" y2="${Y}" stroke="${S}"/>`);
  out.push(`<line x1="${m.l}" y1="${Y}" x2="${m.l + pw}" y2="${Y}" stroke="#e5e5e5" stroke-width="0.5"/>`);
  out.push(`<text x="${m.l - 7}" y="${Y + 3}" font-size="9" fill="${S}" text-anchor="end">${r.toFixed(2)}</text>`);
}
// x 눈금
for (const n of Ns) {
  const X = lx(n);
  out.push(`<line x1="${X}" y1="${m.t + ph}" x2="${X}" y2="${m.t + ph + 4}" stroke="${S}"/>`);
  out.push(`<text x="${X}" y="${m.t + ph + 16}" font-size="9" fill="${S}" text-anchor="middle">${n}</text>`);
}
out.push(`<text x="${m.l + pw / 2}" y="${H - 8}" font-size="10" fill="${S}" text-anchor="middle">number of nodes (log)</text>`);
out.push(`<text x="15" y="${m.t + ph / 2}" font-size="10" fill="${S}" text-anchor="middle" transform="rotate(-90 15 ${m.t + ph / 2})">reconstruction time ratio (/B)</text>`);

function mk(kind, x, y) {
  if (kind === "circ") return `<circle cx="${x}" cy="${y}" r="3.3" fill="#fff" stroke="${S}" stroke-width="1.3"/>`;
  if (kind === "tri") return `<path d="M${x} ${y - 3.8} L${x + 3.4} ${y + 2.9} L${x - 3.4} ${y + 2.9} Z" fill="${S}"/>`;
  if (kind === "dia") return `<path d="M${x} ${y - 4.2} L${x + 3.6} ${y} L${x} ${y + 4.2} L${x - 3.6} ${y} Z" fill="#fff" stroke="${S}" stroke-width="1.2"/>`;
  if (kind === "sq") return `<rect x="${x - 3.1}" y="${y - 3.1}" width="6.2" height="6.2" fill="#fff" stroke="${S}" stroke-width="1.2"/>`;
  return "";
}
function star(x, y) {
  const pts = [];
  for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5; const rr = i % 2 ? 2.3 : 4.8; pts.push(`${(x + rr * Math.cos(a)).toFixed(1)},${(y + rr * Math.sin(a)).toFixed(1)}`); }
  return `<polygon points="${pts.join(" ")}" fill="#000"/>`;
}
function whisker(x, yHi, yLo) {
  return `<line x1="${x.toFixed(1)}" y1="${yHi.toFixed(1)}" x2="${x.toFixed(1)}" y2="${yLo.toFixed(1)}" stroke="${S}" stroke-width="0.8"/>`
    + `<line x1="${(x - 3).toFixed(1)}" y1="${yHi.toFixed(1)}" x2="${(x + 3).toFixed(1)}" y2="${yHi.toFixed(1)}" stroke="${S}" stroke-width="0.8"/>`
    + `<line x1="${(x - 3).toFixed(1)}" y1="${yLo.toFixed(1)}" x2="${(x + 3).toFixed(1)}" y2="${yLo.toFixed(1)}" stroke="${S}" stroke-width="0.8"/>`;
}

for (const s of SERIES) {
  // 수염(IQR) 먼저 — 선·마커 아래
  for (const n of Ns) { const x = lx(n) + s.dx; out.push(whisker(x, yr(rHi(s.id, n)), yr(rLo(s.id, n)))); }
  // median 연결선 (B 는 1.0 평탄 = 기준선과 동일하므로 생략)
  if (s.line) {
    const d = Ns.map((n, i) => `${i ? "L" : "M"}${(lx(n) + s.dx).toFixed(1)} ${yr(rMed(s.id, n)).toFixed(1)}`).join(" ");
    out.push(`<path d="${d}" fill="none" stroke="${S}" stroke-width="${s.w}" ${s.dash ? `stroke-dasharray="${s.dash}"` : ""}/>`);
  }
  // median 마커
  for (const n of Ns) { const x = lx(n) + s.dx, y = yr(rMed(s.id, n)); out.push(s.marker === "star" ? star(x, y) : mk(s.marker, x, y)); }
}

// 범례
let Y = m.t + 8; const X = m.l + pw + 18;
for (const s of SERIES) {
  out.push(`<line x1="${X}" y1="${Y}" x2="${X + 22}" y2="${Y}" stroke="${S}" stroke-width="${s.w}" ${s.dash ? `stroke-dasharray="${s.dash}"` : ""}/>`);
  out.push(s.marker === "star" ? star(X + 11, Y) : mk(s.marker, X + 11, Y));
  out.push(`<text x="${X + 28}" y="${Y + 3}" font-size="9" fill="${S}">${s.label}</text>`); Y += 17;
}
Y += 2;
out.push(`<text x="${X}" y="${Y + 4}" font-size="8" fill="${S}">whisker = IQR (q1–q3)</text>`);
out.push(`<text x="${X}" y="${Y + 15}" font-size="8" fill="${S}">points dodged horizontally</text>`);
out.push(`<text x="${X}" y="${Y + 26}" font-size="8" fill="${S}">all-node change, reuse</text>`);

out.push(`</svg>`);
writeFileSync(path.join(dir, "case4_overhead.svg"), out.join("\n"));
console.log(`written (y: ${RMIN}~${RMAX}) -> figures/case4_overhead.svg`);
