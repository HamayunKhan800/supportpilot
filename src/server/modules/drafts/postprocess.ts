import { stripHiddenCharacters } from "@/server/modules/ai/untrusted";

import { validateCitations } from "./citations";
import { INSUFFICIENT_KNOWLEDGE } from "./prompt";

export { validateCitations, type CitationCheck } from "./citations";

/**
 * Checks on a generated draft, done by code rather than trusted to the model (M5 D7–D10).
 * All pure functions, so every rule is unit-tested.
 */

export const DRAFT_WARNINGS = [
  /** Invisible Unicode tag characters were removed from the ticket, passages or output (D10e). */
  "hidden_characters",
  /** The draft contains a link or email address found in neither the passages nor the ticket (D10d). */
  "unknown_link",
  /** Citation markers that pointed at no passage were removed (D8). */
  "invalid_citations",
  /** The draft cites no passage at all: check it against the sources before sending. */
  "no_citations",
  /** The output limit cut the draft short. */
  "truncated",
] as const;
export type DraftWarning = (typeof DRAFT_WARNINGS)[number];

/** The model said the passages don't answer the question (D7). Tolerates case and a space. */
export function saysInsufficientKnowledge(text: string): boolean {
  return /INSUFFICIENT[_\s]KNOWLEDGE/i.test(text);
}

/** The system prompt's secret appears in the output, ignoring case and whitespace (D10c). */
export function containsCanary(text: string, canary: string): boolean {
  const squash = (s: string) => s.replace(/\s+/g, "").toLowerCase();
  return squash(text).includes(squash(canary));
}

const URL_PATTERN = /\b(?:https?:\/\/|www\.)[^\s<>"'()[\]{}]+/gi;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)*\.[A-Z]{2,}\b/gi;

function normalizeLink(link: string): string {
  return link
    .toLowerCase()
    .replace(/[.,;:!?]+$/, "")
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/+$/, "");
}

/**
 * Links and email addresses in the draft that appear in none of `sources` (passages and ticket
 * text), D10d. A link counts as known when its host and path appear in a source, ignoring the
 * scheme, a leading "www." and case. Bare domains without "www." or a scheme ("example.com")
 * are not detected: a known limit, recorded in the injection tests (step 6).
 */
export function findUnknownLinks(text: string, sources: readonly string[]): string[] {
  const haystack = sources.map(normalizeLink).join("\n");
  const found = [...(text.match(URL_PATTERN) ?? []), ...(text.match(EMAIL_PATTERN) ?? [])];
  return [...new Set(found.map(normalizeLink))].filter((link) => link && !haystack.includes(link));
}

/**
 * Holds back the start of a stream while it could still be the INSUFFICIENT_KNOWLEDGE answer,
 * so the agent never sees the marker flash up before the "insufficient knowledge" message.
 * Everything else streams through unchanged.
 */
export class RefusalPrefixGuard {
  private held = "";
  private decided = false;

  /** Returns the text that may be shown now (possibly empty). */
  push(delta: string): string {
    if (this.decided) return delta;
    this.held += delta;
    const start = this.held.trimStart().toUpperCase();
    if (start.length === 0) return "";
    if (INSUFFICIENT_KNOWLEDGE.startsWith(start) || start.startsWith(INSUFFICIENT_KNOWLEDGE)) return "";
    this.decided = true;
    const out = this.held;
    this.held = "";
    return out;
  }
}

export interface DraftCheckInput {
  text: string;
  passageCount: number;
  canary: string;
  /** Passage and ticket text, for the link check. */
  sources: readonly string[];
  finishReason: string;
  /** Hidden characters were removed from the prompt's inputs. */
  inputFlagged: boolean;
}

export type DraftCheck =
  | { status: "blocked"; errorCode: "canary_leak" }
  | { status: "refused"; errorCode: "model_insufficient_knowledge" }
  | { status: "failed"; errorCode: "empty_output" }
  | {
      status: "ready";
      body: string;
      cited: number[];
      invalidCitationCount: number;
      warnings: DraftWarning[];
      unknownLinkCount: number;
    };

/** Decides what happens to a finished generation, in order: leak → refusal → empty → checks. */
export function checkDraft(input: DraftCheckInput): DraftCheck {
  if (containsCanary(input.text, input.canary)) return { status: "blocked", errorCode: "canary_leak" };
  if (saysInsufficientKnowledge(input.text))
    return { status: "refused", errorCode: "model_insufficient_knowledge" };

  const stripped = stripHiddenCharacters(input.text);
  const citations = validateCitations(stripped.text, input.passageCount);
  const body = citations.text.trim();
  // Nothing left (empty answer, or only invalid markers): a fault, not a refusal.
  if (!body) return { status: "failed", errorCode: "empty_output" };
  const unknown = findUnknownLinks(body, input.sources);

  const warnings: DraftWarning[] = [];
  if (input.inputFlagged || stripped.hiddenRemoved > 0) warnings.push("hidden_characters");
  if (unknown.length > 0) warnings.push("unknown_link");
  if (citations.invalidCount > 0) warnings.push("invalid_citations");
  if (citations.cited.length === 0) warnings.push("no_citations");
  if (input.finishReason === "length") warnings.push("truncated");

  return {
    status: "ready",
    body,
    cited: citations.cited,
    invalidCitationCount: citations.invalidCount,
    warnings,
    unknownLinkCount: unknown.length,
  };
}
