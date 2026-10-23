/**
 * Geometry for the dashboard's SVG charts (M6 D10). Pure functions, unit-tested: the
 * components only turn these numbers into elements.
 */

/** The smallest "round" number (1, 2, 2.5 or 5 × a power of ten) at or above `max`; 1 for no data. */
export function niceMax(max: number): number {
  if (!Number.isFinite(max) || max <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(max));
  for (const step of [1, 2, 2.5, 5, 10]) {
    const candidate = step * power;
    // Rounded so 0.3 doesn't become 0.30000000000000004 and miss itself.
    if (Number(candidate.toPrecision(12)) >= max) return Number(candidate.toPrecision(12));
  }
  return 10 * power;
}

export interface Bar {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Vertical bars filling a `width` × `height` box, one slot per value, with `gap` (a share of a
 * slot, 0–1) between bars. A value above zero is never drawn thinner than `minHeight`, so a
 * day with one ticket is still visible next to a day with a hundred.
 */
export function barLayout(
  values: readonly number[],
  box: { width: number; height: number; gap?: number; minHeight?: number; max?: number },
): Bar[] {
  if (values.length === 0) return [];
  const top = box.max ?? niceMax(Math.max(...values));
  const slot = box.width / values.length;
  const gap = Math.min(Math.max(box.gap ?? 0.2, 0), 0.9);
  const width = slot * (1 - gap);
  const minHeight = box.minHeight ?? 0;
  return values.map((v, i) => {
    const raw = v > 0 ? (Math.min(v, top) / top) * box.height : 0;
    const height = v > 0 ? Math.max(raw, minHeight) : 0;
    return { x: i * slot + (slot - width) / 2, y: box.height - height, width, height };
  });
}

/** Clamps a 0–1 share to a position on a `length`-long axis. */
export function position(share: number, length: number): number {
  return Math.min(Math.max(share, 0), 1) * length;
}

/**
 * Points of a line through `values` (0–1 scale, null = no data) across a `width` × `height`
 * box, left to right. Gaps split the line, so a run with no data is never drawn as zero.
 */
export function lineSegments(
  values: readonly (number | null)[],
  box: { width: number; height: number },
): { x: number; y: number }[][] {
  const step = values.length > 1 ? box.width / (values.length - 1) : 0;
  const segments: { x: number; y: number }[][] = [];
  let current: { x: number; y: number }[] = [];
  values.forEach((v, i) => {
    if (v === null) {
      if (current.length) segments.push(current);
      current = [];
      return;
    }
    const x = values.length > 1 ? i * step : box.width / 2;
    current.push({ x, y: box.height - position(v, box.height) });
  });
  if (current.length) segments.push(current);
  return segments;
}
