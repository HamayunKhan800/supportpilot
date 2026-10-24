import {
  BarChart3,
  BookOpen,
  CircleCheck,
  FlaskConical,
  History,
  Inbox,
  LayoutGrid,
  Pencil,
  PenLine,
  Search,
  Send,
  Settings2,
  Users,
} from "lucide-react";
import { LogoMark } from "@/components/logo";
import { cn } from "@/lib/utils";
import { Chip, Cite, FakeButton, Initials, PriorityBars, StatusRing } from "./mock";

/**
 * The hero picture: the agent's workspace with demo data, built from the app's own tokens and
 * labels. Layers, back to front: the app (sidebar, inbox, ticket with its AI draft, details), then
 * two floating panels for what happens around it (the passages the draft cites, and a live
 * "new ticket" notice). On load, the window rises, the draft appears line by line, its checks and
 * actions follow, then the panels; each step is under 300 ms. Narrow screens get the ticket alone.
 *
 * Decorative: the figure's caption describes it, so it is hidden from assistive technology.
 */

const INBOX: {
  n: number;
  subject: string;
  who: string;
  tag: string;
  level: 1 | 2 | 3 | 4;
  status: "open" | "pending";
  marker?: "draft" | "review";
  time: string;
}[] = [
  {
    n: 128,
    subject: "Refund for my annual plan",
    who: "Priya Shah",
    tag: "billing",
    level: 2,
    status: "open",
    marker: "draft",
    time: "2m",
  },
  {
    n: 127,
    subject: "Web app down? Getting 502 errors",
    who: "Chen Wei",
    tag: "outage",
    level: 4,
    status: "open",
    time: "9m",
  },
  {
    n: 126,
    subject: "Upload fails for files over 2 GB",
    who: "Sofia Rossi",
    tag: "bug",
    level: 3,
    status: "open",
    marker: "review",
    time: "24m",
  },
  {
    n: 125,
    subject: "Can't change the email on my account",
    who: "Samuel Osei",
    tag: "account",
    level: 2,
    status: "pending",
    time: "1h",
  },
  {
    n: 124,
    subject: "Do you offer a nonprofit discount?",
    who: "Fatima Zahra",
    tag: "billing",
    level: 1,
    status: "open",
    marker: "review",
    time: "2h",
  },
  {
    n: 123,
    subject: "Wrong currency on my invoice",
    who: "Lukas Weber",
    tag: "billing",
    level: 2,
    status: "pending",
    time: "3h",
  },
];

const NAV = [
  { icon: LayoutGrid, label: "Overview" },
  { icon: Inbox, label: "Tickets", count: "10", active: true },
  { icon: BookOpen, label: "Knowledge" },
  { icon: BarChart3, label: "Analytics" },
  { icon: FlaskConical, label: "Evaluation" },
  { icon: Users, label: "Members" },
  { icon: Settings2, label: "AI settings" },
  { icon: History, label: "Audit log" },
];

/** Animation delay classes, written out so Tailwind generates them (no inline styles under the CSP). */
const LINE_DELAYS = ["[animation-delay:420ms]", "[animation-delay:520ms]", "[animation-delay:620ms]"];

export function HeroDemo() {
  return (
    <div aria-hidden="true" className="relative select-none">
      {/* The app window */}
      <div className="land-in land-shadow bg-card text-card-foreground relative overflow-hidden rounded-xl border text-left">
        <div className="grid h-[34rem] grid-cols-1 md:grid-cols-[minmax(0,1fr)_14rem] lg:grid-cols-[17rem_minmax(0,1fr)_14rem] xl:grid-cols-[11.5rem_19rem_minmax(0,1fr)_15rem]">
          {/* Sidebar */}
          <div className="bg-muted/40 hidden flex-col gap-3 border-r p-3 xl:flex">
            <div className="flex items-center gap-2 px-1 pb-1">
              <LogoMark className="size-5 [&_svg]:size-4" />
              <span className="truncate text-[13px] font-semibold">Nimbus Cloud</span>
            </div>
            <div className="text-muted-foreground flex h-7 items-center gap-2 rounded-md border px-2 text-xs">
              <Search className="size-3.5" />
              Search…
            </div>
            <ul className="flex flex-col gap-0.5 text-[13px]">
              {NAV.map(({ icon: Icon, label, count, active }) => (
                <li
                  key={label}
                  className={cn(
                    "flex h-7 items-center gap-2 rounded-md px-2",
                    active ? "bg-accent text-foreground font-medium" : "text-muted-foreground",
                  )}
                >
                  <Icon className="size-3.5" />
                  <span className="flex-1">{label}</span>
                  {count && <span className="text-muted-foreground text-[11px] tabular-nums">{count}</span>}
                </li>
              ))}
            </ul>
            <div className="mt-auto flex items-center gap-2 border-t px-1 pt-3">
              <Initials name="Olivia Owner" />
              <span className="flex flex-col leading-tight">
                <span className="text-xs font-medium">Olivia Owner</span>
                <span className="text-muted-foreground text-[11px]">Owner</span>
              </span>
            </div>
          </div>

          {/* Inbox */}
          <div className="hidden min-w-0 flex-col border-r lg:flex">
            <div className="flex items-center justify-between gap-2 border-b px-3.5 py-2.5">
              <span className="text-[13px] font-semibold">Tickets</span>
              <span className="text-muted-foreground flex gap-1 text-[11px]">
                <span className="bg-accent text-foreground rounded px-1.5 py-0.5 font-medium">Active 17</span>
                <span className="px-1.5 py-0.5">Open 11</span>
              </span>
            </div>
            <ul className="flex flex-col">
              {INBOX.map((t) => (
                <li
                  key={t.n}
                  className={cn(
                    "flex flex-col gap-1 border-b px-3.5 py-2.5",
                    t.n === 128 && "bg-accent/70 shadow-[inset_2px_0_0_var(--foreground)]",
                  )}
                >
                  <span className="flex items-center gap-2">
                    <StatusRing status={t.status} />
                    <span className="truncate text-[13px] font-medium">{t.subject}</span>
                    <span className="text-muted-foreground ml-auto shrink-0 text-[11px] tabular-nums">
                      {t.time}
                    </span>
                  </span>
                  <span className="flex items-center gap-1.5 pl-[1.375rem]">
                    <span className="text-muted-foreground truncate text-[11px]">{t.who}</span>
                    <Chip className="h-4 px-1 text-[10px]">{t.tag}</Chip>
                    {t.marker === "draft" && (
                      <Chip className="text-foreground h-4 gap-0.5 px-1 text-[10px]">
                        <PenLine className="size-2.5" />
                        AI draft ready
                      </Chip>
                    )}
                    {t.marker === "review" && (
                      <Chip className="border-warning-border bg-warning-subtle text-warning-strong h-4 px-1 text-[10px]">
                        Needs review
                      </Chip>
                    )}
                    <span className="ml-auto">
                      <PriorityBars level={t.level} />
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {/* Ticket */}
          <div className="flex min-w-0 flex-col gap-4 overflow-hidden p-4 sm:p-5">
            <div className="text-muted-foreground flex items-center gap-1.5 text-[11px]">
              <span>All tickets</span>
              <span>/</span>
              <span className="text-foreground font-medium">#128</span>
              <span className="ml-auto tabular-nums">1 of 17</span>
            </div>
            <div className="flex flex-col gap-1.5">
              <p className="text-lg leading-tight font-semibold tracking-tight">
                <span className="text-muted-foreground font-normal">#128</span> Refund for my annual plan
              </p>
              <p className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                <span className="inline-flex items-center gap-1.5">
                  <StatusRing status="open" /> Open
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <PriorityBars level={2} /> Normal
                </span>
                <span>From Priya Shah</span>
              </p>
            </div>

            <div className="flex gap-2.5">
              <Initials name="Priya Shah" />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="text-xs">
                  <span className="font-medium">Priya Shah</span>
                  <span className="text-muted-foreground"> · customer · 10:39</span>
                </span>
                <p className="bg-background rounded-lg border px-3 py-2 text-[13px] leading-relaxed">
                  My annual plan renewed 12 days ago and I didn&apos;t mean to keep it. Can I get my money
                  back, and how long does it take?
                </p>
              </div>
            </div>

            <div className="flex flex-col rounded-lg border">
              <div className="flex items-center gap-2 border-b px-3 py-2">
                <PenLine className="text-muted-foreground size-3.5" />
                <span className="text-[13px] font-semibold">AI draft</span>
                <span className="text-muted-foreground font-mono text-[11px]">· gemini-3.8-flash</span>
              </div>
              <div className="flex flex-col gap-3 p-3">
                <ul className="flex flex-wrap gap-1.5">
                  {["Cites 2 sources", "Every citation matches a source", "No unfamiliar links"].map(
                    (label) => (
                      <li key={label} className="land-pop [animation-delay:760ms]">
                        <Chip>
                          <CircleCheck className="text-success-strong size-3" />
                          {label}
                        </Chip>
                      </li>
                    ),
                  )}
                </ul>
                <div className="flex flex-col gap-2 text-[13px] leading-relaxed">
                  <p className={cn("land-in", LINE_DELAYS[0])}>Hi Priya,</p>
                  <p className={cn("land-in", LINE_DELAYS[1])}>
                    Yes. Annual plans can be refunded in full within 30 days of purchase or renewal, so your
                    renewal qualifies <Cite n={1} />. The refund goes back to your original payment method;
                    your bank can take 5 to 10 business days to show it <Cite n={1} />.
                  </p>
                  <p className={cn("land-in", LINE_DELAYS[2])}>
                    To stop the plan renewing, go to Settings &gt; Billing and choose Cancel plan{" "}
                    <Cite n={2} />.
                  </p>
                </div>
                <div className="land-in flex flex-wrap gap-2 pt-1 [animation-delay:860ms]">
                  <FakeButton primary>
                    <Send className="size-3.5" />
                    Approve &amp; send
                  </FakeButton>
                  <FakeButton>
                    <Pencil className="size-3.5" />
                    Edit
                  </FakeButton>
                  <FakeButton className="hidden sm:inline-flex">Regenerate</FakeButton>
                </div>
              </div>
            </div>
          </div>

          {/* Details */}
          <div className="bg-muted/30 hidden flex-col gap-4 border-l p-4 text-xs md:flex">
            <div className="bg-card flex flex-col gap-2.5 rounded-lg border p-3">
              <span className="flex items-center justify-between">
                <span className="text-[13px] font-semibold">AI triage</span>
                <Chip className="border-success-border bg-success-subtle text-success-strong h-4 px-1 text-[10px]">
                  Applied
                </Chip>
              </span>
              {[
                ["Category", "billing"],
                ["Priority", "Normal"],
                ["Sentiment", "Neutral"],
                ["Language", "English"],
              ].map(([k, v]) => (
                <span key={k} className="flex justify-between gap-2">
                  <span className="text-muted-foreground">{k}</span>
                  <span className="font-medium">{v}</span>
                </span>
              ))}
              <span className="text-muted-foreground border-t pt-2 leading-relaxed">
                Applied automatically: category and priority.
              </span>
            </div>
            <div className="flex flex-col gap-2">
              <span className="text-[13px] font-semibold">Details</span>
              {[
                ["Status", "Open"],
                ["Assignee", "Olivia Owner"],
              ].map(([k, v]) => (
                <span key={k} className="flex flex-col gap-1">
                  <span className="text-muted-foreground">{k}</span>
                  <span className="bg-background flex h-7 items-center rounded-md border px-2">{v}</span>
                </span>
              ))}
              <span className="text-muted-foreground">Changes save as you make them.</span>
            </div>
          </div>
        </div>
      </div>

      {/* Floating: the passages the draft cites */}
      <div className="land-pop land-shadow-sm bg-popover text-popover-foreground absolute top-24 -right-6 hidden w-72 flex-col gap-2 rounded-lg border p-3 text-left [animation-delay:1000ms] xl:flex 2xl:-right-10">
        <span className="flex items-center gap-1.5 text-xs font-semibold">
          <BookOpen className="text-muted-foreground size-3.5" />
          Sources the draft may cite
        </span>
        {[
          {
            n: 1,
            title: "Refund policy › Annual plans",
            text: "Annual plans can be refunded in full within 30 days of purchase or renewal…",
          },
          {
            n: 2,
            title: "Cancel your subscription",
            text: "Go to Settings > Billing and choose Cancel plan. Your plan stays active until…",
          },
        ].map((s) => (
          <span key={s.n} className="bg-background flex gap-2 rounded-md border p-2">
            <Cite n={s.n} className="mt-0.5" />
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="truncate text-xs font-medium">{s.title}</span>
              <span className="text-muted-foreground line-clamp-2 text-[11px] leading-snug">{s.text}</span>
            </span>
          </span>
        ))}
      </div>

      {/* Floating: a live notice, as the inbox shows when a request arrives */}
      <div className="land-pop land-shadow-sm bg-popover text-popover-foreground absolute bottom-10 -left-6 hidden w-80 items-start gap-2.5 rounded-lg border p-3 text-left [animation-delay:1250ms] lg:flex 2xl:-left-10">
        <Inbox className="text-muted-foreground mt-0.5 size-4 shrink-0" />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-[13px] font-medium">New ticket #129</span>
          <span className="text-muted-foreground truncate text-xs">
            Can I add a second admin to our plan?
          </span>
        </span>
        <FakeButton className="h-6 px-2">Open</FakeButton>
      </div>
    </div>
  );
}
