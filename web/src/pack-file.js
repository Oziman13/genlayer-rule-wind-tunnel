// A rule file is the same normalised pack the page sends to measure(): label, wordings,
// cases (text and intent), and previous. Nothing here talks to a network.

import { problems, LIMITS } from "./pack.js";

const INTENTS = ["COMPLIES", "VIOLATES", "OPEN"];

// The draft a "Revise this rule" action writes into the form. The label keeps a short
// hint the person can edit. previous is the measured pack already on screen.
export function revisionDraft(report) {
  return {
    label: String(report.pack.label) + " v2",
    previous: String(report.id),
    wordings: report.pack.wordings.slice(),
    cases: report.pack.cases.map(c => ({ text: c.text, intent: c.intent })),
  };
}

// Read a local JSON file. Returns { draft } or { error }. A bad file is never applied.
export function interpretPackFile(text) {
  let data;
  try { data = JSON.parse(text); }
  catch { return { error: "This file is not JSON. Use a file saved from this page: one JSON object, nothing else." }; }
  if (!data || typeof data !== "object" || Array.isArray(data)) return { error: "This file has the wrong shape. It needs one object with a name, a list of wordings, and a list of cases." };
  if (typeof data.label !== "string" || !Array.isArray(data.wordings) || !Array.isArray(data.cases)) return { error: "This file has the wrong shape. It needs a name, a list of wordings, and a list of cases." };
  if (data.previous != null && typeof data.previous !== "string") return { error: "This file has the wrong shape. The earlier measurement, when present, must be a pack id." };
  if (data.wordings.some(w => typeof w !== "string")) return { error: "This file has the wrong shape. Each wording must be text." };
  if (data.cases.some(c => !c || typeof c !== "object" || Array.isArray(c) || typeof c.text !== "string" || typeof c.intent !== "string" || !INTENTS.includes(c.intent))) {
    return { error: "This file has the wrong shape. Each case needs text and an intent of COMPLIES, VIOLATES, or OPEN." };
  }
  if (data.wordings.length > LIMITS.wordings[1]) return { error: `This file has too many wordings (${data.wordings.length}). A rule can have at most ${LIMITS.wordings[1]}.` };
  if (data.cases.length > LIMITS.cases[1]) return { error: `This file has too many cases (${data.cases.length}). A rule can have at most ${LIMITS.cases[1]}.` };
  const draft = {
    label: data.label,
    previous: data.previous || "",
    wordings: data.wordings.slice(),
    cases: data.cases.map(c => ({ text: c.text, intent: c.intent })),
  };
  const list = problems(draft);
  if (list.length) return { error: list.slice(0, 6).join(" ") };
  return { draft };
}
