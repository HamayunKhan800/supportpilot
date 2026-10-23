/**
 * Uncertainty for evaluation rates (M6 D3). A rate measured on n items is only an estimate;
 * every reported rate carries a 95% Wilson score interval, the method the NIST/SEMATECH
 * e-Handbook (section 7.2.4.1) gives for a proportion and recommended over the simple normal
 * approximation for small n or rates near 0 or 1 (Brown, Cai & DasGupta 2001).
 */

/** z for a two-sided 95% interval. */
export const Z_95 = 1.959963984540054;

export interface Rate {
  successes: number;
  n: number;
  /** successes / n; null when n is 0. */
  rate: number | null;
  /** 95% Wilson interval; null when n is 0. */
  low: number | null;
  high: number | null;
}

export function wilson(successes: number, n: number, z = Z_95): Rate {
  if (!Number.isInteger(successes) || !Number.isInteger(n) || n < 0 || successes < 0 || successes > n) {
    throw new RangeError(`wilson needs integers with 0 <= successes <= n (got ${successes}/${n})`);
  }
  if (n === 0) return { successes, n, rate: null, low: null, high: null };
  const p = successes / n;
  const z2 = z * z;
  const centre = (p + z2 / (2 * n)) / (1 + z2 / n);
  const half = (z / (1 + z2 / n)) * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  // At 0/n the lower bound is exactly 0, and at n/n the upper bound is exactly 1; floating
  // point would give 0.9999999999999999 (caught by a unit test).
  const low = successes === 0 ? 0 : Math.max(0, centre - half);
  const high = successes === n ? 1 : Math.min(1, centre + half);
  return { successes, n, rate: p, low, high };
}

/** "88% (82–92%, n=150)"; "no data" when n is 0. */
export function formatRate(r: Rate, digits = 0): string {
  if (r.rate === null) return "no data";
  const num = (x: number) => (x * 100).toFixed(digits);
  return `${num(r.rate)}% (${num(r.low!)}–${num(r.high!)}%, n=${r.n})`;
}
