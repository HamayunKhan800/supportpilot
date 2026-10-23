/**
 * Colour maths for the design tokens: OKLCH -> sRGB, gamut checks and WCAG 2 contrast.
 *
 * OKLCH is the perceptually uniform colour space CSS Color 4 supports (`oklch()`); Tailwind 4
 * and shadcn/ui already use it. "Perceptually uniform" means two colours with the same L look
 * equally light, which is why a whole theme can be generated from a few inputs (the approach
 * Linear describes in "How we redesigned the Linear UI").
 *
 * Conversion matrices: Björn Ottosson, "A perceptual color space for image processing" (2020),
 * https://bottosson.github.io/posts/oklab/ (also used by CSS Color 4).
 * Relative luminance and contrast ratio: WCAG 2.2, https://www.w3.org/TR/WCAG22/#dfn-relative-luminance
 */

export type Oklch = { l: number; c: number; h: number; alpha?: number };

/** Linear-light sRGB channels (not gamma encoded); may fall outside 0..1 when out of gamut. */
export type LinearRgb = { r: number; g: number; b: number };

export function oklchToLinearSrgb({ l, c, h }: Oklch): LinearRgb {
  const rad = (h * Math.PI) / 180;
  const a = c * Math.cos(rad);
  const b = c * Math.sin(rad);
  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.291485548 * b;
  const L = l_ ** 3;
  const M = m_ ** 3;
  const S = s_ ** 3;
  return {
    r: 4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S,
    g: -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S,
    b: -0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S,
  };
}

/** True when the colour can be shown on a standard (sRGB) screen without clipping. */
export function inSrgbGamut(color: Oklch, tolerance = 0.002): boolean {
  const { r, g, b } = oklchToLinearSrgb(color);
  return [r, g, b].every((v) => v >= -tolerance && v <= 1 + tolerance);
}

/**
 * Brings a colour into the sRGB gamut by lowering its chroma while keeping lightness and hue,
 * the approach CSS Color 4 recommends for OKLCH gamut mapping. Binary search to 0.0005 chroma.
 */
export function fitGamut(color: Oklch): Oklch {
  if (inSrgbGamut(color, 0)) return color;
  let lo = 0;
  let hi = color.c;
  while (hi - lo > 0.0005) {
    const mid = (lo + hi) / 2;
    if (inSrgbGamut({ ...color, c: mid }, 0)) lo = mid;
    else hi = mid;
  }
  return { ...color, c: lo };
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** WCAG relative luminance (0 = black, 1 = white), clipping out-of-gamut channels like a browser would. */
export function relativeLuminance(color: Oklch): number {
  const { r, g, b } = oklchToLinearSrgb(color);
  return 0.2126 * clamp01(r) + 0.7152 * clamp01(g) + 0.0722 * clamp01(b);
}

/** Paints `top` (with its alpha) over an opaque `bottom`, in linear light, and returns the luminance. */
function compositeLuminance(top: Oklch, bottom: Oklch): number {
  const alpha = top.alpha ?? 1;
  if (alpha >= 1) return relativeLuminance(top);
  const t = oklchToLinearSrgb(top);
  const u = oklchToLinearSrgb(bottom);
  const mix = (x: number, y: number) => clamp01(x) * alpha + clamp01(y) * (1 - alpha);
  return 0.2126 * mix(t.r, u.r) + 0.7152 * mix(t.g, u.g) + 0.0722 * mix(t.b, u.b);
}

/**
 * WCAG 2 contrast ratio between a foreground and a background (1..21).
 * A translucent background is first painted over `base` (normally the page background).
 */
export function contrastRatio(fg: Oklch, bg: Oklch, base?: Oklch): number {
  const bgLum =
    bg.alpha !== undefined && bg.alpha < 1 && base ? compositeLuminance(bg, base) : relativeLuminance(bg);
  const fgLum = compositeLuminance(fg, bg);
  const [hi, lo] = fgLum > bgLum ? [fgLum, bgLum] : [bgLum, fgLum];
  return (hi + 0.05) / (lo + 0.05);
}

const round = (v: number, digits: number) => Number(v.toFixed(digits));

/** CSS `oklch()` string, rounded so the generated stylesheet stays readable and stable. */
export function toCss({ l, c, h, alpha }: Oklch): string {
  const base = `${round(l, 3)} ${round(c, 3)} ${round(h, 1)}`;
  return alpha === undefined || alpha >= 1 ? `oklch(${base})` : `oklch(${base} / ${round(alpha * 100, 1)}%)`;
}
