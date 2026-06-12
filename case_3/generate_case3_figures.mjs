/**
 * generate_case3_figures.mjs — Case 3 figure generation (ESM, data-driven)
 * - case3_fig1_detection.svg : T1~T4 detection matrix
 *
 * 재구성 원칙: 기존 generate_case3_figures.js의 "그림 모양"(svgHeader/스타일/
 * 셀·범례 레이아웃·색·문구)을 그대로 보존한다. 바뀐 것은 입력 경로뿐 —
 * 셀 상태를 하드코딩하지 않고 results/case3_<engine>.json(run.mjs 산출)에서 읽는다.
 * 그리기 전 3엔진 결과가 행별로 일치하는지 검증하고, 불일치 시 중단한다.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = __dirname;
const RES = path.join(__dirname, "results");
const ENGINES = ["chromium", "firefox", "jsdom"]; // chromium = headline(대표)
if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

// -------- 입력: results/에서 읽어 시나리오 행 파생 (하드코딩 제거) --------
function loadResults() {
  const found = {};
  for (const e of ENGINES) {
    const fp = path.join(RES, `case3_${e}.json`);
    if (existsSync(fp)) found[e] = JSON.parse(readFileSync(fp, "utf8"));
  }
  if (!found.chromium) {
    throw new Error("results/case3_chromium.json 이 없습니다. 먼저 `node run.mjs` 실행.");
  }
  return found;
}

function assertCrossEngineAgreement(found) {
  const engines = Object.keys(found);
  const base = found.chromium.rows;
  for (const e of engines) {
    for (const r of base) {
      const o = found[e].rows.find((x) => x.id === r.id);
      if (!o) throw new Error(`${e}: 시나리오 ${r.id} 누락`);
      if (o.snapshot.detected !== r.snapshot.detected || o.identity.detected !== r.identity.detected) {
        throw new Error(`엔진 불일치 (${r.id}) — 그림 생성 중단.`);
      }
    }
  }
  return engines;
}

// 표시용 짧은 서술(원본 desc와 동일). 상태는 데이터에서 파생.
const DESC = {
  T1: "Identical replacement",
  T2: "Genuine no-op (control)",
  T3: "Value mutation",
  T4: "Structural insertion",
};

// 데이터(detected/expected) → 원본 상태 어휘(MISSED/Detected/VALID)
function stateFrom(cell, isAttack) {
  if (cell.detected) return "Detected";
  return isAttack ? "MISSED" : "VALID";
}

// results 행 → 원본 scenarios 배열과 동일한 형태 { id, desc, snap, ident }
function scenariosFromResults(rows) {
  return rows.map((r) => {
    const isAttack = r.snapshot.expected || r.identity.expected;
    return {
      id: r.id,
      desc: DESC[r.id] || r.label,
      snap: stateFrom(r.snapshot, isAttack),
      ident: stateFrom(r.identity, isAttack),
    };
  });
}

// ===================== 이하 SVG 생성: 원본과 동일 보존 =====================
function svgHeader(w, h, title, desc) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="Helvetica, Arial, sans-serif" role="img">
<title>${title}</title>
<desc>${desc}</desc>
<style>
  .axis { stroke: #000; stroke-width: 1; fill: none; }
  .grid { stroke: #DDD; stroke-width: 0.5; fill: none; }
  .tick { font-size: 11px; fill: #000; }
  .title { font-size: 14px; font-weight: bold; fill: #000; }
  .legend { font-size: 12px; fill: #000; }
  .axis-label { font-size: 12px; fill: #000; }
  .cell-text { font-size: 12px; }
  .cell-detected { fill: #222222; }
  .cell-missed   { fill: #FFFFFF; }
  .cell-valid    { fill: #DDDDDD; }
</style>
<rect x="0" y="0" width="${w}" height="${h}" fill="#FFFFFF"/>
`;
}
const svgFooter = `</svg>\n`;

function makeFig(scenarios) {
  const W = 800, H = 380;
  const P = { top: 70, bottom: 80, left: 220, right: 40 };
  const plotW = W - P.left - P.right;
  const plotH = H - P.top - P.bottom;

  const cellW = plotW / 2;       // 2 columns: snapshot, identity
  const cellH = plotH / scenarios.length;

  const stateFill = (state) => {
    if (state === "MISSED")   return "#686868";   // empty = missed
    if (state === "Detected") return "#FFFFFF";
    if (state === "VALID")    return "#BBBBBB";   // gray = clean pass (control)
    return "#FFFFFF";
  };
  const stateText = (state) => {
    if (state === "Detected") return { color: "#000", label: "✓ Detected" };
    if (state === "MISSED")   return { color: "#FFF", label: "✗ MISSED" };
    if (state === "VALID")    return { color: "#000", label: "  valid" };
    return { color: "#000", label: "" };
  };

  let svg = svgHeader(W, H,
    "Detection matrix snapshot-diff vs identity continuity",
    "Matrix showing detection outcomes across four scenarios for snapshot-diff baseline and identity continuity model"
  );

  svg += `<text x="${W/2}" y="30" text-anchor="middle" class="title">Fig. 4. Detection Outcome — Snapshot-diff vs Identity Continuity</text>\n`;
  svg += `<text x="${W/2}" y="50" text-anchor="middle" class="tick" fill="#444">(T1 highlights a false negative of snapshot-diff)</text>\n`;

  // Column headers
  svg += `<text x="${P.left + cellW * 0.5}" y="${P.top - 10}" text-anchor="middle" class="legend" font-weight="bold">Snapshot-diff (baseline)</text>\n`;
  svg += `<text x="${P.left + cellW * 1.5}" y="${P.top - 10}" text-anchor="middle" class="legend" font-weight="bold">Identity continuity (proposed)</text>\n`;

  // Rows
  scenarios.forEach((s, i) => {
    const y = P.top + i * cellH;
    // Row label
    svg += `<text x="${P.left - 12}" y="${y + cellH/2 + 4}" text-anchor="end" class="legend">${s.id}. ${s.desc}</text>\n`;

    // Snapshot cell
    const sn = stateText(s.snap);
    svg += `<rect x="${P.left}" y="${y}" width="${cellW}" height="${cellH}" fill="${stateFill(s.snap)}" stroke="#000" stroke-width="1"/>\n`;
    svg += `<text x="${P.left + cellW/2}" y="${y + cellH/2 + 4}" text-anchor="middle" class="cell-text" fill="${sn.color}" font-weight="bold">${sn.label}</text>\n`;

    // Identity cell
    const id = stateText(s.ident);
    svg += `<rect x="${P.left + cellW}" y="${y}" width="${cellW}" height="${cellH}" fill="${stateFill(s.ident)}" stroke="#000" stroke-width="1"/>\n`;
    svg += `<text x="${P.left + cellW * 1.5}" y="${y + cellH/2 + 4}" text-anchor="middle" class="cell-text" fill="${id.color}" font-weight="bold">${id.label}</text>\n`;
  });

  // Legend
  const legY = H - 35;
  svg += `<rect x="${P.left}" y="${legY - 10}" width="14" height="14" fill="#222222" stroke="#000"/>\n`;
  svg += `<text x="${P.left + 20}" y="${legY + 2}" class="legend">Detected (correct)</text>\n`;

  svg += `<rect x="${P.left + 160}" y="${legY - 10}" width="14" height="14" fill="#FFFFFF" stroke="#000"/>\n`;
  svg += `<text x="${P.left + 180}" y="${legY + 2}" class="legend">MISSED (false negative)</text>\n`;

  svg += `<rect x="${P.left + 360}" y="${legY - 10}" width="14" height="14" fill="#BBBBBB" stroke="#000"/>\n`;
  svg += `<text x="${P.left + 380}" y="${legY + 2}" class="legend">valid (control)</text>\n`;

  svg += svgFooter;
  writeFileSync(path.join(RES, "case3_fig1_detection.svg"), svg);
}

// -------- 실행 --------
const found = loadResults();
const engines = assertCrossEngineAgreement(found);
const scenarios = scenariosFromResults(found.chromium.rows);
makeFig(scenarios);
console.log("Generated:");
console.log("  " + path.join(RES, "case3_fig1_detection.svg"));
console.log("  (states from results/; confirmed identical on: " + engines.join(", ") + ")");
