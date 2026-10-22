/**
 * Preparing untrusted text (customer messages, later knowledge passages) for a prompt
 * (M5 D10, D11; OWASP LLM01 and the OWASP Prompt Injection Prevention Cheat Sheet).
 *
 * None of this is a security boundary: a model can still be talked into anything, which is
 * why AI output is only ever a suggestion with limited effect (D5) or a draft a human must
 * approve (D9). These steps remove the cheap tricks and keep the prompt well-formed:
 *  - Unicode tag characters (U+E0000–U+E007F) are invisible in every UI but readable by
 *    models, a known way to smuggle instructions. They have no legitimate use in a support
 *    message, so they are removed and counted. Zero-width joiners/non-joiners are kept:
 *    Urdu, Persian and several Indic scripts need them.
 *  - Our own delimiter tags are neutralised inside the data, so text can't "close" the
 *    block it sits in and pose as instructions.
 *  - Length is capped, oldest messages first, so a long thread can't crowd out the rules.
 */

const TAG_CHARACTERS = /[\u{E0000}-\u{E007F}]/gu;

export interface SanitizedText {
  text: string;
  /** How many hidden tag characters were removed (a signal worth logging). */
  hiddenRemoved: number;
}

export function stripHiddenCharacters(text: string): SanitizedText {
  let hiddenRemoved = 0;
  const cleaned = text.replace(TAG_CHARACTERS, () => {
    hiddenRemoved++;
    return "";
  });
  return { text: cleaned, hiddenRemoved };
}

/**
 * Escapes `<` in anything that looks like one of `tagNames` (opening or closing, any case,
 * with stray whitespace), so `</ticket>` in a message arrives as the text "&lt;/ticket>".
 * Other angle brackets (code snippets, "<3") are left alone.
 */
export function neutralizeTags(text: string, tagNames: readonly string[]): string {
  if (tagNames.length === 0) return text;
  const names = tagNames.map((n) => n.replace(/[^a-z0-9_-]/gi, "")).join("|");
  return text.replace(new RegExp(`<(?=\\s*/?\\s*(?:${names})\\b)`, "gi"), "&lt;");
}

/** Escapes a value placed inside a double-quoted attribute of our own markup. */
export function attributeValue(text: string): string {
  return text.replace(/[&"<>]/g, (c) => ({ "&": "&amp;", '"': "&quot;", "<": "&lt;", ">": "&gt;" })[c]!);
}

export interface ThreadMessage {
  from: "customer" | "agent";
  body: string;
  internal: boolean;
}

/**
 * The part of a conversation a model may see (D11): internal notes are never sent, then the
 * newest `maxMessages` messages, dropping the oldest until the bodies fit in `maxChars`. The
 * newest message is always kept, truncated if it alone is too long. Order is preserved.
 */
export function selectThread(
  messages: readonly ThreadMessage[],
  options: { maxMessages: number; maxChars: number },
): { messages: ThreadMessage[]; omitted: number } {
  const visible = messages.filter((m) => !m.internal);
  const recent = visible.slice(-options.maxMessages);
  const kept: ThreadMessage[] = [];
  let used = 0;
  for (let i = recent.length - 1; i >= 0; i--) {
    const m = recent[i]!;
    if (kept.length === 0 && m.body.length > options.maxChars) {
      kept.unshift({ ...m, body: `${m.body.slice(0, options.maxChars)}…` });
      used = options.maxChars;
      continue;
    }
    if (used + m.body.length > options.maxChars) break;
    kept.unshift(m);
    used += m.body.length;
  }
  return { messages: kept, omitted: visible.length - kept.length };
}
