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

/** Two versions scored on the same items: how often each was right where the other was wrong. */
export interface PairedComparison {
  /** Items both versions answered (an item missing from either side is left out). */
  n: number;
  bothRight: number;
  /** Right with A only (b) and with B only (c): the only items that tell the versions apart. */
  onlyA: number;
  onlyB: number;
  bothWrong: number;
  /** Two-sided exact McNemar p-value. */
  pValue: number;
}

/**
 * Two-sided exact McNemar test (M6 D6): comparing two prompts on the same tickets is a paired
 * design, so overlapping intervals of two separate rates would understate what the data shows.
 * Only the discordant items count; under "no difference" each is equally likely to favour either
 * version, so b ~ Binomial(b + c, 1/2) and p = min(1, 2 · P(X ≤ min(b, c))). The exact (binomial)
 * form is used for every count, as in Fay's exact2x2 vignette
 * (https://cran.r-project.org/web/packages/exact2x2/vignettes/exactMcNemar.pdf).
 */
export function mcnemarExact(onlyA: number, onlyB: number): number {
  if (!Number.isInteger(onlyA) || !Number.isInteger(onlyB) || onlyA < 0 || onlyB < 0) {
    throw new RangeError(`mcnemarExact needs non-negative integers (got ${onlyA}, ${onlyB})`);
  }
  const n = onlyA + onlyB;
  // 0.5^n underflows past about 1,074; evaluation sets are a few hundred items.
  if (n > 1000) throw new RangeError(`mcnemarExact supports up to 1000 discordant items (got ${n})`);
  if (n === 0) return 1;
  const k = Math.min(onlyA, onlyB);
  let term = 0.5 ** n; // P(X = 0)
  let tail = term;
  for (let i = 0; i < k; i++) {
    term = (term * (n - i)) / (i + 1); // P(X = i + 1)
    tail += term;
  }
  return Math.min(1, 2 * tail);
}

/** Pairs up per-item correctness (keyed by item) and runs the exact McNemar test. */
export function comparePaired(
  a: ReadonlyMap<string, boolean>,
  b: ReadonlyMap<string, boolean>,
): PairedComparison {
  const counts = { n: 0, bothRight: 0, onlyA: 0, onlyB: 0, bothWrong: 0 };
  for (const [key, rightA] of a) {
    const rightB = b.get(key);
    if (rightB === undefined) continue;
    counts.n++;
    if (rightA && rightB) counts.bothRight++;
    else if (rightA) counts.onlyA++;
    else if (rightB) counts.onlyB++;
    else counts.bothWrong++;
  }
  return { ...counts, pValue: mcnemarExact(counts.onlyA, counts.onlyB) };
}
