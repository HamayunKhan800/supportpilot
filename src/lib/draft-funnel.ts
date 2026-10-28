import type { FunnelStep } from "@/components/charts/funnel";
import { formatCount } from "@/lib/format";
import type { DraftStats } from "@/server/modules/analytics/service";

/**
 * The AI draft funnel on the Usage analytics page (after PostHog's funnels): where drafts stop
 * between being created and being sent and rated helpful. A refusal is the AI declining when the
 * knowledge base has no answer, which is intended; the wording says so.
 */

/** How a draft that never became usable ended, in the funnel's "left here" line. */
const DRAFT_DROP_LABELS: Record<string, string> = {
  refused: "refused (no answer in the knowledge base, as intended)",
  blocked: "blocked by a safety check",
  failed: "failed",
  aborted: "cancelled",
  generating: "still generating",
};

const listed = (parts: [number, string][]) =>
  parts
    .filter(([n]) => n > 0)
    .map(([n, what]) => `${formatCount(n)} ${what}`)
    .join(", ");

/** Created → usable → sent → sent and rated helpful; each step keeps part of the one before. */
export function draftFunnel(drafts: DraftStats): FunnelStep[] {
  const n = (k: string) => drafts.byStatus[k] ?? 0;
  const created = Object.values(drafts.byStatus).reduce((sum, v) => sum + v, 0);
  const usable = n("sent") + n("discarded") + n("ready");
  const unusable = Object.entries(drafts.byStatus)
    .filter(([k]) => !["sent", "discarded", "ready"].includes(k))
    .map(([k, v]): [number, string] => [v, DRAFT_DROP_LABELS[k] ?? k]);
  return [
    { key: "created", label: "Drafts created", value: created, dropped: listed(unusable) },
    {
      key: "usable",
      label: "Usable draft for an agent",
      value: usable,
      dropped: listed([
        [n("discarded"), "discarded"],
        [n("ready"), "still waiting for an agent"],
      ]),
    },
    {
      key: "sent",
      label: "Sent to the customer",
      value: n("sent"),
      dropped: "sent without a rating, or rated not helpful",
    },
    { key: "helpful", label: "Sent and rated helpful", value: drafts.feedback.sentUp },
  ];
}
