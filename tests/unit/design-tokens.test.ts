import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { contrastRatio, inSrgbGamut, oklchToLinearSrgb, relativeLuminance, toCss } from "@/lib/design/color";
import { CONTRAST_PAIRS, type Mode, palette, semanticTokens, themeCss } from "@/lib/design/tokens";

const MODES: Mode[] = ["light", "dark"];

describe("colour maths", () => {
  it("converts reference OKLCH colours to sRGB", () => {
    // White, black and pure sRGB red (Ottosson's reference: oklch(0.628 0.2577 29.23)).
    const white = oklchToLinearSrgb({ l: 1, c: 0, h: 0 });
    expect(white.r).toBeCloseTo(1, 3);
    expect(white.g).toBeCloseTo(1, 3);
    expect(white.b).toBeCloseTo(1, 3);
    const red = oklchToLinearSrgb({ l: 0.62796, c: 0.25768, h: 29.234 });
    expect(red.r).toBeCloseTo(1, 2);
    expect(red.g).toBeCloseTo(0, 2);
    expect(red.b).toBeCloseTo(0, 2);
  });

  it("computes WCAG contrast like the specification", () => {
    const white = { l: 1, c: 0, h: 0 };
    const black = { l: 0, c: 0, h: 0 };
    expect(relativeLuminance(white)).toBeCloseTo(1, 3);
    expect(contrastRatio(black, white)).toBeCloseTo(21, 1);
    expect(contrastRatio(white, white)).toBeCloseTo(1, 5);
    // #767676 is the classic lightest grey that passes 4.5:1 on white (4.54:1).
    // Its OKLCH lightness is about 0.5659.
    expect(contrastRatio({ l: 0.5659, c: 0, h: 0 }, white)).toBeCloseTo(4.54, 1);
  });

  it("composites a translucent background over the page before measuring", () => {
    const white = { l: 1, c: 0, h: 0 };
    const black = { l: 0, c: 0, h: 0 };
    // Black text on 0% black over white is just black on white.
    expect(contrastRatio(black, { ...black, alpha: 0 }, white)).toBeCloseTo(21, 1);
    expect(contrastRatio(black, { ...black, alpha: 0.5 }, white)).toBeLessThan(21);
  });

  it("detects colours outside the sRGB gamut", () => {
    expect(inSrgbGamut({ l: 0.6, c: 0.05, h: 250 })).toBe(true);
    expect(inSrgbGamut({ l: 0.9, c: 0.35, h: 140 })).toBe(false);
  });

  it("prints compact CSS", () => {
    expect(toCss({ l: 0.5234, c: 0.19876, h: 277.04 })).toBe("oklch(0.523 0.199 277)");
    expect(toCss({ l: 1, c: 0, h: 0, alpha: 0.1 })).toBe("oklch(1 0 0 / 10%)");
  });
});

describe.each(MODES)("%s theme", (mode) => {
  const tokens = semanticTokens(mode);

  it.each(
    CONTRAST_PAIRS.map((p) => [`${p.fg} on ${p.bg}${p.bgAlpha ? ` @${p.bgAlpha * 100}%` : ""}`, p] as const),
  )("%s meets its WCAG target", (_label, pair) => {
    const fg = tokens[pair.fg];
    const bg = tokens[pair.bg];
    expect(fg, `missing token ${pair.fg}`).toBeDefined();
    expect(bg, `missing token ${pair.bg}`).toBeDefined();
    const background = pair.bgAlpha ? { ...bg!, alpha: pair.bgAlpha } : bg!;
    const ratio = contrastRatio(fg!, background, tokens.background);
    expect(
      ratio,
      `${pair.fg} on ${pair.bg}: ${ratio.toFixed(2)}:1, needs ${pair.min}:1`,
    ).toBeGreaterThanOrEqual(pair.min);
  });

  it("keeps every token inside the sRGB gamut, so screens show the colour we tested", () => {
    const outside = Object.entries(tokens)
      .filter(([, v]) => !inSrgbGamut(v))
      .map(([k, v]) => `${k} ${toCss(v)}`);
    expect(outside).toEqual([]);
  });

  it("orders each scale from background to text", () => {
    const { gray, brand } = palette(mode);
    for (const scale of [gray, brand]) {
      const bg = [1, 2, 3, 4, 5, 6, 7, 8] as const;
      const ls = bg.map((s) => scale[s].l);
      const sorted = [...ls].sort((a, b) => (mode === "light" ? b - a : a - b));
      expect(ls).toEqual(sorted);
    }
  });
});

describe("generated stylesheet", () => {
  it("matches the generator (run `pnpm design:tokens` after changing tokens.ts)", () => {
    const file = readFileSync(resolve(import.meta.dirname, "../../src/app/theme.css"), "utf8");
    expect(file).toBe(themeCss());
  });

  it("covers light, explicit dark and device-preferred dark", () => {
    const css = themeCss();
    expect(css).toContain(':root,\n[data-theme="light"] {');
    expect(css).toContain('[data-theme="dark"] {');
    expect(css).toContain('@media (prefers-color-scheme: dark) {\n  :root:not([data-theme="light"]) {');
    expect(css.match(/color-scheme: dark;/g)).toHaveLength(2);
  });

  it("defines every token the shadcn components use", () => {
    const names = Object.keys(semanticTokens("light"));
    for (const required of [
      "background",
      "foreground",
      "card",
      "popover",
      "primary",
      "primary-foreground",
      "secondary",
      "muted",
      "muted-foreground",
      "accent",
      "destructive",
      "border",
      "input",
      "ring",
      "chart-1",
      "chart-5",
      "sidebar",
      "sidebar-primary",
      "sidebar-accent",
      "sidebar-border",
      "sidebar-ring",
    ]) {
      expect(names).toContain(required);
    }
    expect(Object.keys(semanticTokens("dark")).sort()).toEqual([...names].sort());
  });
});

describe("source code", () => {
  // Raw Tailwind palette colours (bg-amber-50, text-red-800, …) bypass the tokens: they are not
  // contrast-tested and do not switch with the theme. Status, brand and neutral tokens cover
  // every case (bg-warning-subtle, text-danger-strong, text-muted-foreground, …).
  const RAW_PALETTE =
    /(?<![\w-])(?:[a-z-]+:)*(?:text|bg|border(?:-[lrtbxyse])?|ring(?:-offset)?|fill|stroke|outline|divide|from|via|to|decoration|shadow|inset-shadow|accent|caret|placeholder)-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone|white|black)(?:-\d{2,3})?(?:\/\d+)?(?![\w-])/g;

  function files(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? files(join(dir, e.name)) : /\.(tsx?|css)$/.test(e.name) ? [join(dir, e.name)] : [],
    );
  }

  it("the raw-palette guard catches side and state variants, not tokens", () => {
    const hits = (text: string) => [...text.matchAll(RAW_PALETTE)].map((m) => m[0]);
    expect(hits("border-l-4 border-l-blue-700")).toEqual(["border-l-blue-700"]);
    expect(hits("hover:border-t-slate-200 dark:ring-offset-black")).toEqual([
      "hover:border-t-slate-200",
      "dark:ring-offset-black",
    ]);
    expect(hits("bg-white/80 text-red-600")).toEqual(["bg-white/80", "text-red-600"]);
    expect(hits("border-l-brand-strong border-x bg-warning-subtle text-muted-foreground")).toEqual([]);
  });

  it("uses design tokens instead of raw palette colours", () => {
    const root = resolve(import.meta.dirname, "../../src");
    const hits = files(root).flatMap((file) =>
      [...readFileSync(file, "utf8").matchAll(RAW_PALETTE)].map(
        (m) => `${file.slice(root.length + 1)}: ${m[0]}`,
      ),
    );
    expect(hits).toEqual([]);
  });
});
