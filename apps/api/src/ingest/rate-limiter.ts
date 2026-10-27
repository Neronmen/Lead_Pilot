/** Where a window's counter lives: in memory (unit tests) or in Redis (the running app, shared by every instance). */
export interface WindowStore {
  /** Adds one hit to `key`'s window (starting it if needed). Returns the count and ms until the window ends. */
  hit(key: string, windowMs: number): Promise<{ count: number; resetInMs: number }>;
  /** The current count and ms left, without counting. */
  peek(key: string): Promise<{ count: number; resetInMs: number }>;
  /** Forget everything (tests). */
  clear(): Promise<void>;
}

/** In-memory store: one process only. Old keys are swept so the map cannot grow for ever. */
export class MemoryWindowStore implements WindowStore {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  hit(key: string, windowMs: number): Promise<{ count: number; resetInMs: number }> {
    const now = this.now();
    if (this.windows.size > 10_000) {
      for (const [k, w] of this.windows) if (w.resetAt <= now) this.windows.delete(k);
    }
    let window = this.windows.get(key);
    if (!window || window.resetAt <= now) {
      window = { count: 0, resetAt: now + windowMs };
      this.windows.set(key, window);
    }
    window.count += 1;
    return Promise.resolve({ count: window.count, resetInMs: window.resetAt - now });
  }

  peek(key: string): Promise<{ count: number; resetInMs: number }> {
    const window = this.windows.get(key);
    const now = this.now();
    return Promise.resolve(
      window && window.resetAt > now
        ? { count: window.count, resetInMs: window.resetAt - now }
        : { count: 0, resetInMs: 0 },
    );
  }

  clear(): Promise<void> {
    this.windows.clear();
    return Promise.resolve();
  }
}

/**
 * A fixed-window counter: at most `limit` hits per key per window. Where the
 * counts live is the store's business, so with the Redis store every API
 * instance shares one count.
 */
export class FixedWindowLimiter {
  constructor(
    public limit: number,
    private readonly store: WindowStore,
    private readonly name: string,
    private readonly windowMs = 60_000,
  ) {}

  private key(key: string): string {
    return `${this.name}:${key}`;
  }

  /** Counts one hit. Returns 0 when allowed, else the seconds until the window ends. */
  async hit(key: string): Promise<number> {
    const { count, resetInMs } = await this.store.hit(this.key(key), this.windowMs);
    return count > this.limit ? wait(resetInMs) : 0;
  }

  /** Seconds to wait when `key` already used up its hits, else 0. Counts nothing. */
  async blockedFor(key: string): Promise<number> {
    const { count, resetInMs } = await this.store.peek(this.key(key));
    return count >= this.limit && resetInMs > 0 ? wait(resetInMs) : 0;
  }

  /** Counts a hit without checking (used for failures, checked by `blockedFor`). */
  async record(key: string): Promise<void> {
    await this.store.hit(this.key(key), this.windowMs);
  }

  reset(): Promise<void> {
    return this.store.clear();
  }
}

const wait = (ms: number) => Math.max(1, Math.ceil(ms / 1000));
