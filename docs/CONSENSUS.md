# Consensus

## What the validators are asked

For a pack with W wordings and C cases, the leader puts the cases to its model once per wording and gets one row of verdicts per wording (`COMPLIES`, `VIOLATES`, `UNCLEAR`). The rows form a W x C table of letters. A model answer that is not exactly `{"verdicts": [...]}` with C known verdicts is rejected; each wording gets `MODEL_TRIES = 2` attempts, then the whole measurement is `ERROR` and nothing is stored.

## What "agree" means here

Each validator rebuilds the same table with its own model and compares it with the leader's table:

1. the leader's result must be a string of at most 4000 characters, valid canonical JSON with the exact expected shape;
2. both must have the same state (`OK` or `ERROR`);
3. for `OK`, the **grade** of the leader's table and the grade of the validator's table must be at most `MAX_GRADE_STEPS = 1` step apart on `UNSTABLE < SHAKY < USABLE < STEADY`.

Individual cells are allowed to differ. That is a design decision, not a shortcut: the first deployment (v0.1.0) required tables to differ in at most 15% of cells. On a vague rule, real models on Studionet read the rule so differently that those transactions ended `UNDETERMINED` or `UNMEASURABLE`. The spread between models is what the tool measures, so it cannot also be a reason to refuse the measurement.

## What the rule still protects

- A leader that invents a shape, adds fields or pads the answer is rejected (exact shape, canonical form, size cap).
- A leader whose table sits two or more grade steps from a validator's own reading is rejected. A pack on which models read the rule that differently does not settle, and that is reported honestly as "not measurable", not hidden.
- The stored table is the leader's reading, not an average of the validators. Measuring again (up to 5 runs, 5 minutes apart) shows how far readings move.

## Where it lives

`_prompt`, `_parse_row`, `_read_wording`, `_measure`, `_close`, `_consensus`; constants `GRADES`, `MAX_GRADE_STEPS`, `MODEL_TRIES`. Each is covered by tests listed in `VERIFICATION.md`.
