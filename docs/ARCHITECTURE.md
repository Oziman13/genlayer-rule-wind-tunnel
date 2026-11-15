# Architecture

Rule Wind Tunnel has two parts and nothing else. There is no server, no database, no indexer and no key held by the project.

```
 visitor's browser                         GenLayer Studionet
 ┌──────────────────────────┐   reads      ┌────────────────────────────────┐
 │ web/ (static page)       │ ───────────► │ RuleWindTunnel (one contract)  │
 │  index.html, style.css   │              │  pack store + run history      │
 │  src/*.js -> app.js      │   writes     │  consensus: model table +      │
 │  injected wallet (EIP-1193) ──────────► │  grade-distance validator rule │
 └──────────────────────────┘ (own wallet) └────────────────────────────────┘
```

## The contract (`contracts/rule_wind_tunnel.py`)

One Python Intelligent Contract. It holds no funds and makes no web request. State:

| Field | Meaning |
|---|---|
| `entries` | pack id -> JSON `{pack, runs}`; every run keeps its table, timestamp and sender |
| `pack_index`, `pack_count` | insertion order, for the public board |

Flow of `measure(pack_json)`:

1. `_normalize` squashes whitespace and checks every limit; `_pack_id` hashes the normalised text with SHA-256. The hash is the pack's identity.
2. Rules around the pack: board limit (200), known `previous`, run limit (5), cooldown (300 s). The clock is the transaction timestamp.
3. `_consensus` runs the leader's `_measure` and the validators' check (see `CONSENSUS.md`).
4. If the agreed result is a table, it is appended as a run. If the model's answer was never usable, nothing is stored and the call returns `UNMEASURABLE`.
5. `_metrics` computes every number from the stored table with integer arithmetic (permille). Views recompute them on request; nothing derived is stored.

## The page (`web/`)

A static page built with esbuild (`npm run build` -> `web/app.js`). It:

- reads the board and reports from the contract with `genlayer-js`, and recomputes none of the contract's numbers;
- computes the pack id in JavaScript with the same canonical text as the contract, so the id shown before sending equals the id the contract assigns (checked in `tests/browser/logic.test.mjs`);
- sends a measurement from the visitor's own wallet. A pending record is written to the browser before the wallet is asked to sign; a send that may have gone out is reconciled after a reload before anything else is sent;
- treats a transaction as successful only when the status is `FINALIZED` and the execution result is a success;
- since v0.2.0: shows two measurements side by side from the contract's `compare_json` (`web/src/compare.js`; the only arithmetic is subtracting the values it displays), flags vague wording as advice while a pack is written (`web/src/hedges.js`, a word list that never blocks a measurement), and copies a reading as Markdown (`web/src/report-md.js`). The contract is unchanged.

## What is deliberately absent

Funds, an owner or admin key, an upgrade path, web access from the contract, any third-party request from the page (fonts are served from `web/fonts`).
