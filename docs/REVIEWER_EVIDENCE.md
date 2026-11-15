# Reviewer evidence

Everything below can be checked without trusting this repository: the contract and both measurements are on the public Studionet explorer.

## 1. The contract

- Address: [`0xF319FDf761A71Eb81D8FD8bcaBC9d03e155270E5`](https://explorer-studio.genlayer.com/address/0xF319FDf761A71Eb81D8FD8bcaBC9d03e155270E5) (v0.1.1, created 2026-11-10 by `0xde48…76B9`).
- It has exactly three transactions: the deployment and two `measure` calls. All `FINALIZED`, execution `SUCCESS`, consensus `Accepted`.

| Transaction | Hash |
|---|---|
| Deploy | [`0xb94e0c2a51782d292cdc82092b710e59cec35d99997d1217c3a20533a88eba75`](https://explorer-studio.genlayer.com/tx/0xb94e0c2a51782d292cdc82092b710e59cec35d99997d1217c3a20533a88eba75) |
| Measure, "Refund rule v1 (vague)" | [`0xb9b0a0a1e9337167f56f1e4d9d5addf5628589ddebb35ba273eeff1e454ac903`](https://explorer-studio.genlayer.com/tx/0xb9b0a0a1e9337167f56f1e4d9d5addf5628589ddebb35ba273eeff1e454ac903) |
| Measure, "Refund rule v2 (30 days, unused)" | [`0xbca7f6fd3655db4381fa3829d58196e545f7a616f623f14bfb8f89dd533ed81f`](https://explorer-studio.genlayer.com/tx/0xbca7f6fd3655db4381fa3829d58196e545f7a616f623f14bfb8f89dd533ed81f) |

## 2. The source on-chain is the source in the repository

`node scripts/verify-deployed-source.mjs` fetches the code with `gen_getContractCode` and compares it with `deployed/rule_wind_tunnel.studionet-0xF319.py`: 22,321 bytes, SHA-256 `a96c5dcb116a25067f5c0c65421bfdd8b1d4e3885845c18ba76e194f899be7ea`, equal byte for byte. The current `contracts/rule_wind_tunnel.py` differs only in header comment layout (see `DEPLOYMENT.md`).

## 3. The two measurements

Same wording set, same cases, real models (five validators on different models: glm, deepseek, gemini and gemma in the first run, gpt-5.4 and sonnet in the second).

| Pack | Pack id | Consistency | Fidelity | Score | Grade |
|---|---|---|---|---|---|
| Refund rule v1 (vague: "reasonable time", "promptly") | `976df62ae598c0a1c04a07a325d5aa5e54a6697b001e357353317e68f1fcb2b3` | 875 | 142 | 142 | UNSTABLE |
| Refund rule v2 (30 days, unused), revision of v1 | `ad2fccd96e6e3536fe98afa7e268d979a384e2bd190f88c839eee882e87d0542` | 937 | 857 | 857 | USABLE |

How to reproduce the check: call `get_report_json(<pack id>)` on the explorer's contract page, or open the page; paste the stored rows into `_metrics` (tests do this) and compare the score the chain printed.

## 4. Things that went wrong (kept on purpose)

- v0.1.0 used a cell-difference rule that real models broke on the vague pack; the mocked tests did not show it. v0.1.1 changed the validator rule and added one retry per wording. Old contract `0x980E2335b4E670e6ABEb317488b49D0f3ED3F218` is obsolete.
- Bradbury deployment failed four times with `invalid_contract runner malformed`. Not deployed there.

## 5. What this evidence does not show

One run per pack (repeat-run drift not measured live), model mocked in automated tests, no real-wallet automation, Studionet only. See `THREAT_MODEL.md`.
