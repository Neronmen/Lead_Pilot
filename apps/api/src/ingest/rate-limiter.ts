/**
 * A fixed-window counter kept in memory: at most `limit` hits per key per
 * window. In memory means per API instance (do not run two before M3 moves the
 * counters to Redis). Old keys are swept so an attacker cannot grow the map.
 */
export class FixedWindowLimiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();

  constructor(
    public limit: number,
    private readonly windowMs = 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  /** Counts one hit. Returns 0 when allowed, else the seconds until the window ends. */
  hit(key: string): number {
    const window = this.current(key);
    window.count += 1;
    return window.count > this.limit ? this.wait(window) : 0;
  }

  /** Seconds to wait when `key` already used up its hits, else 0. Counts nothing. */
  blockedFor(key: string): number {
    const window = this.windows.get(key);
    if (!window || window.resetAt <= this.now()) return 0;
    return window.count >= this.limit ? this.wait(window) : 0;
  }

  /** Counts a hit without checking (used for failures, checked by `blockedFor`). */
  record(key: string): void {
    this.current(key).count += 1;
  }

  reset(): void {
    this.windows.clear();
  }

  private current(key: string) {
    const now = this.now();
    if (this.windows.size > 10_000) {
      for (const [k, w] of this.windows) if (w.resetAt <= now) this.windows.delete(k);
    }
    let window = this.windows.get(key);
    if (!window || window.resetAt <= now) {
      window = { count: 0, resetAt: now + this.windowMs };
      this.windows.set(key, window);
    }
    return window;
  }

  private wait(window: { resetAt: number }): number {
    return Math.max(1, Math.ceil((window.resetAt - this.now()) / 1000));
  }
}
