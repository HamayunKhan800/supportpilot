import { LANDING_METRICS, type LandingMetric } from "@/lib/landing";
import { cn } from "@/lib/utils";

/** "95.0–99.8%" → [95, 99.8]; "≥ 90%" / "≤ 10%" / "100%" → 90 / 10 / 100. */
function pct(s: string): number {
  return Number.parseFloat(s.replace(/[^\d.]/g, ""));
}
function range(s: string): [number, number] {
  const [lo, hi] = s.split("–");
  return [pct(lo ?? "0"), pct(hi ?? lo ?? "0")];
}

/**
 * A static range bar on a true 0–100% scale (no zoom that would exaggerate differences): the
 * shaded band is the 95% interval, the solid mark the result, the tick the target. Decorative;
 * the same numbers are in the table cells next to it.
 */
function RangeBar({ m }: { m: LandingMetric }) {
  const c = rangeBarClasses(m);
  return (
    <span aria-hidden="true" className="relative block h-5 w-full min-w-28">
      <span className="bg-muted absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full" />
      <span
        className={cn(
          "bg-foreground/25 absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full",
          c.band,
          c.width,
        )}
      />
      <span
        className={cn("bg-foreground absolute top-0.5 h-4 w-0.5 -translate-x-1/2 rounded-full", c.result)}
      />
      <span
        className={cn(
          "border-muted-foreground absolute top-0 h-5 -translate-x-1/2 border-l border-dashed",
          c.target,
        )}
      />
    </span>
  );
}

/**
 * The position classes for one metric's bar, by whole percent. Undefined means the table below
 * lacks a class for a new number (tests/unit/landing-eval.test.ts fails then).
 */
export function rangeBarClasses(m: LandingMetric) {
  const [lo, hi] = range(m.range);
  return {
    band: LEFT[Math.round(lo)],
    width: WIDTH[Math.max(1, Math.round(hi - lo))],
    result: LEFT[Math.round(pct(m.result))],
    target: LEFT[Math.round(pct(m.target))],
  };
}

/*
 * Every left/width class the six metrics can use, written out in full so Tailwind generates them
 * (class names built at run time are invisible to it). Indexed by whole percent.
 */
const LEFT: Record<number, string> = {
  0: "left-[0%]",
  1: "left-[1%]",
  2: "left-[2%]",
  6: "left-[6%]",
  10: "left-[10%]",
  84: "left-[84%]",
  85: "left-[85%]",
  89: "left-[89%]",
  90: "left-[90%]",
  94: "left-[94%]",
  95: "left-[95%]",
  97: "left-[97%]",
  99: "left-[99%]",
  100: "left-[100%]",
};
const WIDTH: Record<number, string> = {
  1: "w-[1%]",
  3: "w-[3%]",
  5: "w-[5%]",
  6: "w-[6%]",
  8: "w-[8%]",
  11: "w-[11%]",
  16: "w-[16%]",
};

export function EvalResults() {
  return (
    <>
      {/* Phones: one block per measure, so nothing scrolls sideways. */}
      <ul className="bg-card divide-y rounded-2xl border md:hidden">
        {LANDING_METRICS.map((m) => (
          <li key={m.label} className="flex flex-col gap-2.5 p-4">
            <span className="flex items-baseline justify-between gap-4">
              <span className="text-sm">{m.label}</span>
              <span className="text-lg font-semibold tracking-tight tabular-nums">{m.result}</span>
            </span>
            <RangeBar m={m} />
            <span className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs tabular-nums">
              <span>95% range {m.range}</span>
              <span>Target {m.target}</span>
              <span>{m.n}</span>
            </span>
          </li>
        ))}
      </ul>
      <EvalTable />
    </>
  );
}

function EvalTable() {
  return (
    <div
      role="region"
      aria-labelledby="evaluation-heading"
      tabIndex={0}
      className="focus-visible:ring-ring bg-card hidden overflow-x-auto rounded-2xl border outline-none focus-visible:ring-2 md:block"
    >
      <table className="w-full min-w-[46rem] text-sm">
        <caption className="sr-only">
          Evaluation results with 95% confidence intervals, targets and sample sizes
        </caption>
        <thead className="text-muted-foreground text-left text-xs">
          <tr className="border-b">
            <th scope="col" className="px-5 py-3 font-medium">
              Measure
            </th>
            <th scope="col" className="px-3 py-3 text-right font-medium">
              Result
            </th>
            <th scope="col" className="w-[26%] px-3 py-3 font-medium">
              <span className="sr-only">Chart of the </span>Range on a 0–100% scale
            </th>
            <th scope="col" className="px-3 py-3 text-right font-medium">
              95% range
            </th>
            <th scope="col" className="px-3 py-3 text-right font-medium">
              Target
            </th>
            <th scope="col" className="px-5 py-3 text-right font-medium">
              Measured on
            </th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {LANDING_METRICS.map((m) => (
            <tr key={m.label} className="hover:bg-muted/40 transition-colors">
              <th scope="row" className="px-5 py-4 text-left font-normal">
                {m.label}
              </th>
              <td className="px-3 py-4 text-right text-base font-semibold tracking-tight tabular-nums">
                {m.result}
              </td>
              <td className="px-3 py-4">
                <RangeBar m={m} />
              </td>
              <td className="text-muted-foreground px-3 py-4 text-right tabular-nums">{m.range}</td>
              <td className="text-muted-foreground px-3 py-4 text-right tabular-nums">{m.target}</td>
              <td className="text-muted-foreground px-5 py-4 text-right whitespace-nowrap tabular-nums">
                {m.n}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
