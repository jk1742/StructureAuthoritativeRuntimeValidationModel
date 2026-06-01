/**
 * Case 4 figure 생성
 * - case4_fig1_detection.svg   : R1/R2 detection matrix
 * - case4_fig2_reconstruction_time.svg : 노드 수별 reconstruction 시간
 * - case4_fig3_payload_size.svg : 노드 수별 payload 크기
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
  .cell-text { font-size: 12px; fill: #000; }
</style>
<rect x="0" y="0" width="${w}" height="${h}" fill="#FFFFFF"/>
`;
}
const svgFooter = `</svg>\n`;

// ============================================================
// Fig 1 - Detection matrix (R1 + R2)
// ============================================================
function makeFig1() {
  const W = 800, H = 440;
  const P = { top: 80, bottom: 80, left: 260, right: 40 };
  const plotW = W - P.left - P.right;
  const plotH = H - P.top - P.bottom;

  // 행: 모델, 열: R1 / R2
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

  const fill = (ok) => ok ? "#222222" : "#FFFFFF";
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

// ============================================================
// Fig 2 - Reconstruction time (line chart, log scale)
// ============================================================
function makeFig2() {
  const W = 800, H = 500;
  const P = { top: 60, bottom: 110, left: 90, right: 40 };
  const plotW = W - P.left - P.right;
  const plotH = H - P.top - P.bottom;

  const nodes = [10, 50, 100, 500, 1000, 2000];
  const series = [
    {
      name: "A. innerHTML swap",
      data: [2.194, 6.743, 6.292, 29.981, 30.219, 98.655],
      color: "#666666",
      dash: "6,4",
      marker: "triangle",
    },
    {
      name: "B. Keyed reconcile",
      data: [2.807, 3.035, 8.660, 63.968, 164.224, 986.002],
      color: "#999999",
      dash: "",
      marker: "rect",
    },
    {
      name: "C. Identity (proposed)",
      data: [1.714, 2.716, 18.407, 51.894, 152.851, 1095.087],
      color: "#222222",
      dash: "",
      marker: "circle",
    },
  ];

  // log10 range
  const logMin = 0;   // 1 ms
  const logMax = 4;   // 10000 ms
  const xFor = (i) => P.left + (i / (nodes.length - 1)) * plotW;
  const yFor = (v) => {
    if (v == null || v <= 0) return null;
    const l = Math.log10(v);
    const t = (l - logMin) / (logMax - logMin);
    return P.top + plotH - t * plotH;
  };

  let svg = svgHeader(W, H,
    "Reconstruction time vs node count",
    "Line chart comparing reconstruction time across node counts for innerHTML swap, keyed reconcile, and identity reconciliation"
  );

  svg += `<text x="${W/2}" y="30" text-anchor="middle" class="title">Fig. 6. Reconstruction Time vs Node Count (log scale)</text>\n`;

  svg += `<line class="axis" x1="${P.left}" y1="${P.top + plotH}" x2="${P.left + plotW}" y2="${P.top + plotH}"/>\n`;
  svg += `<line class="axis" x1="${P.left}" y1="${P.top}" x2="${P.left}" y2="${P.top + plotH}"/>\n`;

  for (let l = logMin; l <= logMax; l++) {
    const v = Math.pow(10, l);
    const y = yFor(v);
    svg += `<line class="grid" x1="${P.left}" y1="${y}" x2="${P.left + plotW}" y2="${y}"/>\n`;
    svg += `<text x="${P.left - 8}" y="${y + 4}" text-anchor="end" class="tick">${v} ms</text>\n`;
  }

  nodes.forEach((n, i) => {
    const x = xFor(i);
    svg += `<line class="grid" x1="${x}" y1="${P.top}" x2="${x}" y2="${P.top + plotH}"/>\n`;
    svg += `<text x="${x}" y="${P.top + plotH + 18}" text-anchor="middle" class="tick">${n}</text>\n`;
  });

  svg += `<text x="${P.left + plotW/2}" y="${P.top + plotH + 42}" text-anchor="middle" class="axis-label">Number of nodes</text>\n`;
  svg += `<text x="${20}" y="${P.top + plotH/2}" text-anchor="middle" class="axis-label" transform="rotate(-90, 20, ${P.top + plotH/2})">Reconstruction time (ms)</text>\n`;

  series.forEach((s) => {
    let d = "";
    let started = false;
    s.data.forEach((v, i) => {
      const y = yFor(v);
      if (y == null) { started = false; return; }
      const x = xFor(i);
      d += (started ? " L " : "M ") + x + " " + y;
      started = true;
    });
    const dashAttr = s.dash ? ` stroke-dasharray="${s.dash}"` : "";
    svg += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2"${dashAttr}/>\n`;

    s.data.forEach((v, i) => {
      const y = yFor(v);
      if (y == null) return;
      const x = xFor(i);
      if (s.marker === "circle") {
        svg += `<circle cx="${x}" cy="${y}" r="5" fill="${s.color}" stroke="#000" stroke-width="0.5"/>\n`;
      } else if (s.marker === "rect") {
        svg += `<rect x="${x-5}" y="${y-5}" width="10" height="10" fill="${s.color}" stroke="#000" stroke-width="0.5"/>\n`;
      } else if (s.marker === "triangle") {
        svg += `<polygon points="${x},${y-6} ${x-5},${y+4} ${x+5},${y+4}" fill="${s.color}" stroke="#000" stroke-width="0.5"/>\n`;
      }
    });
  });

  // Legend
  let legX = P.left + 20, legY = H - 40;
  series.forEach((s, i) => {
    const y = legY + (i * 18);
    if (s.marker === "circle") {
      svg += `<circle cx="${legX + 7}" cy="${y - 2}" r="5" fill="${s.color}" stroke="#000" stroke-width="0.5"/>\n`;
    } else if (s.marker === "rect") {
      svg += `<rect x="${legX + 2}" y="${y - 7}" width="10" height="10" fill="${s.color}" stroke="#000" stroke-width="0.5"/>\n`;
    } else if (s.marker === "triangle") {
      svg += `<polygon points="${legX+7},${y-8} ${legX+2},${y+2} ${legX+12},${y+2}" fill="${s.color}" stroke="#000" stroke-width="0.5"/>\n`;
    }
    svg += `<text x="${legX + 22}" y="${y + 2}" class="legend">${s.name}</text>\n`;
  });

  svg += svgFooter;
  fs.writeFileSync(path.join(OUT_DIR, "case4_fig2_reconstruction_time.svg"), svg);
}

// ============================================================
// Fig 3 - Payload size
// ============================================================
function makeFig3() {
  const W = 800, H = 460;
  const P = { top: 60, bottom: 100, left: 90, right: 40 };
  const plotW = W - P.left - P.right;
  const plotH = H - P.top - P.bottom;

  const nodes = [10, 50, 100, 500, 1000, 2000];
  const innerHTML = [570, 2930, 5880, 30280, 60780, 123780];
  const keyed     = [1114, 5634, 11284, 57684, 115684, 234684];
  const identity  = [1104, 5584, 11184, 57184, 114684, 232684];

  const yMax = 240000;
  const xFor = (i) => P.left + (i / (nodes.length - 1)) * plotW;
  const yFor = (v) => P.top + plotH - (v / yMax) * plotH;

  let svg = svgHeader(W, H,
    "Reconstruction payload size vs node count",
    "Line chart comparing reconstruction payload size between innerHTML fragment, keyed entity tree JSON, and identity entity tree JSON"
  );

  svg += `<text x="${W/2}" y="30" text-anchor="middle" class="title">Fig. 7. Reconstruction Payload Size vs Node Count</text>\n`;

  svg += `<line class="axis" x1="${P.left}" y1="${P.top + plotH}" x2="${P.left + plotW}" y2="${P.top + plotH}"/>\n`;
  svg += `<line class="axis" x1="${P.left}" y1="${P.top}" x2="${P.left}" y2="${P.top + plotH}"/>\n`;

  for (let v = 0; v <= yMax; v += 50000) {
    const y = yFor(v);
    svg += `<line class="grid" x1="${P.left}" y1="${y}" x2="${P.left + plotW}" y2="${y}"/>\n`;
    svg += `<text x="${P.left - 8}" y="${y + 4}" text-anchor="end" class="tick">${v/1000} KB</text>\n`;
  }

  nodes.forEach((n, i) => {
    const x = xFor(i);
    svg += `<text x="${x}" y="${P.top + plotH + 18}" text-anchor="middle" class="tick">${n}</text>\n`;
  });

  svg += `<text x="${P.left + plotW/2}" y="${P.top + plotH + 42}" text-anchor="middle" class="axis-label">Number of nodes</text>\n`;
  svg += `<text x="${20}" y="${P.top + plotH/2}" text-anchor="middle" class="axis-label" transform="rotate(-90, 20, ${P.top + plotH/2})">Payload size</text>\n`;

  // Lines and markers
  const series = [
    { data: innerHTML, color: "#666666", marker: "triangle", name: "A. innerHTML fragment" },
    { data: keyed,     color: "#999999", marker: "rect",     name: "B. Keyed entity tree JSON" },
    { data: identity,  color: "#222222", marker: "circle",   name: "C. Identity entity tree JSON" },
  ];
  series.forEach((s) => {
    let d = "";
    s.data.forEach((v, i) => {
      d += (i === 0 ? "M " : " L ") + xFor(i) + " " + yFor(v);
    });
    svg += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2"/>\n`;
    s.data.forEach((v, i) => {
      const x = xFor(i), y = yFor(v);
      if (s.marker === "circle") {
        svg += `<circle cx="${x}" cy="${y}" r="5" fill="${s.color}" stroke="#000" stroke-width="0.5"/>\n`;
      } else if (s.marker === "rect") {
        svg += `<rect x="${x-5}" y="${y-5}" width="10" height="10" fill="${s.color}" stroke="#000" stroke-width="0.5"/>\n`;
      } else if (s.marker === "triangle") {
        svg += `<polygon points="${x},${y-6} ${x-5},${y+4} ${x+5},${y+4}" fill="${s.color}" stroke="#000" stroke-width="0.5"/>\n`;
      }
    });
  });

  // Legend
  let legX = P.left + 20, legY = H - 30;
  series.forEach((s, i) => {
    const y = legY + (i * 18) - 25;
    if (s.marker === "circle") {
      svg += `<circle cx="${legX + 7}" cy="${y - 2}" r="5" fill="${s.color}" stroke="#000" stroke-width="0.5"/>\n`;
    } else if (s.marker === "rect") {
      svg += `<rect x="${legX + 2}" y="${y - 7}" width="10" height="10" fill="${s.color}" stroke="#000" stroke-width="0.5"/>\n`;
    } else if (s.marker === "triangle") {
      svg += `<polygon points="${legX+7},${y-8} ${legX+2},${y+2} ${legX+12},${y+2}" fill="${s.color}" stroke="#000" stroke-width="0.5"/>\n`;
    }
    svg += `<text x="${legX + 22}" y="${y + 2}" class="legend">${s.name}</text>\n`;
  });

  svg += svgFooter;
  fs.writeFileSync(path.join(OUT_DIR, "case4_fig3_payload_size.svg"), svg);
}

makeFig1();
makeFig2();
makeFig3();

console.log("Generated:");
["case4_fig1_detection.svg", "case4_fig2_reconstruction_time.svg", "case4_fig3_payload_size.svg"].forEach(f => {
  const sz = fs.statSync(path.join(OUT_DIR, f)).size;
  console.log("  " + f + " (" + sz + " bytes)");
});