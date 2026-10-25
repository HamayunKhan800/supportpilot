import type { Metadata } from "next";
import { headers } from "next/headers";
import { Forbidden } from "@/components/forbidden";
import { ANALYTICS_PERIODS, parsePeriod } from "@/server/modules/analytics/periods";
import { getUsageAnalytics } from "@/server/modules/analytics/service";
import { AppError } from "@/server/platform/errors";
import { requireAppWorkspace } from "../workspace-context";
import { AnalyticsHeader, OptionLinks } from "./analytics-header";
import { AiCallsSection, DraftsSection, KeyNumbers, TicketsSection, TriageSection } from "./usage-sections";

export const metadata: Metadata = { title: "Analytics" };

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

  return (
    <div data-wide className="flex flex-col gap-6">
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
      <KeyNumbers days={days} tickets={tickets} ai={ai} />
      <TicketsSection days={days} tickets={tickets} />
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <DraftsSection drafts={drafts} />
        <TriageSection triage={triage} />
      </div>
      <AiCallsSection ai={ai} />
    </div>
  );
}
