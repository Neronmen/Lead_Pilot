import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { errorBodySchema, healthResponseSchema } from '@leadpilot/shared';
import { PrismaPg } from '@prisma/adapter-pg';
import Redis from 'ioredis';
import request from 'supertest';
import type { Env } from '../src/config/env.schema';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { REDIS_CLIENT } from '../src/redis/redis.module';
import { createTestApp } from './utils/create-test-app';

describe('App (e2e)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /health/live', () => {
    it('returns 200 with the health shape', async () => {
      const res = await request(app.getHttpServer()).get('/health/live').expect(200);
      expect(healthResponseSchema.parse(res.body)).toEqual({ status: 'ok', checks: {} });
    });
  });

  describe('GET /health/ready', () => {
    it('returns 200 when Postgres and Redis are reachable', async () => {
      const res = await request(app.getHttpServer()).get('/health/ready').expect(200);
      expect(healthResponseSchema.parse(res.body)).toEqual({
        status: 'ok',
        checks: { database: { status: 'up' }, redis: { status: 'up' } },
      });
    });
  });

  describe('errors', () => {
    it('returns the error envelope for an unknown route', async () => {
      const res = await request(app.getHttpServer()).get('/does-not-exist').expect(404);
      expect(errorBodySchema.parse(res.body).error.code).toBe('NOT_FOUND');
    });

    it('returns VALIDATION_FAILED for a malformed JSON body', async () => {
      const res = await request(app.getHttpServer())
        .post('/does-not-exist')
        .set('content-type', 'application/json')
        .send('{bad')
        .expect(400);
      expect(errorBodySchema.parse(res.body).error.code).toBe('VALIDATION_FAILED');
    });

    it('returns PAYLOAD_TOO_LARGE for an oversized body', async () => {
      const res = await request(app.getHttpServer())
        .post('/does-not-exist')
        .set('content-type', 'application/json')
        .send(JSON.stringify({ blob: 'a'.repeat(200_000) }))
        .expect(413);
      expect(errorBodySchema.parse(res.body).error.code).toBe('PAYLOAD_TOO_LARGE');
    });
  });

  describe('request id', () => {
    it('echoes a valid incoming x-request-id', async () => {
      const res = await request(app.getHttpServer())
        .get('/health/live')
        .set('x-request-id', 'trace-42')
        .expect(200);
      expect(res.headers['x-request-id']).toBe('trace-42');
    });

    it('generates one when missing', async () => {
      const res = await request(app.getHttpServer()).get('/health/live').expect(200);
      expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    });
  });

  describe('platform', () => {
    it('serves the OpenAPI document at /docs-json', async () => {
      const res = await request(app.getHttpServer()).get('/docs-json').expect(200);
      expect(res.body.info.title).toBe('LeadPilot API');
      expect(Object.keys(res.body.paths)).toEqual(
        expect.arrayContaining(['/health/live', '/health/ready']),
      );
    });

    it('does not advertise Express', async () => {
      const res = await request(app.getHttpServer()).get('/health/live');
      expect(res.headers['x-powered-by']).toBeUndefined();
    });
  });

  describe('CORS', () => {
    const webOrigin = () => app.get<ConfigService<Env, true>>(ConfigService).get('WEB_ORIGIN');

    it('allows the web origin with credentials', async () => {
      const res = await request(app.getHttpServer())
        .get('/health/live')
        .set('origin', webOrigin())
        .expect(200);
      expect(res.headers['access-control-allow-origin']).toBe(webOrigin());
      expect(res.headers['access-control-allow-credentials']).toBe('true');
    });

    it('answers a preflight from the web origin', async () => {
      const res = await request(app.getHttpServer())
        .options('/health/live')
        .set('origin', webOrigin())
        .set('access-control-request-method', 'POST')
        .set('access-control-request-headers', 'content-type')
        .expect(204);
      expect(res.headers['access-control-allow-origin']).toBe(webOrigin());
    });

    it('never reflects a foreign origin', async () => {
      // With a fixed-string origin the cors package always sends WEB_ORIGIN;
      // the browser then blocks the mismatch. What matters is that the
      // caller's origin is never echoed back (that would allow it).
      const res = await request(app.getHttpServer())
        .get('/health/live')
        .set('origin', 'https://evil.example')
        .expect(200);
      expect(res.headers['access-control-allow-origin']).not.toBe('https://evil.example');
      expect(res.headers['access-control-allow-origin']).toBe(webOrigin());
      expect(res.headers['vary']).toMatch(/origin/i);
    });
  });
});

describe('App (e2e) shutdown', () => {
  it('app.close() quits the live Redis connection', async () => {
    const app = await createTestApp();
    const redis = app.get<Redis>(REDIS_CLIENT);
    await expect(redis.ping()).resolves.toBe('PONG');

    await app.close();
    expect(redis.status).toBe('end');
  });
});

describe('App (e2e) with Redis down', () => {
  let app: NestExpressApplication;
  // Nothing listens on port 1; no retries and no offline queue -> ping fails at once.
  const deadRedis = new Redis('redis://127.0.0.1:1', {
    lazyConnect: true,
    enableOfflineQueue: false,
    retryStrategy: () => null,
  });

  beforeAll(async () => {
    app = await createTestApp((builder) =>
      builder.overrideProvider(REDIS_CLIENT).useValue(deadRedis),
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health/ready returns 503 and names the failing check', async () => {
    const res = await request(app.getHttpServer()).get('/health/ready').expect(503);
    expect(healthResponseSchema.parse(res.body)).toEqual({
      status: 'error',
      checks: { database: { status: 'up' }, redis: { status: 'down', message: 'unavailable' } },
    });
  });

  it('GET /health/live still returns 200', async () => {
    await request(app.getHttpServer()).get('/health/live').expect(200);
  });
});

describe('App (e2e) with Postgres down', () => {
  let app: NestExpressApplication;
  // Nothing listens on port 1: the pool fails to connect.
  const deadDb = new PrismaClient({
    adapter: new PrismaPg({
      connectionString: 'postgresql://nobody:nothing@127.0.0.1:1/nothing_test',
      connectionTimeoutMillis: 1_000,
    }),
  });

  beforeAll(async () => {
    app = await createTestApp((builder) =>
      builder.overrideProvider(PrismaService).useValue(deadDb),
    );
  });

  afterAll(async () => {
    await app.close();
    await deadDb.$disconnect();
  });

  it('GET /health/ready returns 503 and names the failing check', async () => {
    const res = await request(app.getHttpServer()).get('/health/ready').expect(503);
    expect(healthResponseSchema.parse(res.body)).toEqual({
      status: 'error',
      checks: { database: { status: 'down', message: 'unavailable' }, redis: { status: 'up' } },
    });
  });
});
