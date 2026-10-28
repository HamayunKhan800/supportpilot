import { ChevronRight } from "lucide-react";
import { TableScroll } from "@/components/table-scroll";
import { formatCount } from "@/lib/format";
import type { EvalMissRow } from "@/server/modules/analytics/service";
import { missGroups } from "@/server/modules/eval/misses-view";
import { Block, td, th } from "./report-parts";

/**
 * Every item the run above got wrong, grouped by test set and folded (native <details>, so it
 * works without JavaScript): the ticket or question, what was expected and what the AI did.
 */
export function Misses({ rows }: { rows: readonly EvalMissRow[] }) {
  const groups = missGroups(rows);
  return (
    <Block
      id="misses"
      title="What it got wrong"
      description="Each item the run above measured as wrong, from the fixed synthetic test sets. Provider errors are not wrong answers and are left out."
      bodyClassName="flex flex-col gap-2"
    >
      {groups.length === 0 ? (
        <p className="text-muted-foreground text-sm">Nothing: every measured item passed.</p>
      ) : (
        groups.map((g) => (
          <details key={g.suite} className="group/miss rounded-lg border">
            <summary className="hover:bg-muted/50 focus-visible:ring-ring flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-lg px-3 text-sm font-medium outline-none focus-visible:ring-2 [&::-webkit-details-marker]:hidden">
              <ChevronRight
                aria-hidden="true"
                className="text-muted-foreground size-4 shrink-0 transition-transform duration-150 ease-out group-open/miss:rotate-90 motion-reduce:transition-none"
              />
              <span className="flex-1">{g.title}</span>
              <span className="text-muted-foreground tabular-nums">
                {formatCount(g.items.length + g.unreadable)}
              </span>
            </summary>
            <div className="border-t">
              <TableScroll label={g.title} className="rounded-none border-0">
                <table className="w-full text-sm">
                  <caption className="sr-only">{g.title}</caption>
                  <thead className="bg-muted/50 text-left">
                    <tr>
                      <th scope="col" className={th}>
                        Item
                      </th>
                      <th scope="col" className={th}>
                        Expected
                      </th>
                      <th scope="col" className={th}>
                        What the AI did
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.items.map((m) => (
                      <tr key={m.key} className="border-t align-top">
                        <th scope="row" className={`${td} min-w-56 text-left font-normal`}>
                          {m.what}
                          <span className="text-muted-foreground block font-mono text-xs">{m.key}</span>
                        </th>
                        <td className={`${td} min-w-40`}>{m.expected}</td>
                        <td className={`${td} min-w-48`}>{m.got}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScroll>
              {g.unreadable > 0 && (
                <p className="text-muted-foreground border-t px-3 py-2 text-xs">
                  {g.unreadable} more saved in an older format that this page can&apos;t read.
                </p>
              )}
            </div>
          </details>
        ))
      )}
    </Block>
  );
}
