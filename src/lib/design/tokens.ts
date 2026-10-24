/**
 * SupportPilot design tokens, generated from a handful of inputs (docs/plans/design-system.md §4).
 *
 * - Every colour scale has 12 steps with fixed jobs, following Radix Colors' "Understanding the
 *   scale" (https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale):
 *   1–2 backgrounds, 3–5 component states (normal/hover/pressed), 6–8 borders and focus,
 *   9–10 solid fills, 11–12 text.
 * - Lightness and chroma come from per-step curves in OKLCH, so changing the brand hue re-themes
 *   the whole app consistently, the way Linear generates themes from a base, an accent and a
 *   contrast value instead of 98 hand-picked colours.
 * - The brand is ink: near-black in light mode and near-white in dark mode, on neutral greys with a
 *   barely-there cool tint. Colour is kept for meaning (status, charts, focus), as on Vercel's Geist
 *   and Linear's marketing site. It replaced the Iris accent on 2026-10-24: Iris sat at the same
 *   hue as Tailwind's indigo-600, the colour most associated with AI-generated sites
 *   (docs/plans/design-system.md, step 7).
 *
 * The stylesheet `src/app/theme.css` is generated from this file by `pnpm design:tokens`;
 * tests/unit/design-tokens.test.ts fails if it drifts or if any text/background pair used by the
 * UI misses its WCAG contrast target, in either theme.
 */
import { fitGamut, type Oklch, toCss } from "./color";

export type Mode = "light" | "dark";
export type Step = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;
export type Scale = Record<Step, Oklch>;

/** The brand: ink, a neutral with a trace of cool hue (zinc), chosen by the owner on 2026-10-24. */
export const BRAND = { hue: 286, chroma: 0.006 } as const;

/** Focus rings: a functional blue, so focus stays visible next to ink buttons (WCAG 2.4.7, 2.4.11). */
export const FOCUS = { hue: 255, chroma: 0.17 } as const;

/** Status hues (OKLCH degrees) and the chroma of their solid step. */
export const STATUS = {
  success: { hue: 152, chroma: 0.15 },
  warning: { hue: 72, chroma: 0.15 },
  danger: { hue: 27, chroma: 0.2 },
  info: { hue: 245, chroma: 0.15 },
} as const;
export type StatusName = keyof typeof STATUS;

const STEPS: Step[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

/** Lightness per step. Steps 9–10 (solid) are set per scale; these are the defaults. */
const LIGHTNESS: Record<Mode, readonly number[]> = {
  light: [0.993, 0.982, 0.962, 0.942, 0.92, 0.892, 0.85, 0.775, 0.54, 0.5, 0.47, 0.22],
  dark: [0.165, 0.195, 0.232, 0.266, 0.3, 0.338, 0.395, 0.48, 0.54, 0.5, 0.8, 0.95],
};

/** Chroma per step as a share of the scale's solid chroma (step 9 = 1). */
const CHROMA_SHARE: Record<Mode, readonly number[]> = {
  light: [0.02, 0.06, 0.15, 0.24, 0.33, 0.42, 0.53, 0.7, 1, 1, 0.85, 0.42],
  dark: [0.1, 0.15, 0.27, 0.36, 0.44, 0.52, 0.6, 0.72, 1, 1, 0.62, 0.2],
};

/** Neutral chroma per step: a trace of the brand hue, never enough to read as "coloured". */
const GRAY_CHROMA: Record<Mode, readonly number[]> = {
  light: [0.002, 0.003, 0.005, 0.006, 0.007, 0.008, 0.009, 0.011, 0.012, 0.012, 0.014, 0.016],
  dark: [0.005, 0.006, 0.008, 0.009, 0.01, 0.011, 0.012, 0.013, 0.014, 0.014, 0.012, 0.006],
};

type ScaleSpec = {
  hue: number;
  chroma: number;
  /** Lightness of the solid steps 9 and 10 (hover). */
  solid?: { light: [number, number]; dark: [number, number] };
};

function scale(mode: Mode, spec: ScaleSpec): Scale {
  const out = {} as Scale;
  for (const step of STEPS) {
    const i = step - 1;
    let l = LIGHTNESS[mode][i]!;
    if (spec.solid && (step === 9 || step === 10)) l = spec.solid[mode][step - 9]!;
    // Very light and very dark steps cannot hold much chroma on an sRGB screen: fit the gamut
    // so the colour on screen is exactly the colour the contrast tests measured.
    out[step] = fitGamut({ l, c: spec.chroma * CHROMA_SHARE[mode][i]!, h: spec.hue });
  }
  return out;
}

function grayScale(mode: Mode): Scale {
  const out = {} as Scale;
  for (const step of STEPS) {
    const i = step - 1;
    // Neutral solids are mid-grey (used for icons and placeholder-like fills, not text).
    const l =
      step === 9
        ? mode === "light"
          ? 0.62
          : 0.5
        : step === 10
          ? mode === "light"
            ? 0.57
            : 0.56
          : LIGHTNESS[mode][i]!;
    out[step] = { l, c: GRAY_CHROMA[mode][i]!, h: BRAND.hue };
  }
  return out;
}

/** Solid-step lightness per status: chosen so white (or, for warning, dark) text passes 4.5:1. */
const STATUS_SOLID: Record<StatusName, ScaleSpec["solid"]> = {
  success: { light: [0.5, 0.46], dark: [0.5, 0.46] },
  warning: { light: [0.8, 0.76], dark: [0.8, 0.84] },
  danger: { light: [0.53, 0.49], dark: [0.53, 0.49] },
  info: { light: [0.53, 0.49], dark: [0.53, 0.49] },
};

/**
 * Light mode: near-black ink that carries white text (hover lifts it slightly). Dark mode:
 * near-white that carries ink text. One colour can't do both jobs on both backgrounds, hence the
 * switch.
 */
const BRAND_SOLID: ScaleSpec["solid"] = { light: [0.22, 0.32], dark: [0.95, 0.86] };

export type Palette = {
  gray: Scale;
  brand: Scale;
  status: Record<StatusName, Scale>;
  chart: [Oklch, Oklch, Oklch, Oklch, Oklch];
};

export function palette(mode: Mode): Palette {
  const status = Object.fromEntries(
    (Object.keys(STATUS) as StatusName[]).map((name) => [
      name,
      scale(mode, { ...STATUS[name], solid: STATUS_SOLID[name] }),
    ]),
  ) as Record<StatusName, Scale>;
  // The first series is ink (the main measure); four hues spread around the wheel (teal, orange,
  // pink, green) for the rest. All reach 3:1 against the page (WCAG 1.4.11).
  const cl = mode === "light" ? 0.56 : 0.72;
  const chart: Palette["chart"] = [
    { l: mode === "light" ? 0.32 : 0.86, c: 0.01, h: BRAND.hue },
    { l: cl, c: 0.1, h: 195 },
    { l: cl, c: 0.15, h: 50 },
    { l: cl, c: 0.17, h: 350 },
    { l: cl, c: 0.14, h: 145 },
  ].map(fitGamut) as Palette["chart"];
  return { gray: grayScale(mode), brand: scale(mode, { ...BRAND, solid: BRAND_SOLID }), status, chart };
}

const WHITE: Oklch = { l: 1, c: 0, h: 0 };
const ON_LIGHT_BRAND: Oklch = { l: 0.2, c: 0.006, h: BRAND.hue };

/**
 * Semantic tokens: the shadcn/ui contract (https://ui.shadcn.com/docs/theming) plus status,
 * brand and hover tokens. Components only ever use these names, never raw scale steps.
 */
export function semanticTokens(mode: Mode): Record<string, Oklch> {
  const { gray, brand, status, chart } = palette(mode);
  const light = mode === "light";
  const tokens: Record<string, Oklch> = {
    background: gray[1],
    foreground: gray[12],
    card: light ? WHITE : gray[2],
    "card-foreground": gray[12],
    popover: light ? WHITE : gray[3],
    "popover-foreground": gray[12],
    primary: brand[9],
    "primary-hover": brand[10],
    "primary-foreground": light ? WHITE : ON_LIGHT_BRAND,
    secondary: gray[3],
    "secondary-foreground": gray[12],
    muted: gray[3],
    "muted-foreground": gray[11],
    accent: gray[4],
    "accent-foreground": gray[12],
    // Dark mode: a lighter red than danger-11, so the text still reaches 4.5:1 on the 15% hover tint.
    destructive: light ? status.danger[10] : fitGamut({ ...status.danger[11], l: 0.86 }),
    border: gray[6],
    // Input borders must reach 3:1 against the page (WCAG 1.4.11 non-text contrast).
    input: light ? { ...gray[8], l: 0.6 } : { ...gray[8], l: 0.56 },
    // Focus rings: functional blue, 3:1 against the page and distinct from ink buttons.
    ring: fitGamut({ l: light ? 0.55 : 0.72, c: FOCUS.chroma, h: FOCUS.hue }),
    "chart-1": chart[0],
    "chart-2": chart[1],
    "chart-3": chart[2],
    "chart-4": chart[3],
    "chart-5": chart[4],
    sidebar: gray[2],
    "sidebar-foreground": gray[12],
    "sidebar-primary": brand[9],
    "sidebar-primary-foreground": light ? WHITE : ON_LIGHT_BRAND,
    "sidebar-accent": gray[4],
    "sidebar-accent-foreground": gray[12],
    "sidebar-border": gray[6],
    "sidebar-ring": fitGamut({ l: light ? 0.55 : 0.72, c: FOCUS.chroma, h: FOCUS.hue }),
    // Brand tints: selected navigation, AI draft headers, citation chips. With an ink brand
    // these are quiet greys; the text step is full ink so selected items read clearly.
    // One step darker than the hover grey (accent = step 4), so selected stays distinct from hover.
    "brand-subtle": brand[5],
    "brand-border": brand[8],
    "brand-strong": brand[12],
  };
  for (const name of Object.keys(STATUS) as StatusName[]) {
    const s = status[name];
    tokens[name] = s[9];
    tokens[`${name}-foreground`] = name === "warning" ? { l: 0.25, c: 0.06, h: STATUS.warning.hue } : WHITE;
    tokens[`${name}-subtle`] = s[3];
    tokens[`${name}-border`] = s[7];
    tokens[`${name}-strong`] = s[11];
  }
  return tokens;
}

/**
 * Pairs the UI actually draws, with their WCAG target: 4.5:1 for text (1.4.3) and 3:1 for
 * component boundaries, focus rings and chart marks (1.4.11).
 * `bgAlpha` describes a translucent background painted over `background`.
 */
export type ContrastPair = { fg: string; bg: string; min: number; bgAlpha?: number };

export const CONTRAST_PAIRS: ContrastPair[] = [
  ...["background", "card", "popover", "muted", "secondary", "accent", "sidebar"].map((bg) => ({
    fg: "foreground",
    bg,
    min: 4.5,
  })),
  ...["background", "card", "muted", "sidebar", "accent"].map((bg) => ({
    fg: "muted-foreground",
    bg,
    min: 4.5,
  })),
  { fg: "primary-foreground", bg: "primary", min: 4.5 },
  { fg: "primary-foreground", bg: "primary-hover", min: 4.5 },
  { fg: "primary", bg: "background", min: 4.5 }, // link buttons
  { fg: "primary", bg: "card", min: 4.5 },
  { fg: "sidebar-primary-foreground", bg: "sidebar-primary", min: 4.5 },
  { fg: "sidebar-accent-foreground", bg: "sidebar-accent", min: 4.5 },
  { fg: "destructive", bg: "background", min: 4.5 },
  { fg: "destructive", bg: "card", min: 4.5 },
  { fg: "destructive", bg: "destructive", bgAlpha: 0.1, min: 4.5 }, // destructive button and badge
  { fg: "destructive", bg: "destructive", bgAlpha: 0.15, min: 4.5 }, // ...on hover
  { fg: "foreground", bg: "input", bgAlpha: 0.3, min: 4.5 }, // text in a dark-mode field
  { fg: "muted-foreground", bg: "input", bgAlpha: 0.3, min: 4.5 }, // placeholder in a dark-mode field
  { fg: "brand-strong", bg: "brand-subtle", min: 4.5 },
  { fg: "brand-strong", bg: "background", min: 4.5 },
  ...(Object.keys(STATUS) as StatusName[]).flatMap((name) => [
    { fg: `${name}-strong`, bg: `${name}-subtle`, min: 4.5 },
    { fg: `${name}-strong`, bg: "background", min: 4.5 },
    { fg: `${name}-strong`, bg: "card", min: 4.5 },
    { fg: `${name}-foreground`, bg: name, min: 4.5 },
    // Status dots and icons use the -strong step (amber cannot reach 3:1 on white as a solid,
    // the same reason GitHub Primer draws attention icons in a dark amber).
    { fg: `${name}-strong`, bg: "sidebar", min: 3 },
  ]),
  { fg: "input", bg: "background", min: 3 },
  { fg: "input", bg: "card", min: 3 },
  { fg: "ring", bg: "background", min: 3 },
  { fg: "ring", bg: "card", min: 3 },
  ...[1, 2, 3, 4, 5].flatMap((n) => [
    { fg: `chart-${n}`, bg: "background", min: 3 },
    { fg: `chart-${n}`, bg: "card", min: 3 },
  ]),
];

const HEADER = `/*
 * GENERATED by \`pnpm design:tokens\` from src/lib/design/tokens.ts. Do not edit by hand:
 * tests/unit/design-tokens.test.ts fails when this file and the generator disagree.
 *
 * Light is the default. Dark applies when the user picks it (data-theme="dark" on <html>,
 * set server-side from the sp_theme cookie) or, with no explicit choice, when the device
 * prefers dark. No script runs before paint, so there is no flash and the CSP stays strict.
 */`;

function block(selector: string, mode: Mode, indent = ""): string {
  const lines = Object.entries(semanticTokens(mode)).map(
    ([name, value]) => `${indent}  --${name}: ${toCss(value)};`,
  );
  return `${indent}${selector} {\n${indent}  color-scheme: ${mode};\n${lines.join("\n")}\n${indent}}`;
}

/** The complete generated stylesheet. */
export function themeCss(): string {
  return (
    [
      HEADER,
      block(':root,\n[data-theme="light"]', "light"),
      block('[data-theme="dark"]', "dark"),
      `@media (prefers-color-scheme: dark) {\n${block(':root:not([data-theme="light"])', "dark", "  ")}\n}`,
    ].join("\n\n") + "\n"
  );
}
