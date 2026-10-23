import type { MockRequest } from "@/server/modules/ai/mock-model";

import { INSUFFICIENT_KNOWLEDGE } from "./prompt";

/**
 * Deterministic stand-in for the draft model (ADR-0006, M5 D3), for CI, local development and
 * E2E. It reads the prompt like a model would: it picks the passages sharing the most words
 * with the customer's question and quotes their opening sentences with `[n]` citations, or
 * answers INSUFFICIENT_KNOWLEDGE when no passage shares a meaningful word. It always writes
 * English. It is not what the evaluation measures (M6 measures Gemini).
 */

const STOPWORDS = new Set(
  (
    "about after again also because been before being both could does doing down from have having " +
    "here into just like more most much once only other over same should some such than that their " +
    "them then there these they this those through very what when where which while with would your " +
    "hello thanks thank please help need want know cannot can't dont don't will"
  ).split(" "),
);

interface ParsedPassage {
  marker: number;
  content: string;
}

const decode = (s: string) => s.replace(/&lt;/g, "<");

function parsePassages(prompt: string): ParsedPassage[] {
  const re = /<passage n="(\d+)"[^>]*>\n([\s\S]*?)\n<\/passage>/g;
  return [...prompt.matchAll(re)].map((m) => ({ marker: Number(m[1]), content: decode(m[2]!) }));
}

/** Subject plus the latest customer message: the same text retrieval searched with. */
function question(prompt: string): string {
  const subject = /<subject>([\s\S]*?)<\/subject>/.exec(prompt)?.[1] ?? "";
  const customer = [...prompt.matchAll(/<message from="customer">\n([\s\S]*?)\n<\/message>/g)];
  return decode(`${subject}\n${customer.at(-1)?.[1] ?? ""}`);
}

const words = (text: string) =>
  new Set(
    (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => w.length >= 4 && !STOPWORDS.has(w)),
  );

/** The passage's first sentences as plain text, without Markdown symbols, at most ~240 characters. */
function opening(content: string): string {
  const plain = content
    .split("\n")
    .map((l) =>
      l
        .replace(/^\s*(#{1,6}|[-*+]|\d+\.|\|)\s*/, "")
        .replace(/[*_`|]/g, "")
        .trim(),
    )
    .filter(Boolean)
    .join(" ");
  const sentences = plain.match(/[^.!?]+[.!?]+/g) ?? [plain];
  let out = "";
  for (const s of sentences) {
    if (out && out.length + s.length > 240) break;
    out += s;
  }
  return out.trim().replace(/[.!?]+$/, "");
}

export function mockDraftResponder(request: MockRequest): string {
  const passages = parsePassages(request.prompt);
  const asked = words(question(request.prompt));
  const scored = passages
    .map((p) => ({ ...p, overlap: [...words(p.content)].filter((w) => asked.has(w)).length }))
    .filter((p) => p.overlap > 0)
    .sort((a, b) => b.overlap - a.overlap || a.marker - b.marker)
    .slice(0, 2);
  if (scored.length === 0) return INSUFFICIENT_KNOWLEDGE;

  const body = scored.map((p) => `${opening(p.content)} [${p.marker}].`).join(" ");
  return `Hi,\n\nThanks for getting in touch. ${body}\n\nLet us know if there is anything else we can help with.`;
}
