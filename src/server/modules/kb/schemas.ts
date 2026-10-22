import { z } from "zod";
import { KB_MAX_QUERY_LENGTH } from "./limits";

/**
 * Knowledge-base request schemas (server-side validation). Client components import the
 * limits from ./limits instead: bundling Zod into the browser trips the strict CSP,
 * because Zod probes `new Function` to decide whether it may compile validators.
 */
export { KB_MAX_QUERY_LENGTH };

export const kbSearchInput = z.strictObject({
  query: z
    .string()
    .trim()
    .min(1, "Enter a question to search for.")
    .max(KB_MAX_QUERY_LENGTH, `Questions are limited to ${KB_MAX_QUERY_LENGTH} characters.`)
    .describe("A customer-style question, as an agent would receive it."),
});

export type KbSearchInput = z.output<typeof kbSearchInput>;

export const kbDocumentId = z.uuid();
