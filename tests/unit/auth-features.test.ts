import { describe, expect, it } from "vitest";
import { socialErrorMessage } from "@/app/(auth)/social-errors";
import { getAuthFeatures } from "@/server/platform/auth/features";

describe("getAuthFeatures", () => {
  it("offers nothing extra by default", () => {
    expect(getAuthFeatures({})).toEqual({ email: false, socialProviders: [] });
  });

  it("shows a provider only when both its keys are set, Google first", () => {
    expect(
      getAuthFeatures({
        GITHUB_CLIENT_ID: "g",
        GITHUB_CLIENT_SECRET: "s",
        GOOGLE_CLIENT_ID: "g",
        GOOGLE_CLIENT_SECRET: "s",
        EMAIL_PROVIDER: "outbox",
      }),
    ).toEqual({ email: true, socialProviders: ["google", "github"] });
    expect(getAuthFeatures({ GOOGLE_CLIENT_ID: "g" }).socialProviders).toEqual([]);
  });
});

describe("socialErrorMessage", () => {
  it("maps known provider errors to fixed text", () => {
    expect(socialErrorMessage("account_not_linked")).toContain("already exists");
    expect(socialErrorMessage("access_denied")).toBe("Sign-in was cancelled.");
  });

  it("never echoes the code from the URL, and ignores missing or odd values", () => {
    const injected = "<b>Call 555 now</b>";
    expect(socialErrorMessage(injected)).not.toContain("555");
    expect(socialErrorMessage("toString")).not.toContain("function");
    expect(socialErrorMessage(undefined)).toBe("");
    expect(socialErrorMessage(["account_not_linked"])).toBe("");
  });
});
