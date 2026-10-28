import type { Metadata } from "next";
import { TableScroll } from "@/components/table-scroll";
import { headers } from "next/headers";
import { Forbidden } from "@/components/forbidden";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { PageHeader, Section } from "@/components/page";
import { getAiSettingsPage } from "@/server/modules/settings/service";
import { AppError } from "@/server/platform/errors";
import { requireAppWorkspace } from "../workspace-context";
import { AiSettingsForm } from "./ai-settings-form";
import { formatLongDate } from "@/lib/format";

export const metadata: Metadata = { title: "AI settings" };

const FEATURE_LABELS = { triage: "Triage", draft: "Reply drafts", embed: "Knowledge embeddings" } as const;

const OUTCOME_LABELS: Record<string, string> = {
  ok: "succeeded",
  refused: "refused without an AI call",
  blocked: "blocked for safety",
  invalid: "invalid output",
  timeout: "timed out",
  error: "failed",
  aborted: "cancelled",
};

const int = new Intl.NumberFormat("en-US");
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 4 });

function outcomes(o: Record<string, number | undefined>) {
  const parts = Object.entries(o)
    .filter(([, n]) => n)
    .map(([k, n]) => `${int.format(n!)} ${OUTCOME_LABELS[k] ?? k}`);
  return parts.length ? parts.join(", ") : "none";
}

export default async function AiSettingsPage() {
  await requireAppWorkspace(); // resolve the active workspace first (shared with the layout)
  let page;
  try {
    page = await getAiSettingsPage(await headers());
  } catch (err) {
    if (err instanceof AppError && err.status === 403) return <Forbidden what="the AI settings" />;
    throw err;
  }
  const { settings, usage, canEdit, dailyCallLimit } = page;

  const budget = settings.monthlyTokenBudget;
  const used = usage.budgetTokensUsed;
  const percent = budget > 0 ? Math.min(100, (used / budget) * 100) : 100;
  const exhausted = used >= budget;
  const since = new Date(usage.since);
  const nextReset = new Date(Date.UTC(since.getUTCFullYear(), since.getUTCMonth() + 1, 1));
  const meterMax = Math.max(budget, 1); // a 0 budget shows as a full, red bar
  const usedText = `${int.format(used)} of ${int.format(budget)} tokens used (${percent.toFixed(1)}%)`;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="AI settings"
        description="How this workspace uses AI, and what it has used this month. Every member can see this page."
      />

      <Section
        id="usage"
        title="This month's usage"
        description={`Since ${formatLongDate(since)} (UTC). The budget resets on ${formatLongDate(nextReset)}.`}
        bodyClassName="flex flex-col gap-4"
      >
        {!settings.aiEnabled ? (
          <Alert>
            <AlertDescription>
              AI is switched off: no triage and no drafts until it is turned back on.
            </AlertDescription>
          </Alert>
        ) : (
          exhausted && (
            <Alert variant="destructive">
              <AlertDescription>
                The monthly budget is used up, so triage and drafts are paused until{" "}
                {formatLongDate(nextReset)}
                {canEdit ? " or until you raise the budget below." : " or until an admin raises it."}
              </AlertDescription>
            </Alert>
          )
        )}
        <div className="flex flex-col gap-1.5">
          <p id="budget-label" className="text-sm font-medium">
            Budget used this month
          </p>
          {/* A native <meter>: no inline style, which the CSP forbids (style-src-attr). */}
          <meter
            aria-labelledby="budget-label"
            aria-valuetext={usedText}
            className="budget-meter"
            min={0}
            max={meterMax}
            value={Math.min(used, meterMax)}
            low={meterMax * 0.8}
            high={meterMax * 0.99}
            optimum={0}
          >
            {usedText}
          </meter>
          <p className="text-muted-foreground text-sm" data-testid="budget-used">
            {usedText}
          </p>
        </div>

        <TableScroll label="AI calls this month by feature" className="rounded-none border-0">
          <table className="w-full text-sm">
            <caption className="sr-only">AI calls this month by feature</caption>
            <thead className="bg-muted/50 text-left">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">
                  Feature
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Calls
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Tokens in / out
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Est. cost
                </th>
                <th scope="col" className="min-w-44 px-3 py-2 font-medium">
                  Outcomes
                </th>
              </tr>
            </thead>
            <tbody>
              {usage.features.map((f) => (
                <tr key={f.feature} className="border-t align-top">
                  <th scope="row" className="px-3 py-2 text-left font-normal">
                    {FEATURE_LABELS[f.feature]}
                    {!f.countsTowardBudget && (
                      <span className="text-muted-foreground block text-xs">not counted in the budget</span>
                    )}
                  </th>
                  <td className="px-3 py-2 text-right tabular-nums">{int.format(f.calls)}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">
                    {int.format(f.inputTokens)} / {int.format(f.outputTokens)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{usd.format(f.estimatedCostUsd)}</td>
                  <td className="text-muted-foreground px-3 py-2">{outcomes(f.outcomes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
        <p className="text-muted-foreground max-w-measure text-sm">
          Costs are estimates at Gemini&apos;s paid-tier list prices; on the free tier these calls cost
          nothing. This deployment also allows at most {int.format(dailyCallLimit)} AI calls a day across all
          workspaces (resets at midnight Pacific time).
        </p>
      </Section>

      <Section
        id="ai-config"
        title="Settings"
        description={
          canEdit
            ? "Changes apply to new triage runs and drafts. Each change is recorded in the audit log."
            : "Only admins and owners can change these settings."
        }
      >
        {canEdit ? (
          <AiSettingsForm initial={settings} />
        ) : (
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[max-content_1fr]">
            <dt className="font-medium">AI for triage and drafts</dt>
            <dd>{settings.aiEnabled ? "On" : "Off"}</dd>
            <dt className="font-medium">Monthly token budget</dt>
            <dd>{int.format(settings.monthlyTokenBudget)} tokens</dd>
            <dt className="font-medium">Auto-apply threshold</dt>
            <dd>{settings.triageConfidenceThreshold}</dd>
            <dt className="font-medium">Minimum match score</dt>
            <dd>
              {settings.retrievalMinScore} (Gemini embedding scale
              {settings.retrievalMinScoreApplies
                ? ")"
                : "; not used by this deployment's offline demo embedder)"}
            </dd>
            <dt className="font-medium">Categories</dt>
            <dd>{settings.categories.join(", ")}</dd>
          </dl>
        )}
      </Section>
    </div>
  );
}
