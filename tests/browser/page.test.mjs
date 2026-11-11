// Browser tests for the Rule Wind Tunnel page with a mock EIP-1193 wallet and a mock Studio RPC.
// They check what the page shows and does. They do NOT prove real MetaMask or real Studionet behaviour.
// Run from the repository root:  npm ci && npm test   (set CHROMIUM_PATH to use an installed Chromium)
import { chromium } from "playwright-core";
import { abi } from "genlayer-js";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sample from "../../web/src/sample.js";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../web");
const PORT = 8781;
const ACCOUNT = "0x" + "a1".repeat(20), CONTRACT = "0x" + "d4".repeat(20);
const V1_ID = "976df62ae598c0a1c04a07a325d5aa5e54a6697b001e357353317e68f1fcb2b3";
const P1 = "1".repeat(64), P2 = "2".repeat(64);
const NOW = Math.floor(Date.now() / 1000);
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".txt": "text/plain" };

const hosts = new Set();
const srv = http.createServer((req, res) => {
  const u = new URL(req.url, "http://localhost");
  const f = path.join(WEB, u.pathname === "/" ? "index.html" : decodeURIComponent(u.pathname));
  if (!f.startsWith(WEB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end("not found"); }
  res.writeHead(200, { "content-type": MIME[path.extname(f)] || "application/octet-stream" }); res.end(fs.readFileSync(f));
});
await new Promise(r => srv.listen(PORT, r));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ["--no-sandbox"] });
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => { cond ? pass++ : fail++; console.log((cond ? "PASS " : "FAIL ") + name + (cond ? "" : "  " + extra)); };

const report = (id, label, over = {}) => ({ ...sample, id, pack: { ...sample.pack, label, previous: over.previous || "" }, runs: [{ ...sample.runs[0], by: ACCOUNT, at: NOW - 3600 }], drift_cells: null, ...over.top });
const item = (id, label, grade, score, runs = 1, previous = "") => ({ id, label, grade, score_permille: score, runs, at: NOW - 3600, previous });

async function newCase({ wallet = {}, hasWallet = true, reducedMotion = "no-preference", colorScheme = "light", viewport = { width: 1280, height: 900 }, rpcInit = {} } = {}) {
  const ctx = await browser.newContext({ reducedMotion, colorScheme, viewport });
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", e => errs.push(String(e)));
  p.on("request", r => { try { hosts.add(new URL(r.url()).hostname); } catch { /* ignore */ } });
  const rpc = {
    methods: [], nonce: 0, txScripts: {}, txIdx: {}, onFinal: null, finalSeen: {}, sends: [], listed: [],
    page: { total: 2, items: [item(P1, "Refund rule v1 (vague)", "SHAKY", 625), item(P2, "Refund rule v2 (30 days, unused)", "STEADY", 1000, 2, P1)] },
    reports: { [P1]: report(P1, "Refund rule v1 (vague)"), [P2]: report(P2, "Refund rule v2 (30 days, unused)", { previous: P1 }) },
    lineage: { [P2]: [item(P2, "Refund rule v2 (30 days, unused)", "STEADY", 1000), item(P1, "Refund rule v1 (vague)", "SHAKY", 625)] },
    ...rpcInit,
  };
  await p.exposeFunction("__bumpNonce", () => { rpc.nonce++; });
  // the shipped web/config.js points at the live contract; these cases test the page without one (a later route overrides this)
  await p.route("**/config.js", r => r.fulfill({ status: 200, contentType: "text/javascript", body: `window.WT_CONFIG={CONTRACT:"",REPO:"https://github.com/Oziman13/genlayer-rule-wind-tunnel",FIRST_PACK:""};` }));
  await p.route("https://studio.genlayer.com/**", async r => {
    const req = r.request(); let body = {}; try { body = JSON.parse(req.postData() || "{}"); } catch {}
    if (req.method() === "OPTIONS") return r.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
    const arr = Array.isArray(body) ? body : [body];
    const out = arr.map(x => {
      rpc.methods.push(x.method);
      if (x.method === "gen_call") {
        const txt = Buffer.from((x.params[0].data || "").replace(/^0x/, ""), "hex").toString("latin1");
        const id = (txt.match(/[0-9a-f]{64}/) || [""])[0];
        let s = "NONE";
        if (rpc.readFail) return { jsonrpc: "2.0", id: x.id, error: { code: -32000, message: "mock: node unreachable" } };
        if (txt.includes("get_packs_page")) s = JSON.stringify(rpc.page);
        else if (txt.includes("get_report_json")) s = rpc.reports[id] ? (typeof rpc.reports[id] === "string" ? rpc.reports[id] : JSON.stringify(rpc.reports[id])) : "NONE";
        else if (txt.includes("get_lineage_json")) s = JSON.stringify(rpc.lineage[id] || []);
        return { jsonrpc: "2.0", id: x.id, result: Buffer.from(abi.calldata.encode(s)).toString("hex") };
      }
      if (x.method === "eth_getTransactionCount") return { jsonrpc: "2.0", id: x.id, result: "0x" + rpc.nonce.toString(16) };
      if (x.method === "sim_getTransactionsForAddress") return { jsonrpc: "2.0", id: x.id, result: rpc.listed };
      if (x.method === "eth_gasPrice") return { jsonrpc: "2.0", id: x.id, result: "0x1" };
      if (x.method === "eth_estimateGas") return { jsonrpc: "2.0", id: x.id, result: "0x30d40" };
      if (x.method === "eth_chainId") return { jsonrpc: "2.0", id: x.id, result: "0xf22f" };
      if (x.method === "eth_getTransactionByHash") {
        const h = x.params[0]; const seq = rpc.txScripts[h] || [];
        const i = Math.min(rpc.txIdx[h] || 0, seq.length - 1); rpc.txIdx[h] = (rpc.txIdx[h] || 0) + 1;
        if (!seq.length) return { jsonrpc: "2.0", id: x.id, result: null };
        if (seq[i].status === "FINALIZED" && !rpc.finalSeen[h]) { rpc.finalSeen[h] = true; rpc.onFinal && rpc.onFinal(h); }
        return { jsonrpc: "2.0", id: x.id, result: seq[i] };
      }
      return { jsonrpc: "2.0", id: x.id, error: { code: -32000, message: "mock: unsupported " + x.method } };
    });
    r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(Array.isArray(body) ? out : out[0]) });
  });
  if (hasWallet) {
    await p.addInitScript(cfg => {
      window.__reqs = [];
      window.__w = { chainId: cfg.chainId, accounts: cfg.accounts, sendMode: cfg.sendMode || "ok", hash: cfg.hash || "0x" + "ab".repeat(32) };
      window.ethereum = {
        isMock: true, on: () => {},
        request: async ({ method, params }) => {
          window.__reqs.push({ method, params });
          const w = window.__w;
          if (method === "eth_chainId") return w.chainId;
          if (method === "eth_requestAccounts" || method === "eth_accounts") return w.accounts;
          if (method === "wallet_switchEthereumChain") { w.chainId = params[0].chainId; return null; }
          if (method === "eth_sendTransaction") {
            if (w.sendMode === "reject") throw Object.assign(new Error("User rejected the request."), { code: 4001 });
            if (w.sendMode === "errorButSent") { await window.__bumpNonce(); throw new Error("RPC timeout after broadcast"); }
            await window.__bumpNonce(); return w.hash;
          }
          throw new Error("mock wallet: unsupported " + method);
        },
      };
    }, { chainId: "0xf22f", accounts: [ACCOUNT], ...wallet });
  }
  const open = async (qs = "") => { await p.goto(`http://localhost:${PORT}/index.html?poll=40${qs}`); await p.waitForSelector("#tunnel-svg"); };
  return { p, ctx, rpc, errs, open };
}
const tx = (status, exec) => ({ hash: "0x" + "ab".repeat(32), status, data: {}, consensus_data: exec ? { leader_receipt: [{ execution_result: exec }] } : undefined, recipient: CONTRACT });
const text = (p, sel) => p.textContent(sel);
const waitText = (p, sel, re, t = 8000) => p.waitForFunction(([s, r]) => new RegExp(r).test(document.querySelector(s).textContent), [sel, re.source], { timeout: t }).then(() => true).catch(() => false);
const H = "0x" + "ab".repeat(32);
const CONTRACT_Q = `&contract=${CONTRACT}`;

// ---- 1. first view, no contract set: the sample, honestly labelled
{
  const c = await newCase({ hasWallet: false });
  await c.open();
  ok("first view: headline and sample gauge", /same way twice/.test(await text(c.p, "h1")) && /Shaky/.test(await text(c.p, "#gauge")) && /62 out of 100/.test(await text(c.p, "#gauge")));
  ok("first view: says the table is a sample, not measured", /Sample table/.test(await text(c.p, "#tunnel-caption")) && /nothing here was measured on the network/.test(await text(c.p, "#tunnel-caption")));
  ok("first view: eight gates, four streams, thirty-two dots", (await c.p.locator("#tunnel-svg .gate").count()) === 8 && (await c.p.locator("#tunnel-svg .stream").count()) === 4 && (await c.p.locator("#tunnel-svg .dot").count()) === 32);
  ok("first view: readouts match the sample", /62%/.test(await text(c.p, "#readouts")) && /71%/.test(await text(c.p, "#readouts")) && /Boundary cases/.test(await text(c.p, "#readouts")));
  ok("first view: boundary list has five cases, first boundary case is open in the detail line", (await c.p.locator("#boundary li").count()) === 5 && /Case 2\./.test(await text(c.p, "#gate-detail")));
  ok("first view: the board explains that no contract is set", /No contract address is set/.test(await text(c.p, "#board-lead")) && (await c.p.locator("#openform").isHidden()));
  ok("first view: contract link is not faked", /not set yet/.test(await text(c.p, "#link-contract")) && (await c.p.getAttribute("#link-contract", "href")) === null);
  ok("first view: the page title is the product name", (await c.p.title()) === "Rule Wind Tunnel");
  ok("first view: no script errors", c.errs.length === 0, c.errs.join(" | "));
  ok("first view: no key input anywhere, nothing stored", (await c.p.locator("input[type=password]").count()) === 0 && (await c.p.evaluate(() => Object.keys(localStorage).length)) === 0);
  ok("first view: no network call to any chain node", !c.rpc.methods.length);
  // gates
  await c.p.click('#tunnel-svg .gate[data-case="4"]');
  ok("gate click: detail shows that case and each wording's verdict", /Case 5\./.test(await text(c.p, "#gate-detail")) && (await c.p.locator("#gate-detail .tag").count()) === 4);
  ok("gate click: the gate is marked open", (await c.p.locator("#tunnel-svg .gate.is-open").count()) === 1);
  await c.p.focus('#tunnel-svg .gate[data-case="0"]');
  await c.p.keyboard.press("ArrowRight");
  ok("keyboard: arrow moves to the next gate and reads it", /Case 2\./.test(await text(c.p, "#gate-detail")) && (await c.p.evaluate(() => document.activeElement.dataset.case)) === "1");
  await c.p.keyboard.press("ArrowLeft");
  ok("keyboard: arrow left goes back", (await c.p.evaluate(() => document.activeElement.dataset.case)) === "0");
  // table
  await c.p.click("details.table > summary");
  ok("table: one row per wording plus the intended row, all 8 cases", (await c.p.locator("#matrix tbody tr").count()) === 5 && (await c.p.locator("#matrix tbody tr:nth-child(2) td.v-C, #matrix tbody tr:nth-child(2) td.v-V, #matrix tbody tr:nth-child(2) td.v-U").count()) === 8);
  ok("table: verdicts are words, not only colours", /complies|violates|unclear/.test(await text(c.p, "#matrix tbody tr:nth-child(2)")));
  ok("legend lists the four wordings", (await c.p.locator("#key li").count()) === 4);
  ok("moving streams are drawn", (await c.p.locator("#tunnel-svg .stream.draw").count()) === 4);
  await c.ctx.close();
}
{
  const c = await newCase({ hasWallet: false, reducedMotion: "reduce" });
  await c.open();
  ok("reduced motion: streams are drawn without animation", (await c.p.locator("#tunnel-svg .stream.draw").count()) === 0);
  await c.ctx.close();
}
{
  const c = await newCase({ hasWallet: false, viewport: { width: 390, height: 844 } });
  await c.open();
  const dims = await c.p.evaluate(() => ({ page: document.documentElement.scrollWidth, view: document.documentElement.clientWidth, chart: document.getElementById("tunnel").scrollWidth, chartView: document.getElementById("tunnel").clientWidth }));
  ok("mobile: the page does not scroll sideways", dims.page <= dims.view, JSON.stringify(dims));
  ok("mobile: the chart scrolls inside its own frame and says so", dims.chart > dims.chartView && /Swipe the chart/.test(await text(c.p, ".swipe")) && (await c.p.isVisible(".swipe")));
  ok("mobile: the wordmark stays on one line", (await c.p.evaluate(() => document.querySelector(".mark").getBoundingClientRect().height)) < 40);
  await c.p.click("details.table > summary");
  const d2 = await c.p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
  ok("mobile: the open table scrolls inside its frame, not the page", d2);
  await c.ctx.close();
}
{
  const c = await newCase({ hasWallet: false, colorScheme: "dark" });
  await c.open();
  ok("dark scheme: paper turns dark and text stays readable", (await c.p.evaluate(() => getComputedStyle(document.body).backgroundColor)) === "rgb(10, 19, 25)" && c.errs.length === 0);
  await c.ctx.close();
}

// ---- 2. the composer
{
  const c = await newCase({ hasWallet: false });
  await c.open();
  ok("composer: starts with four wordings and eight cases", (await c.p.locator("#wordings .row").count()) === 4 && (await c.p.locator("#cases .row").count()) === 8);
  ok("composer: no problems are shown before anyone types", (await c.p.locator("#problems li").count()) === 0);
  await c.p.click("#ex1");
  ok("composer: the vague example fills every box and the page shows the id the contract will compute", (await c.p.inputValue("#f-label")) === "Refund rule v1 (vague)" && (await text(c.p, "#idline")).includes(V1_ID), await text(c.p, "#idline"));
  ok("composer: a complete pack shows no problems", (await c.p.locator("#problems li").count()) === 0);
  ok("composer: intents are carried into the radio groups", (await c.p.locator('input[name="intent3"][value="VIOLATES"]').isChecked()) && (await c.p.locator('input[name="intent7"][value="OPEN"]').isChecked()));
  await c.p.click("#ex2");
  ok("composer: the revised example changes the wordings and the id", /30 days/.test(await c.p.inputValue("#w0")) && !(await text(c.p, "#idline")).includes(V1_ID) && /[0-9a-f]{64}/.test(await text(c.p, "#idline")));
  await c.p.fill("#w1", "too short");
  ok("composer: a short wording is explained in plain words and the id disappears", /Wording B needs 20 to 600 characters/.test(await text(c.p, "#problems")) && (await text(c.p, "#idline")) === "");
  await c.p.fill("#w1", await c.p.inputValue("#w0"));
  ok("composer: two identical wordings are caught", /Two wordings are the same/.test(await text(c.p, "#problems")));
  // add and remove
  await c.p.click("#ex1");
  await c.p.click('[data-rm-w="3"]');
  ok("composer: removing down to three hides the remove buttons", (await c.p.locator("#wordings .row").count()) === 3 && (await c.p.locator("[data-rm-w]").count()) === 0);
  await c.p.click("#addw"); await c.p.click("#addw");
  ok("composer: five wordings is the most, and the add button goes away", (await c.p.locator("#wordings .row").count()) === 5 && (await c.p.isHidden("#addw")));
  ok("composer: a new wording is empty and focused", (await c.p.evaluate(() => document.activeElement.id)) === "w4");
  for (let i = 0; i < 2; i++) await c.p.click('[data-rm-c="0"]');
  ok("composer: six cases is the fewest, and the remove buttons go away", (await c.p.locator("#cases .row").count()) === 6 && (await c.p.locator("[data-rm-c]").count()) === 0);
  for (let i = 0; i < 6; i++) await c.p.click("#addc");
  ok("composer: twelve cases is the most, and the add button goes away", (await c.p.locator("#cases .row").count()) === 12 && (await c.p.isHidden("#addc")));
  ok("composer: new cases are empty, so the page names the first one to fill", /Case 7 needs 10 to 400 characters/.test(await text(c.p, "#problems")));
  await c.p.fill("#f-label", "ab");
  ok("composer: label too short is explained", /name of 3 to 60/.test(await text(c.p, "#problems")));
  ok("composer: sending is locked and says why", (await c.p.isDisabled("#send")) && /No contract address/.test((await c.p.getAttribute("#send", "title")) || ""));
  ok("composer: counters say how many are allowed", /3 to 5 allowed/.test(await text(c.p, "#wc")) && /6 to 12 allowed/.test(await text(c.p, "#cc")));
  await c.ctx.close();
}

// ---- 3. a contract is set: board, deep link, revisions
{
  const c = await newCase({ hasWallet: false });
  await c.open(CONTRACT_Q);
  await c.p.waitForSelector("#packs li a");
  ok("board: newest first with grade and score", (await c.p.locator("#packs li").count()) === 2 && /Refund rule v2/.test(await text(c.p, "#packs li:nth-child(1) .t")) && /Steady\s*100/.test(await text(c.p, "#packs li:nth-child(1) .g")));
  ok("board: runs, time and the revision it replaces", /2 runs/.test(await text(c.p, "#packs li:nth-child(1) .m")) && /revises 22222222/.test("revises " + P2.slice(0, 8)) && /revises 11111111…111111/.test(await text(c.p, "#packs li:nth-child(1) .m")) && /1 run,/.test(await text(c.p, "#packs li:nth-child(2) .m")));
  ok("board: the revision picker lists the measured packs", (await c.p.locator("#f-previous option").count()) === 3);
  ok("board: the contract link points to the explorer", /\/address\/0x/.test((await c.p.getAttribute("#link-contract", "href")) || ""));
  await c.p.click("#packs li:nth-child(2) a");
  await c.p.waitForFunction(() => /Run 1 of up to 5/.test(document.getElementById("tunnel-caption").textContent));
  ok("open a pack: caption names it, its run and the pack id", /Refund rule v1 \(vague\)/.test(await text(c.p, "#tunnel-caption")) && /11111111…111111/.test(await text(c.p, "#tunnel-caption")));
  ok("open a pack: the address bar carries a link to it", c.p.url().includes("pack=" + P1));
  ok("open a pack: the title names the rule", /^Refund rule v1 \(vague\) \| /.test(await c.p.title()));
  ok("open a pack: drift line says it was measured once", /Measured once/.test(await text(c.p, "#drift-line")));
  ok("no revision chart for a first version", await c.p.isHidden("#lineage"));
  await c.p.fill("#openid", P2);
  await c.p.click("#openform button");
  await c.p.waitForSelector("#lineage svg", { state: "visible" });
  ok("revision chart: both versions, oldest first, scores shown", /Scores of 2 versions: Refund rule v1 \(vague\) 62, Refund rule v2 \(30 days, unused\) 100/.test(await c.p.getAttribute("#lineage svg", "aria-label")));
  await c.p.fill("#openid", "xyz");
  await c.p.click("#openform button");
  ok("open by id: a malformed id is explained", /64 characters/.test(await text(c.p, "#board-status")));
  await c.p.fill("#openid", "3".repeat(64));
  await c.p.click("#openform button");
  ok("open by id: an unknown id is said to be unknown", await waitText(c.p, "#board-status", /No measurement with that id/));
  ok("no wallet: no write request was made", !c.rpc.methods.includes("eth_sendTransaction"));
  await c.ctx.close();
}
{
  const c = await newCase({ hasWallet: false });
  await c.open(`&pack=${P2}${CONTRACT_Q}`);
  await c.p.waitForFunction(() => /Run 1 of up to 5/.test(document.getElementById("tunnel-caption").textContent));
  ok("deep link: ?pack= opens that measurement on load", /Refund rule v2/.test(await text(c.p, "#tunnel-caption")) && /Steady|Shaky/.test(await text(c.p, "#gauge")));
  await c.ctx.close();
}
{
  const c = await newCase({ hasWallet: false, rpcInit: { reports: { [P1]: "this is not a report" } } });
  await c.open(`&pack=${P1}${CONTRACT_Q}`);
  ok("deep link to unreadable data: says so and falls back to the sample", await waitText(c.p, "#board-status", /cannot read/) && /Sample table/.test(await text(c.p, "#tunnel-caption")));
  await c.ctx.close();
}
{
  const c = await newCase({ hasWallet: false, rpcInit: { readFail: true } });
  await c.open(CONTRACT_Q);
  ok("unreachable node: the board says it could not read, and the sample still shows", await waitText(c.p, "#board-status", /Could not read the board/) && /Sample table/.test(await text(c.p, "#tunnel-caption")) && c.errs.length === 0);
  await c.ctx.close();
}

{
  const c = await newCase({ hasWallet: false });
  await c.p.route("**/config.js", r => r.fulfill({ status: 200, contentType: "text/javascript", body: `window.WT_CONFIG={CONTRACT:"${CONTRACT}",REPO:"https://github.com/Oziman13/genlayer-rule-wind-tunnel",FIRST_PACK:"${P2}"};` }));
  await c.p.goto(`http://localhost:${PORT}/index.html?poll=40`); await c.p.waitForSelector("#tunnel-svg");
  await c.p.waitForFunction(() => /Run 1 of up to 5/.test(document.getElementById("tunnel-caption").textContent));
  ok("recorded first view: a configured pack replaces the sample and the address bar is left alone", /Refund rule v2/.test(await text(c.p, "#tunnel-caption")) && !/Sample table/.test(await text(c.p, "#tunnel-caption")) && !c.p.url().includes("pack="));
  ok("recorded first view: the repository link comes from the configuration", (await c.p.getAttribute("#link-source", "href")) === "https://github.com/Oziman13/genlayer-rule-wind-tunnel");
  await c.ctx.close();
}

// ---- 4. wallet and sending
{
  const c = await newCase({ hasWallet: false });
  await c.open(CONTRACT_Q);
  await c.p.click("#connect");
  ok("no wallet: connecting explains how to proceed", await waitText(c.p, "#send-status", /No browser wallet/));
  await c.ctx.close();
}
async function ready(c) {
  await c.open(CONTRACT_Q);
  await c.p.waitForSelector("#packs li a");
  await c.p.click("#ex1");
  await c.p.click("#connect");
  await waitText(c.p, "#account", /Connected/);
}
{
  const c = await newCase({ wallet: { hash: H } });
  await ready(c);
  ok("send: connected and complete, the button opens", !(await c.p.isDisabled("#send")) && /Connected: 0xa1a1a1…a1a1/.test(await text(c.p, "#account")));
  c.rpc.txScripts[H] = [tx("PENDING"), tx("ACCEPTED", "SUCCESS"), tx("FINALIZED", "SUCCESS")];
  c.rpc.onFinal = () => { c.rpc.reports[V1_ID] = report(V1_ID, "Refund rule v1 (vague)"); c.rpc.page = { total: 3, items: [...c.rpc.page.items, item(V1_ID, "Refund rule v1 (vague)", "SHAKY", 625)] }; };
  await c.p.click("#send");
  ok("send: ACCEPTED is shown as in progress", await waitText(c.p, "#send-status", /ACCEPTED/));
  ok("send: FINALIZED and SUCCESS is reported as recorded, and the reading opens", await waitText(c.p, "#send-status", /Measured and recorded/) && await waitText(c.p, "#tunnel-caption", /Refund rule v1 \(vague\)/));
  const sent = await c.p.evaluate(() => window.__reqs.find(r => r.method === "eth_sendTransaction"));
  const data = Buffer.from(String(sent.params[0].data).replace(/^0x/, ""), "hex").toString("latin1");
  ok("send: one transaction that carries our contract address, the method measure and the normalised pack", !!sent && sent.params[0].data.toLowerCase().includes(CONTRACT.slice(2)) && data.includes("measure") && data.includes('"label":"Refund rule v1 (vague)"') && data.includes("Approve a refund when the item was returned"), data.slice(0, 200));
  ok("send: nothing was sent twice and nothing is left pending", (await c.p.evaluate(() => window.__reqs.filter(r => r.method === "eth_sendTransaction").length)) === 1 && (await c.p.evaluate(() => localStorage.getItem("wt_pending_tx"))) === null);
  ok("send: the board is reloaded and lists the new pack", (await c.p.locator("#packs li").count()) === 3);
  ok("send: no script errors", c.errs.length === 0, c.errs.join(" | "));
  await c.ctx.close();
}
{
  const c = await newCase({ wallet: { sendMode: "reject" } });
  await ready(c);
  await c.p.click("#send");
  ok("send: declining in the wallet says nothing was sent and leaves no pending record", await waitText(c.p, "#send-status", /declined.*Nothing was sent/) && (await c.p.evaluate(() => localStorage.getItem("wt_pending_tx"))) === null && !(await c.p.isDisabled("#send")));
  await c.ctx.close();
}
{
  const c = await newCase({ wallet: { hash: H } });
  await ready(c);
  c.rpc.txScripts[H] = [tx("PENDING"), tx("UNDETERMINED")];
  await c.p.click("#send");
  ok("send: UNDETERMINED is 'did not settle, nothing recorded', with advice", await waitText(c.p, "#send-status", /did not settle on a result \(UNDETERMINED\)\. Nothing was recorded.*grade edge/));
  await c.ctx.close();
}
{
  const c = await newCase({ wallet: { hash: H } });
  await ready(c);
  c.rpc.txScripts[H] = [tx("FINALIZED", "FINISHED_WITH_ERROR")];
  await c.p.click("#send");
  ok("send: FINALIZED with an error is 'the contract refused it' with the usual reasons", await waitText(c.p, "#send-status", /contract refused it.*five minutes/));
  await c.ctx.close();
}
{
  const c = await newCase({ wallet: { hash: H } });
  await ready(c);
  c.rpc.txScripts[H] = [tx("FINALIZED", "SUCCESS")];            // settled, but the contract stored nothing (unmeasurable)
  await c.p.click("#send");
  ok("send: settled but nothing stored is reported as unmeasurable, not as success", await waitText(c.p, "#send-status", /nothing was stored.*did not follow the required format/) && !/Measured and recorded/.test(await text(c.p, "#send-status")));
  await c.ctx.close();
}
{
  const c = await newCase({ wallet: { sendMode: "errorButSent" } });
  await ready(c);
  await c.p.click("#send");
  ok("send: an error after the nonce moved is ambiguous and blocks a second send", await waitText(c.p, "#send-status", /may have been sent.*blocked from being repeated/) && (await c.p.isDisabled("#send")));
  ok("send: the pending record is kept", (await c.p.evaluate(() => JSON.parse(localStorage.getItem("wt_pending_tx") || "null")?.stage)) === "ambiguous");
  await c.p.reload();
  await c.p.waitForSelector("#tunnel-svg");
  ok("reload: the page says an earlier send is unconfirmed and offers to check", (await c.p.isVisible("#recovery")) && /not been confirmed/.test(await text(c.p, "#recovery")));
  await c.p.click("#connect"); await c.p.click("#ex1");
  ok("reload: sending stays locked while it is unresolved", await c.p.isDisabled("#send"));
  c.rpc.nonce = 0;                                              // as if it never went out
  await c.p.click("#recheck");
  ok("reload: when the account's count shows it never went out, the record is cleared", await waitText(c.p, "#send-status", /never sent/) && (await c.p.evaluate(() => localStorage.getItem("wt_pending_tx"))) === null);
  await c.ctx.close();
}
{
  const c = await newCase({ wallet: { chainId: "0x1" } });
  await c.open(CONTRACT_Q);
  await c.p.click("#ex1");
  await c.p.click("#connect");
  await waitText(c.p, "#account", /Connected/);
  const reqs = await c.p.evaluate(() => window.__reqs.map(r => r.method));
  ok("connect: a wrong network is switched before anything else", reqs.includes("wallet_switchEthereumChain") && (await c.p.evaluate(() => window.__w.chainId)) === "0xf22f");
  await c.p.evaluate(() => { window.__w.chainId = "0x1"; });
  await c.p.click("#send");
  ok("send: if the wallet is on another network at send time, nothing is sent", await waitText(c.p, "#send-status", /another network/) && !(await c.p.evaluate(() => window.__reqs.some(r => r.method === "eth_sendTransaction"))));
  await c.ctx.close();
}

// ---- 5. privacy: the page only ever talks to its own origin and the chain node
ok("no third-party requests: only localhost (fonts, scripts and styles are served by the page itself)", [...hosts].every(h => h === "localhost" || h === "studio.genlayer.com"), [...hosts].join(","));

await browser.close(); srv.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
