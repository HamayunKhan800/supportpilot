import { describe, expect, it } from "vitest";
import { pgConnectionConfig, wantsChannelBinding } from "@/server/platform/db/connection";

describe("pgConnectionConfig", () => {
  const neon =
    "postgresql://app:secret@ep-x-pooler.ap-southeast-2.aws.neon.tech/neondb?sslmode=verify-full&channel_binding=require";

  it("turns channel binding on when the address requires it (node-postgres ignores the parameter)", () => {
    expect(pgConnectionConfig(neon)).toEqual({ connectionString: neon, enableChannelBinding: true });
  });

  it("leaves it off for addresses without it, such as local development and CI", () => {
    const local = "postgresql://supportpilot:supportpilot@localhost:5432/supportpilot";
    expect(pgConnectionConfig(local)).toEqual({ connectionString: local });
    expect(wantsChannelBinding(`${local}?channel_binding=prefer`)).toBe(false);
    expect(wantsChannelBinding(`${local}?channel_binding=disable`)).toBe(false);
  });

  it("treats an unparseable address as not asking for it", () => {
    expect(wantsChannelBinding("not a url")).toBe(false);
  });
});
