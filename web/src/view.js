// Turns a report from the contract (get_report_json) into the words and numbers the page shows.
// Nothing here recomputes a measurement: the contract's numbers are shown as they are.

export const VERDICT_WORD = { C: "complies", V: "violates", U: "unclear" };
export const LETTER_OF = { COMPLIES: "C", VIOLATES: "V", UNCLEAR: "U" };
export const GRADES = [
  { id: "UNSTABLE", word: "Unstable", from: 0, line: "The readings do not hold together. A contract built on this rule may struggle to settle." },
  { id: "SHAKY", word: "Shaky", from: 550, line: "Different wordings pull cases apart. Tighten the rule before you build on it." },
  { id: "USABLE", word: "Usable", from: 750, line: "Mostly steady. Look at the boundary cases before you rely on it." },
  { id: "STEADY", word: "Steady", from: 900, line: "The wordings agree and match what you intended, for these cases." },
];
export const gradeInfo = id => GRADES.find(g => g.id === id) || null;

// 899 permille must not read as 90, so the percentage is floored.
export const pct = permille => (permille === null || permille === undefined ? "none" : Math.floor(permille / 10) + "%");
export const score100 = permille => Math.floor(permille / 10);
export const WORDING_LETTERS = "ABCDE";

export const utc = t => (t ? new Date(t * 1000).toISOString().replace("T", " ").slice(0, 16) + " UTC" : "unknown time");
export const shortId = id => (id ? id.slice(0, 8) + "…" + id.slice(-6) : "");

export function parseReport(text) {
  let r;
  try { r = typeof text === "string" ? JSON.parse(text) : text; } catch { return null; }
  if (!r || typeof r !== "object" || !r.pack || !Array.isArray(r.runs) || !r.runs.length || !r.report) return null;
  const k = r.pack.wordings?.length, n = r.pack.cases?.length;
  const latest = r.runs[r.runs.length - 1];
  if (!Number.isInteger(k) || !Number.isInteger(n) || !Array.isArray(latest.rows) || latest.rows.length !== k) return null;
  if (!latest.rows.every(row => typeof row === "string" && row.length === n && /^[CVU]+$/.test(row))) return null;
  if (!Array.isArray(r.report.per_case) || r.report.per_case.length !== n || !gradeInfo(r.report.grade)) return null;
  return r;
}

const countsText = (counts) => ["C", "V", "U"].filter(l => counts[l]).map(l => `${counts[l]} ${VERDICT_WORD[l]}`).join(", ");

// One sentence per boundary case, plus which wording said what.
export function boundaryRows(r) {
  const latest = r.runs[r.runs.length - 1];
  const k = r.pack.wordings.length;
  return r.report.boundary.map(j => {
    const c = r.report.per_case[j];
    const intent = r.pack.cases[j].intent;
    const said = latest.rows.map((row, i) => ({ wording: WORDING_LETTERS[i], verdict: row[j] }));
    let why;
    if (c.class === "SPLIT") why = `The wordings split with no majority: ${countsText(c.counts)}.`;
    else if (c.class === "MAJORITY") why = `${c.counts[c.majority]} of ${k} wordings say ${VERDICT_WORD[c.majority]}; the others differ.`;
    else why = `All ${k} wordings say ${VERDICT_WORD[c.majority]}.`;
    if (c.off_intent) {
      const want = intent === "COMPLIES" ? "complies" : "violates";
      why += c.majority ? ` You intended: ${want}.` : ` You intended: ${want}, and no verdict won.`;
    }
    return { index: j, text: r.pack.cases[j].text, intent, klass: c.class, off: c.off_intent, why, said };
  });
}

export function bestWordingLine(r) {
  const rep = r.report;
  const letter = WORDING_LETTERS[rep.best_wording];
  const share = pct(rep.alignment_permille[rep.best_wording]);
  const basis = rep.fidelity_permille === null ? "the majority reading" : "your intended verdicts and the majority reading";
  if (rep.best_tied) return `Wording ${letter} matches ${basis} most often (${share}), tied with at least one other. Pick the one you find clearest.`;
  return `Wording ${letter} matches ${basis} most often (${share}).`;
}

export function driftLine(r) {
  if (r.runs.length < 2 || r.drift_cells === null || r.drift_cells === undefined) return `Measured once. Measuring again shows how much the readings move between runs.`;
  const total = r.pack.wordings.length * r.pack.cases.length;
  if (r.drift_cells === 0) return `${r.runs.length} runs, and no cell changed between the first and the latest.`;
  return `${r.runs.length} runs. ${r.drift_cells} of ${total} cells changed between the first and the latest.`;
}

// What each wording said, as a table the chart can be read from without colour or sight.
export function matrixRows(r) {
  const latest = r.runs[r.runs.length - 1];
  return r.pack.wordings.map((w, i) => ({ letter: WORDING_LETTERS[i], text: w, cells: [...latest.rows[i]], alignment: r.report.alignment_permille[i], best: i === r.report.best_wording }));
}
