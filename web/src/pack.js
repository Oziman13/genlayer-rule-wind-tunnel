// Pack rules, mirrored from contracts/rule_wind_tunnel.py so the page can tell a person what is wrong before
// anything is sent, and can show the pack id the contract will compute. The contract is the authority: it checks
// everything again, and a test (tests/browser/logic.test.mjs) compares this file with the contract's own limits.

export const LIMITS = {
  wordings: [3, 5], cases: [6, 12], wording: [20, 600], caseText: [10, 400], label: [3, 60], packText: 12000,
};
export const INTENTS = ["COMPLIES", "VIOLATES", "OPEN"];

const squash = s => String(s ?? "").split(/\s+/).filter(Boolean).join(" ");
// Python's str.split() splits on Unicode whitespace; JS \s covers the same set closely enough for the preview.
const hasControl = s => [...s].some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);
const len = s => [...s].length; // Python counts code points

export function normalize(draft) {
  return {
    label: squash(draft.label),
    previous: String(draft.previous ?? "").trim().toLowerCase(),
    wordings: (draft.wordings || []).map(squash),
    cases: (draft.cases || []).map(c => ({ text: squash(c.text), intent: c.intent })),
  };
}

// Plain-language problems, one per line. Empty list = the contract will accept the pack's shape.
export function problems(draft) {
  const p = normalize(draft);
  const out = [];
  const [wmin, wmax] = LIMITS.wordings, [cmin, cmax] = LIMITS.cases;
  if (len(p.label) < LIMITS.label[0] || len(p.label) > LIMITS.label[1]) out.push(`Give the rule a name of ${LIMITS.label[0]} to ${LIMITS.label[1]} characters.`);
  if (p.previous && !/^[0-9a-f]{64}$/.test(p.previous)) out.push("The earlier version must be a 64-character pack id, or left empty.");
  if (p.wordings.length < wmin || p.wordings.length > wmax) out.push(`Write between ${wmin} and ${wmax} wordings of the rule (now ${p.wordings.length}).`);
  p.wordings.forEach((w, i) => {
    if (len(w) < LIMITS.wording[0] || len(w) > LIMITS.wording[1] || hasControl(w)) out.push(`Wording ${"ABCDE"[i]} needs ${LIMITS.wording[0]} to ${LIMITS.wording[1]} characters.`);
  });
  if (new Set(p.wordings.map(w => w.toLowerCase())).size !== p.wordings.length) out.push("Two wordings are the same. Each one has to say the rule in its own way.");
  if (p.cases.length < cmin || p.cases.length > cmax) out.push(`Add between ${cmin} and ${cmax} cases (now ${p.cases.length}).`);
  p.cases.forEach((c, i) => {
    if (len(c.text) < LIMITS.caseText[0] || len(c.text) > LIMITS.caseText[1] || hasControl(c.text)) out.push(`Case ${i + 1} needs ${LIMITS.caseText[0]} to ${LIMITS.caseText[1]} characters.`);
    if (!INTENTS.includes(c.intent)) out.push(`Case ${i + 1} needs an intended verdict.`);
  });
  if (new Set(p.cases.map(c => c.text.toLowerCase())).size !== p.cases.length) out.push("Two cases are the same. Each case has to be different.");
  return out;
}

// Key order must match Python's json.dumps(sort_keys=True, separators=(",", ":")): keys sorted, no spaces, and
// non-ASCII characters escaped as \uXXXX (ensure_ascii).
function pyJson(v) {
  if (v === null) return "null";
  if (typeof v === "string") return JSON.stringify(v).replace(/[\u007f-￿]/g, c => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
  if (typeof v === "number" || typeof v === "boolean") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(pyJson).join(",") + "]";
  return "{" + Object.keys(v).sort().map(k => pyJson(k) + ":" + pyJson(v[k])).join(",") + "}";
}

export async function packId(draft, subtle = globalThis.crypto?.subtle) {
  const bytes = new TextEncoder().encode(pyJson(normalize(draft)));
  const digest = await subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}

// The text sent to measure(). It is the normalised pack; "previous" is left out when empty.
export function packJson(draft) {
  const p = normalize(draft);
  const out = { label: p.label, wordings: p.wordings, cases: p.cases };
  if (p.previous) out.previous = p.previous;
  return JSON.stringify(out);
}
