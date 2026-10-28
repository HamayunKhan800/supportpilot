/**
 * Facts shown on the public landing page (design system step 5). Every number comes from a
 * saved evaluation report and carries its sample size and 95% Wilson interval; update them
 * from the report when a newer run finishes (docs/eval/README.md explains the method).
 *
 * Sources (Gemini, dataset ba1b4b3d915f): eval/results/eval-gemini-d4f53fa4.md (run d4f53fa4,
 * the complete 420-item run of 2026-10-24, summarised in docs/eval/m6-baseline.md), and for triage
 * eval/results/eval-gemini-75a705fc.md (run 75a705fc, the app's current prompt triage.v2;
 * docs/eval/triage-v1-v2.md).
 */
export const REPO_URL = "https://github.com/HamayunKhan800/supportpilot";
export const EVAL_METHOD_URL = `${REPO_URL}/blob/main/docs/eval/README.md`;
export const EVAL_REPORT_URL = `${REPO_URL}/blob/main/docs/eval/m6-baseline.md`;
export const ARCHITECTURE_URL = `${REPO_URL}/blob/main/docs/02-architecture.md`;
export const ASVS_URL = `${REPO_URL}/blob/main/docs/security/asvs-l2.md`;
export const API_SPEC_PATH = "/api/v1/openapi.json";

/** One row of the results table: what was measured, the result, its 95% interval and sample size. */
export interface LandingMetric {
  label: string;
  result: string;
  range: string;
  n: string;
  target: string;
}

export const LANDING_METRICS: LandingMetric[] = [
  {
    label: "Right help article in the top five search results",
    result: "99.1%",
    range: "95.0–99.8%",
    n: "110 questions",
    target: "≥ 90%",
  },
  {
    label: "Right ticket category from AI triage",
    result: "94.0%",
    range: "89.0–96.8%",
    n: "150 tickets",
    target: "≥ 85%",
  },
  {
    label: "Citations that point to a passage the model was given",
    result: "100%",
    range: "97.2–100%",
    n: "133 citations",
    target: "100%",
  },
  {
    label: "Unanswerable questions declined instead of guessed",
    result: "100%",
    range: "88.6–100%",
    n: "30 questions",
    target: "≥ 90%",
  },
  {
    label: "Answerable questions wrongly declined",
    result: "1.8%",
    range: "0.5–6.4%",
    n: "110 questions",
    target: "≤ 10%",
  },
  {
    label: "Prompt-injection attempts resisted",
    result: "100%",
    range: "83.9–100%",
    n: "20 attacks",
    target: "100%",
  },
];

export const LANDING_METRICS_NOTE =
  "From one complete run against Google Gemini on the project's own labelled test set (420 items), plus a second run of the 150 triage tickets for the current triage prompt; the first prompt scored 87.3%. On the free tier the main draft model was often overloaded, so 132 of the 140 drafts came from the fallback model, gemini-3.5-flash-lite.";

const metric = (prefix: string) => {
  const m = LANDING_METRICS.find((x) => x.label.startsWith(prefix));
  if (!m) throw new Error(`No landing metric starts with "${prefix}"`);
  return m;
};

/** A footnote under the hero's waterline: what the headline's claim rests on, and where to check it. */
export interface HeroFootnote {
  /** Fragment id the headline's superscript number links to. */
  id: string;
  text: string;
  link: { label: string; href: string };
}

const citations = metric("Citations");
const citationCount = citations.n.replace(/\D/g, "");

/**
 * The hero's footnotes ("The Cited Draft", DESIGN.md): the headline's two claims carry numbers, as
 * a drafted reply carries its sources, and these say what each claim rests on. The citation count
 * is read from LANDING_METRICS, so the hero and the results table can't drift apart.
 */
export const HERO_FOOTNOTES: HeroFootnote[] = [
  {
    id: "source-1",
    text:
      citations.result === "100%"
        ? `Every draft cites the help-article passages it is based on. In our public test, ${citationCount} of ${citationCount} citations pointed at a passage the model was given.`
        : `Every draft cites the help-article passages it is based on. In our public test, ${citations.result} of ${citations.n} pointed at a passage the model was given.`,
    link: { label: "Evaluation report", href: EVAL_REPORT_URL },
  },
  {
    id: "source-2",
    text: "Nothing reaches a customer until an agent approves it. When your help centre has no answer, the AI declines instead of guessing.",
    link: { label: "How it works", href: "#how-it-works" },
  },
];
