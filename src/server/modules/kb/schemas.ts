import { z } from "zod";

/**
 * Knowledge-base request schemas. No server imports, so forms can reuse them.
 */
export const KB_MAX_QUERY_LENGTH = 500;

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
