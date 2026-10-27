import { describe, expect, it } from "vitest";

import { parseWakeEnv } from "@/server/platform/env";
import {
  createWorkerWaker,
  WAKE_DEBOUNCE_MS,
  WAKE_PAYLOAD,
  type InvokeAsync,
} from "@/server/platform/jobs/wake";

/** Waking the worker Lambda function after a job is queued (plan M8 revision 2, R4). */

function recorder(fail = false) {
  const calls: { functionName: string; payload: string }[] = [];
  const invoke: InvokeAsync = async (functionName, payload) => {
    calls.push({ functionName, payload });
    if (fail) throw new Error("AccessDenied");
  };
  return { calls, invoke };
}
const quiet = { warn: () => {} };

describe("worker wake-up", () => {
  it("does nothing when WORKER_FUNCTION_NAME is not set", async () => {
    const { calls, invoke } = recorder();
    await createWorkerWaker({ functionName: undefined, invoke })();
    expect(calls).toEqual([]);
  });

  it('sends {"task":"drain"} to the configured function', async () => {
    const { calls, invoke } = recorder();
    await createWorkerWaker({ functionName: "supportpilot-worker:live", invoke, log: quiet })();
    expect(calls).toEqual([{ functionName: "supportpilot-worker:live", payload: '{"task":"drain"}' }]);
    expect(JSON.parse(WAKE_PAYLOAD)).toEqual({ task: "drain" });
  });

  it("skips repeated wake-ups within the debounce window, then wakes again", async () => {
    let clock = 0;
    const { calls, invoke } = recorder();
    const wake = createWorkerWaker({ functionName: "w", invoke, now: () => clock, log: quiet });
    await wake();
    clock += WAKE_DEBOUNCE_MS - 1;
    await wake();
    expect(calls).toHaveLength(1);
    clock += 1;
    await wake();
    expect(calls).toHaveLength(2);
  });

  it("never throws, logs the failure without detail beyond the message, and retries on the next job", async () => {
    const warnings: unknown[][] = [];
    const { calls, invoke } = recorder(true);
    const wake = createWorkerWaker({
      functionName: "w",
      invoke,
      now: () => 0,
      log: { warn: (...a: unknown[]) => warnings.push(a) },
    });
    await expect(wake()).resolves.toBeUndefined();
    await wake(); // not debounced after a failure
    expect(calls).toHaveLength(2);
    expect(warnings[0]).toEqual([
      { err: { message: "AccessDenied" } },
      expect.stringContaining("could not wake"),
    ]);
  });

  it("validates the function name setting", () => {
    expect(parseWakeEnv({}).WORKER_FUNCTION_NAME).toBeUndefined();
    expect(parseWakeEnv({ WORKER_FUNCTION_NAME: "" }).WORKER_FUNCTION_NAME).toBeUndefined();
    expect(parseWakeEnv({ WORKER_FUNCTION_NAME: "supportpilot-worker:live" }).WORKER_FUNCTION_NAME).toBe(
      "supportpilot-worker:live",
    );
    expect(() => parseWakeEnv({ WORKER_FUNCTION_NAME: "bad name; rm" })).toThrow(/WORKER_FUNCTION_NAME/);
  });
});
