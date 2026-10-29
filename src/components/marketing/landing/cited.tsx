"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

/*
 * The landing page's few moving parts ("The cited sentence", docs/design/landing.md). Each one is
 * driven by the visitor, except the results highlight, which makes one pass of about five seconds
 * (under WCAG 2.2.2's limit, so it needs no pause control) and never runs with reduced motion.
 * Layout values are set through the CSSOM (element.style), which the strict CSP allows.
 */

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Runs `measure` again whenever web fonts finish loading: the first measurement may use the
 * fallback face, and `document.fonts.ready` is already resolved if loading had not started yet.
 * Returns a cleanup that also runs `cleanup`.
 */
function onFontsLoaded(measure: () => void, cleanup: () => void) {
  const fonts = typeof document !== "undefined" ? document.fonts : undefined;
  void fonts?.ready.then(measure);
  fonts?.addEventListener("loadingdone", measure);
  window.addEventListener("load", measure);
  return () => {
    fonts?.removeEventListener("loadingdone", measure);
    window.removeEventListener("load", measure);
    cleanup();
  };
}

/**
 * The hero: "AI drafts.[1] You approve." The number is a real control that opens the passage it
 * cites, as in the app. Above 980px (where the headline is always one line) CSS hangs the passage
 * from the number on first paint, and this measures the exact spot; otherwise it sits under the
 * headline.
 */
export function CitedHero({ children, passage }: { children: ReactNode; passage: ReactNode }) {
  const hero = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(true);

  useIsoLayoutEffect(() => {
    const el = hero.current;
    if (!el) return;
    const place = () => {
      const h1 = el.querySelector("h1");
      const cite = el.querySelector<HTMLElement>(".lp-cite");
      const lines = el.querySelectorAll<HTMLElement>("h1 .l");
      if (!h1 || !cite || lines.length < 2) return;
      const oneLine = Math.abs(lines[0]!.offsetTop - lines[1]!.offsetTop) < 4 && window.innerWidth > 980;
      if (!oneLine) return;
      const hr = el.getBoundingClientRect();
      const top =
        h1.getBoundingClientRect().bottom - hr.top + parseFloat(getComputedStyle(h1).fontSize) * 0.22 + 16;
      el.style.setProperty("--px", `${cite.getBoundingClientRect().left - hr.left}px`);
      el.style.setProperty("--py", `${top}px`);
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(el);
    return onFontsLoaded(place, () => ro.disconnect());
  }, []);

  return (
    <section ref={hero} className="lp-hero" aria-labelledby="lp-title">
      <h1 aria-labelledby="lp-title">
        <span className="l">
          AI drafts.
          <button
            type="button"
            className="lp-cite"
            aria-expanded={open}
            aria-controls="lp-passage"
            aria-label="Citation 1: the passage it came from"
            onClick={() => setOpen((o) => !o)}
          >
            1
          </button>
        </span>{" "}
        <span className="l">
          <em>You approve.</em>
        </span>
      </h1>
      <span id="lp-title" className="sr-only">
        AI drafts. You approve.
      </span>
      <figure id="lp-passage" className="lp-passage lp-ui" hidden={!open} aria-label="Citation 1">
        {passage}
      </figure>
      {children}
    </section>
  );
}

export interface Stage {
  name: string;
  clause: string;
  text: string;
  scene: ReactNode;
}

/**
 * How it works: one real range input drives the clause on the left and the app screen on the
 * right. Arrow keys and dragging both work; nothing depends on scroll.
 */
export function StageSlider({ stages }: { stages: Stage[] }) {
  const [i, setI] = useState(0);
  const range = useRef<HTMLInputElement>(null);
  const stage = stages[i]!;

  useEffect(() => {
    range.current?.style.setProperty("--p", `${(i / (stages.length - 1)) * 100}%`);
  }, [i, stages.length]);

  return (
    <section id="how" className="lp-how" aria-labelledby="lp-clause">
      <div className="left" data-reveal>
        <h2 id="lp-clause" className="lp-clause">
          {stage.clause}
        </h2>
        <p aria-live="polite">{stage.text}</p>
      </div>
      <div className="right lp-ui">
        {stages.map((s, n) => (
          <div key={s.name} className="lp-frag" data-on={n === i ? "" : undefined}>
            {s.scene}
          </div>
        ))}
      </div>
      <div className="lp-slider">
        <label htmlFor="lp-stage" className="sr-only">
          Ticket stage
        </label>
        <input
          ref={range}
          id="lp-stage"
          className="lp-range"
          type="range"
          min={0}
          max={stages.length - 1}
          step={1}
          value={i}
          aria-valuetext={stage.name}
          onChange={(e) => setI(Number(e.currentTarget.value))}
        />
        <div className="lp-stops" aria-hidden="true">
          {stages.map((s, n) => (
            <span key={s.name} data-on={n === i ? "" : undefined}>
              {s.name}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

/** "Nothing [Approve & send] itself." The button is the verb; pressing it shows who sent it. */
export function SendSentence() {
  const [sent, setSent] = useState(false);
  return (
    <section className="lp-show" aria-labelledby="lp-send-title">
      <h2 id="lp-send-title" className="sr-only">
        Nothing sends itself
      </h2>
      <div className="lp-poster" data-reveal>
        <span aria-hidden="true">Nothing</span>
        <button
          type="button"
          className="lp-send"
          aria-describedby="lp-send-note"
          onClick={() => setSent((s) => !s)}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z" />
          </svg>
          {sent ? "Sent by you" : "Approve & send"}
        </button>
        <span aria-hidden="true">itself.</span>
      </div>
      <p id="lp-send-note" className="lp-note" aria-live="polite" data-reveal>
        {sent
          ? "Sent, by a person: you. Press again to reset."
          : "Every reply waits for a person. This button is the only way a draft reaches a customer."}
      </p>
    </section>
  );
}

/**
 * The results sentence. Each clause lights in turn, once, when the sentence is first well in
 * view; then all stay lit. Without script or with reduced motion, all are lit from the start.
 */
export function Tally({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const clauses = Array.from(el.querySelectorAll<HTMLElement>(".k"));
    let timer: number | undefined;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        io.disconnect();
        let n = 0;
        el.setAttribute("data-run", "");
        clauses[0]?.setAttribute("data-on", "");
        timer = window.setInterval(() => {
          clauses[n]?.removeAttribute("data-on");
          n += 1;
          if (n < clauses.length) clauses[n]!.setAttribute("data-on", "");
          else {
            window.clearInterval(timer);
            el.removeAttribute("data-run");
          }
        }, 1250);
      },
      { threshold: 0.6 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      window.clearInterval(timer);
      el.removeAttribute("data-run");
      clauses.forEach((c) => c.removeAttribute("data-on"));
    };
  }, []);
  return (
    <p ref={ref} className="lp-state lp-tally">
      {children}
    </p>
  );
}

/** The footer's name: exactly the footer's width, cropped at the bottom edge only. */
export function FooterName() {
  const ref = useRef<HTMLParagraphElement>(null);
  useIsoLayoutEffect(() => {
    const el = ref.current;
    const word = el?.firstElementChild as HTMLElement | null;
    if (!el || !word) return;
    // A running font-size transition would make the measurement read the old size.
    el.style.transition = word.style.transition = "none";
    const fit = () => {
      el.style.fontSize = "100px";
      const w = word.getBoundingClientRect().width;
      if (w > 0) el.style.fontSize = `${((100 * el.clientWidth) / w) * 0.995}px`;
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return onFontsLoaded(fit, () => ro.disconnect());
  }, []);
  return (
    <p ref={ref} className="lp-name" aria-hidden="true">
      <span>SupportPilot</span>
    </p>
  );
}
