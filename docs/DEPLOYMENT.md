# Deployment

## Current

| Item | Value |
|---|---|
| Network | GenLayer Studionet |
| Contract | `0xF319FDf761A71Eb81D8FD8bcaBC9d03e155270E5` (v0.1.1) |
| Deploy transaction | `0xb94e0c2a51782d292cdc82092b710e59cec35d99997d1217c3a20533a88eba75`, `FINALIZED`, execution `SUCCESS` |
| Creator | `0xde48a3e53d80c316a6a72575b9f7ad5141df76b9` |
| Deployed source | `deployed/rule_wind_tunnel.studionet-0xF319.py`, 22,321 bytes, SHA-256 `a96c5dcb116a25067f5c0c65421bfdd8b1d4e3885845c18ba76e194f899be7ea` |
| Page | https://oziman13.github.io/genlayer-rule-wind-tunnel/ |

## Source parity

The bytes returned by `gen_getContractCode` for the contract equal `deployed/rule_wind_tunnel.studionet-0xF319.py` exactly (checked 2026-11-15; `evidence/source-parity-studionet.txt`). Run it yourself: `node scripts/verify-deployed-source.mjs`.

`contracts/rule_wind_tunnel.py` has the same code but a different header layout: the deployed file starts with the version line and then the runner line; the current file starts with the runner line, a blank line, then the version line. GenVM read both layouts. The script reports both comparisons (exact for the deployed file, code-after-header for the current one) so the difference is visible, not hidden.

## How to deploy again

1. GenLayer Studio (Studionet): paste `contracts/rule_wind_tunnel.py`, deploy with no constructor arguments.
2. Put the new address in `web/config.js` (`CONTRACT`), run `npm run build`, publish `web/`.
3. Save the contract code from the chain next to the repository file and run the parity script.

## Bradbury (not deployed)

On 2026-11-10 the contract was sent to Testnet Bradbury (chain 4221) four times with GenLayer CLI 0.40.0-rc.6. Each time the deployment was accepted and finalised but its execution failed with `invalid_contract runner malformed`; all five validators agreed on the error, the fee deposit was refunded and no contract was created. Tried: the runner line `py-genlayer:1jb45…` as the first line of the file; the same with a blank line under it (GenVM reads the whole run of leading `#` lines as one JSON document, so a second comment line there breaks it; a test guards this); and `py-genlayer:test`, the runner the CLI's own project template uses. None worked, so the cause is probably a runner/version mismatch on the network and is not understood. Studio's Bradbury mode could not load the contract schema either. The same file deploys on Studionet. Bradbury support is therefore not claimed.
