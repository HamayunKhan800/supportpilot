/**
 * A short, readable device name from a User-Agent string ("Chrome on Android"), for the
 * account's session list. Best effort and display-only: User-Agent is client-supplied.
 */
export interface DeviceInfo {
  label: string;
  mobile: boolean;
}

const BROWSERS: [RegExp, string][] = [
  [/Edg(A|iOS)?\//, "Edge"],
  [/SamsungBrowser\//, "Samsung Internet"],
  [/OPR\//, "Opera"],
  [/Firefox\/|FxiOS\//, "Firefox"],
  [/Chrome\/|CriOS\//, "Chrome"],
  [/Safari\//, "Safari"],
];

const SYSTEMS: [RegExp, string][] = [
  [/Android/, "Android"],
  [/iPhone|iPad|iPod/, "iOS"],
  [/Windows/, "Windows"],
  [/Mac OS X|Macintosh/, "macOS"],
  [/CrOS/, "ChromeOS"],
  [/Linux/, "Linux"],
];

export function describeDevice(userAgent: string | null | undefined): DeviceInfo {
  const ua = userAgent ?? "";
  const browser = BROWSERS.find(([re]) => re.test(ua))?.[1];
  const system = SYSTEMS.find(([re]) => re.test(ua))?.[1];
  const mobile = /Mobi|Android|iPhone|iPad|iPod/.test(ua);
  if (browser && system) return { label: `${browser} on ${system}`, mobile };
  return { label: browser ?? system ?? "Unknown device", mobile };
}
