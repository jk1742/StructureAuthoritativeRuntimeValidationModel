/**
 * generate_case3_figures.mjs — Case 3 figure generation (ESM, data-driven)
 * - case3_fig1_detection.svg : T1~T4 detection matrix
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = __dirname;
const RES = path.join(__dirname, "results");
const ENGINES = ["chromium", "firefox", "jsdom"]; 
if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

function loadResults() {
  const found = {};
  for (const e of ENGINES) {
    const fp = path.join(RES, `case3_${e}.json`);
    if (existsSync(fp)) found[e] = JSON.parse(readFileSync(fp, "utf8"));
  }
  if (!found.chromium) {
    throw new Error("results/case3_chromium.json missing. `node run.mjs` run first.");
  }
  return found;
}

function assertCrossEngineAgreement(found) {
  const engines = Object.keys(found);
  const base = found.chromium.rows;
  for (const e of engines) {
    for (const r of base) {
      const o = found[e].rows.find((x) => x.id === r.id);
      if (!o) throw new Error(`${e}: scenarios ${r.id} missing`);
      if (o.snapshot.detected !== r.snapshot.detected || o.identity.detected !== r.identity.detected) {
        throw new Error(`(${r.id}) — stop`);
      }
    }
  }
  return engines;
}

const DESC = {
  T1: "Identical replacement",
  T2: "Genuine no-op (control)",
  T3: "Value mutation",
  T4: "Structural insertion",
};

function stateFrom(cell, isAttack) {
  if (cell.detected) return "Detected";
  return isAttack ? "MISSED" : "VALID";
}

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

const found = loadResults();
const engines = assertCrossEngineAgreement(found);
const scenarios = scenariosFromResults(found.chromium.rows);
makeFig(scenarios);
console.log("Generated:");
console.log("  " + path.join(RES, "case3_fig1_detection.svg"));
console.log("  (states from results/; confirmed identical on: " + engines.join(", ") + ")");
