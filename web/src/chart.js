// The test section: one streamline per wording, one gate per case.
// Reading it: a gate is a case. The height at which a line crosses a gate is the verdict that wording gave
// (top: complies, middle: unclear, bottom: violates). Lines that cross a gate together agree; lines that fan out
// disagree. The lines join one wording's answers in case order; the order of the cases carries no meaning.

export const W = 1200, H = 430;
const LEFT = 128, RIGHT = 1096, TOP = 64, BOTTOM = 360;
export const LANE_Y = { C: 120, U: 212, V: 304 };
export const LANE_NAME = { C: "complies", U: "unclear", V: "violates" };
const SPREAD = 8;

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function gateX(j, n) { return n === 1 ? (LEFT + RIGHT) / 2 : LEFT + 40 + (j * (RIGHT - LEFT - 80)) / (n - 1); }

// Wording i sits slightly above or below its neighbours inside a lane, so a bundle of agreeing lines reads as a bundle.
export function offset(i, k) { return (i - (k - 1) / 2) * SPREAD; }

export function pathFor(row, i, k, n) {
  const pts = [...row].map((letter, j) => [gateX(j, n), LANE_Y[letter] + offset(i, k)]);
  let d = `M ${LEFT - 28} ${pts[0][1]} L ${pts[0][0]} ${pts[0][1]}`;
  for (let j = 1; j < pts.length; j++) {
    const [x0, y0] = pts[j - 1], [x1, y1] = pts[j];
    const xm = (x0 + x1) / 2;
    d += ` C ${xm} ${y0} ${xm} ${y1} ${x1} ${y1}`;
  }
  const last = pts[pts.length - 1];
  return d + ` L ${RIGHT + 24} ${last[1]}`;
}

// `r` is a parsed report (see view.js parseReport). Returns SVG markup.
export function streamSvg(r, { animate = true } = {}) {
  const rows = r.runs[r.runs.length - 1].rows;
  const k = rows.length, n = r.pack.cases.length;
  const boundary = new Set(r.report.boundary);
  const parts = [];
  parts.push(`<svg id="tunnel-svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-labelledby="tunnel-title tunnel-desc" focusable="false">`);
  parts.push(`<title id="tunnel-title">Verdicts of ${k} wordings on ${n} cases</title>`);
  parts.push(`<desc id="tunnel-desc">Each line is one wording of the rule. Each vertical gate is one case. A line crosses a gate at the height of its verdict: top complies, middle unclear, bottom violates. The same data is in the table below.</desc>`);
  // lanes
  for (const l of ["C", "U", "V"]) {
    parts.push(`<line class="lane" x1="${LEFT - 28}" x2="${RIGHT + 24}" y1="${LANE_Y[l]}" y2="${LANE_Y[l]}"/>`);
    parts.push(`<text class="lane-name" x="${LEFT - 40}" y="${LANE_Y[l] + 5}" text-anchor="end">${LANE_NAME[l]}</text>`);
  }
  // gates
  for (let j = 0; j < n; j++) {
    const x = gateX(j, n), c = r.pack.cases[j], b = boundary.has(j);
    const intent = c.intent === "COMPLIES" ? "C" : c.intent === "VIOLATES" ? "V" : null;
    parts.push(`<g class="gate${b ? " is-boundary" : ""}" data-case="${j}" tabindex="0" role="button" aria-label="Case ${j + 1}: ${esc(c.text)}">`);
    parts.push(`<rect class="gate-hit" x="${x - 30}" y="${TOP - 18}" width="60" height="${BOTTOM - TOP + 60}"/>`);
    if (b) parts.push(`<rect class="wake" x="${x - 22}" y="${TOP}" width="44" height="${BOTTOM - TOP}"/>`);
    parts.push(`<line class="post${intent ? "" : " open"}" x1="${x}" x2="${x}" y1="${TOP}" y2="${BOTTOM}"/>`);
    if (intent) parts.push(`<circle class="intent" cx="${x}" cy="${LANE_Y[intent]}" r="${12 + Math.ceil((k - 1) / 2) * SPREAD * 0.5}"/>`);
    parts.push(`<text class="gate-no${b ? " is-boundary" : ""}" x="${x}" y="${BOTTOM + 30}" text-anchor="middle">${j + 1}</text>`);
    if (r.report.per_case[j].off_intent) parts.push(`<path class="miss" d="M ${x - 5} ${BOTTOM + 42} l 10 10 m 0 -10 l -10 10"/>`);
    parts.push(`</g>`);
  }
  // streamlines, then dots
  for (let i = 0; i < k; i++) {
    parts.push(`<path class="stream s${i + 1}${animate ? " draw" : ""}" style="--i:${i}" pathLength="1" d="${pathFor(rows[i], i, k, n)}"/>`);
  }
  for (let i = 0; i < k; i++) {
    for (let j = 0; j < n; j++) {
      parts.push(`<circle class="dot s${i + 1}" cx="${gateX(j, n)}" cy="${LANE_Y[rows[i][j]] + offset(i, k)}" r="4.5"/>`);
    }
  }
  // direct labels at the outlet
  for (let i = 0; i < k; i++) {
    const last = rows[i][n - 1];
    parts.push(`<g class="outlet"><circle class="swatch s${i + 1}" cx="${RIGHT + 44}" cy="${LANE_Y[last] + offset(i, k)}" r="8"/><text x="${RIGHT + 44}" y="${LANE_Y[last] + offset(i, k) + 4}" text-anchor="middle">${"ABCDE"[i]}</text></g>`);
  }
  parts.push(`</svg>`);
  return parts.join("");
}
