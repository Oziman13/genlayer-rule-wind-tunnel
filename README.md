# Rule Wind Tunnel

**Measure how steadily a model reads a rule before you build a contract on it.**

An Intelligent Contract that asks the validators "does this case follow the rule?" is only as steady as the sentence that states the rule. If two honest wordings of the same rule send the same case to different verdicts, validators will disagree in production and the transaction will fail to settle. Nothing tells a contract author that in advance.

Rule Wind Tunnel is a test rig for that. You submit a **pack**: three to five wordings of one rule and six to twelve cases, each case with the verdict you intend (or "open"). The validators put every case to the model once per wording. The contract keeps the resulting table and computes, with whole-number arithmetic, how consistent the wordings are, how often the majority matches what you intended, which wording to keep and which cases sit on the boundary.

* `contracts/rule_wind_tunnel.py` — the Intelligent Contract (one Python file, no funds, no web access).
* `web/` — a static page that reads the chain and sends measurements from your own wallet. No keys, no third-party requests, fonts self-hosted.
* `tests/` — 174 direct-mode tests, 6 local-network tests, 134 browser/logic checks, and a mutation check of the contract.
* `fixtures/` — the demo packs used in the tests and in the live run (a vague refund rule and its revision).

Status: **v0.1.1, Studionet only.** See [Live run](#live-run) and [What it does not show](#what-it-does-not-show).

## How a measurement works

| Step | What happens | Who has to agree |
|---|---|---|
| 1. Pack | `measure(pack_json)` normalises the pack (whitespace squashed, fields checked) and hashes it. The hash is the pack's id. | Deterministic; every validator gets the same id. |
| 2. Ask | The leader asks its model once per wording: for each numbered case, answer `COMPLIES`, `VIOLATES` or `UNCLEAR`. The text of the rule and the cases is treated as untrusted data. | — |
| 3. Table | The answers become a table of letters: one row per wording, one column per case. A malformed answer (wrong shape, wrong length, unknown verdict) means the whole measurement is `UNMEASURABLE` and nothing is stored. | — |
| 4. Agree | Each validator asks its own model the same questions. It accepts the leader's table when the grade of the leader's table and the grade of its own table are **at most one step apart** (STEADY, USABLE, SHAKY, UNSTABLE are the four steps). Individual cells may differ freely; only the verdict on the pack has to be close. If a model's answer is unusable it gets one more try before the measurement is reported as `UNMEASURABLE`. | Validators, by the rule above. |
| 5. Store | The accepted table is appended to the pack's runs (at most 5 runs, 5 minutes apart). | — |
| 6. Compute | All numbers below are computed by the contract from the stored table. | Deterministic. |

Numbers (permille, integers):

* **consistency** = pairs of wordings that give the same verdict to the same case, over all such pairs.
* **fidelity** = share of cases with an intended verdict where the majority verdict (a strict majority of wordings) equals it. `null` when every case is `OPEN`.
* **score** = the lower of the two (or consistency alone when fidelity is `null`).
* **grade** = `STEADY` ≥ 900, `USABLE` ≥ 750, `SHAKY` ≥ 550, otherwise `UNSTABLE`.
* **best wording** = the wording whose verdicts match the reference most often. The reference is the intended verdict, or the majority verdict for an `OPEN` case; ties go to the earlier wording and are reported as tied.
* **boundary** = cases where the wordings do not all agree, or where the majority missed the intended verdict.
* **drift** = number of cells that differ between the first and the latest run of the same pack.

A pack can name the pack it revises (`previous`, which must already be measured), so a rule's history reads as a chain of scores.

## Contract

`RuleWindTunnel` has no constructor arguments.

| Method | Kind | Purpose |
|---|---|---|
| `measure(pack_json)` | write | Measure a pack. Returns `{"id", "grade", "score_permille"}` as JSON, or `UNMEASURABLE`. |
| `get_pack_id(pack_json)` | view | The id a pack will get; also checks the pack is well formed. |
| `get_report_json(pack_id)` | view | The pack, its runs, the metrics of the latest run, drift; or `NONE`. |
| `get_grade(pack_id)` | view | `STEADY`, `USABLE`, `SHAKY`, `UNSTABLE` or `NONE`. |
| `get_lineage_json(pack_id)` | view | The pack and the packs it replaced, newest first (at most 12). |
| `compare_json(first_id, second_id)` | view | Side-by-side numbers and deltas for two measured packs. |
| `get_pack_count()`, `get_packs_page(offset, limit)` | view | The public board (at most 200 packs, pages of at most 50). |

Pack format (`tests` and `fixtures/*.min.json` show complete examples):

```json
{"label": "Refund rule v1 (vague)",
 "previous": "",
 "wordings": ["Approve a refund when ...", "A refund is valid only if ...", "..."],
 "cases": [{"text": "Buyer returned an unopened item 3 days after delivery.", "intent": "COMPLIES"}, ...]}
```

Limits: label 3–60 characters; 3–5 wordings of 20–600 characters, all different; 6–12 cases of 10–400 characters, all different; `intent` is `COMPLIES`, `VIOLATES` or `OPEN`; the submitted text is at most 12 000 characters.

## What it does not show

These are limits of the idea, not bugs.

* A steady grade is about **these cases and these wordings**. A rule can read steadily here and still fail on a case nobody thought of.
* It measures the reading, not whether your intent is right.
* The model is whatever the validators run. A different model, or the same model later, can read the rule differently. Measuring again (up to 5 runs) shows how much the readings move.
* **Grade edges.** Validators must agree to within one grade step, so a pack on which different models read very differently (two or more steps apart) will not settle: the transaction ends undetermined. That is by design: such a pack is exactly the kind a contract should not rely on. The accepted table is the leader's, so the stored score is one model's reading, not an average of all validators. Small packs move more per cell: with 4 wordings and 8 cases one changed cell moves the score by about 6 points, with 5 wordings and 12 cases by about 3.
* Anyone can measure any pack; a run records who sent it, not who wrote the rule.
* The page and the contract do not decide whether a rule is "good". They report how the model read it.

## Tests

Run from the repository root.

```
python3 -m pytest tests/direct        # 174 tests, in-memory (genlayer-test direct mode), model mocked
python3 -m pytest tests/glsim         # 6 tests on a local 5-validator network (glsim), model mocked
npm ci && npm test                    # browser/logic checks (needs Chromium; set CHROMIUM_PATH if installed elsewhere)
```

Use `python3 -m pytest`, not `pytest`: the genlayer plugin is loaded through the module form.

What the tests cover:

* **Metrics are checked against a second implementation** written with `itertools` and `math.comb` (40 random tables, plus exact threshold tables at 900, 750 and 550 permille).
* **Pack rules**: every limit is tested one character inside and one outside; duplicate, control-character, wrong-type and oversized packs are refused with a message.
* **Model answers**: 13 malformed answers, in the first and the last wording, are never a measurement.
* **Validator rule**: identical table, many differing cells with the grade unchanged, two differences in one case, a grade one step away (accepted) and two steps away (refused), every step distance from 0 to 3, six leader/validator pairs built from real model tables seen on Studionet, matching and mismatching errors, and malformed leader results. **Second try**: a bad first answer is retried once (six kinds of bad answer), two failures give `UNMEASURABLE` after exactly two calls, and a validator that needs its retry still agrees.
* **Repeat runs**: cooldown to the second, run limit, drift, anyone may re-run, an unmeasurable re-run changes nothing.
* **Lineage and board**: revisions, unknown or never-measured `previous`, the 12-step cap, paging, the 200-pack limit.
* **Clock**: the transaction timestamp is read with its offset; unreadable timestamps stop a measurement.
* **Web page** (`tests/browser`): the pack id computed in JavaScript equals the contract's (three packs, one with non-ASCII text); the page limits equal the contract's constants (read from the source); the page with a mock wallet and mock node: connect, wrong network, declined signature, undetermined and refused transactions, "settled but nothing stored", an ambiguous send that blocks a second send and is reconciled after a reload, deep links, sideways overflow on a 390 px screen, reduced motion, dark scheme, and no request to any host other than the page's own and the chain node.

The model is **mocked** in all of these. They test the contract's handling and the validator rule, not how steady a real model is. The mock wallet and mock node do not prove behaviour with MetaMask or the real Studionet.

### Mutation check

`scripts/mutation_check_v011.py` makes 11 deliberate breakages of the code that changed in v0.1.1 (the grade-distance rule and the second try) and checks that the direct tests fail on each: `evidence/mutation-checks.txt`. `evidence/mutation-checks-v0.1.0.txt` lists the 88 breakages of the first version (changed limits, thresholds, comparisons, removed checks, swapped letters, reordered arguments).

Result on v0.1.1: **11 of 11 caught** on the changed code. For v0.1.0 the result was 84 of 88; the 4 survivors were equivalent mutants (guards for model answers that reach the contract as raw oversized strings, which the test harness cannot produce, and an `isinstance` check made redundant by the lookup after it). The 88 were not all re-run on v0.1.1 (the script that ran them is not in the repository), so the v0.1.0 number describes v0.1.0, and the 8 mutants of the old 15% rule no longer exist.

## Web page

`web/index.html` is a static page (built into `web/app.js` with `npm run build`). It reads the board, draws the selected measurement as a test section (each wording is a line, each case a gate; the height at which a line crosses a gate is its verdict), lists the boundary cases in words, offers the full table as an ordinary table, and sends new measurements through the visitor's own wallet. It never asks for a key. Until `web/config.js` has a contract address it works on a clearly labelled **sample table** that is not a network measurement.

Transactions are treated as successful only when the network status is `FINALIZED` and the execution result is a success; a pending record is written before the wallet is asked to sign, so a send that may have gone out is reconciled after a reload before anything is sent again.

Fonts (Bricolage Grotesque, Newsreader, SIL Open Font License) are served from `web/fonts`.

## Live run

Measured on GenLayer **Studionet** on 2026-11-10 with the two packs in `fixtures/`. Contract (v0.1.1): [`0xF319FDf761A71Eb81D8FD8bcaBC9d03e155270E5`](https://explorer-studio.genlayer.com/address/0xF319FDf761A71Eb81D8FD8bcaBC9d03e155270E5). Both transactions were `FINALIZED`, execution `SUCCESS`, consensus `Accepted`, with five validators per run on different models (for example glm, deepseek, gemini and gemma in the first run, gpt-5.4 and sonnet in the second); validators that show "cancelled after quorum" were stopped once quorum was reached, which is normal.

| Pack | Table the contract stored (rows = wordings, columns = cases; C complies, V violates, U unclear) | Consistency | Fidelity | Score | Grade |
|---|---|---|---|---|---|
| Refund rule v1 (vague: "reasonable time", "promptly") | `UUUUUUUU` `UUUUUUVU` `UUUUUUVU` `UUUUUVVU` | 875 | 142 | **142** | **UNSTABLE** |
| Refund rule v2 (30 days, unused), revision of v1 | `UCUVVVVV` `CCUVVVVV` `CCUVVVVV` `CCUVVVVV` | 937 | 857 | **857** | **USABLE** |

* Pack ids: v1 `976df62ae598c0a1c04a07a325d5aa5e54a6697b001e357353317e68f1fcb2b3`, v2 `ad2fccd96e6e3536fe98afa7e268d979a384e2bd190f88c839eee882e87d0542` (v2 names v1 as `previous`).
* Both ids equal the ids computed by the page's JavaScript from the fixtures (`tests/browser/logic.test.mjs`), so the hash is the same in the contract, in the page and in the tests.
* The score printed by the chain (142 and 857) equals the score computed here from the stored tables with the contract's own `_metrics` code.
* What it shows: the vague rule is read almost entirely as "unclear" (the intended verdicts are not reproduced: fidelity 142), the precise one is read steadily (consistency 937) and mostly as intended. The one case v2 still does not settle is the 20-day return "in the original box" (third column): all four wordings were read as unclear for it, probably because the case does not say whether the item was used.
* Measure transactions: v1 `0xb9b0a0a1e9337167f56f1e4d9d5addf5628589ddebb35ba273eeff1e454ac903`, v2 `0xbca7f6fd3655db4381fa3829d58196e545f7a616f623f14bfb8f89dd533ed81f`.

**What went wrong first.** The first deployment (v0.1.0, contract `0x980E2335b4E670e6ABEb317488b49D0f3ED3F218`) required validators' tables to differ in at most 15% of cells. With real models on the vague pack that failed: the transactions ended `UNDETERMINED` or `UNMEASURABLE`, because different models read vague rules very differently, and a model sometimes returned a malformed answer. The mocked tests had not shown this. v0.1.1 changed the agreement to "grade at most one step apart" and added one retry; the numbers above come from that version. The old contract is obsolete and is not used by the page.

**Bradbury (not deployed).** On 2026-11-10 the same contract was sent to Testnet Bradbury (chain 4221) with the GenLayer CLI 0.40.0-rc.6, four times. Each time the transaction was accepted and finalised, but the deployment execution failed with `invalid_contract runner malformed` (all five validators agreed on the error, the fee deposit was refunded, no contract was created). Things tried: the runner line `py-genlayer:1jb45…` as the first line of the file; the same with a blank line under it (GenVM reads the whole run of leading `#` lines as one JSON document, so a second comment line there breaks it; a test now guards this); and `py-genlayer:test`, the runner the CLI's own project template uses. None worked, so the cause is probably a runner/version mismatch on the network and is not understood yet. Studio's Bradbury mode cannot load the contract schema either. The contract was not changed for this; it runs on Studionet as shown above.

**Header layout.** The Studionet contract above was deployed from the file as it was before the blank line under the runner line was added in this repository (same code, comment layout only). GenVM on Studionet read both layouts.

Not measured live: repeat runs (cooldown, drift). A single run per pack was taken, so how much the table moves between runs on Studionet is not yet known.

## Where each claim lives in the code

| Claim | Where |
|---|---|
| Pack normalisation and limits | `_normalize`, constants at the top of `contracts/rule_wind_tunnel.py` |
| The id is the hash of the normalised text | `_pack_id`, `_canonical`; mirrored in `web/src/pack.js` |
| Malformed model answers are never a measurement (one retry first) | `_parse_row`, `_read_wording`, `_measure` |
| Validators agree when their grades are at most one step apart | `_close`, `_consensus` (`GRADES`, `MAX_GRADE_STEPS`) |
| Metrics are integer arithmetic | `_metrics`, `_grade` |
| Cooldown, run limit, board limit, known `previous` | `RuleWindTunnel.measure` |
| Lineage cap | `get_lineage_json` |
| The page shows the contract's numbers and recomputes none | `web/src/view.js`, `web/src/chart.js` |

## Repository layout

```
contracts/rule_wind_tunnel.py
tests/direct/            direct-mode tests
tests/glsim/             local-network tests (rpc.py starts a 5-validator glsim)
tests/browser/           logic and page tests (Playwright)
web/                     the page (index.html, style.css, src/, app.js, fonts/)
fixtures/                demo packs (pretty, and *.min.json: paste the text as it is, without outer quotes, into `measure` in GenLayer Studio)
scripts/                 mutation check of the v0.1.1 changes
evidence/                test output and mutation checks
```
