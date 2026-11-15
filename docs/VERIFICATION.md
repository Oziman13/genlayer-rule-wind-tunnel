# Verification

Commands run from the repository root. Outputs are in `evidence/`.

| Layer | Command | Result | Output |
|---|---|---|---|
| Contract, direct mode (model mocked) | `python3 -m pytest tests/direct` | 174 passed | `evidence/direct-tests.txt` |
| Contract on a local 5-validator network (glsim, model mocked) | `python3 -m pytest tests/glsim` | 6 passed | `evidence/glsim-tests.txt` |
| Pack id and metric logic in JavaScript | `node tests/browser/logic.test.mjs` | 76 checks passed (v0.2.0; 54 at v0.1.1) | `evidence/browser-logic-tests.txt` |
| The page with a mock wallet and node | `node tests/browser/page.test.mjs` | 105 checks passed (v0.2.0; 80 at v0.1.1) | `evidence/browser-page-tests.txt` |
| Mutation check of the v0.1.1 changes | `python3 scripts/mutation_check_v011.py` | 11 of 11 caught | `evidence/mutation-checks.txt` |
| Mutation check of v0.1.0 | (script not kept) | 84 of 88 caught, 4 equivalent mutants | `evidence/mutation-checks-v0.1.0.txt` |
| Deployed source equals repository | `node scripts/verify-deployed-source.mjs` | on-chain bytes equal `deployed/` file | `evidence/source-parity-studionet.txt` |

CI (`.github/workflows/ci.yml`) re-runs the direct tests, the browser tests, the bundle build and the parity script's offline check on every push.

## What the test matrix covers

| Area | Cases |
|---|---|
| Metrics | compared with a second implementation (`itertools`, `math.comb`) on 40 random tables; exact tables at the 900, 750 and 550 permille thresholds |
| Pack rules | every limit one inside and one outside; duplicates, control characters, wrong types, oversize |
| Model answers | 13 malformed answers, first and last wording; second try; second try as the last wording |
| Validator rule | identical table; many differing cells with the same grade; two differences in one case; grade 0, 1, 2 and 3 steps away; six leader/validator pairs built from real Studionet tables; malformed leader results |
| Repeat runs | cooldown, run limit, drift, anyone may re-run, an unmeasurable re-run changes nothing |
| Lineage and board | revisions, unknown or unmeasured `previous`, 12-step cap, paging, 200-pack limit |
| Header | the leading comment block is exactly the runner JSON (GenVM reads it) |
| Page | JS pack id equals the contract's (three packs, one non-ASCII); page limits equal the contract's constants read from the source; connect, wrong network, declined signature, undetermined and refused transactions, settled-but-nothing-stored, ambiguous send blocks a second send |
| Page, v0.2.0 | vague-word hints (flagged on the vague refund rule, none on the revised one, whole words only, never blocking); comparison (contract asked for exactly the chosen two in order, same id twice refused without a call, unknown id, unreadable answer, one-click revision comparison, no form with one measurement); Markdown copy (sample has no button, clipboard holds the reading, fallback box when the browser refuses, pipes and line breaks cannot break the table) |

## What is not verified

Real-model behaviour in automated tests (always mocked), behaviour with a real wallet, repeat runs on Studionet (one run per pack was taken), and Bradbury.
