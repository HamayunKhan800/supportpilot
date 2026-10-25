import { describe, expect, it } from "vitest";

import {
  stoppedCleanly,
  supervise,
  WEB_ONLY_ENV,
  withoutKeys,
  type ChildSpec,
} from "../../scripts/lib/supervisor";

/**
 * The container launcher (plan M8 D2) runs the web server and the worker together. These
 * tests start real Node child processes, because signal handling is the point.
 */
const node = (name: string, code: string, env?: NodeJS.ProcessEnv): ChildSpec => ({
  name,
  command: process.execPath,
  args: ["-e", code],
  env,
});
/** Waits for SIGTERM, then exits 0 after a short cleanup (like the worker and Next.js). */
const graceful = `process.on("SIGTERM", () => setTimeout(() => process.exit(0), 50)); setInterval(() => {}, 1000);`;
/** Ignores SIGTERM: only SIGKILL stops it. */
const stubborn = `process.on("SIGTERM", () => {}); setInterval(() => {}, 1000);`;

function run(specs: ChildSpec[], graceMs = 2_000) {
  const lines: Record<string, unknown>[] = [];
  const supervisor = supervise(specs, { graceMs, log: (l) => lines.push(l) });
  return { ...supervisor, lines };
}

/** Lets the children start and install their signal handlers. */
const settle = () => new Promise((r) => setTimeout(r, 400));

describe("container supervisor (web + worker in one container)", () => {
  it("passes a stop signal to every child and exits 0 when they stop cleanly", async () => {
    const s = run([node("web", graceful), node("worker", graceful)]);
    await settle();
    s.stop("SIGTERM");
    await expect(s.done).resolves.toBe(0);
    expect(
      s.lines
        .filter((l) => l.msg === "child stopped")
        .map((l) => l.child)
        .sort(),
    ).toEqual(["web", "worker"]);
  });

  it("counts exit code 143 after SIGTERM as a clean stop (Next.js does this)", async () => {
    const s = run([
      node("web", `process.on("SIGTERM", () => process.exit(143)); setInterval(() => {}, 1000);`),
    ]);
    await settle();
    s.stop("SIGTERM");
    await expect(s.done).resolves.toBe(0);
    expect(stoppedCleanly(null, "SIGTERM")).toBe(true);
    expect(stoppedCleanly(1, null)).toBe(false);
  });

  it("stops the other child and fails when one exits on its own", async () => {
    const s = run([node("web", graceful), node("worker", "setTimeout(() => process.exit(3), 200)")]);
    await expect(s.done).resolves.toBe(3);
    expect(s.lines).toContainEqual(
      expect.objectContaining({ msg: "child exited unexpectedly", child: "worker" }),
    );
    expect(s.lines).toContainEqual(expect.objectContaining({ msg: "child stopped", child: "web" }));
  });

  it("treats an unexpected clean exit as a failure (half the app must not keep serving)", async () => {
    const s = run([node("web", graceful), node("worker", "setTimeout(() => process.exit(0), 200)")]);
    await expect(s.done).resolves.toBe(1);
  });

  it("kills a child that ignores the stop signal once the grace period ends", async () => {
    const started = Date.now();
    const s = run([node("web", graceful), node("worker", stubborn)], 1_000);
    await settle();
    s.stop("SIGTERM");
    await expect(s.done).resolves.toBe(1);
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(s.lines).toContainEqual(
      expect.objectContaining({ msg: "child did not stop in time; killing it", child: "worker" }),
    );
  });

  it("fails fast when a child can't be started", async () => {
    const s = run([node("web", graceful), { name: "worker", command: "/nonexistent/node", args: [] }]);
    await expect(s.done).resolves.toBe(1);
    expect(s.lines).toContainEqual(
      expect.objectContaining({ msg: "child failed to start", child: "worker" }),
    );
  });

  it("gives the worker no web-only secrets (least privilege)", async () => {
    const env = withoutKeys(
      {
        NODE_ENV: "test",
        PATH: process.env.PATH,
        DATABASE_URL: "postgres://x",
        BETTER_AUTH_SECRET: "s",
        RESEND_API_KEY: "r",
      },
      WEB_ONLY_ENV,
    );
    expect(env).toEqual({ NODE_ENV: "test", PATH: process.env.PATH, DATABASE_URL: "postgres://x" });
    // And the child really receives the filtered environment.
    const check = `process.exit(process.env.BETTER_AUTH_SECRET === undefined && process.env.DATABASE_URL ? 7 : 8)`;
    const s = run([node("worker", check, env)]);
    await expect(s.done).resolves.toBe(7);
  });
});
