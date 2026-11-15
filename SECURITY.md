# Security policy

Rule Wind Tunnel is a test rig. The contract holds no funds and no privileges, and the page holds no keys. The realistic problems are a wrong measurement, a way to block the public board, or a page that asks for something it should not. The full analysis is in [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md).

## Supported version

Only **v0.1.1** on Studionet (`0xF319FDf761A71Eb81D8FD8bcaBC9d03e155270E5`). Studionet is a test network, so there is nothing of value at stake.

## Reporting a problem

Open a GitHub issue titled "Security: <short summary>" on this repository. Because nothing of value is held, public reports are fine. Please include:

- what you did (the pack JSON or the page steps),
- what you expected and what happened,
- the transaction hash, if a transaction was involved.

For anything you would rather not post publicly, open an issue that says only "please contact me about a security problem" and leave a way to reach you.

## What is in scope

- A pack that makes the contract store a table it should have refused, or refuse a valid pack.
- A way around the limits (200 packs, 5 runs per pack, 300 s cooldown, text length caps).
- A prompt-injection text in a rule or case that changes a verdict shape or reaches state.
- The page sending a request to a third-party host, asking for a key or a seed phrase, or reporting a success before the transaction is finalized.

## What is not in scope

- Disagreement between two models reading the same pack. That spread is what the tool measures, and the stored score is the leader's reading. See "Known limits" in the threat model.
- Behaviour on networks other than Studionet. Deployment to Bradbury failed (see [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)).
- The mock wallet and mock node used in the automated page tests. They do not prove behaviour with a real wallet.

## What we do not do

The page never asks for a private key, a seed phrase or a password, and it makes no request to a third-party host. Transactions are signed in your own wallet.
