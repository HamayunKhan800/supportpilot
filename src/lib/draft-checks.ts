/**
 * The checks shown on an AI draft: facts the server verified, never a confidence score
 * (Google PAIR: avoid raw model percentages; Microsoft HAX G2: say how well it can do).
 * Each check maps to a warning code from the drafts module (src/server/modules/drafts).
 */

export interface DraftCheck {
  id: "sources" | "citations" | "links" | "hidden" | "truncated" | "changed";
  ok: boolean;
  label: string;
}

export interface CheckableDraft {
  warnings: readonly string[];
  citations: readonly { sourceRemoved: boolean }[];
}

export function draftChecks(draft: CheckableDraft): DraftCheck[] {
  const has = (code: string) => draft.warnings.includes(code);
  const n = draft.citations.length;
  const checks: DraftCheck[] = [];

  if (n === 0 || has("no_citations")) {
    checks.push({ id: "sources", ok: false, label: "No sources cited" });
  } else {
    checks.push({ id: "sources", ok: true, label: `Cites ${n} ${n === 1 ? "source" : "sources"}` });
  }
  if (has("invalid_citations")) {
    checks.push({ id: "citations", ok: false, label: "Made-up source numbers removed" });
  } else if (n > 0) {
    checks.push({ id: "citations", ok: true, label: "Every citation matches a source" });
  }
  checks.push(
    has("unknown_link")
      ? { id: "links", ok: false, label: "Unfamiliar link or email" }
      : { id: "links", ok: true, label: "No unfamiliar links" },
  );
  if (has("hidden_characters")) checks.push({ id: "hidden", ok: false, label: "Hidden characters removed" });
  if (has("truncated")) checks.push({ id: "truncated", ok: false, label: "Cut off at the length limit" });
  if (draft.citations.some((c) => c.sourceRemoved)) {
    checks.push({ id: "changed", ok: false, label: "A source changed since" });
  }
  return checks;
}

/** Markdown syntax that reads as noise in a plain-text preview (the passage itself is kept). */
function plainText(markdown: string): string {
  return markdown
    .replace(/^\s{0,3}#{1,6}\s+/gm, "") // headings
    .replace(/^\s*>\s?/gm, "") // quotes
    .replace(/(\*\*|__)(.+?)\1/g, "$2") // bold
    .replace(/(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])/g, "$1") // italics
    .replace(/`([^`]+)`/g, "$1") // inline code
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1"); // links: keep the text only
}

/** A short plain-text excerpt for the citation preview: whole words, at most `max` characters. */
export function excerpt(text: string, max = 280): string {
  const clean = plainText(text).replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[\s.,;:]+$/, "")}…`;
}
