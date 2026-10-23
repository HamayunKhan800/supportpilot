import type { Metadata } from "next";
import { headers } from "next/headers";
import { BarChart } from "@/components/charts/bar-chart";
import { Forbidden } from "@/components/forbidden";
import { TableScroll } from "@/components/table-scroll";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  formatCount,
  formatDay,
  formatMicros,
  formatMs,
  formatRatio,
  formatShare,
  NO_DATA,
} from "@/lib/format";
import { ANALYTICS_PERIODS, parsePeriod } from "@/server/modules/analytics/periods";
import { getUsageAnalytics, type FeatureCalls } from "@/server/modules/analytics/service";
import { AppError } from "@/server/platform/errors";
import { STATUS_LABEL } from "../tickets/labels";
import { requireAppWorkspace } from "../workspace-context";
import { AnalyticsHeader, OptionLinks, Stat } from "./analytics-header";

export const metadata: Metadata = { title: "Analytics" };

const FEATURE_LABELS = { triage: "Triage", draft: "Reply drafts", embed: "Knowledge embeddings" } as const;

const DRAFT_STATUS_LABELS: Record<string, string> = {
  sent: "Sent to the customer",
  discarded: "Discarded",
  ready: "Waiting for an agent",
  refused: "Refused (not enough knowledge)",
  blocked: "Blocked by a safety check",
  failed: "Failed",
  aborted: "Cancelled",
  generating: "Still generating",
};

/** In the inbox's order: open, pending, resolved, closed. */
const TICKET_STATUSES = Object.keys(STATUS_LABEL) as (keyof typeof STATUS_LABEL)[];

const th = "px-3 py-2 font-medium whitespace-nowrap";
const td = "px-3 py-2";

/** Calls that reached the AI provider: "refused" rows are refusals made before any call. */
const madeCalls = (f: FeatureCalls) => f.calls - (f.outcomes.refused ?? 0);

export default async function AnalyticsPage({ searchParams }: PageProps<"/app/analytics">) {
  const { days: rawDays } = await searchParams;
  const days = parsePeriod(rawDays);
  await requireAppWorkspace();
  let data;
  try {
    data = await getUsageAnalytics(await headers(), days);
  } catch (err) {
    if (err instanceof AppError && err.status === 403) return <Forbidden what="analytics" />;
    throw err;
  }
  const { tickets, drafts, triage, ai } = data;

  const decided = (drafts.byStatus.sent ?? 0) + (drafts.byStatus.discarded ?? 0);
  const generated = Object.values(drafts.byStatus).reduce((n, v) => n + v, 0);
  const totalTokens = ai.daily.reduce((n, d) => n + d.tokens, 0);
  const totalCost = ai.daily.reduce((n, d) => n + d.costMicros, 0);
  const draftTtft = ai.features.find((f) => f.feature === "draft")?.ttftMs ?? null;
  const ticketDays = tickets.daily.map((d) => ({ key: d.day, label: formatDay(d.day), value: d.count }));
  const tokenDays = ai.daily.map((d) => ({ key: d.day, label: formatDay(d.day), value: d.tokens }));

  return (
    <div className="flex flex-col gap-6">
      <AnalyticsHeader
        current="usage"
        intro="How this workspace and its AI features are being used. Counts only: no ticket text. Days are UTC."
      />
      <OptionLinks
        label="Period"
        options={ANALYTICS_PERIODS.map((p) => ({
          href: `/app/analytics?days=${p}`,
          label: `Last ${p} days`,
          current: p === days,
        }))}
      />

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Tickets</h2>
          </CardTitle>
          <CardDescription>
            Requests created in the last {days} days, by their current status and category.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-5">
            <Stat label="Created" value={formatCount(tickets.created)} />
            {TICKET_STATUSES.map((s) => (
              <Stat key={s} label={STATUS_LABEL[s]} value={formatCount(tickets.byStatus[s] ?? 0)} />
            ))}
          </dl>
          <BarChart
            title="Tickets created per day"
            data={ticketDays}
            formatValue={formatCount}
            valueHeader="Tickets"
          />
          {tickets.byCategory.length > 0 && (
            <TableScroll label="Tickets by category">
              <table className="w-full text-sm">
                <caption className="sr-only">Tickets by category</caption>
                <thead className="bg-muted/50 text-left">
                  <tr>
                    <th scope="col" className={th}>
                      Category
                    </th>
                    <th scope="col" className={`${th} text-right`}>
                      Tickets
                    </th>
                    <th scope="col" className={`${th} text-right`}>
                      Share
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {tickets.byCategory.map((c) => (
                    <tr key={c.category ?? ""} className="border-t">
                      <th scope="row" className={`${td} text-left font-normal`}>
                        {c.category ?? <span className="text-muted-foreground">Not categorised</span>}
                      </th>
                      <td className={`${td} text-right whitespace-nowrap tabular-nums`}>
                        {formatCount(c.count)}
                      </td>
                      <td className={`${td} text-right whitespace-nowrap tabular-nums`}>
                        {formatRatio(c.count, tickets.created)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>AI reply drafts</h2>
            </CardTitle>
            <CardDescription>Drafts created in the period and what agents did with them.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <dl className="grid grid-cols-2 gap-4">
              <Stat label="Drafts" value={formatCount(generated)} />
              <Stat
                label="Acceptance rate"
                value={formatRatio(drafts.byStatus.sent ?? 0, decided)}
                detail={
                  decided
                    ? `${drafts.byStatus.sent ?? 0} sent of ${decided} decided`
                    : "none sent or discarded"
                }
              />
              <Stat
                label="Median edit before sending"
                value={formatShare(drafts.edited.median)}
                detail={
                  drafts.edited.n
                    ? `mean ${formatShare(drafts.edited.mean)}, ${drafts.edited.n} sent · 0% = unchanged`
                    : "no drafts sent"
                }
              />
              <Stat
                label="Agent feedback"
                value={`👍 ${drafts.feedback.up} · 👎 ${drafts.feedback.down}`}
                detail={
                  drafts.feedback.up + drafts.feedback.down
                    ? `${formatRatio(drafts.feedback.up, drafts.feedback.up + drafts.feedback.down)} positive`
                    : "no feedback yet"
                }
              />
            </dl>
            {generated > 0 && (
              <TableScroll label="Drafts by outcome">
                <table className="w-full text-sm">
                  <caption className="sr-only">Drafts by outcome</caption>
                  <thead className="bg-muted/50 text-left">
                    <tr>
                      <th scope="col" className={th}>
                        Outcome
                      </th>
                      <th scope="col" className={`${th} text-right`}>
                        Drafts
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(drafts.byStatus)
                      .sort((a, b) => b[1] - a[1])
                      .map(([status, n]) => (
                        <tr key={status} className="border-t">
                          <th scope="row" className={`${td} text-left font-normal`}>
                            {DRAFT_STATUS_LABELS[status] ?? status}
                          </th>
                          <td className={`${td} text-right whitespace-nowrap tabular-nums`}>
                            {formatCount(n)}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </TableScroll>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              <h2>AI triage</h2>
            </CardTitle>
            <CardDescription>Category and priority suggestions made in the period.</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-4">
              <Stat
                label="Suggestions"
                value={formatCount(triage.succeeded)}
                detail={
                  triage.failed + triage.skipped
                    ? `plus ${triage.failed} failed, ${triage.skipped} skipped`
                    : "none failed or skipped"
                }
              />
              <Stat
                label="Override rate"
                value={formatRatio(triage.overridden, triage.succeeded)}
                detail={
                  triage.succeeded
                    ? `${triage.overridden} changed by an agent (category ${triage.categoryOverridden}, priority ${triage.priorityOverridden})`
                    : undefined
                }
              />
              <Stat
                label="Applied automatically"
                value={formatRatio(triage.autoApplied, triage.succeeded)}
                detail={triage.succeeded ? `${triage.autoApplied} of ${triage.succeeded}` : undefined}
              />
              <Stat
                label="Left for review"
                value={formatRatio(triage.needsReview, triage.succeeded)}
                detail={
                  triage.succeeded
                    ? `${triage.needsReview} below the confidence threshold or flagged`
                    : undefined
                }
              />
            </dl>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>AI calls, speed and cost</h2>
          </CardTitle>
          <CardDescription>
            Speed is measured on successful calls. Costs are estimates at the paid-tier list price; the free
            tier costs $0.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Tokens" value={formatCount(totalTokens)} />
            <Stat label="Estimated cost" value={formatMicros(totalCost)} />
            <Stat label="Draft first text, p50" value={formatMs(draftTtft?.p50 ?? null)} />
            <Stat label="Draft first text, p95" value={formatMs(draftTtft?.p95 ?? null)} />
          </dl>
          <TableScroll label="AI calls by feature">
            <table className="w-full text-sm">
              <caption className="sr-only">AI calls by feature</caption>
              <thead className="bg-muted/50 text-left">
                <tr>
                  <th scope="col" className={th}>
                    Feature
                  </th>
                  <th scope="col" className={`${th} text-right`}>
                    Calls
                  </th>
                  <th scope="col" className={`${th} text-right`}>
                    Succeeded
                  </th>
                  <th scope="col" className={`${th} text-right`}>
                    Timed out
                  </th>
                  <th scope="col" className={`${th} text-right`}>
                    Errors
                  </th>
                  <th scope="col" className={`${th} text-right`}>
                    p50
                  </th>
                  <th scope="col" className={`${th} text-right`}>
                    p95
                  </th>
                </tr>
              </thead>
              <tbody>
                {ai.features.map((f) => {
                  const made = madeCalls(f);
                  const errors = (f.outcomes.error ?? 0) + (f.outcomes.invalid ?? 0);
                  return (
                    <tr key={f.feature} className="border-t">
                      <th scope="row" className={`${td} text-left font-normal`}>
                        {FEATURE_LABELS[f.feature]}
                        {(f.outcomes.refused ?? 0) > 0 && (
                          <span className="text-muted-foreground block text-xs">
                            plus {f.outcomes.refused} refused without a call
                          </span>
                        )}
                      </th>
                      <td className={`${td} text-right whitespace-nowrap tabular-nums`}>
                        {formatCount(made)}
                      </td>
                      <td className={`${td} text-right whitespace-nowrap tabular-nums`}>
                        {formatRatio(f.outcomes.ok ?? 0, made)}
                      </td>
                      <td className={`${td} text-right whitespace-nowrap tabular-nums`}>
                        {made ? formatRatio(f.outcomes.timeout ?? 0, made) : NO_DATA}
                      </td>
                      <td className={`${td} text-right whitespace-nowrap tabular-nums`}>
                        {made ? formatRatio(errors, made) : NO_DATA}
                      </td>
                      <td className={`${td} text-right whitespace-nowrap tabular-nums`}>
                        {formatMs(f.latencyMs.p50)}
                      </td>
                      <td className={`${td} text-right whitespace-nowrap tabular-nums`}>
                        {formatMs(f.latencyMs.p95)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableScroll>
          <BarChart
            title="AI tokens per day"
            data={tokenDays}
            formatValue={formatCount}
            valueHeader="Tokens"
          />
          {ai.byModel.length > 0 && (
            <TableScroll label="AI calls by model">
              <table className="w-full text-sm">
                <caption className="text-muted-foreground px-3 py-2 text-left text-xs">
                  Calls by model. A draft retried on the fallback model when the main one was overloaded
                  (ADR-0016) shows here under the fallback.
                </caption>
                <thead className="bg-muted/50 text-left">
                  <tr>
                    <th scope="col" className={th}>
                      Model
                    </th>
                    <th scope="col" className={`${th} text-right`}>
                      Calls
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {ai.byModel.map((m) => (
                    <tr key={m.model} className="border-t">
                      <th scope="row" className={`${td} text-left font-mono text-xs font-normal`}>
                        {m.model}
                      </th>
                      <td className={`${td} text-right whitespace-nowrap tabular-nums`}>
                        {formatCount(m.calls)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
