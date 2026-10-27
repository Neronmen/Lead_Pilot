import { Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { MemoryWindowStore, type WindowStore } from '../ingest/rate-limiter';

/**
 * Rate-limit counters in Redis, so every API instance counts together. A window
 * is one key: INCR makes it, and PEXPIRE (set on the first hit only) ends it.
 *
 * If Redis is unreachable it keeps counting in this process's memory and logs once:
 * the limit still holds (per instance), and the API does not go down with Redis.
 */
export class RedisWindowStore implements WindowStore {
  private readonly logger = new Logger(RedisWindowStore.name);
  private failing = false;
  /** Counts per process while Redis is unreachable: a brute-force limit never turns into "no limit". */
  private readonly fallback = new MemoryWindowStore();

  constructor(
    private readonly redis: Redis,
    private readonly prefix: string,
  ) {}

  async hit(key: string, windowMs: number): Promise<{ count: number; resetInMs: number }> {
    try {
      const redisKey = `${this.prefix}:rl:${key}`;
      const count = await this.redis.incr(redisKey);
      if (count === 1) await this.redis.pexpire(redisKey, windowMs);
      const ttl = await this.redis.pttl(redisKey);
      this.recovered();
      // -1: the key lost its expiry (a crash between INCR and PEXPIRE): end the window now.
      if (ttl < 0) await this.redis.pexpire(redisKey, windowMs);
      return { count, resetInMs: ttl < 0 ? windowMs : ttl };
    } catch (error) {
      return this.failOver(error, () => this.fallback.hit(key, windowMs));
    }
  }

  async peek(key: string): Promise<{ count: number; resetInMs: number }> {
    try {
      const redisKey = `${this.prefix}:rl:${key}`;
      const [count, ttl] = await Promise.all([this.redis.get(redisKey), this.redis.pttl(redisKey)]);
      this.recovered();
      return { count: Number(count ?? 0), resetInMs: Math.max(0, ttl) };
    } catch (error) {
      return this.failOver(error, () => this.fallback.peek(key));
    }
  }

  async clear(): Promise<void> {
    const keys = await this.redis.keys(`${this.prefix}:rl:*`);
    if (keys.length > 0) await this.redis.del(...keys);
  }

  private failOver(
    error: unknown,
    memory: () => Promise<{ count: number; resetInMs: number }>,
  ): Promise<{ count: number; resetInMs: number }> {
    if (!this.failing) {
      this.failing = true;
      this.logger.warn(
        `Rate limiter cannot reach Redis, counting in memory for now: ${String(error)}`,
      );
    }
    return memory();
  }

  private recovered(): void {
    if (this.failing) this.logger.log('Rate limiter reconnected to Redis');
    this.failing = false;
  }
}
