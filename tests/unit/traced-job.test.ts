import { afterEach, describe, expect, it } from "vitest";

import { setErrorReporter, type ErrorReportContext } from "@/server/platform/error-reporting";
import { traced } from "@/worker/traced-job";

/** Plan M6 D9: a job's error reaches the error tracker only on its final attempt. */
describe("traced job", () => {
  const reports: Array<[unknown, ErrorReportContext]> = [];
  setErrorReporter((err, ctx) => void reports.push([err, ctx]));
  afterEach(() => {
    reports.length = 0;
  });

  const job = (retryCount?: number, retryLimit?: number) =>
    ({ id: "job-1", name: "ai.triage", data: {}, retryCount, retryLimit }) as never;
  const fail = async (): Promise<{ status: string }> => {
    throw new Error("unexpected");
  };

  it("returns the job's result", async () => {
    await expect(traced("ai.triage", job(0, 2), {}, async () => ({ status: "succeeded" }))).resolves.toEqual({
      status: "succeeded",
    });
    expect(reports).toEqual([]);
  });

  it("rethrows without reporting while retries remain", async () => {
    await expect(traced("ai.triage", job(1, 2), {}, fail)).rejects.toThrow("unexpected");
    expect(reports).toEqual([]);
  });

  it("reports on the final attempt, then rethrows so pg-boss dead-letters the job", async () => {
    await expect(traced("ai.triage", job(2, 2), {}, fail)).rejects.toThrow("unexpected");
    expect(reports.map(([, ctx]) => ctx)).toEqual([{ job: "ai.triage", jobId: "job-1" }]);
  });

  it("treats a job without retry metadata (dead-letter queues) as final", async () => {
    await expect(traced("ai.triage.dead", job(), {}, fail)).rejects.toThrow();
    expect(reports).toHaveLength(1);
  });
});
