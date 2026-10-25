import { describe, expect, it, vi } from "vitest";

import { DEMO_LOCKED_PATHS, isDemoEmail, skipDemoRecipients } from "@/server/platform/auth/demo";
import type { EmailSender } from "@/server/platform/email";
import { parseEnv } from "@/server/platform/env";

describe("demo accounts (plan M8 step 2)", () => {
  it("recognises the demo domain exactly, case-insensitively", () => {
    expect(isDemoEmail("owner@demo.example.com", "demo.example.com")).toBe(true);
    expect(isDemoEmail("Owner@DEMO.example.com", "demo.example.com")).toBe(true);
    expect(isDemoEmail("owner@example.com", "demo.example.com")).toBe(false);
    expect(isDemoEmail("owner@evil-demo.example.com", "demo.example.com")).toBe(false);
    expect(isDemoEmail("owner@demo.example.com.evil.test", "demo.example.com")).toBe(false);
    expect(isDemoEmail("demo.example.com", "demo.example.com")).toBe(false);
    expect(isDemoEmail(undefined, "demo.example.com")).toBe(false);
  });

  it("drops email to demo addresses and passes everything else on", async () => {
    const send = vi.fn<EmailSender["send"]>().mockResolvedValue();
    const sender = skipDemoRecipients({ send }, "demo.example.com");
    await sender.send({ to: "owner@demo.example.com", subject: "s", text: "t" });
    expect(send).not.toHaveBeenCalled();
    await sender.send({ to: "person@example.com", subject: "s", text: "t" });
    expect(send).toHaveBeenCalledOnce();
  });

  it("locks the account and membership endpoints, not signing in or out", () => {
    for (const p of ["/change-password", "/revoke-sessions", "/organization/invite-member", "/link-social"]) {
      expect(DEMO_LOCKED_PATHS.has(p), p).toBe(true);
    }
    for (const p of ["/sign-in/email", "/sign-out", "/get-session", "/organization/set-active"]) {
      expect(DEMO_LOCKED_PATHS.has(p), p).toBe(false);
    }
  });

  it("DEMO_EMAIL_DOMAIN defaults to the seed's domain and must be a domain name", () => {
    const base = {
      DATABASE_URL: "postgres://u:p@localhost:5432/db",
      BETTER_AUTH_SECRET: "x".repeat(32),
      BETTER_AUTH_URL: "http://localhost:3000",
    };
    expect(parseEnv(base).DEMO_EMAIL_DOMAIN).toBe("demo.supportpilot.dev");
    expect(parseEnv({ ...base, DEMO_EMAIL_DOMAIN: " Demo.Example.com " }).DEMO_EMAIL_DOMAIN).toBe(
      "demo.example.com",
    );
    for (const bad of ["@demo.example.com", "localhost", "demo example.com", "https://demo.example.com"]) {
      expect(() => parseEnv({ ...base, DEMO_EMAIL_DOMAIN: bad }), bad).toThrow(/DEMO_EMAIL_DOMAIN/);
    }
  });
});
