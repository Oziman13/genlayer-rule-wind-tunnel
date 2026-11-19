import { getAddress } from "viem";
import {
  hasWallet, readClient, writeClient, connectWallet, currentNetworkOk, watchWallet,
  sendAndConfirm, watchTx, loadPending, clearPending, readNonce, listAccountTxs, EXPLORER,
} from "./wallet.js";
import { nextStep } from "./recovery.js";
import { streamSvg } from "./chart.js";
import { problems, packId, packJson, normalize, LIMITS } from "./pack.js";
import {
  parseReport, gradeInfo, GRADES, pct, score100, utc, shortId, boundaryRows, bestWordingLine, driftLine, matrixRows,
  VERDICT_WORD, WORDING_LETTERS,
} from "./view.js";
import { hedgeNotes } from "./hedges.js";
import { revisionDraft, interpretPackFile } from "./pack-file.js";
import { parseCompare, compareRows, compareLine } from "./compare.js";
import { reportMarkdown } from "./report-md.js";
import sample from "./sample.js";

const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const cfg = window.WT_CONFIG || {};
const query = new URLSearchParams(location.search);
const validAddress = a => /^0x[0-9a-fA-F]{40}$/.test(String(a || ""));
const contract = (() => { const a = (query.get("contract") || cfg.CONTRACT || "").trim(); try { return validAddress(a) ? getAddress(a) : ""; } catch { return ""; } })();
const POLL = Number(query.get("poll")) || 3000;

const state = { report: null, source: "sample", account: "", busy: false, packs: [] };

// ---------------------------------------------------------------- reading a measurement

function setGauge(r) {
  const g = gradeInfo(r.report.grade);
  const score = score100(r.report.score_permille);
  $("gauge").innerHTML = `<div><span class="word">${esc(g.word)}</span><span class="score num">${score} out of 100</span></div>
    <p class="line">${esc(g.line)}</p>
    <div class="scale" aria-hidden="true"><i></i><i></i><i></i><i></i><b style="left:${Math.min(99, Math.max(1, score))}%"></b></div>
    <div class="scale-names" aria-hidden="true"><span>Unstable</span><span>Shaky</span><span>Usable</span><span>Steady</span></div>`;
}

function setCaption(r) {
  const runs = r.runs.length;
  const latest = r.runs[runs - 1];
  if (state.source === "sample") {
    $("tunnel-caption").innerHTML = `<strong>Sample table.</strong> Answers invented for this page; nothing here was measured on the network. Measure a rule below, or open one from the board.`;
    return;
  }
  const by = latest.by && latest.by.startsWith("0x") ? latest.by.slice(0, 8) + "…" + latest.by.slice(-4) : "unknown";
  $("tunnel-caption").innerHTML = `<strong>${esc(r.pack.label)}.</strong> Run ${runs} of up to 5, ${esc(utc(latest.at))}, by ${esc(by)}. Pack <span class="mono">${esc(shortId(r.id))}</span>.`;
}

function setKey(r) {
  $("key").innerHTML = r.pack.wordings.map((w, i) => `<li><span class="tag s${i + 1}">${WORDING_LETTERS[i]}</span><span>${esc(w)}</span></li>`).join("");
}

function setReadouts(r) {
  const rep = r.report;
  $("read-lead").textContent = state.source === "sample"
    ? "Read it on the sample, then measure your own rule."
    : `${r.pack.cases.length} cases put to ${r.pack.wordings.length} wordings: ${r.pack.wordings.length * r.pack.cases.length} verdicts in all.`;
  $("readouts").innerHTML = `
    <div class="readout"><div class="big num">${pct(rep.consistency_permille)}</div><div class="bar" aria-hidden="true"><i style="width:${Math.floor(rep.consistency_permille / 10)}%"></i></div><div class="name">Consistency</div><p>How often two wordings give the same case the same verdict.</p></div>
    <div class="readout"><div class="big num">${pct(rep.fidelity_permille)}</div><div class="bar" aria-hidden="true"><i style="width:${rep.fidelity_permille === null ? 0 : Math.floor(rep.fidelity_permille / 10)}%"></i></div><div class="name">Fidelity</div><p>${rep.fidelity_permille === null ? "No case had an intended verdict, so there is nothing to compare with." : "How often the majority verdict is the one you intended."}</p></div>
    <div class="readout"><div class="big num">${rep.boundary.length}</div><div class="name">Boundary ${rep.boundary.length === 1 ? "case" : "cases"}</div><p>${rep.boundary.length ? "Where the wordings split or the majority missed your intent." : "Every case was read the same way, as intended."}</p></div>`;
  $("best-line").textContent = bestWordingLine(r);
  $("drift-line").textContent = state.source === "sample" ? "" : driftLine(r);
}

function setBoundary(r) {
  const rows = boundaryRows(r);
  $("boundary").innerHTML = rows.length ? rows.map(b => `<li data-case="${b.index}"><span class="no num">${b.index + 1}</span><div>
      <p class="case">${esc(b.text)}</p><p class="why">${esc(b.why)}</p>
      <div class="verdicts">${b.said.map(s => `<span><span class="tag s${WORDING_LETTERS.indexOf(s.wording) + 1}">${s.wording}</span>${VERDICT_WORD[s.verdict]}</span>`).join("")}</div></div></li>`).join("")
    : `<li class="empty" style="display:block">No boundary cases. All ${r.pack.wordings.length} wordings agreed on every case, and the majority matched every intended verdict. Nothing here needs a rewrite before you rely on this reading.</li>`;
}

const GLYPH = { C: "complies", V: "violates", U: "unclear" };
function setMatrix(r) {
  const head = `<thead><tr><th scope="col">Wording</th><th scope="col" class="wtext">Text</th>${r.pack.cases.map((_, j) => `<th scope="col">${j + 1}</th>`).join("")}<th scope="col">Match</th></tr></thead>`;
  const intent = `<tr class="intent"><th scope="row">Intended</th><td class="wtext"></td>${r.pack.cases.map(c => `<td>${c.intent === "OPEN" ? "open" : c.intent === "COMPLIES" ? "complies" : "violates"}</td>`).join("")}<td></td></tr>`;
  const body = matrixRows(r).map(m => `<tr><th scope="row" class="${m.best ? "best" : ""}">${m.letter}</th><td class="wtext">${esc(m.text)}</td>${m.cells.map(c => `<td class="v-${c}">${GLYPH[c]}</td>`).join("")}<td class="num ${m.best ? "best" : ""}">${pct(m.alignment)}</td></tr>`).join("");
  $("matrix").innerHTML = head + `<tbody>${intent}${body}</tbody>`;
}

async function setLineage(r) {
  const box = $("lineage");
  box.hidden = true;
  if (state.source === "sample" || !contract) return;
  let chain;
  try { chain = JSON.parse(await readClient().readContract({ address: contract, functionName: "get_lineage_json", args: [r.id] })); } catch { return; }
  if (!Array.isArray(chain) || chain.length < 2) return;
  const pts = chain.slice().reverse();
  const W = 760, H = 190, L = 56, R = 40, T = 24, B = 54;
  const x = i => L + (pts.length === 1 ? 0 : (i * (W - L - R)) / (pts.length - 1));
  const y = s => T + (1 - s / 1000) * (H - T - B);
  const line = pts.map((p, i) => `${i ? "L" : "M"} ${x(i)} ${y(p.score_permille)}`).join(" ");
  const grid = [0, 550, 750, 900].map(t => `<line class="axis" x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/><text x="${L - 8}" y="${y(t) + 4}" text-anchor="end">${t / 10}</text>`).join("");
  const dots = pts.map((p, i) => `<circle class="pt${i === pts.length - 1 ? " now" : ""}" cx="${x(i)}" cy="${y(p.score_permille)}" r="6"/><text class="lab" x="${x(i)}" y="${y(p.score_permille) - 14}" text-anchor="middle">${Math.floor(p.score_permille / 10)}</text><text x="${x(i)}" y="${H - 22}" text-anchor="${pts.length > 1 && i === 0 ? "start" : pts.length > 1 && i === pts.length - 1 ? "end" : "middle"}">${esc(p.label.length > 24 ? p.label.slice(0, 23) + "…" : p.label)}</text>`).join("");
  box.innerHTML = `<h3>Revisions of this rule</h3><p class="hint">Score of each version, oldest first. Lines at 55, 75 and 90 mark the grade edges.</p>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Scores of ${pts.length} versions: ${pts.map(p => esc(p.label) + " " + Math.floor(p.score_permille / 10)).join(", ")}">${grid}<path class="trace" d="${line}"/>${dots}</svg>
    <button class="btn small" type="button" id="cmp-prev" data-a="${esc(chain[1].id)}" data-b="${esc(r.id)}">Compare with the version it revises</button>`;
  box.hidden = false;
}

function bindGates(r) {
  const gates = [...document.querySelectorAll("#tunnel-svg .gate")];
  const open = j => {
    gates.forEach(g => g.classList.toggle("is-open", Number(g.dataset.case) === j));
    const c = r.pack.cases[j], per = r.report.per_case[j], rows = r.runs[r.runs.length - 1].rows;
    const intent = c.intent === "OPEN" ? "No intended verdict." : `You intended: ${c.intent === "COMPLIES" ? "complies" : "violates"}.`;
    $("gate-detail").innerHTML = `<b>Case ${j + 1}.</b> ${esc(c.text)} ${esc(intent)}
      <span class="verdicts">${rows.map((row, i) => `<span><span class="tag s${i + 1}">${WORDING_LETTERS[i]}</span>${VERDICT_WORD[row[j]]}</span>`).join("")}</span>`;
    void per;
  };
  gates.forEach((g, idx) => {
    const j = Number(g.dataset.case);
    g.addEventListener("click", () => open(j));
    g.addEventListener("focus", () => open(j));
    g.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(j); }
      if (e.key === "ArrowRight" && gates[idx + 1]) { e.preventDefault(); gates[idx + 1].focus(); }
      if (e.key === "ArrowLeft" && gates[idx - 1]) { e.preventDefault(); gates[idx - 1].focus(); }
    });
  });
  const first = r.report.boundary.length ? r.report.boundary[0] : null;
  if (first !== null) open(first); else $("gate-detail").textContent = "Select a gate to read its case.";
}

// ---------------------------------------------------------------- copy the reading as Markdown

function setActions(source) {
  $("report-actions").hidden = source === "sample";
  $("copy-status").textContent = "";
  $("md-fallback").hidden = true;
}

$("copy-md").addEventListener("click", async () => {
  if (!state.report || state.source === "sample") return;
  const md = reportMarkdown(state.report, { contract, explorer: EXPLORER, repo: cfg.REPO || "" });
  const el = $("copy-status");
  try {
    await navigator.clipboard.writeText(md);
    el.textContent = "Copied.";
    $("md-fallback").hidden = true;
  } catch {
    const ta = $("md-fallback");
    ta.value = md; ta.hidden = false; ta.focus(); ta.select();
    el.textContent = "Could not copy automatically. The text is selected below: copy it yourself.";
  }
});

function show(r, source) {
  state.report = r;
  state.source = source;
  const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  $("tunnel").innerHTML = streamSvg(r, { animate: !reduce });
  setGauge(r); setCaption(r); setKey(r); setReadouts(r); setBoundary(r); setMatrix(r); bindGates(r); setLineage(r); setActions(source);
  document.title = source === "sample" ? "Rule Wind Tunnel" : `${r.pack.label} | Rule Wind Tunnel`;
}

// ---------------------------------------------------------------- the board

async function readJson(fn, args) {
  const raw = await readClient().readContract({ address: contract, functionName: fn, args });
  return raw;
}

function boardNote(html, cls = "") { const el = $("board-status"); el.hidden = !html; el.className = "status " + cls; el.innerHTML = html || ""; el.setAttribute("role", cls === "bad" ? "alert" : "status"); }

function netState(cls, title) { const n = $("net"); n.className = "net " + cls; if (title) n.title = title; }

async function loadBoard() {
  if (!contract) {
    $("packs").innerHTML = "";
    $("board-lead").textContent = "No contract address is set for this page yet, so there is no board to read.";
    $("openform").hidden = true;
    return;
  }
  $("board-lead").textContent = "Every measurement is public. Open one to see its table.";
  let page;
  try { page = JSON.parse(await readJson("get_packs_page", [0, 50])); } catch (e) { netState("is-down", "Could not reach Studionet just now."); boardNote("Could not read the board: " + esc(e.message || e) + " Reload the page once you are back online.", "bad"); return; }
  netState("is-live", "Connected: this page is reading GenLayer Studionet, a test network.");
  boardNote("");
  state.packs = (page.items || []).slice().reverse();
  $("packs").innerHTML = state.packs.length ? state.packs.map(p => {
    const g = gradeInfo(p.grade);
    return `<li><a href="?pack=${esc(p.id)}" data-id="${esc(p.id)}"><span class="t">${esc(p.label)}</span><span class="g g-${esc(p.grade)}">${esc(g ? g.word : p.grade)} <span class="num">${score100(p.score_permille)}</span></span>
      <span class="m">${p.runs} ${p.runs === 1 ? "run" : "runs"}, latest ${esc(utc(p.at))}${p.previous ? ", revises " + esc(shortId(p.previous)) : ""}</span></a></li>`;
  }).join("") : `<li class="empty" style="display:block;border-top:0">Nothing has been measured yet. Be the first: use the form below. Name the rule, write at least three wordings, and add at least six cases.</li>`;
  const select = $("f-previous");
  const keep = select.value;
  select.innerHTML = `<option value="">No, this is a first version</option>` + state.packs.map(p => `<option value="${esc(p.id)}">${esc(p.label)} (${esc(gradeInfo(p.grade)?.word || p.grade)}, ${esc(shortId(p.id))})</option>`).join("");
  select.value = state.packs.some(p => p.id === keep) ? keep : "";
  fillCompare();
}

// ---------------------------------------------------------------- comparing two measurements

function fillCompare() {
  const box = $("compare");
  box.hidden = state.packs.length < 2;
  if (box.hidden) return;
  const a = $("cmp-a"), b = $("cmp-b");
  const keepA = a.value, keepB = b.value;
  const opts = state.packs.map(p => `<option value="${esc(p.id)}">${esc(p.label)} (${esc(gradeInfo(p.grade)?.word || p.grade)} ${score100(p.score_permille)}, ${esc(shortId(p.id))})</option>`).join("");
  a.innerHTML = opts; b.innerHTML = opts;
  // newest first on the board: the default is the older one against the newest
  a.value = state.packs.some(p => p.id === keepA) ? keepA : state.packs[1].id;
  b.value = state.packs.some(p => p.id === keepB) ? keepB : state.packs[0].id;
}

function compareNote(html, cls = "") { $("compare-out").innerHTML = html ? `<p class="status ${cls}">${html}</p>` : ""; }

async function runCompare(idA, idB) {
  if (!contract) return;
  if (idA === idB) { compareNote("Pick two different measurements. Change one of the two lists, then compare again.", "bad"); return; }
  compareNote("Reading both measurements…");
  let raw;
  try { raw = await readJson("compare_json", [idA, idB]); } catch (e) { compareNote("Could not read the contract: " + esc(e.message || e) + " Reload the page and compare again.", "bad"); return; }
  if (raw === "NONE") { compareNote("One of these is not on this contract. Choose both rules from the lists, which only contain measurements stored here.", "bad"); return; }
  const c = parseCompare(raw);
  if (!c) { compareNote("The contract returned something this page cannot read. Reload and try the same two rules again.", "bad"); return; }
  const rows = compareRows(c);
  const word = t => ({ better: "better", worse: "worse", same: "" }[t]);
  $("compare-out").innerHTML = `<p class="cmp-line">${esc(compareLine(c))}</p>
    <div class="tablewrap"><table class="cmp">
      <caption class="sr">${esc(c.first.label)} compared with ${esc(c.second.label)}</caption>
      <thead><tr><th scope="col">Measure</th><th scope="col">${esc(c.first.label)}</th><th scope="col">${esc(c.second.label)}</th><th scope="col">Change</th></tr></thead>
      <tbody>${rows.map(x => `<tr class="t-${x.trend}"><th scope="row">${esc(x.name)}</th><td class="num">${esc(x.first)}</td><td class="num">${esc(x.second)}</td><td class="num">${esc(x.change)}${x.change && word(x.trend) ? ` <span class="cw">${word(x.trend)}</span>` : ""}</td></tr>`).join("")}</tbody></table></div>
    <p class="hint">Changes are the shown values subtracted. Fidelity is "none" when no case had an intended verdict.</p>`;
}

$("compare-form").addEventListener("submit", e => { e.preventDefault(); runCompare($("cmp-a").value, $("cmp-b").value); });
$("lineage").addEventListener("click", e => {
  const b = e.target.closest("#cmp-prev");
  if (!b) return;
  if ($("cmp-a").querySelector(`option[value="${b.dataset.a}"]`) && $("cmp-b").querySelector(`option[value="${b.dataset.b}"]`)) { $("cmp-a").value = b.dataset.a; $("cmp-b").value = b.dataset.b; }
  $("compare").scrollIntoView({ behavior: "smooth", block: "start" });
  runCompare(b.dataset.a, b.dataset.b);
});

async function openPack(id, { scroll = true, quiet = false } = {}) {
  if (!/^[0-9a-f]{64}$/.test(id)) { boardNote("A pack id is 64 characters, 0 to 9 and a to f. Paste the full id, with nothing else in the box.", "bad"); return false; }
  if (!contract) { boardNote("No contract address is set for this page yet. Open this page from a build that names the Studionet contract, then try the id again.", "bad"); return false; }
  boardNote("Reading the measurement…");
  let raw;
  try { raw = await readJson("get_report_json", [id]); } catch (e) { boardNote("Could not read the contract: " + esc(e.message || e) + " Reload the page and open the id again.", "bad"); return false; }
  if (raw === "NONE") { boardNote("No measurement with that id on this contract. Copy an id from the board above, or measure the rule first.", "bad"); return false; }
  const r = parseReport(raw);
  if (!r) { boardNote("The contract returned something this page cannot read. Reload the page. If it stays unreadable, the answer is not a measurement this page knows.", "bad"); return false; }
  boardNote("");
  show(r, "chain");
  if (!quiet) history.replaceState(null, "", "?pack=" + id + (query.get("contract") ? "&contract=" + query.get("contract") : ""));
  if (scroll) window.scrollTo({ top: 0, behavior: "smooth" });
  return true;
}

$("packs").addEventListener("click", e => {
  const a = e.target.closest("a[data-id]");
  if (!a) return;
  e.preventDefault();
  openPack(a.dataset.id);
});
$("openform").addEventListener("submit", e => { e.preventDefault(); openPack($("openid").value.trim().toLowerCase()); });

// ---------------------------------------------------------------- the composer

const draft = { label: "", previous: "", wordings: ["", "", "", ""], cases: Array.from({ length: 8 }, () => ({ text: "", intent: "OPEN" })) };

function renderRows() {
  $("wordings").innerHTML = draft.wordings.map((w, i) => `<div class="row" data-w="${i}"><span class="idx tag s${i + 1}">${WORDING_LETTERS[i]}</span>
    <div><label class="sr" for="w${i}">Wording ${WORDING_LETTERS[i]}</label><textarea id="w${i}" data-w="${i}" maxlength="700" placeholder="State the rule in your own way.">${esc(w)}</textarea></div>
    <div class="tools">${draft.wordings.length > LIMITS.wordings[0] ? `<button class="mini" type="button" data-rm-w="${i}">Remove</button>` : ""}</div></div>`).join("");
  $("cases").innerHTML = draft.cases.map((c, i) => `<div class="row" data-c="${i}"><span class="idx num">${i + 1}</span>
    <div><label class="sr" for="c${i}">Case ${i + 1}</label><textarea id="c${i}" data-c="${i}" maxlength="500" placeholder="Describe one concrete situation.">${esc(c.text)}</textarea></div>
    <div class="tools"><div class="seg" role="radiogroup" aria-label="Intended verdict for case ${i + 1}">
      ${[["COMPLIES", "Complies"], ["VIOLATES", "Violates"], ["OPEN", "Open"]].map(([v, t]) => `<label><input type="radio" name="intent${i}" value="${v}" data-i="${i}" ${c.intent === v ? "checked" : ""}><span>${t}</span></label>`).join("")}</div>
      ${draft.cases.length > LIMITS.cases[0] ? `<button class="mini" type="button" data-rm-c="${i}">Remove</button>` : ""}</div></div>`).join("");
  $("addw").hidden = draft.wordings.length >= LIMITS.wordings[1];
  $("addc").hidden = draft.cases.length >= LIMITS.cases[1];
  refreshChecks();
}

let idToken = 0;
async function refreshChecks() {
  $("wc").textContent = `${draft.wordings.length} written, ${LIMITS.wordings[0]} to ${LIMITS.wordings[1]} allowed`;
  $("cc").textContent = `${draft.cases.length} written, ${LIMITS.cases[0]} to ${LIMITS.cases[1]} allowed`;
  const list = problems(draft);
  renderHedges();
  // problems about empty boxes only matter once someone has started typing
  const touched = draft.label.trim() || draft.wordings.some(w => w.trim()) || draft.cases.some(c => c.text.trim());
  $("problems").innerHTML = touched ? list.slice(0, 6).map(p => `<li>${esc(p)}</li>`).join("") + (list.length > 6 ? `<li>${list.length - 6} more to fix.</li>` : "") : "";
  const mine = ++idToken;
  if (!list.length) {
    const id = await packId(draft);
    if (mine === idToken) $("idline").innerHTML = `This pack will be stored as <span class="mono">${esc(id)}</span>.`;
  } else if (mine === idToken) $("idline").textContent = "";
  updateSend(list.length === 0);
  renderRail(list);
}

// Advice only: it never blocks a measurement and says so.
function renderHedges() {
  const notes = hedgeNotes(draft.wordings, WORDING_LETTERS);
  const box = $("hedges");
  box.hidden = !notes.length;
  if (!notes.length) { box.innerHTML = ""; return; }
  box.innerHTML = `<b>Words that leave room to guess</b>
    <ul>${notes.map(n => `<li>Wording ${n.letter}: ${n.phrases.map(p => `<q>${esc(p)}</q>`).join(", ")}</li>`).join("")}</ul>
    <p>A number or a named condition gives the models less to guess at. The vague refund rule in the demo used words like these and scored 142 out of 1,000. This is a word list, not a measurement: it does not stop you from measuring, and a rule without these words can still read unsteadily.</p>`;
}

function renderRail(list) {
  const w = draft.wordings, c = draft.cases;
  const wf = w.filter(x => x.trim()).length, cf = c.filter(x => x.text.trim()).length;
  const intended = c.filter(x => x.intent !== "OPEN").length;
  const items = [
    { what: "Name the rule", more: draft.label.trim() ? "" : "A short name for the board.", done: !!draft.label.trim() },
    { what: "Write the wordings", more: `${wf} of ${w.length} written`, done: wf === w.length && w.length >= LIMITS.wordings[0] },
    { what: "Add the cases", more: `${cf} of ${c.length} written, ${intended} with an intended verdict`, done: cf === c.length && c.length >= LIMITS.cases[0] },
    { what: "Pass the checks", more: list.length ? (wf || cf || draft.label.trim() ? `${list.length} to fix` : "Fills in as you write.") : "All set.", done: list.length === 0 },
    { what: "Connect a wallet", more: state.account ? "" : "Needed to sign the measurement.", done: !!state.account },
  ];
  const now = items.findIndex(i => !i.done);
  $("rail").innerHTML = items.map((it, i) => `<li class="${it.done ? "is-done" : i === now ? "is-now" : "is-todo"}"><span class="mk" aria-hidden="true">${it.done ? "&#10003;" : i + 1}</span><span><span class="what">${esc(it.what)}${it.done ? '<span class="sr"> (done)</span>' : ""}</span>${it.more ? `<span class="more">${esc(it.more)}</span>` : ""}</span></li>`).join("");
  [items[0].done, items[1].done, items[2].done].forEach((d, i) => $("step-" + (i + 1)).classList.toggle("is-done", d));
}

function updateSend(valid) {
  const ready = valid && !!contract && !!state.account && !state.busy && !loadPending();
  const b = $("send");
  b.disabled = !ready;
  b.title = ready ? "" : !contract ? "No contract address is set for this page." : !state.account ? "Connect a wallet first." : !valid ? "Fix the points above first." : "";
}

$("f-label").addEventListener("input", e => { draft.label = e.target.value; refreshChecks(); });
$("f-previous").addEventListener("change", e => { draft.previous = e.target.value; refreshChecks(); });
$("composer").addEventListener("input", e => {
  const t = e.target;
  if (t.dataset.w !== undefined && t.tagName === "TEXTAREA") draft.wordings[Number(t.dataset.w)] = t.value;
  else if (t.dataset.c !== undefined && t.tagName === "TEXTAREA") draft.cases[Number(t.dataset.c)].text = t.value;
  else if (t.dataset.i !== undefined && t.type === "radio") draft.cases[Number(t.dataset.i)].intent = t.value;
  else return;
  refreshChecks();
});
$("composer").addEventListener("click", e => {
  const rw = e.target.closest("[data-rm-w]"), rc = e.target.closest("[data-rm-c]");
  if (rw) { draft.wordings.splice(Number(rw.dataset.rmW), 1); renderRows(); }
  if (rc) { draft.cases.splice(Number(rc.dataset.rmC), 1); renderRows(); }
});
$("addw").onclick = () => { if (draft.wordings.length < LIMITS.wordings[1]) { draft.wordings.push(""); renderRows(); $("w" + (draft.wordings.length - 1)).focus(); } };
$("addc").onclick = () => { if (draft.cases.length < LIMITS.cases[1]) { draft.cases.push({ text: "", intent: "OPEN" }); renderRows(); $("c" + (draft.cases.length - 1)).focus(); } };

const EXAMPLES = {
  v1: {
    label: "Refund rule v1 (vague)", previous: "",
    wordings: ["Approve a refund when the item was returned within a reasonable time after delivery.", "A refund is valid only if the buyer sent the item back soon after receiving it.", "Refunds are granted for items that were returned promptly.", "The buyer may get a refund provided the return happened in good time and the item is in acceptable condition."],
    cases: [["Buyer returned an unopened item 3 days after delivery.", "COMPLIES"], ["Buyer returned the item 12 days after delivery, unused.", "COMPLIES"], ["Buyer returned the item 20 days after delivery, in the original box.", "COMPLIES"], ["Buyer returned the item 31 days after delivery, unused.", "VIOLATES"], ["Buyer returned the item 90 days after delivery.", "VIOLATES"], ["Buyer returned a visibly worn item 5 days after delivery.", "VIOLATES"], ["Buyer sent only a photo of the item 2 days after delivery and kept the item.", "VIOLATES"], ["Buyer returned the item 34 days after delivery because the carrier lost the first parcel.", "OPEN"]],
  },
  v2: {
    label: "Refund rule v2 (30 days, unused)",
    wordings: ["Approve a refund when the item reaches the seller within 30 days of delivery and has not been used.", "A refund is valid only if (1) the item is back with the seller no later than 30 days after delivery and (2) it shows no signs of use.", "Refund if the item is returned within 30 days of delivery and unused. Otherwise do not refund.", "The buyer gets a refund when the return arrives within thirty days of the delivery date and the product is unused."],
  },
};
function selectPrevious(id, label) {
  const sel = $("f-previous");
  if (id && ![...sel.options].some(o => o.value === id)) {
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = label ? `${label} (${shortId(id)})` : `Pack ${shortId(id)}`;
    sel.appendChild(opt);
  }
  sel.value = id && [...sel.options].some(o => o.value === id) ? id : "";
}

function applyDraft(next, { focus = false } = {}) {
  draft.label = next.label;
  draft.previous = next.previous || "";
  draft.wordings = next.wordings.slice();
  draft.cases = next.cases.map(c => ({ text: c.text, intent: c.intent }));
  $("f-label").value = draft.label;
  selectPrevious(draft.previous, next.previousLabel || "");
  if (!$("f-previous").value) draft.previous = "";
  renderRows();
  if (focus) $("f-label").focus();
}

function fill(which) {
  const v1 = EXAMPLES.v1;
  const ex = which === "v1" ? v1 : { ...v1, ...EXAMPLES.v2 };
  applyDraft({
    label: ex.label, previous: "",
    wordings: ex.wordings,
    cases: v1.cases.map(([text, intent]) => ({ text, intent })),
  }, { focus: true });
}
$("ex1").onclick = () => fill("v1");
$("ex2").onclick = () => fill("v2");

function fileNote(msg, cls = "") {
  const el = $("file-status");
  el.hidden = !msg;
  el.className = "status " + cls;
  el.textContent = msg || "";
}

$("revise").addEventListener("click", () => {
  if (!state.report || state.source === "sample") return;
  applyDraft({ ...revisionDraft(state.report), previousLabel: state.report.pack.label }, { focus: true });
  fileNote("");
  const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  $("measure").scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
});

$("download-pack").addEventListener("click", () => {
  const blob = new Blob([packJson(draft)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "rule.json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

$("load-pack").addEventListener("change", async () => {
  const input = $("load-pack");
  const file = input.files && input.files[0];
  input.value = "";
  if (!file) return;
  let text;
  try { text = await file.text(); }
  catch { fileNote("Could not read that file on this device. Choose it again.", "bad"); return; }
  const result = interpretPackFile(text);
  if (result.error) { fileNote(result.error, "bad"); return; }
  applyDraft(result.draft, { focus: true });
  fileNote("Loaded from this device. Nothing was uploaded. The id below is the one the contract will store.", "ok");
});

// ---------------------------------------------------------------- wallet and sending

function setAccount(a) {
  state.account = a || "";
  $("account").textContent = a ? `Connected: ${a.slice(0, 8)}…${a.slice(-4)}` : "No wallet connected.";
  $("connect").textContent = a ? "Switch account" : "Connect wallet";
  refreshChecks();
}
$("connect").onclick = async () => {
  const el = $("send-status");
  try { setAccount(await connectWallet()); el.hidden = true; }
  catch (e) { el.hidden = false; el.className = "status bad"; el.textContent = e.message || String(e); }
};
watchWallet({
  onAccounts: a => setAccount(Array.isArray(a) && a.length ? a[0] : ""),
  onChain: async () => { if (state.account && !(await currentNetworkOk())) { const el = $("send-status"); el.hidden = false; el.className = "status bad"; el.textContent = "The wallet is on another network. Switch back to GenLayer Studio network before sending."; updateSend(false); } else refreshChecks(); },
});

function status(html, cls = "") { const el = $("send-status"); el.hidden = !html; el.className = "status " + cls; el.innerHTML = html || ""; }
const txLink = h => (EXPLORER && h ? `<a href="${esc(EXPLORER)}/tx/${esc(h)}" target="_blank" rel="noopener">${esc(h.slice(0, 10))}…</a>` : esc(h ? h.slice(0, 10) + "…" : ""));

async function afterApplied(id) {
  let raw;
  try { raw = await readJson("get_report_json", [id]); } catch { raw = null; }
  if (!raw || raw === "NONE") {
    setTrack(3, true);
    status("The transaction settled, but nothing was stored. The model's answer did not follow the required format, so the contract reports the pack as unmeasurable. Send it again.", "bad");
    return;
  }
  setTrack(4); $("step-4").classList.add("is-done");
  status(`Measured and recorded. <a href="?pack=${esc(id)}" data-open="${esc(id)}">Open the reading</a>.`, "ok");
  await loadBoard();
  await openPack(id, { scroll: false });
}

// the four stages of a measurement, shown as a line that fills as the transaction moves
let trackAt = -1, trackTimer = null, trackT0 = 0;
function stopTimer() { if (trackTimer) { clearInterval(trackTimer); trackTimer = null; } }
function setTrack(n, failed = false) {
  const ol = $("track");
  const note = $("reading-note");
  if (n < 0) { ol.hidden = true; ol.setAttribute("aria-busy", "false"); note.hidden = true; stopTimer(); $("elapsed").textContent = ""; trackAt = -1; return; }
  ol.hidden = false; trackAt = n;
  const reading = n === 2 && !failed;
  ol.setAttribute("aria-busy", reading ? "true" : "false");
  note.hidden = !reading;
  [...ol.children].forEach((li, i) => { li.className = i < n ? "is-done" : i === n ? (failed ? "is-failed" : "is-now") : ""; });
  if (n === 2 && !failed) {
    if (!trackTimer) {
      trackT0 = Date.now();
      const tick = () => { const t = Math.floor((Date.now() - trackT0) / 1000); $("elapsed").textContent = Math.floor(t / 60) + ":" + String(t % 60).padStart(2, "0"); };
      tick(); trackTimer = setInterval(tick, 1000);
    }
  } else stopTimer();
}
const failTrack = () => setTrack(Math.max(trackAt, 0), true);

function progress(u) {
  if (u.stage === "submitted" || (u.stage === "status" && trackAt < 2)) setTrack(2);
  if (u.stage === "submitted") status(`Sent. Transaction ${txLink(u.hash)}. The validators are reading your cases once per wording; this usually takes one to three minutes. Leave this tab open until the result is recorded.`);
  else if (u.stage === "status") status(`Transaction ${txLink(u.hash)}: ${esc(u.status || "pending")}.`);
  else if (u.stage === "network-hiccup") status("The network did not answer just now. Still watching. Leave this tab open; the page will ask again.");
}

function outcome(o, id) {
  if (o.kind !== "APPLIED" && o.kind !== "STILL_PENDING") failTrack();
  switch (o.kind) {
    case "APPLIED": return afterApplied(id);
    case "REJECTED_BY_USER": return status(esc(o.message) + " Connect again when you are ready; nothing is waiting on the network.", "bad");
    case "NOT_SENT": return status(esc(o.message) + " Fix the cause above, then measure again.", "bad");
    case "AMBIGUOUS": return status(esc(o.message) + " Reload the page to reconcile it.", "bad");
    case "REJECTED_BY_CONTRACT": return status(`The contract refused it (transaction ${txLink(o.hash)}). Usually the pack was measured less than five minutes ago, has already had five runs, or names an earlier version that is not on the board.`, "bad");
    case "NOT_APPLIED": return status(`The validators did not settle on a result (${esc(o.status)}). Nothing was recorded. This happens when the validators' models read the pack very differently (grades two or more steps apart), which is itself a sign the rule is unsteady: sharpen a wording or add cases, then try again.`, "bad");
    case "STILL_PENDING": return status(`Still waiting after 15 minutes. Transaction ${txLink(o.hash)} may yet settle; this page will pick it up if you reload.`, "bad");
    default: return status(`The outcome is unclear (${esc(o.status)} / ${esc(o.exec)}). Check transaction ${txLink(o.hash)} on the explorer before sending again.`, "bad");
  }
}

$("composer").addEventListener("submit", async e => {
  e.preventDefault();
  if (state.busy || problems(draft).length || !contract || !state.account) return;
  if (!(await currentNetworkOk())) { status("The wallet is on another network. Switch to GenLayer Studio network and try again.", "bad"); return; }
  state.busy = true; refreshChecks();
  $("step-4").classList.remove("is-done"); setTrack(-1); setTrack(0);
  const text = packJson(draft);
  const id = await packId(draft);
  status("Waiting for your wallet. Check it for a signature request.");
  try {
    const wallet = writeClient(state.account);
    const o = await sendAndConfirm({
      client: wallet, address: state.account, label: "measure", pollMs: POLL,
      remember: { fn: "measure", address: contract, packId: id },
      build: () => wallet.writeContract({ address: contract, functionName: "measure", args: [text], value: 0n }),
      onUpdate: progress,
    });
    await outcome(o, id);
  } catch (err) { failTrack(); status("Something went wrong: " + esc(err.message || err) + " If you had already signed, reload the page to check whether the measurement was recorded.", "bad"); }
  finally { state.busy = false; refreshChecks(); }
});

document.addEventListener("click", e => {
  const a = e.target.closest("a[data-open]");
  if (a) { e.preventDefault(); window.scrollTo({ top: 0, behavior: "smooth" }); }
});

// A send that never reported back (closed tab, wallet crash) is looked up again from the page that remembers it.
async function recover() {
  const p = loadPending();
  const box = $("recovery");
  if (!p) { box.hidden = true; return; }
  box.hidden = false;
  box.innerHTML = `A measurement sent from this browser has not been confirmed yet. <button class="mini" type="button" id="recheck">Check it now</button>`;
  $("recheck").onclick = async () => {
    box.textContent = "Checking…";
    let listing = null, nonceNow = null;
    try { listing = await listAccountTxs(p.account, "from"); } catch { listing = null; }
    try { nonceNow = await readNonce(readClient(), p.account); } catch { nonceNow = null; }
    const step = nextStep(p, { listing, nonceNow });
    if (step.kind === "NOT_SENT") { clearPending(); box.hidden = true; status("That transaction was never sent, so nothing is waiting. You can measure again.", "ok"); }
    else if (step.kind === "WATCH") {
      setTrack(2);
      status(`Found it: transaction ${txLink(step.hash)}. Watching until it settles.`);
      const o = await watchTx(readClient(), step.hash, { onUpdate: progress, pollMs: POLL });
      if (o.kind !== "STILL_PENDING") clearPending();
      box.hidden = o.kind === "STILL_PENDING" ? false : true;
      await outcome(o, p.packId);
    } else box.textContent = "It cannot be told whether that transaction was sent. Look at your wallet's activity list before sending again.";
    refreshChecks();
  };
}

// ---------------------------------------------------------------- start

function links() {
  const repo = cfg.REPO || "";
  if (repo) { $("link-source").href = repo; $("foot-source").href = repo; }
  else { $("link-source").removeAttribute("href"); $("foot-source").remove(); }
  if (contract && EXPLORER) { $("link-contract").href = `${EXPLORER}/address/${contract}`; $("nav-contract").href = `${EXPLORER}/address/${contract}`; $("foot-contract").href = `${EXPLORER}/address/${contract}`; $("foot-contract").target = "_blank"; $("foot-contract").rel = "noopener"; }
  else { $("link-contract").textContent = "Contract address: not set yet"; $("link-contract").removeAttribute("href"); $("foot-contract").remove(); }
}

(async function start() {
  links();
  renderRows();
  setAccount("");
  await recover();
  const want = (query.get("pack") || cfg.FIRST_PACK || "").toLowerCase();
  let opened = false;
  if (want && contract) { $("gauge").innerHTML = `<p class="line">Reading the latest measurement from Studionet…</p><p class="line">The test section fills in when the contract answers.</p>`; await loadBoard(); opened = await openPack(want, { scroll: false, quiet: !query.get("pack") }); }
  else await loadBoard();
  if (!opened) show(parseReport(sample), "sample");
})();
