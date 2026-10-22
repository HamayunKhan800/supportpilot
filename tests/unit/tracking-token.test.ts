import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  generateTrackingToken,
  hashTrackingToken,
  TOKEN_BYTES,
} from "@/server/modules/tickets/tracking-token";

describe("tracking tokens (T6)", () => {
  it("carry 256 bits of randomness in URL-safe form", () => {
    const { token } = generateTrackingToken();
    expect(TOKEN_BYTES * 8).toBe(256);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
  });

  it("are unique", () => {
    const tokens = new Set(Array.from({ length: 1000 }, () => generateTrackingToken().token));
    expect(tokens.size).toBe(1000);
  });

  it("store only a SHA-256 hash that never contains the token", () => {
    const { token, hash } = generateTrackingToken();
    expect(hash).toBe(createHash("sha256").update(token).digest("base64url"));
    expect(hash).not.toContain(token);
    expect(hashTrackingToken(token)).toBe(hash);
  });

  it("reject anything that can't be a token before it reaches the database", () => {
    for (const bad of [
      "",
      "short",
      "a".repeat(44),
      `${"a".repeat(42)}=`,
      `${"a".repeat(42)}/`,
      "' OR 1=1 --",
    ]) {
      expect(hashTrackingToken(bad)).toBeNull();
    }
  });
});
