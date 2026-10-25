import { hashPassword as legacyHash } from "better-auth/crypto";
import { describe, expect, it } from "vitest";
import { hashPassword, needsRehash, verifyPassword } from "@/server/platform/auth/password";
import { passwordContextProblem, validateUserName } from "@/server/platform/auth/policy";

const PW = "correct horse battery staple";

describe("password hashing (M7-02)", () => {
  it("round-trips, salts every hash and rejects a wrong password", async () => {
    const [a, b] = [await hashPassword(PW), await hashPassword(PW)];
    expect(a).not.toBe(b);
    expect(await verifyPassword({ hash: a, password: PW })).toBe(true);
    expect(await verifyPassword({ hash: a, password: `${PW}!` })).toBe(false);
    expect(needsRehash(a)).toBe(false);
  });

  it("verifies pre-M7 library hashes and marks them for upgrade", async () => {
    const old = await legacyHash(PW);
    expect(await verifyPassword({ hash: old, password: PW })).toBe(true);
    expect(await verifyPassword({ hash: old, password: "nope nope nope nope" })).toBe(false);
    expect(needsRehash(old)).toBe(true);
  });

  it("normalises Unicode the same way as the library (NFKC)", async () => {
    const hash = await hashPassword("ｐａｓｓｗｏｒｄ long enough here");
    expect(await verifyPassword({ hash, password: "password long enough here" })).toBe(true);
  });

  it("refuses malformed hashes and settings that would use too much memory", async () => {
    const good = await hashPassword(PW);
    const [, , , salt, key] = good.split("$");
    expect(await verifyPassword({ hash: `$scrypt$n=4194304,r=8,p=1$${salt}$${key}`, password: PW })).toBe(
      false,
    );
    expect(await verifyPassword({ hash: `$scrypt$n=1000,r=8,p=1$${salt}$${key}`, password: PW })).toBe(false);
    expect(await verifyPassword({ hash: `$scrypt$n=16384,r=8,p=5$${salt}$abc`, password: PW })).toBe(false);
    expect(await verifyPassword({ hash: "$scrypt$garbage", password: PW })).toBe(false);
    expect(needsRehash(`$scrypt$n=16384,r=8,p=1$${salt}$${key}`)).toBe(true);
  });
});

describe("password context words (M7-08)", () => {
  it("catches the product name in any spacing or case", () => {
    for (const pw of ["SupportPilot rocks forever", "my support pilot pass", "x-support_pilot.x long"]) {
      expect(passwordContextProblem(pw)).not.toBeNull();
    }
  });
  it("catches the email name when it has at least 4 characters", () => {
    expect(passwordContextProblem("hello jordanlee 12345678", "jordan.lee@example.com")).not.toBeNull();
    expect(passwordContextProblem("abc is part of this long one", "abc@example.com")).toBeNull();
    expect(
      passwordContextProblem("nimbus demo passphrase for local only", "owner@demo.supportpilot.dev"),
    ).toBeNull();
  });
});

describe("display names (M7-22)", () => {
  it("accepts normal names and refuses empty, long or control-character names", () => {
    expect(validateUserName("Ayesha Khan")).toBeNull();
    expect(validateUserName("  ")).not.toBeNull();
    expect(validateUserName("x".repeat(101))).not.toBeNull();
    expect(validateUserName("a\u0007b")).not.toBeNull();
    expect(validateUserName(42)).not.toBeNull();
  });
});
