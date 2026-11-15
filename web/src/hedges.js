// A word list, not a measurement. It points at wording that leaves the model room to guess (no number, no named
// condition) so a person can sharpen it before spending a measurement. A rule without these words can still read
// unsteadily; the tunnel is what tells you that. Matching is on whole words, case-insensitive, longest phrase first.

export const HEDGES = [
  "as soon as possible", "as soon as practicable", "in a timely manner", "in good time", "from time to time",
  "where possible", "if necessary", "as appropriate", "as needed", "good condition",
  "unreasonably", "reasonably", "unreasonable", "reasonable", "promptly", "prompt", "shortly", "soon", "timely",
  "inappropriate", "appropriately", "appropriate", "inadequate", "adequately", "adequate", "unsuitable", "suitable",
  "insufficient", "sufficiently", "sufficient", "significantly", "significant", "substantially", "substantial",
  "excessively", "excessive", "unduly", "undue", "acceptable", "satisfactory", "properly", "proper",
  "normally", "normal", "usually", "usual", "generally", "typically", "recently", "a while", "a few",
];

const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const RE = new RegExp(`(?<![\\p{L}\\p{N}])(?:${HEDGES.map(escapeRe).join("|")})(?![\\p{L}\\p{N}])`, "giu");

// Every vague phrase in one text, in the order written, each phrase once.
export function findHedges(text) {
  const seen = new Set(), out = [];
  for (const m of String(text ?? "").matchAll(RE)) {
    const k = m[0].toLowerCase();
    if (!seen.has(k)) { seen.add(k); out.push(m[0]); }
  }
  return out;
}

// One entry per wording that contains any, with its letter.
export function hedgeNotes(wordings, letters = "ABCDE") {
  return (wordings || []).map((w, i) => ({ index: i, letter: letters[i], phrases: findHedges(w) })).filter(n => n.phrases.length);
}
