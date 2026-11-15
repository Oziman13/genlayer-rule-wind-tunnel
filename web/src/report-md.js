// The reading of one measurement as Markdown, to paste into a pull request, an issue or a design note.
// Everything comes from the report the contract returned; nothing is recomputed here.
import { gradeInfo, pct, score100, utc, boundaryRows, bestWordingLine, driftLine, VERDICT_WORD, WORDING_LETTERS } from "./view.js";

const cell = s => String(s ?? "").replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
const INTENT = { COMPLIES: "complies", VIOLATES: "violates", OPEN: "open" };

export function reportMarkdown(r, { contract = "", explorer = "", repo = "" } = {}) {
  const rep = r.report, g = gradeInfo(rep.grade), latest = r.runs[r.runs.length - 1];
  const k = r.pack.wordings.length;
  const out = [];
  out.push(`# Rule Wind Tunnel: ${cell(r.pack.label)}`, "");
  out.push(`**${g.word}**, score ${score100(rep.score_permille)} out of 100.`, "");
  out.push(`- Consistency: ${pct(rep.consistency_permille)}`);
  out.push(`- Fidelity: ${pct(rep.fidelity_permille)}`);
  out.push(`- Boundary cases: ${rep.boundary.length}`);
  out.push(`- Run ${r.runs.length} of up to 5, ${utc(latest.at)}. ${driftLine(r)}`);
  out.push(`- ${bestWordingLine(r)}`, "");
  out.push("## Wordings", "");
  r.pack.wordings.forEach((w, i) => out.push(`${WORDING_LETTERS[i]}. ${cell(w)}`));
  out.push("", "## Verdicts", "");
  out.push(`| Case | Intended | ${r.pack.wordings.map((_, i) => WORDING_LETTERS[i]).join(" | ")} |`);
  out.push(`|---|---|${"---|".repeat(k)}`);
  r.pack.cases.forEach((c, j) => out.push(`| ${j + 1}. ${cell(c.text)} | ${INTENT[c.intent]} | ${latest.rows.map(row => VERDICT_WORD[row[j]]).join(" | ")} |`));
  const rows = boundaryRows(r);
  out.push("", "## Boundary cases", "");
  if (rows.length) rows.forEach(b => out.push(`- Case ${b.index + 1}: ${cell(b.text)} ${b.why}`));
  else out.push("None. Every wording agreed on every case, and the majority matched every intended verdict.");
  out.push("", "## Record", "");
  out.push(`- Pack id: \`${r.id}\``);
  if (contract) out.push(`- Contract: ${explorer ? `[\`${contract}\`](${explorer}/address/${contract})` : `\`${contract}\``} (GenLayer Studionet, a test network)`);
  out.push(`- Measured with Rule Wind Tunnel${repo ? `: ${repo}` : ""}`, "");
  out.push("A steady grade is about these cases and these wordings. It is not proof the rule is right.", "");
  return out.join("\n");
}
