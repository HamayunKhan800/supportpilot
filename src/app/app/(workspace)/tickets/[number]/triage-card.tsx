import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { TriageRun } from "@/server/modules/triage/types";
import { languageName, PRIORITY_LABEL, SENTIMENT_LABEL, TRIAGE_ERROR_LABEL } from "../labels";
import { AcceptSuggestion } from "./accept-suggestion";

/** Show "in progress" this long after creation; queue retries finish well within it. */
const PENDING_WINDOW_MS = 15 * 60_000;

interface Props {
  triage: TriageRun | null;
  ticket: { id: string; version: number; createdAt: Date };
  threshold: number;
  /** Server render time, passed in so the component stays pure. */
  now: number;
}

/**
 * The AI triage result (M5 D5, FR-AI2). Everything the model wrote is rendered as plain text.
 * Tickets never triaged (e.g. demo data) show nothing once the pending window has passed.
 */
export function TriageCard({ triage, ticket, threshold, now }: Props) {
  if (!triage && now - ticket.createdAt.getTime() > PENDING_WINDOW_MS) return null;

  return (
    <Card data-testid="triage-card">
      <CardHeader>
        <CardTitle>
          <h2>AI triage</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        {!triage ? (
          <p role="status" className="text-muted-foreground">
            Analysing this request. Refresh in a moment to see the suggestion.
          </p>
        ) : triage.status !== "succeeded" || !triage.category || !triage.priority ? (
          <p>
            {triage.status === "skipped" ? "Skipped: " : "Not available: "}
            {TRIAGE_ERROR_LABEL[triage.errorCode ?? ""] ?? "Something went wrong."} Set the details yourself.
          </p>
        ) : (
          <Suggestion triage={triage} ticket={ticket} threshold={threshold} />
        )}
      </CardContent>
    </Card>
  );
}

function Suggestion({
  triage,
  ticket,
  threshold,
}: {
  triage: TriageRun;
  ticket: Props["ticket"];
  threshold: number;
}) {
  const open = triage.needsReview && !triage.reviewedAt;
  const confidence = Math.round((triage.confidence ?? 0) * 100);
  const applied = [triage.appliedCategory && "category", triage.appliedPriority && "priority"].filter(
    Boolean,
  );
  const flagged = triage.flags.includes("hidden_characters");

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {open && <Badge className="bg-warning-subtle text-warning-strong">Needs review</Badge>}
        {!open && triage.reviewedAt && <Badge variant="secondary">Reviewed</Badge>}
        {flagged && (
          <Badge variant="outline" className="border-danger-border text-danger-strong">
            Hidden characters removed
          </Badge>
        )}
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <dt className="text-muted-foreground">Category</dt>
        <dd className="font-medium break-words">{triage.category}</dd>
        <dt className="text-muted-foreground">Priority</dt>
        <dd className="font-medium">{PRIORITY_LABEL[triage.priority!]}</dd>
        <dt className="text-muted-foreground">Sentiment</dt>
        <dd>{SENTIMENT_LABEL[triage.sentiment ?? ""] ?? "Unknown"}</dd>
        <dt className="text-muted-foreground">Language</dt>
        <dd>{triage.language ? languageName(triage.language) : "Unknown"}</dd>
        <dt className="text-muted-foreground">Self-rated confidence</dt>
        <dd>{confidence}%</dd>
      </dl>
      {triage.reason && (
        <p className="break-words">
          <span className="text-muted-foreground">Why: </span>
          {triage.reason}
        </p>
      )}
      {applied.length > 0 && <p>Applied automatically: {applied.join(" and ")}.</p>}
      {open && (
        <>
          <p className="text-muted-foreground">
            {flagged
              ? "Nothing was applied automatically, because the message contained hidden characters."
              : (triage.confidence ?? 0) < threshold
                ? `Not applied automatically: confidence is below ${Math.round(threshold * 100)}%.`
                : "Not applied automatically, because an agent had already set this."}{" "}
            Accept it, or change the details below.
          </p>
          <AcceptSuggestion ticketId={ticket.id} version={ticket.version} />
        </>
      )}
      {(triage.categoryOverride !== null || triage.priorityOverride !== null) && (
        <p className="text-muted-foreground">An agent chose different details.</p>
      )}
      <p className="text-muted-foreground text-xs">
        AI suggestion ({triage.model}, {triage.promptVersion}). Check it before relying on it.
      </p>
    </>
  );
}
