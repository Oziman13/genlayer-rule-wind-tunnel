# Changelog

## 0.2.0 (web page; the contract stays at v0.1.1)

The contract on Studionet (`0xF319FDf761A71Eb81D8FD8bcaBC9d03e155270E5`) is **not** changed and not redeployed. `node scripts/verify-deployed-source.mjs` still shows the on-chain bytes equal to `deployed/rule_wind_tunnel.studionet-0xF319.py`. Everything below is in `web/`, `tests/browser/` and the docs.

### Added

- **Compare two measurements** (`web/src/compare.js`, board section). Pick two measured rules and the page asks the contract's `compare_json` for them, then shows score, grade, consistency, fidelity and boundary cases side by side with the change and whether it is better or worse, in words as well as colour. An opened rule that revises an earlier one gets a button, "Compare with the version it revises". Before this release the page never called `compare_json`, so the contract's comparison view could only be used from Studio. The same measurement twice is refused without a network call; an unknown id and an unreadable answer are each explained.
- **Vague-word hints in the composer** (`web/src/hedges.js`). While wordings are typed, phrases such as "reasonable", "promptly", "soon", "in good time" and "acceptable" (about fifty in all) are listed per wording, with a sentence on why. It is a word list, not a measurement. It never blocks a measurement and the box says so. The vague refund rule from the demo is flagged in all four wordings; the revised rule in none.
- **Copy a reading as Markdown** (`web/src/report-md.js`). A measured reading can be copied as Markdown: grade and score, consistency, fidelity, boundary cases, the wordings, the table of verdicts, the boundary cases with the reason, the pack id and the contract. Pipes and line breaks in the text are escaped so a table cannot break. If the browser refuses clipboard access the text is shown selected, with a note. The made-up sample table has no copy button.

### Changed

- Styles for the three additions in `web/style.css`; `web/app.js` rebuilt from `web/src/` (CI checks the bundle matches).
- `package.json` version 0.2.0. README, `docs/ARCHITECTURE.md` and `docs/VERIFICATION.md` describe the additions.

### Tests

- Browser logic checks 54 to 76; page checks 80 to 105 (181 in all). New checks cover each addition, including the failure paths named above. The 174 direct-mode tests and 6 local-network tests are unchanged because the contract is unchanged.
- No mutation check was run on the new page code; the mutation evidence in `evidence/` is about the contract.

### Not done

- No change to the contract, and no deployment to Bradbury (see `docs/DEPLOYMENT.md`).
- The hint list is English and short; it will miss vague wording it does not know.

## 0.1.1

Studionet contract and first web page. The validators' agreement rule changed to "grade at most one step apart" with one retry per wording; see the README and `docs/REVIEWER_EVIDENCE.md`.

## 0.1.0

First contract (obsolete, replaced by 0.1.1 after real models broke its 15%-of-cells rule).
