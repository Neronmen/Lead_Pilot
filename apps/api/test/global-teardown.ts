import Redis from 'ioredis';
import { applyTestEnv } from './test-env';

/** Runs once after all e2e files: remove the Redis keys the test files left behind. */
export default async function globalTeardown(): Promise<void> {
  applyTestEnv();
  const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: 1,
  });
  try {
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', 'bull-test-*', 'COUNT', 500);
      cursor = next;
      if (keys.length > 0) await redis.del(...keys);
    } while (cursor !== '0');
  } catch {
    // Redis down: nothing to clean.
  } finally {
    redis.disconnect();
  }
}
