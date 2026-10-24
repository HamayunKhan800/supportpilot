"use client";

import {
  BarChart3,
  BookOpen,
  CircleCheck,
  FlaskConical,
  History,
  Inbox,
  LayoutGrid,
  Pause,
  Pencil,
  PenLine,
  Play,
  RotateCcw,
  Search,
  Send,
  Settings2,
  TriangleAlert,
  Users,
} from "lucide-react";
import { useEffect, useReducer, useRef, useState, type ReactNode } from "react";
import { LogoMark } from "@/components/logo";
import { cn } from "@/lib/utils";
import {
  BASE_ACTIVE,
  DEMO_IDS,
  DEMO_TICKETS,
  heroReducer,
  initialHeroState,
  OLDER_ROWS,
  PRIORITY,
  tokenCount,
  tokenize,
  type DemoId,
  type HeroAction,
  type HeroState,
  type PressTarget,
} from "./hero-script";
import { Chip, Cite, Initials, PriorityBars, StatusRing } from "./mock";

/**
 * The hero: a small working copy of the agent's workspace on sample data. It plays by itself
 * (a request arrives, triage fills in, a draft streams in with its citations, an agent approves
 * it, then a request no article answers is refused before any AI call) and the visitor can take
 * over at any point. It runs in the browser only. It pauses off screen and in a hidden tab, has a
 * Pause button (WCAG 2.2.2), and does not play by itself with reduced motion. The server renders
 * the opening state, so the page reads the same without JavaScript.
 */

const NAV = [
  { icon: LayoutGrid, label: "Overview" },
  { icon: Inbox, label: "Tickets", active: true },
  { icon: BookOpen, label: "Knowledge" },
  { icon: BarChart3, label: "Analytics" },
  { icon: FlaskConical, label: "Evaluation" },
  { icon: Users, label: "Members" },
  { icon: Settings2, label: "AI settings" },
  { icon: History, label: "Audit log" },
];

const BELOW_MIN_SCORE =
  "No article is close enough to this question, so no AI call was made. Write this reply yourself, or add an article that answers it.";

const STREAM_MS = 38;
const WRITING_MS = 650;
const TOAST_MS = 3200;

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    query.addEventListener("change", update);
    // Read once after mount (the server can't know); a subscription callback, not an effect body.
    queueMicrotask(update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}

/**
 * `compact` is for narrower, shorter places (the sign-in page's side panel): a lower window. The
 * columns follow the container's width either way (container queries), not the screen's.
 */
export function HeroLive({ compact = false }: { compact?: boolean }) {
  const [state, dispatch] = useReducer(heroReducer, undefined, () => initialHeroState("auto"));
  const reduced = useReducedMotion();
  const [visible, setVisible] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  // Play only while on screen and in a visible tab.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    let onScreen = false;
    const update = () => setVisible(onScreen && document.visibilityState === "visible");
    const observer = new IntersectionObserver(
      ([entry]) => {
        onScreen = entry?.isIntersecting ?? false;
        update();
      },
      { threshold: 0.3 },
    );
    observer.observe(el);
    document.addEventListener("visibilitychange", update);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", update);
    };
  }, []);

  // With reduced motion the demo waits for the visitor instead of playing by itself.
  const [playRequested, setPlayRequested] = useState(false);
  const mode = reduced && state.mode === "auto" && !playRequested ? "paused" : state.mode;
  const autoRunning = mode === "auto" && visible;
  useEffect(() => {
    if (!autoRunning) return;
    const id = window.setInterval(() => dispatch({ type: "tick", ms: 100 }), 100);
    return () => window.clearInterval(id);
  }, [autoRunning]);

  const writing = DEMO_IDS.find((id) => state.tickets[id].draft === "writing");
  useEffect(() => {
    if (writing === undefined) return;
    const id = window.setTimeout(
      () => dispatch({ type: "startStream", id: writing, instant: reduced }),
      reduced ? 0 : WRITING_MS,
    );
    return () => window.clearTimeout(id);
  }, [writing, reduced]);

  const streaming = DEMO_IDS.find((id) => state.tickets[id].draft === "streaming");
  useEffect(() => {
    if (streaming === undefined) return;
    const id = window.setInterval(() => dispatch({ type: "stream", id: streaming, words: 1 }), STREAM_MS);
    return () => window.clearInterval(id);
  }, [streaming]);

  const toastKey = state.toast?.key;
  useEffect(() => {
    if (toastKey === undefined) return;
    const id = window.setTimeout(() => dispatch({ type: "dismissToast" }), TOAST_MS);
    return () => window.clearTimeout(id);
  }, [toastKey]);

  /** A visitor's action: they drive from now on. */
  const act = (action: HeroAction) => {
    dispatch({ type: "takeOver" });
    dispatch(action);
  };

  return (
    <div ref={root} className="@container relative">
      <div
        role="group"
        aria-label="Interactive demo of the SupportPilot inbox, with sample data"
        className="land-in land-shadow bg-card text-card-foreground relative overflow-hidden rounded-xl border text-left"
      >
        <div
          className={cn(
            "grid grid-cols-1",
            compact ? "h-[34rem]" : "h-[38rem]",
            "@min-[44rem]:grid-cols-[minmax(0,1fr)_14rem] @min-[56rem]:grid-cols-[17rem_minmax(0,1fr)_14rem] @min-[68rem]:grid-cols-[11rem_17.5rem_minmax(0,1fr)_14rem]",
          )}
        >
          <Sidebar open={9 + state.order.length} />
          <InboxList state={state} onSelect={(id) => act({ type: "select", id })} />
          <TicketPane state={state} act={act} />
          <DetailsPane state={state} />
        </div>
        <Toast state={state} />
      </div>

      <SourcesPanel state={state} />
      <NewTicketNotice state={state} onOpen={(id) => act({ type: "select", id })} />

      <DemoControls
        mode={mode}
        onPause={() => dispatch({ type: "pause" })}
        onPlay={() => (state.mode === "auto" ? setPlayRequested(true) : dispatch({ type: "play" }))}
        onReplay={() => dispatch({ type: "replay" })}
      />
      <Announcer state={state} />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------

function pressed(state: HeroState, target: PressTarget, id: DemoId) {
  return state.pressing?.target === target && state.pressing.id === id;
}

/** Buttons inside the demo: small, as in the app, with a 28 px target. */
function DemoButton({
  children,
  primary = false,
  pressing = false,
  className,
  ...props
}: React.ComponentProps<"button"> & { primary?: boolean; pressing?: boolean }) {
  return (
    <button
      type="button"
      data-pressing={pressing || undefined}
      className={cn(
        "inline-flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium whitespace-nowrap transition-[background-color,scale,box-shadow] duration-150",
        "data-[pressing]:ring-foreground/25 data-[pressing]:scale-95 data-[pressing]:ring-4",
        primary
          ? "bg-primary text-primary-foreground hover:bg-primary/85 border-transparent"
          : "bg-background hover:bg-muted",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

function Sidebar({ open }: { open: number }) {
  return (
    <div className="bg-muted/40 hidden flex-col gap-3 border-r p-3 @min-[68rem]:flex">
      <div className="flex items-center gap-2 px-1 pb-1">
        <LogoMark className="size-5 [&_svg]:size-4" />
        <span className="truncate text-[13px] font-semibold">Nimbus Cloud</span>
      </div>
      <div className="text-muted-foreground flex h-7 items-center gap-2 rounded-md border px-2 text-xs">
        <Search aria-hidden="true" className="size-3.5" />
        Search…
      </div>
      <ul aria-hidden="true" className="flex flex-col gap-0.5 text-[13px]">
        {NAV.map(({ icon: Icon, label, active: current }) => (
          <li
            key={label}
            className={cn(
              "flex h-7 items-center gap-2 rounded-md px-2",
              current ? "bg-accent text-foreground font-medium" : "text-muted-foreground",
            )}
          >
            <Icon className="size-3.5" />
            <span className="flex-1">{label}</span>
            {current && <span className="text-muted-foreground text-[11px] tabular-nums">{open}</span>}
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
  );
}

function InboxList({ state, onSelect }: { state: HeroState; onSelect: (id: DemoId) => void }) {
  return (
    <div className="hidden min-w-0 flex-col border-r @min-[56rem]:flex">
      <div className="flex items-center justify-between gap-2 border-b px-3.5 py-2.5">
        <span className="text-[13px] font-semibold">Tickets</span>
        <span className="text-muted-foreground flex gap-1 text-[11px] tabular-nums">
          <span className="bg-accent text-foreground rounded px-1.5 py-0.5 font-medium">
            Active {BASE_ACTIVE + state.order.length}
          </span>
          <span className="px-1.5 py-0.5">Open {10 + state.order.length}</span>
        </span>
      </div>
      <ul aria-label="Demo tickets" className="flex flex-col overflow-hidden">
        {state.order.map((id) => {
          const t = DEMO_TICKETS[id];
          const s = state.tickets[id];
          const current = state.selected === id;
          return (
            <li key={id} className={cn(s.fresh && "land-in")}>
              <button
                type="button"
                aria-current={current || undefined}
                data-pressing={pressed(state, "select", id) || undefined}
                onClick={() => onSelect(id)}
                className={cn(
                  "flex w-full cursor-pointer flex-col gap-1 border-b px-3.5 py-2.5 text-left transition-colors",
                  "hover:bg-muted/60 focus-visible:outline-offset-[-2px]",
                  current && "bg-accent/70 hover:bg-accent/70 shadow-[inset_2px_0_0_var(--foreground)]",
                )}
              >
                <span className="flex items-center gap-2">
                  <StatusRing status="open" />
                  <span className="truncate text-[13px] font-medium">{t.subject}</span>
                  <span className="text-muted-foreground ml-auto shrink-0 text-[11px] tabular-nums">
                    {s.fresh ? "now" : "2m"}
                  </span>
                </span>
                <span className="flex min-h-4 items-center gap-1.5 pl-[1.375rem]">
                  <span className="text-muted-foreground truncate text-[11px]">{t.customer}</span>
                  {s.triaged ? (
                    <>
                      <Chip className="land-pop h-4 px-1 text-[10px]">{t.triage.category}</Chip>
                      {!t.triage.applied && (
                        <Chip className="land-pop border-warning-border bg-warning-subtle text-warning-strong h-4 px-1 text-[10px]">
                          Needs review
                        </Chip>
                      )}
                      {(s.draft === "ready" || s.draft === "editing") && !s.sent && (
                        <Chip className="text-foreground h-4 gap-0.5 px-1 text-[10px]">
                          <PenLine aria-hidden="true" className="size-2.5" />
                          AI draft ready
                        </Chip>
                      )}
                      <span className="ml-auto">
                        <PriorityBars level={t.triage.level} />
                      </span>
                    </>
                  ) : (
                    <span className="bg-muted h-3 w-16 animate-pulse rounded motion-reduce:animate-none" />
                  )}
                </span>
              </button>
            </li>
          );
        })}
        {OLDER_ROWS.map((t) => (
          <li key={t.n} aria-hidden="true" className="flex flex-col gap-1 border-b px-3.5 py-2.5">
            <span className="flex items-center gap-2">
              <StatusRing status={t.status} />
              <span className="text-muted-foreground truncate text-[13px]">{t.subject}</span>
              <span className="text-muted-foreground ml-auto shrink-0 text-[11px] tabular-nums">
                {t.time}
              </span>
            </span>
            <span className="flex items-center gap-1.5 pl-[1.375rem]">
              <span className="text-muted-foreground truncate text-[11px]">{t.who}</span>
              <Chip className="h-4 px-1 text-[10px]">{t.tag}</Chip>
              {t.review && (
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
  );
}

function TicketPane({ state, act }: { state: HeroState; act: (a: HeroAction) => void }) {
  const id = state.selected;
  const t = DEMO_TICKETS[id];
  const s = state.tickets[id];
  const index = state.order.indexOf(id) + 1;
  return (
    <div className="flex min-w-0 flex-col overflow-hidden">
      {/* Phones and tablets have no inbox column: switch tickets here. */}
      <div className="flex gap-1.5 overflow-x-auto border-b px-4 py-2 @min-[56rem]:hidden">
        {state.order.map((n) => (
          <button
            key={n}
            type="button"
            aria-current={n === id || undefined}
            onClick={() => act({ type: "select", id: n })}
            className={cn(
              "inline-flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-md border px-2 text-xs",
              n === id ? "bg-accent text-foreground font-medium" : "text-muted-foreground hover:bg-muted",
              state.tickets[n].fresh && "land-pop",
            )}
          >
            #{n}
            {!DEMO_TICKETS[n].triage.applied && state.tickets[n].triaged && (
              <>
                <span aria-hidden="true" className="bg-warning-strong size-1.5 rounded-full" />
                <span className="sr-only">needs review</span>
              </>
            )}
          </button>
        ))}
      </div>

      <div
        key={id}
        className={cn(
          "flex min-w-0 flex-1 flex-col gap-3 overflow-hidden p-4 sm:p-5",
          state.selectCount > 0 && "land-in",
        )}
      >
        <div className="text-muted-foreground flex items-center gap-1.5 text-[11px]">
          <span>All tickets</span>
          <span aria-hidden="true">/</span>
          <span className="text-foreground font-medium">#{id}</span>
          <span className="ml-auto tabular-nums">
            {index} of {BASE_ACTIVE + state.order.length}
          </span>
        </div>
        <div className="flex flex-col gap-1.5">
          <p className="text-lg leading-tight font-semibold tracking-tight">
            <span className="text-muted-foreground font-normal">#{id}</span> {t.subject}
          </p>
          <p className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <span className="inline-flex items-center gap-1.5">
              <StatusRing status="open" /> Open
            </span>
            {s.triaged && (
              <span className="inline-flex items-center gap-1.5">
                <PriorityBars level={t.triage.level} /> {PRIORITY[t.triage.level]}
              </span>
            )}
            <span>From {t.customer}</span>
          </p>
        </div>

        <Message who={t.customer} role="customer">
          {t.message}
        </Message>
        {s.sent && (
          <Message who="Olivia Owner" role="support team" agent>
            {s.sent.replace(/\n+/g, " ")}
          </Message>
        )}

        <DraftPanel state={state} act={act} />
      </div>
    </div>
  );
}

function Message({
  who,
  role,
  agent = false,
  children,
}: {
  who: string;
  role: string;
  agent?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={cn("flex gap-2.5", agent && "land-in")}>
      <Initials name={who} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-xs">
          <span className="font-medium">{who}</span>
          <span className="text-muted-foreground"> · {role}</span>
        </span>
        <p
          className={cn(
            "rounded-lg border px-3 py-2 text-[13px] leading-relaxed",
            agent ? "bg-muted/50" : "bg-background",
          )}
        >
          <span className={cn(agent && "line-clamp-3")}>{children}</span>
        </p>
      </div>
    </div>
  );
}

function DraftPanel({ state, act }: { state: HeroState; act: (a: HeroAction) => void }) {
  const id = state.selected;
  const t = DEMO_TICKETS[id];
  const s = state.tickets[id];
  const [text, setText] = useState("");

  if (s.sent) {
    return (
      <p className="text-success-strong flex items-center gap-1.5 text-xs">
        <CircleCheck aria-hidden="true" className="size-3.5" />
        Reply sent to {t.customer}. It now appears in the conversation.
      </p>
    );
  }

  const header = (
    <div className="flex items-center gap-2 border-b px-3 py-2">
      <PenLine aria-hidden="true" className="text-muted-foreground size-3.5" />
      <span className="text-[13px] font-semibold">AI draft</span>
      {s.draft !== "none" && s.draft !== "refused" && (
        <span className="text-muted-foreground font-mono text-[11px]">· gemini-3.8-flash</span>
      )}
    </div>
  );

  if (s.draft === "none") {
    return (
      <div className="flex flex-col rounded-lg border">
        {header}
        <div className="flex flex-wrap items-center gap-3 p-3">
          <DemoButton
            primary
            pressing={pressed(state, "generate", id)}
            onClick={() => act({ type: "generate", id })}
          >
            <PenLine aria-hidden="true" className="size-3.5" />
            Generate draft
          </DemoButton>
          <span className="text-muted-foreground text-xs">
            Uses the closest passages in your help centre.
          </span>
        </div>
      </div>
    );
  }

  if (s.draft === "refused") {
    return (
      <div className="land-in border-warning-border bg-warning-subtle flex gap-2.5 rounded-lg border p-3">
        <TriangleAlert aria-hidden="true" className="text-warning-strong mt-0.5 size-4 shrink-0" />
        <p className="text-[13px] leading-relaxed">{BELOW_MIN_SCORE}</p>
      </div>
    );
  }

  if (s.draft === "writing") {
    return (
      <div className="flex flex-col rounded-lg border" aria-busy="true">
        {header}
        <div className="flex flex-col gap-2 p-3">
          {["w-1/4", "w-full", "w-11/12", "w-2/3"].map((w) => (
            <span
              key={w}
              className={cn("bg-muted h-3 animate-pulse rounded motion-reduce:animate-none", w)}
            />
          ))}
        </div>
      </div>
    );
  }

  const total = tokenCount(t.draft);
  const ready = s.draft === "ready";
  return (
    <div className="flex min-h-0 flex-col rounded-lg border">
      {header}
      <div className="flex min-h-0 flex-col gap-3 p-3">
        {ready && (
          <ul className="flex flex-wrap gap-1.5">
            {[
              `Cites ${t.sources.length} sources`,
              "Every citation matches a source",
              "No unfamiliar links",
            ].map((label) => (
              <li key={label} className="land-pop">
                <Chip>
                  <CircleCheck aria-hidden="true" className="text-success-strong size-3" />
                  {label}
                </Chip>
              </li>
            ))}
          </ul>
        )}
        {s.draft === "editing" ? (
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted-foreground">Edit the reply to {t.customer}</span>
            <textarea
              defaultValue={s.edited ?? ""}
              onChange={(e) => setText(e.target.value)}
              rows={6}
              className="border-input bg-background field-focus resize-none rounded-md border px-2.5 py-2 text-[13px] leading-relaxed"
            />
          </label>
        ) : s.edited ? (
          <p className="text-[13px] leading-relaxed whitespace-pre-line">{s.edited}</p>
        ) : (
          <DraftText
            id={id}
            shown={s.draft === "streaming" ? s.shown : total}
            streaming={s.draft === "streaming"}
          />
        )}
        {(ready || s.draft === "editing") && (
          <div className="land-in flex flex-wrap gap-2 pt-1">
            {s.draft === "editing" ? (
              <DemoButton
                primary
                onClick={() => act({ type: "saveEdit", id, text: text || (s.edited ?? "") })}
              >
                Done editing
              </DemoButton>
            ) : (
              <>
                <DemoButton
                  primary
                  pressing={pressed(state, "approve", id)}
                  onClick={() => act({ type: "approve", id })}
                >
                  <Send aria-hidden="true" className="size-3.5" />
                  Approve &amp; send
                </DemoButton>
                <DemoButton
                  onClick={() => {
                    setText("");
                    act({ type: "edit", id });
                  }}
                >
                  <Pencil aria-hidden="true" className="size-3.5" />
                  Edit
                </DemoButton>
                <DemoButton className="hidden sm:inline-flex" onClick={() => act({ type: "generate", id })}>
                  Regenerate
                </DemoButton>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function DraftText({ id, shown, streaming }: { id: DemoId; shown: number; streaming: boolean }) {
  const paragraphs = tokenize(DEMO_TICKETS[id].draft ?? []);
  // Where each paragraph starts in the word count.
  const starts = paragraphs.map((_, p) => paragraphs.slice(0, p).reduce((sum, t) => sum + t.length, 0));
  return (
    <div className="flex flex-col gap-2 text-[13px] leading-relaxed" aria-busy={streaming || undefined}>
      {paragraphs.map((tokens, p) => {
        const room = shown - (starts[p] ?? 0);
        if (room <= 0) return null;
        const visible = tokens.slice(0, room);
        const last = room <= tokens.length;
        return (
          <p key={p}>
            {visible.map((tok, i) =>
              tok.kind === "cite" ? (
                <span key={i}>
                  {" "}
                  <Cite n={tok.n} />
                </span>
              ) : (
                <span key={i}>
                  {i > 0 && !tok.glue ? " " : ""}
                  {tok.text}
                </span>
              ),
            )}
            {streaming && last && (
              <span
                aria-hidden="true"
                className="bg-foreground ml-0.5 inline-block h-3.5 w-[2px] translate-y-0.5 animate-[caret-blink_1s_steps(1)_infinite] motion-reduce:animate-none"
              />
            )}
          </p>
        );
      })}
    </div>
  );
}

function DetailsPane({ state }: { state: HeroState }) {
  const id = state.selected;
  const t = DEMO_TICKETS[id];
  const s = state.tickets[id];
  return (
    <div className="bg-muted/30 hidden flex-col gap-4 border-l p-4 text-xs @min-[44rem]:flex">
      <div className="bg-card flex flex-col gap-2.5 rounded-lg border p-3">
        <span className="flex items-center justify-between">
          <span className="text-[13px] font-semibold">AI triage</span>
          {s.triaged &&
            (t.triage.applied ? (
              <Chip className="land-pop border-success-border bg-success-subtle text-success-strong h-4 px-1 text-[10px]">
                Applied
              </Chip>
            ) : (
              <Chip className="land-pop border-warning-border bg-warning-subtle text-warning-strong h-4 px-1 text-[10px]">
                Needs review
              </Chip>
            ))}
        </span>
        {(
          [
            ["Category", t.triage.category],
            ["Priority", PRIORITY[t.triage.level]],
            ["Sentiment", t.triage.sentiment],
            ["Language", t.triage.language],
          ] as const
        ).map(([k, v]) => (
          <span key={k} className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">{k}</span>
            {s.triaged ? (
              <span className="land-in font-medium">{v}</span>
            ) : (
              <span className="bg-muted h-3 w-14 animate-pulse rounded motion-reduce:animate-none" />
            )}
          </span>
        ))}
        {s.triaged && (
          <span className="land-in text-muted-foreground border-t pt-2 leading-relaxed">
            {t.triage.applied
              ? "Applied automatically: category and priority."
              : "Not applied automatically: confidence is below 95%. Accept it, or change the details."}
          </span>
        )}
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-[13px] font-semibold">Details</span>
        {[
          ["Status", "Open"],
          ["Assignee", id === 128 ? "Olivia Owner" : "Unassigned"],
        ].map(([k, v]) => (
          <span key={k} className="flex flex-col gap-1">
            <span className="text-muted-foreground">{k}</span>
            <span className="bg-background flex h-7 items-center rounded-md border px-2">{v}</span>
          </span>
        ))}
        <span className="text-muted-foreground">Changes save as you make them.</span>
      </div>
    </div>
  );
}

function SourcesPanel({ state }: { state: HeroState }) {
  const t = DEMO_TICKETS[state.selected];
  return (
    <div className="land-pop land-shadow-sm bg-popover text-popover-foreground absolute top-[20rem] -right-6 hidden w-72 flex-col gap-2 rounded-lg border p-3 text-left [animation-delay:600ms] 2xl:-right-10 @min-[68rem]:flex">
      <span className="flex items-center gap-1.5 text-xs font-semibold">
        <BookOpen aria-hidden="true" className="text-muted-foreground size-3.5" />
        Sources the draft may cite
      </span>
      {t.sources.length === 0 ? (
        <span className="text-muted-foreground bg-background rounded-md border p-2 text-[11px] leading-snug">
          None above the minimum match score (0.62), so no draft is written.
        </span>
      ) : (
        t.sources.map((src) => (
          <span key={`${t.n}-${src.n}`} className="land-in bg-background flex gap-2 rounded-md border p-2">
            <Cite n={src.n} className="mt-0.5" />
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="truncate text-xs font-medium">{src.title}</span>
              <span className="text-muted-foreground line-clamp-2 text-[11px] leading-snug">{src.text}</span>
            </span>
          </span>
        ))
      )}
    </div>
  );
}

function NewTicketNotice({ state, onOpen }: { state: HeroState; onOpen: (id: DemoId) => void }) {
  if (state.notice === null) return null;
  const t = DEMO_TICKETS[state.notice];
  return (
    <div
      key={t.n}
      className="land-pop land-shadow-sm bg-popover text-popover-foreground absolute bottom-16 -left-6 hidden w-80 items-start gap-2.5 rounded-lg border p-3 text-left 2xl:-left-10 @min-[56rem]:flex"
    >
      <Inbox aria-hidden="true" className="text-muted-foreground mt-0.5 size-4 shrink-0" />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[13px] font-medium">New ticket #{t.n}</span>
        <span className="text-muted-foreground truncate text-xs">{t.subject}</span>
      </span>
      <DemoButton pressing={pressed(state, "open", t.n)} onClick={() => onOpen(t.n)} className="h-7 px-2">
        Open
      </DemoButton>
    </div>
  );
}

function Toast({ state }: { state: HeroState }) {
  if (!state.toast) return null;
  return (
    <div
      key={state.toast.key}
      className="land-pop land-shadow-sm bg-popover text-popover-foreground absolute right-4 bottom-4 flex items-center gap-2 rounded-lg border px-3 py-2 text-[13px]"
    >
      <CircleCheck aria-hidden="true" className="text-success-strong size-4" />
      {state.toast.text}
    </div>
  );
}

function DemoControls({
  mode,
  onPause,
  onPlay,
  onReplay,
}: {
  mode: HeroState["mode"];
  onPause: () => void;
  onPlay: () => void;
  onReplay: () => void;
}) {
  const status = {
    auto: "Playing. Click anything to take over.",
    paused: "Paused. Press play, or try it yourself.",
    user: "Your turn: pick a ticket, generate a draft, edit it, approve it.",
    done: "That's the loop. Try it yourself, or replay it.",
  }[mode];
  return (
    <div className="mt-4 flex flex-col gap-3 text-sm sm:flex-row sm:items-center sm:justify-between">
      <p className="text-muted-foreground">
        Live demo with sample data, running in your browser: no AI call, nothing is sent.{" "}
        <span className="text-foreground">{status}</span>
      </p>
      <div className="flex shrink-0 gap-2">
        {mode === "auto" && (
          <ControlButton onClick={onPause}>
            <Pause aria-hidden="true" className="size-3.5" />
            Pause
          </ControlButton>
        )}
        {mode === "paused" && (
          <ControlButton onClick={onPlay}>
            <Play aria-hidden="true" className="size-3.5" />
            Play
          </ControlButton>
        )}
        {(mode === "user" || mode === "done") && (
          <ControlButton onClick={onReplay}>
            <RotateCcw aria-hidden="true" className="size-3.5" />
            Replay
          </ControlButton>
        )}
      </div>
    </div>
  );
}

function ControlButton(props: React.ComponentProps<"button">) {
  return (
    <button
      type="button"
      className="border-foreground/20 hover:bg-foreground/10 inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md border px-3 text-sm font-medium transition-colors"
      {...props}
    />
  );
}

/** Speaks outcomes of the visitor's own actions only; the self-playing script stays quiet. */
function Announcer({ state }: { state: HeroState }) {
  const s = state.tickets[state.selected];
  const t = DEMO_TICKETS[state.selected];
  let message = "";
  if (state.mode === "user") {
    if (s.sent) message = `Reply sent to ${t.customer}.`;
    else if (s.draft === "writing") message = "Writing a draft…";
    else if (s.draft === "ready") message = "Draft ready. Review it before sending.";
    else if (s.draft === "refused") message = BELOW_MIN_SCORE;
  }
  return (
    <p aria-live="polite" className="sr-only">
      {message}
    </p>
  );
}
