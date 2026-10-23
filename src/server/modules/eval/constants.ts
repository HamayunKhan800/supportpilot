/**
 * Values the evaluation runner stores (M6 D3). Kept apart from the runner so the database
 * schema can import them without pulling in any runner code.
 */

/** Which model answered: the deterministic mock (CI) or Gemini (on demand, M6 D4). */
export const EVAL_PROVIDERS = ["mock", "gemini"] as const;
export type EvalProvider = (typeof EVAL_PROVIDERS)[number];

/**
 * running: items are being added. stopped: the run ended early (call budget, a 429, the
 * provider failing) and can be resumed. completed: every planned item has a result.
 */
export const EVAL_RUN_STATUSES = ["running", "stopped", "completed"] as const;
export type EvalRunStatus = (typeof EVAL_RUN_STATUSES)[number];

/** The four suites, in the order a run works through them. */
export const EVAL_SUITES = ["retrieval", "triage", "draft", "injection"] as const;
export type EvalSuite = (typeof EVAL_SUITES)[number];

/** Dataset item ids: tri-001, nim-01, q001, u01, D01 … */
export const EVAL_ITEM_KEY_PATTERN = "^[A-Za-z0-9-]{1,40}$";
