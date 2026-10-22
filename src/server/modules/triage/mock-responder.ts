import type { MockRequest } from "@/server/modules/ai/mock-model";

/**
 * Deterministic stand-in for the triage model (ADR-0006, M5 D3), used by CI, local development
 * and E2E. It is deliberately simple, keyword counting, and it is not what the evaluation
 * measures: M6 measures Gemini. It reads only the user prompt (the <ticket> block), and takes
 * the allowed categories from the JSON Schema the SDK sends, exactly like a real model.
 *
 * Confidence: 0.9 with two or more keyword hits for the chosen category, 0.75 with one, 0.4
 * with none, so both the "applied" and the "needs review" paths show up in a demo.
 */

const CATEGORY_KEYWORDS: Record<string, readonly string[]> = {
  billing: [
    "refund",
    "charge",
    "charged",
    "invoice",
    "payment",
    "billing",
    "card",
    "subscription",
    "receipt",
    "price",
  ],
  bug: [
    "error",
    "crash",
    "crashes",
    "broken",
    "bug",
    "not working",
    "doesn't work",
    "fails",
    "failed",
    "stuck",
  ],
  account: ["password", "login", "log in", "sign in", "2fa", "two-factor", "account", "locked", "username"],
  "how-to": ["how do i", "how to", "how can i", "where can i", "is it possible", "where do i"],
  "feature-request": [
    "feature",
    "would be great",
    "please add",
    "suggestion",
    "wish",
    "could you add",
    "roadmap",
  ],
};

const URGENT = [
  "urgent",
  "asap",
  "outage",
  "is down",
  "data loss",
  "lost all",
  "security",
  "hacked",
  "breach",
];
const HIGH = ["cannot", "can't", "unable", "blocked", "charged twice", "double charged", "not working"];
const LOW = ["feature", "suggestion", "feedback", "just wondering", "no rush", "would be great"];
const NEGATIVE = [
  "angry",
  "frustrated",
  "terrible",
  "unacceptable",
  "disappointed",
  "worst",
  "annoyed",
  "ridiculous",
];
const POSITIVE = ["thanks", "thank you", "great", "love", "awesome", "appreciate"];

function allowedCategories(schema: unknown): string[] {
  const values = (schema as { properties?: { category?: { enum?: unknown } } } | undefined)?.properties
    ?.category?.enum;
  return Array.isArray(values) ? values.filter((v): v is string => typeof v === "string") : [];
}

/** The text between <ticket> and </ticket>, lower-cased; the whole prompt if the tags are missing. */
function ticketText(prompt: string): string {
  const match = /<ticket>([\s\S]*)<\/ticket>/.exec(prompt);
  return (match?.[1] ?? prompt).toLowerCase();
}

const hits = (text: string, words: readonly string[]) => words.filter((w) => text.includes(w));

function guessLanguage(text: string): string {
  if (/[\u0679\u0688\u0691\u06BA\u06BE\u06C1\u06D2]/.test(text)) return "ur"; // letters used in Urdu
  if (/[\u0600-\u06FF]/.test(text)) return "ar";
  if (/\b(hola|gracias|por favor|no puedo|mi cuenta|factura)\b/.test(text)) return "es";
  if (/\b(bonjour|merci|je ne|mon compte|s'il vous pla[iî]t)\b/.test(text)) return "fr";
  if (/\b(hallo|danke|ich|nicht|bitte)\b/.test(text)) return "de";
  return "en";
}

export function mockTriageResponder(request: MockRequest): string {
  const text = ticketText(request.prompt);
  const categories = allowedCategories(request.schema);

  let best = {
    category: categories.includes("other") ? "other" : (categories[0] ?? "other"),
    found: [] as string[],
  };
  for (const category of categories) {
    const found = hits(text, CATEGORY_KEYWORDS[category] ?? [category.toLowerCase()]);
    if (found.length > best.found.length) best = { category, found };
  }

  const priority =
    hits(text, URGENT).length > 0
      ? "urgent"
      : hits(text, HIGH).length > 0
        ? "high"
        : hits(text, LOW).length > 0
          ? "low"
          : "normal";
  const sentiment =
    hits(text, NEGATIVE).length > 0 || text.includes("!!")
      ? "negative"
      : hits(text, POSITIVE).length > 0
        ? "positive"
        : "neutral";

  return JSON.stringify({
    category: best.category,
    priority,
    sentiment,
    language: guessLanguage(text),
    confidence: best.found.length >= 2 ? 0.9 : best.found.length === 1 ? 0.75 : 0.4,
    reason: best.found.length
      ? `Mentions ${best.found.slice(0, 3).join(", ")}.`
      : "No clear signal in the request; best guess.",
  });
}
