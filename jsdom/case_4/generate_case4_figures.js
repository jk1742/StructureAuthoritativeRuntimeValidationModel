/**
 * Case 4 figure generation
 * - case4_fig1_detection.svg : R1/R2 detection matrix
 *
 * (the former fig2 reconstruction_time / fig3 payload_size have been removed.
 *  the source of truth for timing/payload is the paired runner — browser/results/paired_case4_*.json)
 */

const fs = require("fs");
const path = require("path");
const OUT_DIR = ".";
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

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
</style>
<rect x="0" y="0" width="${w}" height="${h}" fill="#FFFFFF"/>
`;
}
const svgFooter = `</svg>\n`;

// ============================================================
// Fig 1 - Detection matrix (R1 + R2)
// ============================================================
function makeFig1() {
  const W = 800, H = 470;
  const P = { top: 110, bottom: 80, left: 260, right: 40 };
  const plotW = W - P.left - P.right;
  const plotH = H - P.top - P.bottom;

  // rows: models, columns: R1 / R2
  const models = [
    { id: "A. innerHTML swap",
      r1: { result: "LOST",      ok: false, label: "value lost" },
      r2: { result: "Discarded", ok: true,  label: "✓ correctly discarded" }
    },
    { id: "B. Keyed reconcile",
      r1: { result: "Preserved", ok: true,  label: "✓ preserved" },
      r2: { result: "FALSE REUSE", ok: false, label: "✗ false reuse" }
    },
    { id: "C. Identity (proposed)",
      r1: { result: "Preserved", ok: true,  label: "✓ preserved" },
      r2: { result: "Discarded", ok: true,  label: "✓ correctly discarded" }
    },
  ];

  const cellW = plotW / 2;
  const cellH = plotH / models.length;

  const fill = (ok) => ok ? "#686868" : "#FFFFFF";
  const textColor = (ok) => ok ? "#FFFFFF" : "#000000";

  let svg = svgHeader(W, H,
    "Reconstruction outcome matrix",
    "Matrix showing R1 (state preservation) and R2 (identity-aware discard) outcomes across three reconstruction models"
  );

  svg += `<text x="${W/2}" y="30" text-anchor="middle" class="title">Fig. 5. Runtime Reconstruction Outcome — R1 (preserve) and R2 (discard)</text>\n`;
  svg += `<text x="${W/2}" y="50" text-anchor="middle" class="tick" fill="#444">(Only identity reconciliation satisfies both R1 and R2)</text>\n`;

  // Column headers
  svg += `<text x="${P.left + cellW * 0.5}" y="${P.top - 30}" text-anchor="middle" class="legend" font-weight="bold">R1: Runtime State Preservation</text>\n`;
  svg += `<text x="${P.left + cellW * 0.5}" y="${P.top - 14}" text-anchor="middle" class="tick" fill="#444">(same entity, attribute updated)</text>\n`;
  svg += `<text x="${P.left + cellW * 1.5}" y="${P.top - 30}" text-anchor="middle" class="legend" font-weight="bold">R2: Identity-Aware Reconstruction</text>\n`;
  svg += `<text x="${P.left + cellW * 1.5}" y="${P.top - 14}" text-anchor="middle" class="tick" fill="#444">(different entity, same shape)</text>\n`;

  // Rows
  models.forEach((m, i) => {
    const y = P.top + i * cellH;
    // Row label
    svg += `<text x="${P.left - 12}" y="${y + cellH/2 + 4}" text-anchor="end" class="legend">${m.id}</text>\n`;

    // R1 cell
    svg += `<rect x="${P.left}" y="${y}" width="${cellW}" height="${cellH}" fill="${fill(m.r1.ok)}" stroke="#000" stroke-width="1"/>\n`;
    svg += `<text x="${P.left + cellW/2}" y="${y + cellH/2 + 4}" text-anchor="middle" class="cell-text" fill="${textColor(m.r1.ok)}" font-weight="bold">${m.r1.label}</text>\n`;

    // R2 cell
    svg += `<rect x="${P.left + cellW}" y="${y}" width="${cellW}" height="${cellH}" fill="${fill(m.r2.ok)}" stroke="#000" stroke-width="1"/>\n`;
    svg += `<text x="${P.left + cellW * 1.5}" y="${y + cellH/2 + 4}" text-anchor="middle" class="cell-text" fill="${textColor(m.r2.ok)}" font-weight="bold">${m.r2.label}</text>\n`;
  });

  // Legend
  const legY = H - 30;
  svg += `<rect x="${P.left}" y="${legY - 10}" width="14" height="14" fill="#222222" stroke="#000"/>\n`;
  svg += `<text x="${P.left + 20}" y="${legY + 2}" class="legend">Expected outcome</text>\n`;
  svg += `<rect x="${P.left + 180}" y="${legY - 10}" width="14" height="14" fill="#FFFFFF" stroke="#000"/>\n`;
  svg += `<text x="${P.left + 200}" y="${legY + 2}" class="legend">Unexpected outcome</text>\n`;

  svg += svgFooter;
  fs.writeFileSync(path.join(OUT_DIR, "case4_fig1_detection.svg"), svg);
}

makeFig1();

console.log("Generated:");
["case4_fig1_detection.svg"].forEach((f) => {
  const sz = fs.statSync(path.join(OUT_DIR, f)).size;
  console.log("  " + f + " (" + sz + " bytes)");
});
