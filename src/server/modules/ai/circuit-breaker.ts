/**
 * Circuit breaker for one AI model (M5 D13, T16). After `failureThreshold` consecutive provider
 * failures it opens: calls fail at once with "AI temporarily unavailable" instead of each waiting
 * for a timeout. After `cooldownMs` it lets exactly one trial call through (half-open); success
 * closes it, failure opens it again.
 *
 * State is per process (web and worker each have their own). That is deliberate: it protects the
 * process's own latency, while the shared daily cap protects the quota.
 */
export type CircuitState = "closed" | "open" | "half-open";

export type Permit = { allowed: true } | { allowed: false; retryAfterMs: number };

export class CircuitBreaker {
  private failures = 0;
  private openedAt: number | null = null;
  private trialInFlight = false;

  constructor(
    private readonly options: { failureThreshold: number; cooldownMs: number; now?: () => number },
  ) {
    if (options.failureThreshold < 1) throw new RangeError("failureThreshold must be at least 1");
  }

  private now(): number {
    return (this.options.now ?? Date.now)();
  }

  get state(): CircuitState {
    if (this.openedAt === null) return "closed";
    return this.now() - this.openedAt >= this.options.cooldownMs ? "half-open" : "open";
  }

  /** Ask before calling the provider. Every allowed call must end in exactly one of the three outcomes below. */
  acquire(): Permit {
    const state = this.state;
    if (state === "closed") return { allowed: true };
    if (state === "half-open" && !this.trialInFlight) {
      this.trialInFlight = true;
      return { allowed: true };
    }
    const elapsed = this.now() - (this.openedAt ?? 0);
    return { allowed: false, retryAfterMs: Math.max(0, this.options.cooldownMs - elapsed) };
  }

  /** The provider answered (even with unusable output): it is reachable. */
  recordSuccess(): void {
    this.failures = 0;
    this.openedAt = null;
    this.trialInFlight = false;
  }

  /** The provider failed (unavailable, timeout, rejected). */
  recordFailure(): void {
    this.trialInFlight = false;
    this.failures += 1;
    if (this.openedAt !== null || this.failures >= this.options.failureThreshold) {
      this.openedAt = this.now();
    }
  }

  /** The call ended without telling us anything about the provider (e.g. the caller cancelled). */
  release(): void {
    this.trialInFlight = false;
  }
}
