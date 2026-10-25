import { describe, expect, it } from "vitest";
import { describeDevice } from "@/lib/user-agent";

describe("describeDevice", () => {
  it.each([
    [
      "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36",
      "Chrome on Android",
      true,
    ],
    [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
      "Safari on iOS",
      true,
    ],
    [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0",
      "Edge on Windows",
      false,
    ],
    [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:131.0) Gecko/20100101 Firefox/131.0",
      "Firefox on macOS",
      false,
    ],
    [
      "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36",
      "Samsung Internet on Android",
      true,
    ],
  ])("%s", (ua, label, mobile) => {
    expect(describeDevice(ua)).toEqual({ label, mobile });
  });

  it("falls back for missing or unknown agents", () => {
    expect(describeDevice(null).label).toBe("Unknown device");
    expect(describeDevice("curl/8.5.0").label).toBe("Unknown device");
  });
});
