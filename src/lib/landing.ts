/**
 * Facts shown on the public landing page (design system step 5). Every number comes from a
 * saved evaluation report and carries its sample size and 95% Wilson interval; update them
 * from the report when a newer run finishes (docs/eval/README.md explains the method).
 *
 * Source: eval/results/eval-gemini-d4f53fa4.md (run d4f53fa4, Gemini, dataset ba1b4b3d915f,
 * completed 2026-10-24), summarised in docs/eval/m6-baseline.md.
 */
export const REPO_URL = "https://github.com/HamayunKhan800/supportpilot";
export const EVAL_METHOD_URL = `${REPO_URL}/blob/main/docs/eval/README.md`;

export interface LandingMetric {
  value: string;
  label: string;
  detail: string;
}

export const LANDING_METRICS: LandingMetric[] = [
  {
    value: "99.1%",
    label: "of help-centre questions find the right article in the top five results",
    detail: "Recall@5 · n=110 · 95% CI 95.0–99.8%",
  },
  {
    value: "87.3%",
    label: "of test tickets get the right category from AI triage",
    detail: "n=150 · 95% CI 81.1–91.7% · target 85%",
  },
  {
    value: "100%",
    label: "of citations in drafts point to a passage the model was actually given",
    detail: "n=133 citations · 95% CI 97.2–100% · target 100%",
  },
  {
    value: "1.8%",
    label: "of answerable questions were wrongly refused a draft",
    detail: "n=110 · 95% CI 0.5–6.4% · target ≤ 10%",
  },
];

export const LANDING_METRICS_NOTE =
  "One complete evaluation run against Google Gemini on the project's own test set of 420 items. The same run found the AI declined all 30 questions the help centre cannot answer and resisted all 20 prompt-injection attempts. On the free tier the main draft model often timed out or was overloaded, so 132 of the 140 drafts were written by the fallback model, gemini-3.5-flash-lite.";
