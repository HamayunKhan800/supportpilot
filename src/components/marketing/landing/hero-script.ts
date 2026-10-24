/**
 * The landing page's live demo: sample data and a pure state machine. It runs in the visitor's
 * browser only (no AI call, nothing sent). Labels and behaviour follow the real app:
 * triage runs on arrival and is applied only at the auto-apply threshold (95 % by default); a draft
 * is written only when someone presses Generate draft; when no article is close enough, no AI
 * call is made; a reply goes out only on Approve & send, and sending does not change the status.
 */

export type DemoId = 128 | 129 | 130;
export const DEMO_IDS: readonly DemoId[] = [128, 129, 130];
export type Level = 1 | 2 | 3 | 4;
export const PRIORITY: Record<Level, string> = { 1: "Low", 2: "Normal", 3: "High", 4: "Urgent" };

/** A paragraph: words, with numbers standing for citation markers. */
export type Paragraph = (string | number)[];

export interface DemoTicket {
  n: DemoId;
  subject: string;
  customer: string;
  firstName: string;
  message: string;
  triage: {
    category: string;
    level: Level;
    sentiment: "Negative" | "Neutral" | "Positive";
    language: string;
    /** Confident enough to apply on its own (at or above the auto-apply threshold). */
    applied: boolean;
  };
  sources: { n: number; title: string; text: string }[];
  /** null: no article is close enough, so the app refuses before any AI call. */
  draft: Paragraph[] | null;
}

export const DEMO_TICKETS: Record<DemoId, DemoTicket> = {
  128: {
    n: 128,
    subject: "Refund for my annual plan",
    customer: "Priya Shah",
    firstName: "Priya",
    message:
      "My annual plan renewed 12 days ago and I didn't mean to keep it. Can I get my money back, and how long does it take?",
    triage: { category: "billing", level: 2, sentiment: "Neutral", language: "English", applied: true },
    sources: [
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
    ],
    draft: [
      ["Hi Priya,"],
      [
        "Yes. Annual plans can be refunded in full within 30 days of purchase or renewal, so your renewal qualifies",
        1,
        ". The refund goes back to your original payment method; your bank can take 5 to 10 business days to show it",
        1,
        ".",
      ],
      ["To stop the plan renewing, go to Settings > Billing and choose Cancel plan", 2, "."],
    ],
  },
  129: {
    n: 129,
    subject: "Can I add a second admin to our plan?",
    customer: "Daniel Kim",
    firstName: "Daniel",
    message:
      "We're growing and I'd like a colleague to help manage our account. Can I make her an admin too?",
    triage: { category: "account", level: 2, sentiment: "Positive", language: "English", applied: true },
    sources: [
      {
        n: 1,
        title: "Team roles › Admins",
        text: "Admins can invite and remove members and change settings. Only the owner can close…",
      },
      {
        n: 2,
        title: "Invite people to your team",
        text: "Go to Settings > Members, choose Invite and enter their email, then pick a role…",
      },
    ],
    draft: [
      ["Hi Daniel,"],
      [
        "Yes. Go to Settings > Members, choose Invite, enter your colleague's email and pick the Admin role",
        2,
        ".",
      ],
      [
        "Admins can invite and remove members and change settings; only the owner can close the account",
        1,
        ".",
      ],
    ],
  },
  130: {
    n: 130,
    subject: "Vocês vendem licença vitalícia?",
    customer: "Marta Silva",
    firstName: "Marta",
    message: "Olá! Existe um plano vitalício, com pagamento único? Obrigada.",
    triage: { category: "billing", level: 1, sentiment: "Positive", language: "Portuguese", applied: false },
    sources: [],
    draft: null,
  },
};

/** Older rows: background for the inbox, not part of the demo. */
export const OLDER_ROWS: {
  n: number;
  subject: string;
  who: string;
  tag: string;
  level: Level;
  status: "open" | "pending";
  review?: boolean;
  time: string;
}[] = [
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
    review: true,
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
    review: true,
    time: "2h",
  },
];

/** Tickets that existed before the demo started (count shown in the inbox tabs). */
export const BASE_ACTIVE = 16;

// ---------------------------------------------------------------------------------------------
// Draft text as tokens, so it can be revealed word by word.

export type Token = { kind: "word"; text: string; glue: boolean } | { kind: "cite"; n: number };

/** Splits paragraphs into tokens. Punctuation right after a citation sticks to it ("[1]."). */
export function tokenize(paragraphs: Paragraph[]): Token[][] {
  return paragraphs.map((p) =>
    p.flatMap((part): Token[] => {
      if (typeof part === "number") return [{ kind: "cite", n: part }];
      const glue = /^[.,;:!?]/.test(part);
      return part
        .split(/\s+/)
        .filter(Boolean)
        .map((text, i) => ({ kind: "word" as const, text, glue: glue && i === 0 }));
    }),
  );
}

export function tokenCount(paragraphs: Paragraph[] | null): number {
  return paragraphs ? tokenize(paragraphs).reduce((sum, p) => sum + p.length, 0) : 0;
}

/** The draft as plain text (what lands in the conversation once sent). */
export function plainText(paragraphs: Paragraph[]): string {
  return tokenize(paragraphs)
    .map((p) =>
      p
        .filter((t) => t.kind === "word")
        .map((t, i) => (i > 0 && !t.glue ? " " : "") + t.text)
        .join(""),
    )
    .join("\n\n");
}

// ---------------------------------------------------------------------------------------------
// State machine.

export type DraftState = "none" | "writing" | "streaming" | "ready" | "editing" | "refused";

export interface TicketState {
  arrived: boolean;
  /** Arrived during the demo (animate the new row); false for what was there on load. */
  fresh: boolean;
  triaged: boolean;
  draft: DraftState;
  shown: number;
  /** The reply as sent, once approved. */
  sent: string | null;
  edited: string | null;
}

export type Mode = "auto" | "paused" | "user" | "done";
export type PressTarget = "open" | "select" | "generate" | "approve";

export interface HeroState {
  tickets: Record<DemoId, TicketState>;
  /** Newest first. */
  order: DemoId[];
  selected: DemoId;
  /** Bumped when the selection changes, so the pane can replay its entrance. */
  selectCount: number;
  notice: DemoId | null;
  toast: { text: string; key: number } | null;
  mode: Mode;
  clock: number;
  step: number;
  pressing: { target: PressTarget; id: DemoId } | null;
}

export type HeroAction =
  | { type: "tick"; ms: number }
  | { type: "arrive"; id: DemoId }
  | { type: "triage"; id: DemoId }
  | { type: "press"; target: PressTarget; id: DemoId }
  | { type: "select"; id: DemoId }
  | { type: "generate"; id: DemoId }
  | { type: "startStream"; id: DemoId; instant?: boolean }
  | { type: "stream"; id: DemoId; words: number }
  | { type: "approve"; id: DemoId }
  | { type: "edit"; id: DemoId }
  | { type: "saveEdit"; id: DemoId; text: string }
  | { type: "dismissToast" }
  | { type: "takeOver" }
  | { type: "pause" }
  | { type: "play" }
  | { type: "replay"; mode?: Mode }
  | { type: "finish" };

type TimelineAction = Exclude<HeroAction, { type: "tick" | "takeOver" | "pause" | "play" | "replay" }>;

/** The self-playing script, in milliseconds of visible time. */
export const TIMELINE: { at: number; action: TimelineAction }[] = [
  { at: 2600, action: { type: "arrive", id: 129 } },
  { at: 3800, action: { type: "triage", id: 129 } },
  { at: 4900, action: { type: "press", target: "open", id: 129 } },
  { at: 5150, action: { type: "select", id: 129 } },
  { at: 6300, action: { type: "press", target: "generate", id: 129 } },
  { at: 6550, action: { type: "generate", id: 129 } },
  { at: 10600, action: { type: "press", target: "approve", id: 129 } },
  { at: 10850, action: { type: "approve", id: 129 } },
  { at: 13400, action: { type: "arrive", id: 130 } },
  { at: 14600, action: { type: "triage", id: 130 } },
  { at: 15700, action: { type: "press", target: "open", id: 130 } },
  { at: 15950, action: { type: "select", id: 130 } },
  { at: 17100, action: { type: "press", target: "generate", id: 130 } },
  { at: 17350, action: { type: "generate", id: 130 } },
  { at: 20500, action: { type: "finish" } },
];

const idle: TicketState = {
  arrived: false,
  fresh: false,
  triaged: false,
  draft: "none",
  shown: 0,
  sent: null,
  edited: null,
};

export function initialHeroState(mode: Mode = "auto"): HeroState {
  return {
    tickets: {
      128: {
        ...idle,
        arrived: true,
        triaged: true,
        draft: "ready",
        shown: tokenCount(DEMO_TICKETS[128].draft),
      },
      129: { ...idle },
      130: { ...idle },
    },
    order: [128],
    selected: 128,
    selectCount: 0,
    notice: null,
    toast: null,
    mode,
    clock: 0,
    step: 0,
    pressing: null,
  };
}

function patch(state: HeroState, id: DemoId, change: Partial<TicketState>): HeroState {
  return { ...state, tickets: { ...state.tickets, [id]: { ...state.tickets[id], ...change } } };
}

function apply(state: HeroState, action: TimelineAction): HeroState {
  const s = action.type === "press" ? state : { ...state, pressing: null };
  switch (action.type) {
    case "arrive": {
      if (s.tickets[action.id].arrived) return s;
      const next = patch(s, action.id, { arrived: true, fresh: true });
      return { ...next, order: [action.id, ...s.order], notice: action.id };
    }
    case "triage":
      return s.tickets[action.id].arrived ? patch(s, action.id, { triaged: true }) : s;
    case "press":
      return { ...s, pressing: { target: action.target, id: action.id } };
    case "select":
      if (!s.tickets[action.id].arrived) return s;
      return {
        ...s,
        selected: action.id,
        selectCount: s.selected === action.id ? s.selectCount : s.selectCount + 1,
        notice: s.notice === action.id ? null : s.notice,
      };
    case "generate": {
      const t = s.tickets[action.id];
      if (!t.arrived || t.sent) return s;
      return patch(s, action.id, { draft: "writing", shown: 0, edited: null });
    }
    case "startStream": {
      const t = s.tickets[action.id];
      if (t.draft !== "writing") return s;
      const draft = DEMO_TICKETS[action.id].draft;
      if (!draft) return patch(s, action.id, { draft: "refused" });
      return action.instant
        ? patch(s, action.id, { draft: "ready", shown: tokenCount(draft) })
        : patch(s, action.id, { draft: "streaming", shown: 0 });
    }
    case "stream": {
      const t = s.tickets[action.id];
      if (t.draft !== "streaming") return s;
      const total = tokenCount(DEMO_TICKETS[action.id].draft);
      const shown = Math.min(total, t.shown + action.words);
      return patch(s, action.id, { shown, draft: shown >= total ? "ready" : "streaming" });
    }
    case "approve": {
      const t = s.tickets[action.id];
      const ticket = DEMO_TICKETS[action.id];
      if (t.draft !== "ready" || !ticket.draft) return s;
      const text = t.edited ?? plainText(ticket.draft);
      const next = patch(s, action.id, { sent: text, draft: "none" });
      return { ...next, toast: { text: `Reply sent to ${ticket.customer}.`, key: (s.toast?.key ?? 0) + 1 } };
    }
    case "edit": {
      const t = s.tickets[action.id];
      const ticket = DEMO_TICKETS[action.id];
      if (t.draft !== "ready" || !ticket.draft) return s;
      return patch(s, action.id, { draft: "editing", edited: t.edited ?? plainText(ticket.draft) });
    }
    case "saveEdit":
      return s.tickets[action.id].draft === "editing"
        ? patch(s, action.id, { draft: "ready", edited: action.text })
        : s;
    case "dismissToast":
      return { ...s, toast: null };
    case "finish":
      return { ...s, mode: "done", notice: null };
  }
}

export function heroReducer(state: HeroState, action: HeroAction): HeroState {
  switch (action.type) {
    case "tick": {
      if (state.mode !== "auto") return state;
      let s: HeroState = { ...state, clock: state.clock + action.ms };
      for (let next = TIMELINE[s.step]; next && s.clock >= next.at; next = TIMELINE[s.step]) {
        s = { ...apply(s, next.action), step: s.step + 1 };
      }
      return s;
    }
    case "takeOver": {
      if (state.mode === "user") return state;
      // The visitor drives from here: every demo ticket is in the inbox and triaged.
      let s: HeroState = { ...state, mode: "user", pressing: null, notice: null };
      for (const id of [129, 130] as const) {
        if (!s.tickets[id].arrived)
          s = { ...patch(s, id, { arrived: true, fresh: true }), order: [id, ...s.order] };
        s = patch(s, id, { triaged: true });
      }
      return s;
    }
    case "pause":
      return state.mode === "auto" ? { ...state, mode: "paused", pressing: null } : state;
    case "play":
      return state.mode === "paused" ? { ...state, mode: "auto" } : state;
    case "replay":
      return initialHeroState(action.mode ?? "auto");
    default:
      return apply(state, action);
  }
}
