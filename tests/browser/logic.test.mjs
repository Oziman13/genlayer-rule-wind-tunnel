// Pure-logic tests for the web client: pack rules, pack ids (must equal the contract's), report reading, chart geometry.
// Run from the repository root:  node tests/browser/logic.test.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { webcrypto } from "node:crypto";
import { LIMITS, problems, normalize, packId, packJson } from "../../web/src/pack.js";
import { parseReport, pct, score100, boundaryRows, bestWordingLine, driftLine, matrixRows, gradeInfo, GRADES, utc, shortId } from "../../web/src/view.js";
import { streamSvg, gateX, offset, pathFor, LANE_Y } from "../../web/src/chart.js";
import sample from "../../web/src/sample.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fx = n => JSON.parse(fs.readFileSync(path.join(ROOT, "fixtures", n), "utf8"));
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => { cond ? pass++ : fail++; console.log((cond ? "PASS " : "FAIL ") + name + (cond ? "" : "  " + extra)); };
const subtle = webcrypto.subtle;

// ---- the limits equal the contract's
const src = fs.readFileSync(path.join(ROOT, "contracts/rule_wind_tunnel.py"), "utf8");
const pair = name => { const m = src.match(new RegExp(`${name}, ${name.replace("MIN", "MAX")} = (\\d+), (\\d+)`)); return m ? [Number(m[1]), Number(m[2])] : null; };
ok("limits: wordings", JSON.stringify(pair("MIN_WORDINGS")) === JSON.stringify(LIMITS.wordings));
ok("limits: cases", JSON.stringify(pair("MIN_CASES")) === JSON.stringify(LIMITS.cases));
ok("limits: wording length", JSON.stringify(pair("WORDING_MIN")) === JSON.stringify(LIMITS.wording));
ok("limits: case length", JSON.stringify(pair("CASE_MIN")) === JSON.stringify(LIMITS.caseText));
ok("limits: label length", JSON.stringify(pair("LABEL_MIN")) === JSON.stringify(LIMITS.label));
ok("limits: pack text", Number(src.match(/MAX_PACK_TEXT = (\d+)/)[1]) === LIMITS.packText);

// ---- pack ids equal the ones Python computes (the contract test asserts the same three values)
const v1 = fx("refund-v1-vague.json"), v2 = fx("refund-v2-precise.json"), uni = fx("unicode-pack.json");
ok("id: vague refund pack", await packId(v1, subtle) === "976df62ae598c0a1c04a07a325d5aa5e54a6697b001e357353317e68f1fcb2b3");
ok("id: revised refund pack (names the first as previous)", await packId(v2, subtle) === "ad2fccd96e6e3536fe98afa7e268d979a384e2bd190f88c839eee882e87d0542");
ok("id: non-ASCII pack (escapes as Python does)", await packId(uni, subtle) === "b3993bc83ae6e6f36533e9ad1e75a825264d238a5a94de842282fba13bbf7f2f");
const messy = { ...v1, label: "  Refund   rule v1 (vague) \n", wordings: v1.wordings.map(w => " " + w.replace(/ /g, "  ") + "\t") };
ok("id: spacing does not change it", await packId(messy, subtle) === await packId(v1, subtle));
ok("id: previous is part of it", await packId({ ...v1, previous: "a".repeat(64) }, subtle) !== await packId(v1, subtle));
ok("id: previous is lower-cased like the page sends it", normalize({ ...v1, previous: " " + "AB".repeat(32) + " " }).previous === "ab".repeat(32));
const sent = JSON.parse(packJson({ ...v1, label: "  x   y z  " }));
ok("packJson: normalised and without an empty previous", sent.label === "x y z" && !("previous" in sent) && sent.cases.length === 8);
ok("packJson: keeps previous when set", JSON.parse(packJson(v2)).previous === await packId(v1, subtle));

// ---- problems are plain sentences
ok("problems: both demo packs are fine", problems(v1).length === 0 && problems(v2).length === 0 && problems(uni).length === 0);
const empty = { label: "", previous: "", wordings: ["", "", "", ""], cases: Array.from({ length: 8 }, () => ({ text: "", intent: "OPEN" })) };
const em = problems(empty);
ok("problems: empty draft lists name, wordings, cases", em.some(p => /name of/.test(p)) && em.some(p => /Wording A/.test(p)) && em.some(p => /Case 1 /.test(p)));
ok("problems: too few wordings", problems({ ...v1, wordings: v1.wordings.slice(0, 2) }).some(p => /between 3 and 5 wordings of the rule \(now 2\)/.test(p)));
ok("problems: too many cases", problems({ ...v1, cases: [...v1.cases, ...v1.cases] }).some(p => /between 6 and 12 cases \(now 16\)/.test(p)));
ok("problems: duplicate wordings (case-insensitive)", problems({ ...v1, wordings: [v1.wordings[0], v1.wordings[0].toUpperCase(), v1.wordings[2]] }).some(p => /Two wordings are the same/.test(p)));
ok("problems: duplicate cases", problems({ ...v1, cases: v1.cases.map((c, i) => i === 1 ? { ...c, text: v1.cases[0].text } : c) }).some(p => /Two cases are the same/.test(p)));
ok("problems: bad intent", problems({ ...v1, cases: v1.cases.map((c, i) => i === 0 ? { ...c, intent: "MAYBE" } : c) }).some(p => /Case 1 needs an intended verdict/.test(p)));
ok("problems: bad previous", problems({ ...v1, previous: "xyz" }).some(p => /64-character/.test(p)));
ok("problems: control characters", problems({ ...v1, wordings: [v1.wordings[0] + "\u0001", ...v1.wordings.slice(1)] }).some(p => /Wording A/.test(p)));
ok("problems: lengths are inclusive", problems({ ...v1, wordings: ["w".repeat(20), "x".repeat(600), v1.wordings[2]], cases: v1.cases.map((c, i) => i === 0 ? { ...c, text: "c".repeat(10) } : i === 1 ? { ...c, text: "d".repeat(400) } : c) }).length === 0);
ok("problems: one character outside is caught", problems({ ...v1, wordings: ["w".repeat(19), v1.wordings[1], v1.wordings[2]] }).length === 1 && problems({ ...v1, wordings: ["w".repeat(601), v1.wordings[1], v1.wordings[2]] }).length === 1);
ok("problems: emoji count as one character like Python", problems({ ...v1, wordings: ["😀".repeat(20), v1.wordings[1], v1.wordings[2]] }).length === 0 && problems({ ...v1, wordings: ["😀".repeat(19), v1.wordings[1], v1.wordings[2]] }).length === 1);

// ---- reading a report
const r = parseReport(sample);
ok("report: the sample parses", !!r && r.report.grade === "SHAKY" && r.pack.wordings.length === 4 && r.pack.cases.length === 8);
ok("report: junk and wrong shapes are refused", parseReport("nope") === null && parseReport("{}") === null && parseReport(null) === null
  && parseReport({ ...sample, runs: [] }) === null && parseReport({ ...sample, report: { ...sample.report, grade: "FINE" } }) === null
  && parseReport({ ...sample, runs: [{ ...sample.runs[0], rows: ["CCCCCCCC"] }] }) === null
  && parseReport({ ...sample, runs: [{ ...sample.runs[0], rows: sample.runs[0].rows.map(x => x.slice(1)) }] }) === null
  && parseReport({ ...sample, runs: [{ ...sample.runs[0], rows: sample.runs[0].rows.map(x => x.replace("C", "X")) }] }) === null
  && parseReport({ ...sample, report: { ...sample.report, per_case: [] } }) === null);
ok("report: JSON text is accepted too", parseReport(JSON.stringify(sample))?.report.grade === "SHAKY");
ok("percent is floored, never rounded up to a better look", pct(899) === "89%" && pct(900) === "90%" && pct(0) === "0%" && pct(null) === "none" && score100(625) === 62 && score100(999) === 99);
ok("grades are ordered and complete", GRADES.map(g => g.id).join() === "UNSTABLE,SHAKY,USABLE,STEADY" && GRADES.map(g => g.from).join() === "0,550,750,900" && gradeInfo("USABLE").word === "Usable" && gradeInfo("x") === null);
const b = boundaryRows(r);
ok("boundary rows match the contract's list", b.map(x => x.index).join() === r.report.boundary.join() && b.length === 5);
ok("boundary text: majority", /3 of 4 wordings say complies; the others differ\./.test(b[0].why));
ok("boundary text: split and intent", /split with no majority: 2 complies, 2 violates\. You intended: complies, and no verdict won\./.test(b.find(x => x.index === 2).why));
ok("boundary text: off intent", b.some(x => x.off && /You intended: violates\./.test(x.why)));
ok("boundary rows name what each wording said", b[0].said.length === 4 && b[0].said[0].wording === "A");
ok("best wording line", /^Wording D matches your intended verdicts and the majority reading most often \(100%\)\.$/.test(bestWordingLine(r)));
ok("drift line, one run and many runs", /Measured once/.test(driftLine(r)) && /3 runs\. 2 of 32 cells changed/.test(driftLine({ ...r, runs: [r.runs[0], r.runs[0], r.runs[0]], drift_cells: 2 })) && /no cell changed/.test(driftLine({ ...r, runs: [r.runs[0], r.runs[0]], drift_cells: 0 })));
const mr = matrixRows(r);
ok("matrix rows: one per wording with every cell", mr.length === 4 && mr.every(m => m.cells.length === 8) && mr.filter(m => m.best).length === 1);
ok("time and id formatting", utc(0) === "unknown time" && utc(1792749600) === "2026-10-23 10:00 UTC" && shortId("a".repeat(64)) === "aaaaaaaa…aaaaaa");

// ---- chart geometry
const svg = streamSvg(r);
ok("chart: one gate per case and one stream per wording", (svg.match(/class="gate( is-boundary)?"/g) || []).length === 8 && (svg.match(/class="stream /g) || []).length === 4 && (svg.match(/class="dot /g) || []).length === 32);
ok("chart: a dot for every wording at every gate, one outlet label per wording", (svg.match(/class="outlet"/g) || []).length === 4);
ok("chart: boundary gates are marked, intent rings drawn for intended cases only", (svg.match(/class="wake"/g) || []).length === r.report.boundary.length && (svg.match(/class="intent"/g) || []).length === r.pack.cases.filter(c => c.intent !== "OPEN").length);
ok("chart: crosses only where the majority missed the intent", (svg.match(/class="miss"/g) || []).length === r.report.per_case.filter(c => c.off_intent).length);
ok("chart: gates are keyboard reachable and named", (svg.match(/tabindex="0" role="button" aria-label="Case \d+: /g) || []).length === 8);
ok("chart: texts are escaped", !streamSvg({ ...r, pack: { ...r.pack, cases: r.pack.cases.map((c, i) => i === 0 ? { ...c, text: '<img src=x onerror=alert(1)> "q"' } : c) } }).includes("<img"));
ok("chart: animation can be switched off", !streamSvg(r, { animate: false }).includes("draw"));
ok("chart: gates are evenly spaced left to right", gateX(0, 8) < gateX(1, 8) && Math.abs((gateX(2, 8) - gateX(1, 8)) - (gateX(1, 8) - gateX(0, 8))) < 1e-9);
ok("chart: wordings in a lane are spread but stay inside it", offset(0, 4) < offset(3, 4) && Math.abs(offset(0, 4)) < 20 && offset(1, 3) === 0);
ok("chart: lanes run complies, unclear, violates from the top", LANE_Y.C < LANE_Y.U && LANE_Y.U < LANE_Y.V);
const d = pathFor("CVU", 0, 1, 3);
ok("chart: a path starts at the inlet and visits every gate", d.startsWith("M ") && (d.match(/ C /g) || []).length === 2 && d.includes(`${gateX(2, 3)} ${LANE_Y.U}`));

// shipped configuration: the live Studionet contract and the id the chain returned for the revised refund pack
const cfg = fs.readFileSync(path.join(ROOT, "web", "config.js"), "utf8");
const LIVE_V2 = "ad2fccd96e6e3536fe98afa7e268d979a384e2bd190f88c839eee882e87d0542";
ok("config: a contract address is set", /CONTRACT: "0x[0-9a-fA-F]{40}"/.test(cfg));
ok("config: the first view is the live revised pack", cfg.includes(`FIRST_PACK: "${LIVE_V2}"`));
ok("id: revised refund pack equals the id the contract returned on Studionet", await packId(fx("refund-v2-precise.json"), subtle) === LIVE_V2);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
