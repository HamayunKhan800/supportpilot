import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { transaction } from "@/server/platform/db/tx";
import { resetEnvCache } from "@/server/platform/env";
import { enqueueKbIngest, stopWebBoss } from "@/server/platform/jobs/boss";

/**
 * Queueing a job wakes the worker Lambda function (plan M8 revision 2, R4), through the real
 * AWS SDK pointed at a stand-in Lambda endpoint (AWS_ENDPOINT_URL_LAMBDA), so the request's
 * shape is checked without an AWS account. Each test file has its own module state, so the
 * settings below apply to this file only.
 */
interface Seen {
  method: string;
  path: string;
  invocationType: string | undefined;
  body: string;
}

describe("enqueue wakes the worker function", () => {
  let lambda: Server;
  const seen: Seen[] = [];
  let status = 202;

  beforeAll(async () => {
    lambda = createServer((req, res) => {
      let body = "";
      req.on("data", (c: Buffer) => (body += c.toString("utf8")));
      req.on("end", () => {
        seen.push({
          method: req.method ?? "",
          path: decodeURIComponent(req.url ?? ""),
          invocationType: req.headers["x-amz-invocation-type"] as string | undefined,
          body,
        });
        res.writeHead(status, { "content-type": "application/json" });
        res.end(status === 202 ? "" : '{"Type":"User","message":"denied"}');
      });
    });
    await new Promise<void>((resolve) => lambda.listen(0, "127.0.0.1", resolve));
    const { port } = lambda.address() as AddressInfo;
    Object.assign(process.env, {
      WORKER_FUNCTION_NAME: "supportpilot-worker:live",
      AWS_REGION: "ap-southeast-2",
      AWS_ACCESS_KEY_ID: "test",
      AWS_SECRET_ACCESS_KEY: "test",
      AWS_ENDPOINT_URL_LAMBDA: `http://127.0.0.1:${port}`,
    });
    resetEnvCache();
  });

  afterAll(async () => {
    await stopWebBoss();
    await new Promise<void>((resolve) => lambda.close(() => resolve()));
    for (const key of [
      "WORKER_FUNCTION_NAME",
      "AWS_REGION",
      "AWS_ACCESS_KEY_ID",
      "AWS_SECRET_ACCESS_KEY",
      "AWS_ENDPOINT_URL_LAMBDA",
    ]) {
      delete process.env[key];
    }
    resetEnvCache();
  });

  /** Queues a job in a transaction that is then rolled back, so no job is left behind. */
  async function enqueueAndRollBack(): Promise<string | undefined> {
    let id: string | undefined;
    await transaction(async (tx) => {
      id = await enqueueKbIngest(tx, { workspaceId: "wake-test", documentId: randomUUID() });
      throw new Error("roll back");
    }).catch((err: Error) => {
      if (err.message !== "roll back") throw err;
    });
    return id;
  }

  it("sends an asynchronous Invoke with the drain task to the configured function", async () => {
    expect(await enqueueAndRollBack()).toBeTruthy();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual({
      method: "POST",
      path: "/2015-03-31/functions/supportpilot-worker:live/invocations",
      invocationType: "Event",
      body: '{"task":"drain"}',
    });
  });

  it("skips a second wake-up straight after the first (debounce)", async () => {
    await enqueueAndRollBack();
    expect(seen).toHaveLength(1);
  });

  it("still queues the job when Lambda refuses the wake-up", async () => {
    await new Promise((r) => setTimeout(r, 5_100)); // past the debounce window
    status = 403;
    expect(await enqueueAndRollBack()).toBeTruthy();
    expect(seen).toHaveLength(2);
  });
});
