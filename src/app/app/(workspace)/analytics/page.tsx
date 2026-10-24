import type { Metadata } from "next";
import { headers } from "next/headers";
import { Coins, Cpu, Inbox, MessageSquareText, Send, Tags, ThumbsDown, ThumbsUp } from "lucide-react";
import { BarChart } from "@/components/charts/bar-chart";
import { ChangeNote, Sparkline } from "@/components/charts/sparkline";
import { StackedBar, type StackedSegment } from "@/components/charts/stacked-bar";
import { Forbidden } from "@/components/forbidden";
import { MeterBar } from "@/components/meter";
import { EmptyState, Section, Stat, StatGrid } from "@/components/page";
import { TableScroll } from "@/components/table-scroll";
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
import { AnalyticsHeader, OptionLinks } from "./analytics-header";

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
const STATUS_TONE = { open: 1, pending: 3, resolved: 5, closed: 2 } as const;

/** Draft outcomes as at most five coloured parts; the rarer failure states share one. */
function draftSegments(byStatus: Record<string, number>): StackedSegment[] {
  const n = (k: string) => byStatus[k] ?? 0;
  const known = new Set(["sent", "discarded", "ready", "refused"]);
  const other = Object.entries(byStatus).reduce((sum, [k, v]) => (known.has(k) ? sum : sum + v), 0);
  return [
    { key: "sent", label: DRAFT_STATUS_LABELS.sent!, value: n("sent"), tone: 5 },
    { key: "discarded", label: DRAFT_STATUS_LABELS.discarded!, value: n("discarded"), tone: 4 },
    { key: "ready", label: DRAFT_STATUS_LABELS.ready!, value: n("ready"), tone: 1 },
    { key: "refused", label: DRAFT_STATUS_LABELS.refused!, value: n("refused"), tone: 3 },
    { key: "other", label: "Blocked, failed or cancelled", value: other, tone: 2 },
  ];
}

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
  const ticketSeries = tickets.daily.map((d) => d.count);
  const tokenSeries = ai.daily.map((d) => d.tokens);
  const costSeries = ai.daily.map((d) => d.costMicros);
  const sent = drafts.byStatus.sent ?? 0;
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

      <section aria-labelledby="key-numbers">
        <h2 id="key-numbers" className="sr-only">
          Key numbers, last {days} days
        </h2>
        <StatGrid>
          <Stat
            label="Tickets created"
            value={formatCount(tickets.created)}
            icon={Inbox}
            tone="brand"
            note={<ChangeNote values={ticketSeries} format={formatCount} />}
            chart={<Sparkline values={ticketSeries} />}
          />
          <Stat
            label="Draft acceptance"
            value={formatRatio(sent, decided)}
            icon={Send}
            tone="success"
            note={
              decided
                ? `${sent} sent of ${decided} decided (sent or discarded)`
                : "None sent or discarded yet"
            }
          />
          <Stat
            label="AI tokens"
            value={formatCount(totalTokens)}
            icon={Cpu}
            note={<ChangeNote values={tokenSeries} format={formatCount} />}
            chart={<Sparkline values={tokenSeries} />}
          />
          <Stat
            label="Estimated cost"
            value={formatMicros(totalCost)}
            icon={Coins}
            note={<ChangeNote values={costSeries} format={formatMicros} />}
            chart={<Sparkline values={costSeries} />}
          />
        </StatGrid>
      </section>

      <Section
        id="tickets"
        title="Tickets"
        description={`Requests created in the last ${days} days, by their current status and category.`}
        bodyClassName="flex flex-col gap-6"
      >
        <StackedBar
          label="Tickets by status"
          formatValue={formatCount}
          segments={TICKET_STATUSES.map((st) => ({
            key: st,
            label: STATUS_LABEL[st],
            value: tickets.byStatus[st] ?? 0,
            tone: STATUS_TONE[st],
          }))}
        />
        <BarChart
          title="Tickets created per day"
          data={ticketDays}
          formatValue={formatCount}
          valueHeader="Tickets"
        />
        {tickets.byCategory.length > 0 ? (
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
                      {c.category ? (
                        <span className="font-mono text-xs">{c.category}</span>
                      ) : (
                        <span className="text-muted-foreground">Not categorised</span>
                      )}
                    </th>
                    <td className={`${td} text-right whitespace-nowrap tabular-nums`}>
                      {formatCount(c.count)}
                    </td>
                    <td className={`${td} whitespace-nowrap tabular-nums`}>
                      <span className="flex items-center justify-end gap-3">
                        <MeterBar
                          value={tickets.created ? c.count / tickets.created : 0}
                          className="hidden w-24 sm:block"
                        />
                        <span className="w-10 text-right">{formatRatio(c.count, tickets.created)}</span>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        ) : (
          <EmptyState icon={Tags} title="No tickets in this period">
            Requests from the customer portal show up here, by category once AI triage has run.
          </EmptyState>
        )}
      </Section>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <Section
          id="drafts"
          title="AI reply drafts"
          description="Drafts created in the period and what agents did with them."
          bodyClassName="flex flex-col gap-5"
        >
          <dl className="grid grid-cols-2 gap-4">
            <SmallStat label="Drafts" value={formatCount(generated)} />
            <SmallStat
              label="Median edit before sending"
              value={formatShare(drafts.edited.median)}
              detail={
                drafts.edited.n
                  ? `mean ${formatShare(drafts.edited.mean)}, ${drafts.edited.n} sent · 0% = unchanged`
                  : "no drafts sent"
              }
            />
            <SmallStat
              label="Agent feedback"
              value={
                <span className="inline-flex items-center gap-3">
                  <span className="inline-flex items-center gap-1">
                    <ThumbsUp aria-hidden="true" className="text-muted-foreground size-4" />
                    {drafts.feedback.up}
                    <span className="sr-only"> helpful,</span>
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <ThumbsDown aria-hidden="true" className="text-muted-foreground size-4" />
                    {drafts.feedback.down}
                    <span className="sr-only"> not helpful</span>
                  </span>
                </span>
              }
              detail={
                drafts.feedback.up + drafts.feedback.down
                  ? `${formatRatio(drafts.feedback.up, drafts.feedback.up + drafts.feedback.down)} positive`
                  : "no feedback yet"
              }
            />
          </dl>
          {generated > 0 ? (
            <StackedBar
              hideEmpty
              label="Drafts by outcome"
              formatValue={formatCount}
              segments={draftSegments(drafts.byStatus)}
            />
          ) : (
            <EmptyState icon={MessageSquareText} title="No drafts in this period">
              Agents create drafts from a ticket with “Generate draft”.
            </EmptyState>
          )}
        </Section>

        <Section
          id="triage"
          title="AI triage"
          description="Category and priority suggestions made in the period."
        >
          <dl className="grid grid-cols-2 gap-4">
            <SmallStat
              label="Suggestions"
              value={formatCount(triage.succeeded)}
              detail={
                triage.failed + triage.skipped
                  ? `plus ${triage.failed} failed, ${triage.skipped} skipped`
                  : "none failed or skipped"
              }
            />
            <SmallStat
              label="Override rate"
              value={formatRatio(triage.overridden, triage.succeeded)}
              detail={
                triage.succeeded
                  ? `${triage.overridden} changed by an agent (category ${triage.categoryOverridden}, priority ${triage.priorityOverridden})`
                  : undefined
              }
            />
            <SmallStat
              label="Applied automatically"
              value={formatRatio(triage.autoApplied, triage.succeeded)}
              detail={triage.succeeded ? `${triage.autoApplied} of ${triage.succeeded}` : undefined}
            />
            <SmallStat
              label="Left for review"
              value={formatRatio(triage.needsReview, triage.succeeded)}
              detail={
                triage.succeeded
                  ? `${triage.needsReview} below the confidence threshold or flagged`
                  : undefined
              }
            />
          </dl>
        </Section>
      </div>

      <Section
        id="ai-calls"
        title="AI calls, speed and cost"
        description="Speed is measured on successful calls. Costs are estimates at the paid-tier list price; the free tier costs $0."
        bodyClassName="flex flex-col gap-6"
      >
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <SmallStat label="Tokens" value={formatCount(totalTokens)} />
          <SmallStat label="Estimated cost" value={formatMicros(totalCost)} />
          <SmallStat label="Draft first text, p50" value={formatMs(draftTtft?.p50 ?? null)} />
          <SmallStat label="Draft first text, p95" value={formatMs(draftTtft?.p95 ?? null)} />
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
                    <td className={`${td} text-right whitespace-nowrap tabular-nums`}>{formatCount(made)}</td>
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
          tone={2}
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
      </Section>
    </div>
  );
}

/** A smaller labelled number inside a section (the page's key numbers use the larger Stat tiles). */
function SmallStat({ label, value, detail }: { label: string; value: React.ReactNode; detail?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="text-xl font-semibold tracking-tight tabular-nums">{value}</dd>
      {detail && <dd className="text-muted-foreground text-xs">{detail}</dd>}
    </div>
  );
}
