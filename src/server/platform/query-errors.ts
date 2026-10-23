/**
 * Query values out of error text (M6 step 4, finding #122).
 *
 * A failed Drizzle query throws `DrizzleQueryError`, whose message is
 * `Failed query: <sql>\nparams: <values>`. The values are whatever the query carried: a
 * customer's message, an email address, article text. The message is also the first line of the
 * stack, and both are logged and sent to the error tracker. Postgres does the same for a value it
 * can't convert: `invalid input syntax for type integer: "<value>"`.
 *
 * The SQL text is kept (it uses `$1` placeholders and says which query failed); the values are
 * replaced. Used by the logger's `err` serializer and the Sentry scrubber.
 */

export const REDACTED_VALUE = "[redacted]";

// Drizzle puts the values last, so everything after "\nparams: " in a message is values, even if a
// value itself contains new lines.
const DRIZZLE_PARAMS_TO_END = /(\nparams: )[\s\S]*$/;
// In a stack the frames follow the message; used only when the original message isn't known.
const DRIZZLE_PARAMS_IN_STACK = /(\nparams: )[\s\S]*?(?=\n\s+at |$)/;
// Postgres conversion errors quote the value, doubling any quote inside it.
const PG_QUOTED_INPUT = /(invalid input (?:syntax|value) for (?:type|enum) [^:\n]{1,80}: )"(?:[^"]|"")*"/g;

export function redactQueryValues(message: string): string {
  return message
    .replace(DRIZZLE_PARAMS_TO_END, (_m, lead: string) => `${lead}${REDACTED_VALUE}`)
    .replace(PG_QUOTED_INPUT, (_m, lead: string) => `${lead}"${REDACTED_VALUE}"`);
}

/** A stack starts with `<name>: <message>`; when the message is known it is replaced exactly. */
export function redactStack(stack: string, message?: string): string {
  if (message && stack.includes(message)) {
    // A function replacement, so `$&` or `$1` inside a value is not treated as a pattern.
    return stack.replace(message, () => redactQueryValues(message));
  }
  return stack
    .replace(DRIZZLE_PARAMS_IN_STACK, (_m, lead: string) => `${lead}${REDACTED_VALUE}`)
    .replace(PG_QUOTED_INPUT, (_m, lead: string) => `${lead}"${REDACTED_VALUE}"`);
}

/**
 * Pino serializer for the `err` key. Every error log in the app passes an Error or a plain
 * `{ name?, message, stack? }` object there; Drizzle's `params` and `query` fields are dropped.
 */
export function serializeErrorForLog(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  const source = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  if (value instanceof Error) {
    out.type = value.constructor.name;
    out.name = value.name;
  }
  for (const [key, field] of Object.entries(source)) {
    if (key === "params" || key === "query" || key === "cause") continue;
    out[key] = field;
  }
  const message = value instanceof Error ? value.message : source.message;
  const stack = value instanceof Error ? value.stack : source.stack;
  if (typeof message === "string") out.message = redactQueryValues(message);
  if (typeof stack === "string")
    out.stack = redactStack(stack, typeof message === "string" ? message : undefined);
  return out;
}
