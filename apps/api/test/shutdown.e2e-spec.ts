// Must stay the first import: it sets REDIS_URL before AppModule is loaded.
import { UNREACHABLE_REDIS_URL } from './utils/unreachable-redis-env';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { healthResponseSchema } from '@leadpilot/shared';
import type Redis from 'ioredis';
import request from 'supertest';
import { CHECK_TIMEOUT_MS } from '../src/health/health.service';
import { REDIS_CLIENT } from '../src/redis/redis.module';
import { createTestApp } from './utils/create-test-app';

/**
 * Unlike the "Redis down" suite in app.e2e-spec.ts (a fail-fast stub client),
 * this uses the real client factory: it keeps reconnecting in the background
 * and queues commands offline. Boot, readiness and shutdown must all still
 * finish in bounded time.
 */
describe('App (e2e) with the real Redis client and Redis unreachable', () => {
  let app: NestExpressApplication;
  let redis: Redis;

  beforeAll(async () => {
    app = await createTestApp();
    redis = app.get<Redis>(REDIS_CLIENT);
  });

  afterAll(() => {
    // Safety net if the shutdown test failed. After a successful close the
    // client stays in "reconnecting" (ioredis has no socket left to close), so
    // this check is true either way; disconnect() is then a harmless no-op.
    if (redis.status !== 'end') redis.disconnect();
  });

  it('uses the overridden REDIS_URL', () => {
    expect(redis.options.port).toBe(Number(new URL(UNREACHABLE_REDIS_URL).port));
  });

  it('GET /health/ready reports redis down within the check timeout', async () => {
    const started = Date.now();
    const res = await request(app.getHttpServer()).get('/health/ready').expect(503);
    expect(healthResponseSchema.parse(res.body)).toEqual({
      status: 'error',
      checks: { database: { status: 'up' }, redis: { status: 'down', message: 'unavailable' } },
    });
    expect(Date.now() - started).toBeLessThan(CHECK_TIMEOUT_MS + 1_500);
  });

  it('app.close() resolves while the client is reconnecting, and stops the retries', async () => {
    expect(redis.status).not.toBe('ready');
    let timer: NodeJS.Timeout | undefined;
    const hang = new Promise<'hang'>((resolve) => {
      timer = setTimeout(() => resolve('hang'), 3_000);
    });
    const outcome = await Promise.race([app.close().then(() => 'closed' as const), hang]);
    clearTimeout(timer);
    expect(outcome).toBe('closed');

    // ioredis' retry delay grows to at most 2s; wait past that and make sure
    // no reconnect attempt happened after shutdown.
    let attempts = 0;
    const count = () => attempts++;
    redis.on('connect', count).on('reconnecting', count);
    await new Promise((resolve) => setTimeout(resolve, 2_500));
    redis.off('connect', count).off('reconnecting', count);
    expect(attempts).toBe(0);
  }, 10_000);
});
