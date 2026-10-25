/**
 * Removes NUL characters. PostgreSQL rejects \0 in text, so one left in would turn a bad
 * input into a 500 instead of being stored or refused cleanly (M7-19).
 */
export function stripNul(s: string): string {
  return s.replace(/\u0000/g, "");
}

/** Copies a parsed JSON value with NUL removed from every string, keys included. */
export function stripNulDeep(value: unknown): unknown {
  if (typeof value === "string") return stripNul(value);
  if (Array.isArray(value)) return value.map(stripNulDeep);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [stripNul(k), stripNulDeep(v)]));
  }
  return value;
}
