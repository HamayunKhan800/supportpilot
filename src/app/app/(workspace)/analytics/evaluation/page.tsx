import type { Metadata } from "next";
import { headers } from "next/headers";
import { FlaskConical } from "lucide-react";
import { Forbidden } from "@/components/forbidden";
import { EmptyState } from "@/components/page";
import { parseProvider } from "@/server/modules/analytics/periods";
import { getEvaluationOverview } from "@/server/modules/analytics/service";
import { EVAL_PROVIDERS } from "@/server/modules/eval/constants";
import { headlineRun } from "@/server/modules/eval/summary-view";
import { AppError } from "@/server/platform/errors";
import { requireAppWorkspace } from "../../workspace-context";
import { AnalyticsHeader, OptionLinks } from "../analytics-header";
import { LatestRun } from "./latest-run";
import { Block, PROVIDER_LABELS } from "./report-parts";
import { Trend } from "./trend";

export const metadata: Metadata = { title: "AI evaluation" };

/** What the numbers mean and what they don't, in plain words, at the end of the report. */
function AboutNumbers() {
  return (
    <Block
      id="about"
      title="About these numbers"
      bodyClassName="grid grid-cols-1 gap-x-10 gap-y-4 text-sm md:grid-cols-2"
    >
      <p className="text-muted-foreground">
        <strong className="text-foreground font-medium">Fixed test sets.</strong> Every run replays the same
        synthetic tickets and questions with known answers (docs/04), plus a set of prompt-injection attacks,
        so runs can be compared. No customer data is used.
      </p>
      <p className="text-muted-foreground">
        <strong className="text-foreground font-medium">Ranges, not just rates.</strong> Each rate comes with
        a 95% range (Wilson interval). A target counts as met when the measured rate reaches it; when the
        range also reaches below the target, the result could still be chance.
      </p>
      <p className="text-muted-foreground">
        <strong className="text-foreground font-medium">Groundedness is AI-graded,</strong> not checked
        against a human: a second model judges whether each draft sticks to its sources.
      </p>
      <p className="text-muted-foreground">
        <strong className="text-foreground font-medium">Costs are estimates</strong> at paid-tier list prices
        from the tokens each call used. On the free tier these runs cost $0.
      </p>
    </Block>
  );
}

export default async function EvaluationPage({ searchParams }: PageProps<"/app/analytics/evaluation">) {
  const { provider: rawProvider } = await searchParams;
  await requireAppWorkspace();
  let overview;
  try {
    overview = await getEvaluationOverview(await headers(), parseProvider(rawProvider));
  } catch (err) {
    if (err instanceof AppError && err.status === 403) return <Forbidden what="analytics" />;
    throw err;
  }
  const { provider, runCounts, runs } = overview;
  const latest = headlineRun(runs);

  return (
    <div data-wide className="flex flex-col gap-8">
      <AnalyticsHeader
        current="evaluation"
        intro="How well the AI does on fixed test sets (docs/04): synthetic tickets and questions with known answers, the same for every workspace."
      />
      <OptionLinks
        label="Provider"
        options={EVAL_PROVIDERS.map((p) => ({
          href: `/app/analytics/evaluation?provider=${p}`,
          label: `${PROVIDER_LABELS[p]} (${runCounts[p] ?? 0} ${(runCounts[p] ?? 0) === 1 ? "run" : "runs"})`,
          current: p === provider,
        }))}
      />
      {latest ? (
        <>
          <LatestRun run={latest.run} newer={latest.newer} />
          {runs.length > 1 && <Trend runs={runs} />}
          <AboutNumbers />
        </>
      ) : (
        <EmptyState icon={FlaskConical} title={`No ${PROVIDER_LABELS[provider]} runs yet`}>
          Results appear here after the evaluation runs against this database (
          <code className="font-mono">pnpm eval{provider === "gemini" ? " --provider gemini" : ""}</code>).
        </EmptyState>
      )}
    </div>
  );
}
