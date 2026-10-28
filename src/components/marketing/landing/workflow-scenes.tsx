import { BookOpen, CircleCheck, History, Pencil, PenLine, Search, Send, Tag } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Chip, Cite, FakeButton, Initials } from "./mock";
import type { WorkflowStep } from "./workflow-tabs";

/**
 * The four scenes of the "how it works" showcase. Wording follows the app's own screens
 * (triage card, draft panel, preview, audit log); names and times are demo data.
 */

function Stage({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      aria-hidden="true"
      data-spotlight
      className={cn(
        "land-dots bg-muted/40 relative flex min-h-[25rem] items-center justify-center overflow-hidden rounded-2xl border p-4 select-none sm:p-8 lg:min-h-[30rem] lg:p-10",
        className,
      )}
    >
      {children}
    </div>
  );
}

function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "bg-card text-card-foreground land-shadow-sm w-full rounded-xl border text-left text-[13px]",
        className,
      )}
    >
      {children}
    </div>
  );
}

function TriageCard({ applied }: { applied: boolean }) {
  return (
    <Panel className="flex flex-col gap-2.5 p-4">
      <span className="flex items-center justify-between gap-2">
        <span className="font-semibold">AI triage</span>
        {applied ? (
          <Chip className="border-success-border bg-success-subtle text-success-strong">Applied</Chip>
        ) : (
          <Chip className="border-warning-border bg-warning-subtle text-warning-strong">Needs review</Chip>
        )}
      </span>
      <span className="text-muted-foreground text-xs">
        {applied ? "#128 Refund for my annual plan" : "#126 Upload fails for files over 2 GB"}
      </span>
      <span className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
        {(applied
          ? [
              ["Category", "billing"],
              ["Priority", "Normal"],
              ["Sentiment", "Neutral"],
              ["Language", "English"],
            ]
          : [
              ["Category", "bug"],
              ["Priority", "High"],
              ["Sentiment", "Negative"],
              ["Language", "English"],
            ]
        ).map(([k, v]) => (
          <span key={k} className="flex justify-between gap-2">
            <span className="text-muted-foreground">{k}</span>
            <span className="font-medium">{v}</span>
          </span>
        ))}
      </span>
      <span className="text-muted-foreground border-t pt-2.5 text-xs leading-relaxed">
        {applied
          ? "Applied automatically: category and priority."
          : "Not applied automatically: confidence is below 95%. Accept it, or change the details below."}
      </span>
      {!applied && (
        <FakeButton primary className="justify-center">
          Accept suggestion
        </FakeButton>
      )}
    </Panel>
  );
}

function TriageScene() {
  return (
    <Stage>
      <div className="land-in grid w-full max-w-xl grid-cols-1 gap-4 sm:grid-cols-2 sm:items-start">
        <TriageCard applied />
        <div className="sm:mt-10">
          <TriageCard applied={false} />
        </div>
      </div>
    </Stage>
  );
}

function SearchScene() {
  return (
    <Stage>
      <Panel className="land-in flex max-w-lg flex-col">
        <div className="flex items-center gap-2 border-b px-4 py-3">
          <Search className="text-muted-foreground size-4" />
          <span className="truncate">Can I get my money back on an annual plan?</span>
        </div>
        <ul className="flex flex-col gap-2 p-3">
          {[
            {
              n: 1,
              title: "Refund policy › Annual plans",
              text: "Annual plans can be refunded in full within 30 days of purchase or renewal.",
              used: true,
            },
            {
              n: 2,
              title: "Cancel your subscription",
              text: "Go to Settings > Billing and choose Cancel plan.",
              used: true,
            },
            {
              n: 0,
              title: "Invoices › Change the billing currency",
              text: "Invoices use the currency chosen when the plan was bought.",
              used: false,
            },
          ].map((r) => (
            <li
              key={r.title}
              className={cn(
                "flex gap-3 rounded-lg border p-3",
                r.used ? "bg-background" : "bg-muted/50 border-dashed",
              )}
            >
              {r.used ? (
                <Cite n={r.n} className="mt-0.5" />
              ) : (
                <span className="mt-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded border border-dashed" />
              )}
              <span className="flex min-w-0 flex-col gap-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{r.title}</span>
                  {!r.used && <Chip>Not close enough: not used</Chip>}
                </span>
                <span className="text-muted-foreground text-xs leading-relaxed">{r.text}</span>
              </span>
            </li>
          ))}
        </ul>
        <p className="text-muted-foreground border-t px-4 py-2.5 text-xs">
          Up to 5 passages go to the model. If none is close enough, no AI call is made.
        </p>
      </Panel>
    </Stage>
  );
}

function DraftScene() {
  return (
    <Stage>
      <Panel className="flex max-w-lg flex-col">
        <div className="flex items-center gap-2 border-b px-4 py-2.5">
          <PenLine className="text-muted-foreground size-3.5" />
          <span className="font-semibold">AI draft</span>
          <span className="text-muted-foreground ml-auto text-xs">Writing a draft…</span>
        </div>
        <div className="flex flex-col gap-2 p-4 leading-relaxed">
          <p className="land-in">Hi Priya,</p>
          <p className="land-in [animation-delay:140ms]">
            Yes. Annual plans can be refunded in full within 30 days of purchase or renewal, so your renewal
            qualifies <Cite n={1} />. The refund goes back to your original payment method
            <span className="stream-caret" />
          </p>
          <div className="mt-1 flex flex-col gap-2">
            <span className="skeleton h-3 w-11/12" />
            <span className="skeleton h-3 w-2/3" />
          </div>
        </div>
        <div className="text-muted-foreground flex flex-col gap-1.5 border-t px-4 py-3 text-xs">
          <span className="text-foreground font-medium">Automatic checks when it finishes</span>
          {[
            "Every [n] must point to a passage the model was given",
            "Links and email addresses must come from the sources or the ticket",
            "Leaked instructions block the draft",
          ].map((t) => (
            <span key={t} className="flex items-center gap-1.5">
              <CircleCheck className="size-3.5" />
              {t}
            </span>
          ))}
        </div>
      </Panel>
    </Stage>
  );
}

function ReviewScene() {
  return (
    <Stage>
      <div className="land-in grid w-full max-w-xl grid-cols-1 gap-4">
        <Panel className="flex flex-col">
          <div className="flex items-center justify-between gap-2 border-b px-4 py-2.5">
            <span className="font-semibold">What Priya Shah will receive</span>
            <Chip>Preview</Chip>
          </div>
          <div className="flex flex-col gap-2 p-4 leading-relaxed">
            <p>Hi Priya,</p>
            <p>
              Yes. Annual plans can be refunded in full within 30 days of purchase or renewal, so your renewal
              qualifies. The refund goes back to your original payment method; your bank can take 5 to 10
              business days to show it.
            </p>
            <p className="text-muted-foreground text-xs">Citation numbers are removed before sending.</p>
          </div>
          <div className="flex flex-wrap gap-2 border-t px-4 py-3">
            <FakeButton primary>
              <Send className="size-3.5" />
              Approve &amp; send
            </FakeButton>
            <FakeButton>
              <Pencil className="size-3.5" />
              Edit
            </FakeButton>
          </div>
        </Panel>
        <Panel className="flex flex-col gap-2.5 p-4 text-xs">
          <span className="flex items-center gap-1.5 text-[13px] font-semibold">
            <History className="text-muted-foreground size-3.5" />
            Audit log
          </span>
          {[
            ["10:46", "Olivia Owner", "Sent an AI-drafted reply"],
            ["10:44", "Olivia Owner", "Changed assignee"],
            ["10:39", "Priya Shah", "Submitted a request"],
          ].map(([time, who, what]) => (
            <span key={time} className="flex items-center gap-2">
              <span className="text-muted-foreground w-9 shrink-0 font-mono tabular-nums">{time}</span>
              <Initials name={who!} className="size-5 text-[11px]" />
              <span className="truncate">
                <span className="font-medium">{who}</span>{" "}
                <span className="text-muted-foreground">{what}</span>
              </span>
            </span>
          ))}
        </Panel>
      </div>
    </Stage>
  );
}

export const WORKFLOW_STEPS: WorkflowStep[] = [
  {
    value: "triage",
    title: "Triage",
    body: "Every new request gets a category, priority, sentiment and language. Labels are applied only when the model is confident enough (95% by default, set per workspace) and no person has set them.",
    icon: <Tag />,
    scene: <TriageScene />,
  },
  {
    value: "search",
    title: "Search",
    body: "When an agent asks for a draft, the question is matched against your help articles with vector search. Weak matches are dropped; with nothing relevant, no draft is written.",
    icon: <BookOpen />,
    scene: <SearchScene />,
  },
  {
    value: "draft",
    title: "Draft",
    body: "One click on Generate draft, and the reply streams in. Each claim cites a passage, and automatic checks run on citations, links and leaked instructions.",
    icon: <PenLine />,
    scene: <DraftScene />,
  },
  {
    value: "review",
    title: "Review and send",
    body: "The agent edits, previews exactly what the customer gets, and approves. Nothing is sent automatically, and every step is in the audit log.",
    icon: <Send />,
    scene: <ReviewScene />,
  },
];
