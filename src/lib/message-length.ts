/**
 * Ticket messages above either limit start collapsed on the agent's ticket page, with a "Show full
 * message" button: a pasted log (customers may send up to 10,000 characters) otherwise pushes the
 * draft and reply box many screens down. Found by the worst-case data review (2026-10-28).
 */
export const LONG_MESSAGE = { lines: 12, chars: 1200 } as const;

export function isLongMessage(body: string): boolean {
  return body.length > LONG_MESSAGE.chars || body.split("\n").length > LONG_MESSAGE.lines;
}
