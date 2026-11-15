// Reads the contract's compare_json (two measured packs side by side, the second minus the first) into rows a person
// can read. Nothing is recomputed from tables: the numbers are the contract's, shown the way the rest of the page
// shows them (permille floored to a whole percent), so that subtracting the shown values gives the shown change.
import { gradeInfo, score100 } from "./view.js";

const isInt = v => Number.isInteger(v);
const side = s => s && typeof s === "object" && typeof s.id === "string" && typeof s.label === "string" && !!gradeInfo(s.grade)
  && isInt(s.score_permille) && isInt(s.consistency_permille) && (s.fidelity_permille === null || isInt(s.fidelity_permille)) && isInt(s.boundary_cases);

export function parseCompare(text) {
  let c;
  try { c = typeof text === "string" ? JSON.parse(text) : text; } catch { return null; }
  if (!c || typeof c !== "object" || !side(c.first) || !side(c.second) || !c.delta || typeof c.delta !== "object") return null;
  return c;
}

const signed = n => (n > 0 ? "+" + n : String(n));
const shown = p => (p === null ? null : score100(p));
// "better" means the change is in the direction a rule author wants: higher agreement, fewer boundary cases.
const trend = (d, higherIsBetter) => (d === 0 ? "same" : (d > 0) === higherIsBetter ? "better" : "worse");

export function compareRows(c) {
  const a = c.first, b = c.second;
  const pctRow = (name, x, y) => {
    if (x === null || y === null) return { name, first: x === null ? "none" : shown(x) + "%", second: y === null ? "none" : shown(y) + "%", change: "", trend: "same" };
    const d = shown(y) - shown(x);
    return { name, first: shown(x) + "%", second: shown(y) + "%", change: signed(d), trend: trend(d, true) };
  };
  const bd = b.boundary_cases - a.boundary_cases;
  const ds = score100(b.score_permille) - score100(a.score_permille);
  return [
    { name: "Score out of 100", first: String(score100(a.score_permille)), second: String(score100(b.score_permille)), change: signed(ds), trend: trend(ds, true) },
    { name: "Grade", first: gradeInfo(a.grade).word, second: gradeInfo(b.grade).word, change: a.grade === b.grade ? "" : (gradeInfo(b.grade).from > gradeInfo(a.grade).from ? "up" : "down"), trend: a.grade === b.grade ? "same" : gradeInfo(b.grade).from > gradeInfo(a.grade).from ? "better" : "worse" },
    pctRow("Consistency", a.consistency_permille, b.consistency_permille),
    pctRow("Fidelity", a.fidelity_permille, b.fidelity_permille),
    { name: "Boundary cases", first: String(a.boundary_cases), second: String(b.boundary_cases), change: signed(bd), trend: trend(bd, false) },
  ];
}

// One plain sentence about the score.
export function compareLine(c) {
  const a = score100(c.first.score_permille), b = score100(c.second.score_permille);
  const names = `${c.second.label} against ${c.first.label}`;
  if (b > a) return `${names}: steadier. The score rose from ${a} to ${b} (${signed(b - a)}).`;
  if (b < a) return `${names}: less steady. The score fell from ${a} to ${b} (${signed(b - a)}).`;
  return `${names}: the same score, ${a} out of 100.`;
}
