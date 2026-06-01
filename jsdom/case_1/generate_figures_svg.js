const fs = require("fs");
const path = require("path");

const OUT_DIR = ".";
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

// ============================================================
// Helper - SVG builder
// ============================================================
function svgHeader(w, h, title, desc) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="Helvetica, Arial, sans-serif" role="img">
<title>${title}</title>
<desc>${desc}</desc>
<style>
  .axis { stroke: #000; stroke-width: 1; fill: none; }
  .grid { stroke: #DDD; stroke-width: 0.5; fill: none; }
  .label { font-size: 12px; fill: #000; }
  .tick { font-size: 11px; fill: #000; }
  .title { font-size: 14px; font-weight: bold; fill: #000; }
  .legend { font-size: 12px; fill: #000; }
  .axis-label { font-size: 12px; fill: #000; }
</style>
<rect x="0" y="0" width="${w}" height="${h}" fill="#FFFFFF"/>
`;
}
const svgFooter = `</svg>\n`;

// ============================================================
// Fig 1 - Detection result (bar chart)
// ============================================================
function makeFig1() {
  const W = 800, H = 480;
  const P = { top: 60, bottom: 100, left: 100, right: 40 };
  const plotW = W - P.left - P.right;
  const plotH = H - P.top - P.bottom;

  const scenarios = [
    { label: "S1", sub: "input.value", base: 1, prop: 1 },
    { label: "S2", sub: "checkbox.checked", base: 1, prop: 1 },
    { label: "S3", sub: "textarea.value", base: 1, prop: 1 },
    { label: "S4-a", sub: "meta+value", base: 0, prop: 1 },
    { label: "S4-b", sub: "meta+checked", base: 0, prop: 1 },
    { label: "S4-c", sub: "meta+textarea", base: 0, prop: 1 },
  ];

  const groupW = plotW / scenarios.length;
  const barW   = groupW * 0.35;
  const baseColor = "#999999";
  const propColor = "#222222";

  let svg = svgHeader(W, H,
    "Forgery detection result per scenario",
    "Bar chart comparing baseline meta tag model and proposed registry model across six forgery scenarios"
  );

  // Title
  svg += `<text x="${W/2}" y="30" text-anchor="middle" class="title">Fig. 1. Forgery Detection Result per Scenario</text>\n`;

  // Plot frame
  svg += `<line class="axis" x1="${P.left}" y1="${P.top + plotH}" x2="${P.left + plotW}" y2="${P.top + plotH}"/>\n`;
  svg += `<line class="axis" x1="${P.left}" y1="${P.top}" x2="${P.left}" y2="${P.top + plotH}"/>\n`;

  // Y ticks (0=Bypassed, 1=Detected)
  for (const v of [0, 1]) {
    const y = P.top + plotH - (v / 1) * plotH;
    svg += `<line class="grid" x1="${P.left}" y1="${y}" x2="${P.left + plotW}" y2="${y}"/>\n`;
    const label = v === 1 ? "Detected" : "Bypassed";
    svg += `<text x="${P.left - 8}" y="${y + 4}" text-anchor="end" class="tick">${label}</text>\n`;
  }

  // Hatched pattern for "Bypassed" markers (added once in defs)
  svg += `<defs>
    <pattern id="hatch" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
      <rect width="6" height="6" fill="#FFF"/>
      <line x1="0" y1="0" x2="0" y2="6" stroke="#000" stroke-width="1"/>
    </pattern>
  </defs>\n`;

  // Bars
  scenarios.forEach((s, i) => {
    const cx = P.left + groupW * i + groupW / 2;

    // Baseline bar
    if (s.base === 1) {
      const baseH = s.base * plotH;
      svg += `<rect x="${cx - barW - 2}" y="${P.top + plotH - baseH}" width="${barW}" height="${baseH}" fill="${baseColor}" stroke="#000" stroke-width="1"/>\n`;
    } else {
      // BYPASSED : 짧은 hatched 사각형 + ✗ 텍스트
      const markH = 26;
      svg += `<rect x="${cx - barW - 2}" y="${P.top + plotH - markH}" width="${barW}" height="${markH}" fill="url(#hatch)" stroke="#000" stroke-width="1"/>\n`;
      svg += `<text x="${cx - barW/2 - 2}" y="${P.top + plotH - markH - 6}" text-anchor="middle" class="tick" font-weight="bold">✗</text>\n`;
    }

    // Proposed bar
    const propH = s.prop * plotH;
    svg += `<rect x="${cx + 2}" y="${P.top + plotH - propH}" width="${barW}" height="${propH}" fill="${propColor}" stroke="#000" stroke-width="1"/>\n`;

    // X label
    svg += `<text x="${cx}" y="${P.top + plotH + 18}" text-anchor="middle" class="tick">${s.label}</text>\n`;
    svg += `<text x="${cx}" y="${P.top + plotH + 32}" text-anchor="middle" class="tick" fill="#555">${s.sub}</text>\n`;
  });

  // Legend
  const legY = H - 25;
  svg += `<rect x="${P.left + 20}" y="${legY - 10}" width="14" height="14" fill="${baseColor}" stroke="#000"/>\n`;
  svg += `<text x="${P.left + 40}" y="${legY + 2}" class="legend">Baseline (meta tag)</text>\n`;
  svg += `<rect x="${P.left + 220}" y="${legY - 10}" width="14" height="14" fill="${propColor}" stroke="#000"/>\n`;
  svg += `<text x="${P.left + 240}" y="${legY + 2}" class="legend">Proposed (registry)</text>\n`;

  svg += svgFooter;
  fs.writeFileSync(path.join(OUT_DIR, "case1_fig1_detection.svg"), svg);
}

// ============================================================
// Fig 2 - Validation time (line chart, log scale)
// ============================================================
function makeFig2() {
  const W = 800, H = 500;
  const P = { top: 60, bottom: 110, left: 90, right: 40 };
  const plotW = W - P.left - P.right;
  const plotH = H - P.top - P.bottom;

  const nodes = [10, 50, 100, 200, 500, 1000, 2000];
  const series = [
    {
      name: "Baseline-naive (meta + querySelector)",
      data: [1.666, 12.963, 29.527, 117.764, 710.536, 2871.937, null],
      color: "#666666",
      dash: "6,4",
      marker: "triangle",
    },
    {
      name: "Baseline-optimized (meta + index)",
      data: [0.030, 0.332, 0.418, 0.148, 1.193, 1.939, 7.638],
      color: "#999999",
      dash: "",
      marker: "rect",
    },
    {
      name: "Proposed (registry)",
      data: [0.011, 0.031, 0.028, 0.617, 0.871, 1.066, 8.573],
      color: "#222222",
      dash: "",
      marker: "circle",
    },
  ];

  // log10 range
  const logMin = -2;  // 0.01 ms
  const logMax =  4;  // 10000 ms
  const xFor = (i) => P.left + (i / (nodes.length - 1)) * plotW;
  const yFor = (v) => {
    if (v == null || v <= 0) return null;
    const l = Math.log10(v);
    const t = (l - logMin) / (logMax - logMin);
    return P.top + plotH - t * plotH;
  };

  let svg = svgHeader(W, H,
    "Validation time vs node count",
    "Line chart comparing validation time across node counts for baseline-naive, baseline-optimized, and proposed model on log scale"
  );

  svg += `<text x="${W/2}" y="30" text-anchor="middle" class="title">Fig. 2. Validation Time vs Node Count (log scale)</text>\n`;

  // Plot frame
  svg += `<line class="axis" x1="${P.left}" y1="${P.top + plotH}" x2="${P.left + plotW}" y2="${P.top + plotH}"/>\n`;
  svg += `<line class="axis" x1="${P.left}" y1="${P.top}" x2="${P.left}" y2="${P.top + plotH}"/>\n`;

  // Y ticks (log scale: 0.01, 0.1, 1, 10, 100, 1000)
  for (let l = logMin; l <= logMax; l++) {
    const v = Math.pow(10, l);
    const y = yFor(v);
    svg += `<line class="grid" x1="${P.left}" y1="${y}" x2="${P.left + plotW}" y2="${y}"/>\n`;
    svg += `<text x="${P.left - 8}" y="${y + 4}" text-anchor="end" class="tick">${v} ms</text>\n`;
  }

  // X ticks
  nodes.forEach((n, i) => {
    const x = xFor(i);
    svg += `<line class="grid" x1="${x}" y1="${P.top}" x2="${x}" y2="${P.top + plotH}"/>\n`;
    svg += `<text x="${x}" y="${P.top + plotH + 18}" text-anchor="middle" class="tick">${n}</text>\n`;
  });

  // Axis labels
  svg += `<text x="${P.left + plotW/2}" y="${P.top + plotH + 42}" text-anchor="middle" class="axis-label">Number of registered nodes</text>\n`;
  svg += `<text x="${20}" y="${P.top + plotH/2}" text-anchor="middle" class="axis-label" transform="rotate(-90, 20, ${P.top + plotH/2})">Validation time (ms)</text>\n`;

  // Series
  series.forEach((s) => {
    // Line
    let d = "";
    let started = false;
    s.data.forEach((v, i) => {
      const y = yFor(v);
      if (y == null) {
        started = false;
        return;
      }
      const x = xFor(i);
      d += (started ? " L " : "M ") + x + " " + y;
      started = true;
    });
    const dashAttr = s.dash ? ` stroke-dasharray="${s.dash}"` : "";
    svg += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2"${dashAttr}/>\n`;

    // Markers
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
  fs.writeFileSync(path.join(OUT_DIR, "case1_fig2_validation_time.svg"), svg);
}

// ============================================================
// Fig 3 - Payload size (line chart, linear)
// ============================================================
function makeFig3() {
  const W = 800, H = 460;
  const P = { top: 60, bottom: 100, left: 90, right: 40 };
  const plotW = W - P.left - P.right;
  const plotH = H - P.top - P.bottom;

  const nodes = [10, 50, 100, 200, 500, 1000, 2000];
  const baseB = [964, 4684, 9334, 19034, 48134, 96634, 197634];
  const propB = [534, 2454, 4854, 9854, 24854, 49854, 101854];

  const yMax = 200000;
  const xFor = (i) => P.left + (i / (nodes.length - 1)) * plotW;
  const yFor = (v) => P.top + plotH - (v / yMax) * plotH;

  let svg = svgHeader(W, H,
    "Document payload size vs node count",
    "Line chart comparing document payload size in bytes between baseline (with meta tags) and proposed (no in-DOM metadata) across node counts"
  );

  svg += `<text x="${W/2}" y="30" text-anchor="middle" class="title">Fig. 3. Document Payload Size vs Node Count</text>\n`;

  svg += `<line class="axis" x1="${P.left}" y1="${P.top + plotH}" x2="${P.left + plotW}" y2="${P.top + plotH}"/>\n`;
  svg += `<line class="axis" x1="${P.left}" y1="${P.top}" x2="${P.left}" y2="${P.top + plotH}"/>\n`;

  // Y ticks
  for (let v = 0; v <= yMax; v += 50000) {
    const y = yFor(v);
    svg += `<line class="grid" x1="${P.left}" y1="${y}" x2="${P.left + plotW}" y2="${y}"/>\n`;
    svg += `<text x="${P.left - 8}" y="${y + 4}" text-anchor="end" class="tick">${v/1000} KB</text>\n`;
  }

  // X ticks
  nodes.forEach((n, i) => {
    const x = xFor(i);
    svg += `<text x="${x}" y="${P.top + plotH + 18}" text-anchor="middle" class="tick">${n}</text>\n`;
  });

  svg += `<text x="${P.left + plotW/2}" y="${P.top + plotH + 42}" text-anchor="middle" class="axis-label">Number of registered nodes</text>\n`;
  svg += `<text x="${20}" y="${P.top + plotH/2}" text-anchor="middle" class="axis-label" transform="rotate(-90, 20, ${P.top + plotH/2})">Document payload size</text>\n`;

  // Baseline path
  let dBase = "";
  baseB.forEach((v, i) => {
    dBase += (i === 0 ? "M " : " L ") + xFor(i) + " " + yFor(v);
  });
  svg += `<path d="${dBase}" fill="none" stroke="#999999" stroke-width="2"/>\n`;
  baseB.forEach((v, i) => {
    svg += `<rect x="${xFor(i)-5}" y="${yFor(v)-5}" width="10" height="10" fill="#999999" stroke="#000" stroke-width="0.5"/>\n`;
  });

  // Proposed path
  let dProp = "";
  propB.forEach((v, i) => {
    dProp += (i === 0 ? "M " : " L ") + xFor(i) + " " + yFor(v);
  });
  svg += `<path d="${dProp}" fill="none" stroke="#222222" stroke-width="2"/>\n`;
  propB.forEach((v, i) => {
    svg += `<circle cx="${xFor(i)}" cy="${yFor(v)}" r="5" fill="#222222" stroke="#000" stroke-width="0.5"/>\n`;
  });

  // Legend
  const legY = H - 30;
  svg += `<rect x="${P.left + 20}" y="${legY - 10}" width="14" height="14" fill="#999999" stroke="#000"/>\n`;
  svg += `<text x="${P.left + 40}" y="${legY + 2}" class="legend">Baseline (with meta tags)</text>\n`;
  svg += `<circle cx="${P.left + 250 + 7}" cy="${legY - 3}" r="5" fill="#222222" stroke="#000" stroke-width="0.5"/>\n`;
  svg += `<text x="${P.left + 250 + 22}" y="${legY + 2}" class="legend">Proposed (no in-DOM metadata)</text>\n`;

  svg += svgFooter;
  fs.writeFileSync(path.join(OUT_DIR, "case1_fig3_payload_size.svg"), svg);
}

makeFig1();
makeFig2();
makeFig3();

const files = fs.readdirSync(OUT_DIR);
console.log("Figures generated:");
for (const f of files) {
  const sz = fs.statSync(path.join(OUT_DIR, f)).size;
  console.log(`  ${f}  (${sz} bytes)`);
}
