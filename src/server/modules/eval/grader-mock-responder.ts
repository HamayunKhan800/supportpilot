import type { MockRequest } from "@/server/modules/ai/mock-model";

/**
 * Deterministic stand-in for the groundedness grader, for CI and local runs (ADR-0006). It reads
 * the prompt like the model would: each sentence of the reply with at least three meaningful
 * words is a claim, and a claim is supported when one source contains at least 60% of those
 * words. Greetings and sign-offs are skipped. It checks the plumbing, not grading quality: only
 * the Gemini run measures the real grader.
 */

const SUPPORT_SHARE = 0.6;
const MIN_WORDS = 3;

const STOPWORDS = new Set(
  (
    "about after again also because been before being both could does doing down from have having " +
    "here into just like more most much once only other over same should some such than that their " +
    "them then there these they this those through very what when where which while with would your " +
    "hello thanks thank please help need want know cannot can't dont don't will"
  ).split(" "),
);

const SKIP = /^(hi|hello|dear|thanks|thank you|let us know|kind regards|best|cheers)\b/i;

const decode = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");

const words = (text: string) =>
  new Set(
    (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => w.length >= 4 && !STOPWORDS.has(w)),
  );

export function mockGraderResponder(request: MockRequest): string {
  const sources = [...request.prompt.matchAll(/<source n="(\d+)"[^>]*>\n([\s\S]*?)\n<\/source>/g)].map(
    (m) => ({
      marker: Number(m[1]),
      words: words(decode(m[2]!)),
    }),
  );
  const reply = decode(/<reply>\n([\s\S]*?)\n<\/reply>/.exec(request.prompt)?.[1] ?? "");
  const sentences = reply
    .replace(/\s*\[\d+\]/g, "")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s && !SKIP.test(s));

  const claims = sentences.flatMap((sentence) => {
    const claimWords = [...words(sentence)];
    if (claimWords.length < MIN_WORDS) return [];
    const backing = sources.filter(
      (s) => claimWords.filter((w) => s.words.has(w)).length / claimWords.length >= SUPPORT_SHARE,
    );
    return [
      {
        claim: sentence.replace(/[.!?]+$/, ""),
        verdict: backing.length ? "supported" : "unsupported",
        sources: backing.map((s) => s.marker),
      },
    ];
  });
  return JSON.stringify({ claims: claims.slice(0, 12) });
}
