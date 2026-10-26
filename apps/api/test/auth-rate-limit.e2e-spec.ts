import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { errorBodySchema } from '@leadpilot/shared';
import request from 'supertest';

/**
 * Auth routes are rate limited per IP (SPEC §4.8). The limit is read when the
 * app module loads, so it is set before the module is imported, below.
 */
describe('Auth rate limit (e2e)', () => {
  let app: NestExpressApplication;
  const LIMIT = 3;

  beforeAll(async () => {
    process.env.AUTH_RATE_LIMIT_PER_MINUTE = String(LIMIT);
    const { createTestApp } = await import('./utils/create-test-app.js');
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('answers 429 RATE_LIMITED once an IP exceeds the limit on login', async () => {
    const attempt = () =>
      request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'e2e-auth-ratelimit@example.test', password: 'wrong-password' });

    for (let i = 0; i < LIMIT; i += 1) await attempt().expect(401);
    const res = await attempt().expect(429);
    expect(errorBodySchema.parse(res.body).error.code).toBe('RATE_LIMITED');
    expect(res.headers['retry-after']).toBeDefined();
  }, 30_000); // argon2 per attempt: slow when e2e files run in parallel

  it('counts each route separately and does not limit signed-in calls', async () => {
    // Login is used up by the test above; refresh still has its own budget.
    await request(app.getHttpServer()).post('/auth/refresh').expect(401);
    // /auth/me and /auth/logout skip the limiter: an app polling /me is not throttled.
    for (let i = 0; i < LIMIT + 2; i += 1) {
      await request(app.getHttpServer()).get('/auth/me').expect(401);
      await request(app.getHttpServer()).post('/auth/logout').expect(204);
    }
  });
});

/**
 * The limiter's key is the client IP. Real distinct client IPs come from
 * binding each request to its own loopback address (127.0.0.x), so no app
 * setting (such as `trust proxy`) changes for the test.
 */
describe('Auth rate limit keying (e2e)', () => {
  let app: NestExpressApplication;
  let port: number;
  const LIMIT = 3;

  beforeAll(async () => {
    process.env.AUTH_RATE_LIMIT_PER_MINUTE = String(LIMIT);
    const { createTestApp } = await import('./utils/create-test-app.js');
    app = await createTestApp();
    await app.listen(0, '127.0.0.1');
    port = (app.getHttpServer().address() as AddressInfo).port;
  });

  afterAll(async () => {
    await app.close();
  });

  /** POST /auth/login from a given client address; resolves to the status code. */
  function loginFrom(localAddress: string, headers: Record<string, string> = {}): Promise<number> {
    const body = JSON.stringify({ email: 'e2e-auth-ratelimit@example.test', password: 'wrong-pw' });
    return new Promise((resolve, reject) => {
      const req = httpRequest(
        {
          host: '127.0.0.1',
          port,
          localAddress,
          method: 'POST',
          path: '/auth/login',
          headers: { 'content-type': 'application/json', ...headers },
        },
        (res) => {
          res.resume();
          res.on('end', () => resolve(res.statusCode ?? 0));
        },
      );
      req.on('error', reject);
      req.end(body);
    });
  }

  it('keeps a separate budget per client IP', async () => {
    for (let i = 0; i < LIMIT; i += 1) expect(await loginFrom('127.0.0.2')).toBe(401);
    expect(await loginFrom('127.0.0.2')).toBe(429);
    // Another client is not locked out by the first one's attempts.
    expect(await loginFrom('127.0.0.3')).toBe(401);
  }, 30_000);

  it('ignores a spoofed X-Forwarded-For: a throttled client cannot reset its budget', async () => {
    // 127.0.0.2 used its budget above.
    expect(await loginFrom('127.0.0.2', { 'x-forwarded-for': '203.0.113.7' })).toBe(429);
  });
});
