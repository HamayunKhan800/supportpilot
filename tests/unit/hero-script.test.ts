import { describe, expect, it } from "vitest";
import {
  DEMO_TICKETS,
  heroReducer,
  initialHeroState,
  plainText,
  TIMELINE,
  tokenCount,
  tokenize,
  type HeroAction,
  type HeroState,
} from "@/components/marketing/landing/hero-script";

const run = (state: HeroState, ...actions: HeroAction[]) => actions.reduce(heroReducer, state);
/** Advances the self-playing clock, as the component does every 100 ms. */
const play = (state: HeroState, ms: number) => {
  let s = state;
  for (let t = 0; t < ms; t += 100) s = heroReducer(s, { type: "tick", ms: 100 });
  return s;
};
/** Lets a written draft stream to the end, as the component's timers would. */
const finishDraft = (state: HeroState, id: 128 | 129 | 130) =>
  run(state, { type: "startStream", id }, { type: "stream", id, words: 999 });

describe("draft tokens", () => {
  it("keeps punctuation after a citation attached to it", () => {
    const [p] = tokenize([["renewal qualifies", 1, ". The refund"]]);
    expect(p).toEqual([
      { kind: "word", text: "renewal", glue: false },
      { kind: "word", text: "qualifies", glue: false },
      { kind: "cite", n: 1 },
      { kind: "word", text: ".", glue: true },
      { kind: "word", text: "The", glue: false },
      { kind: "word", text: "refund", glue: false },
    ]);
  });

  it("sends plain text without citation markers", () => {
    expect(plainText([["Hi Priya,"], ["It qualifies", 1, "."]])).toBe("Hi Priya,\n\nIt qualifies.");
  });

  it("every citation in a demo draft points at one of its sources", () => {
    for (const t of Object.values(DEMO_TICKETS)) {
      const cited = (t.draft ?? []).flat().filter((x): x is number => typeof x === "number");
      for (const n of cited) expect(t.sources.map((s) => s.n)).toContain(n);
    }
  });
});

describe("the self-playing script", () => {
  it("starts with one ticket and its draft ready, like the server-rendered page", () => {
    const s = initialHeroState();
    expect(s.order).toEqual([128]);
    expect(s.tickets[128]).toMatchObject({ draft: "ready", shown: tokenCount(DEMO_TICKETS[128].draft) });
  });

  it("brings in a ticket, triages it, then opens it", () => {
    let s = play(initialHeroState(), 2700);
    expect(s.order).toEqual([129, 128]);
    expect(s.notice).toBe(129);
    expect(s.tickets[129].triaged).toBe(false);
    s = play(s, 1200);
    expect(s.tickets[129].triaged).toBe(true);
    s = play(s, 1400);
    expect(s.selected).toBe(129);
    expect(s.notice).toBeNull();
  });

  it("writes a draft only after Generate draft is pressed", () => {
    let s = play(initialHeroState(), 6400);
    expect(s.tickets[129].draft).toBe("none");
    expect(s.pressing).toEqual({ target: "generate", id: 129 });
    s = play(s, 300);
    expect(s.tickets[129].draft).toBe("writing");
  });

  it("sends the reply on approve, says so, and leaves the status alone", () => {
    let s = play(initialHeroState(), 6700);
    s = finishDraft(s, 129);
    s = play(s, 4300);
    expect(s.tickets[129].sent).toContain("Hi Daniel,");
    expect(s.tickets[129].sent).not.toMatch(/\[\d\]/);
    expect(s.toast?.text).toBe("Reply sent to Daniel Kim.");
  });

  it("refuses the request no article answers, without a draft", () => {
    let s = play(initialHeroState(), 17400);
    expect(s.tickets[130].triaged).toBe(true);
    expect(DEMO_TICKETS[130].triage.applied).toBe(false);
    s = run(s, { type: "startStream", id: 130 });
    expect(s.tickets[130].draft).toBe("refused");
  });

  it("ends, and stays put until replayed", () => {
    const end = TIMELINE.at(-1)!.at;
    const s = play(initialHeroState(), end + 100);
    expect(s.mode).toBe("done");
    expect(play(s, 5000)).toEqual(s);
    expect(heroReducer(s, { type: "replay" })).toEqual(initialHeroState());
  });

  it("does not advance while paused", () => {
    const s = run(play(initialHeroState(), 1000), { type: "pause" });
    expect(play(s, 10_000).clock).toBe(1000);
    expect(heroReducer(s, { type: "play" }).mode).toBe("auto");
  });
});

describe("the visitor taking over", () => {
  it("stops the script and puts every demo ticket in the inbox, triaged", () => {
    const s = heroReducer(initialHeroState(), { type: "takeOver" });
    expect(s.mode).toBe("user");
    expect(s.order).toEqual([130, 129, 128]);
    expect(s.tickets[129].triaged && s.tickets[130].triaged).toBe(true);
    expect(play(s, 30_000)).toEqual(s);
  });

  it("can edit a draft and send the edited text", () => {
    let s = run(
      initialHeroState(),
      { type: "takeOver" },
      { type: "edit", id: 128 },
      { type: "saveEdit", id: 128, text: "Hi Priya, done." },
      { type: "approve", id: 128 },
    );
    expect(s.tickets[128].sent).toBe("Hi Priya, done.");
    // A sent ticket can't get a new draft.
    s = heroReducer(s, { type: "generate", id: 128 });
    expect(s.tickets[128].draft).toBe("none");
  });

  it("can't approve a draft that is still streaming", () => {
    const s = run(
      initialHeroState(),
      { type: "takeOver" },
      { type: "select", id: 129 },
      { type: "generate", id: 129 },
      { type: "startStream", id: 129 },
      { type: "approve", id: 129 },
    );
    expect(s.tickets[129].sent).toBeNull();
    expect(s.tickets[129].draft).toBe("streaming");
  });

  it("shows the finished draft at once with reduced motion", () => {
    const s = run(
      initialHeroState(),
      { type: "takeOver" },
      { type: "generate", id: 129 },
      { type: "startStream", id: 129, instant: true },
    );
    expect(s.tickets[129]).toMatchObject({ draft: "ready", shown: tokenCount(DEMO_TICKETS[129].draft) });
  });
});
