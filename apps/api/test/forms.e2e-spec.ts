import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaPg } from '@prisma/adapter-pg';
import request from 'supertest';
import { PrismaClient } from '../src/generated/prisma/client';
import { FixedWindowLimiter } from '../src/ingest/rate-limiter';
import { IngestLimits } from '../src/ingest/ingest.service';
import { WINDOW_STORE } from '../src/redis/redis.tokens';
import { PipelineQueue } from '../src/queue/pipeline.queue';
import { createTestApp } from './utils/create-test-app';
import { INVITES_EMAIL_PREFIX, ownerOf } from './utils/invites';

/** The public web form: open to anyone with the link, so every guard is tested. */
describe('Public web form (e2e)', () => {
  let app: NestExpressApplication;
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.get(PipelineQueue).queue.obliterate({ force: true });
    const users = await prisma.user.findMany({
      where: { email: { startsWith: INVITES_EMAIL_PREFIX } },
      select: { memberships: { select: { workspaceId: true } } },
    });
    await prisma.workspace.deleteMany({
      where: { id: { in: users.flatMap((u) => u.memberships.map((m) => m.workspaceId)) } },
    });
    await prisma.user.deleteMany({ where: { email: { startsWith: INVITES_EMAIL_PREFIX } } });
    await prisma.$disconnect();
    await app.close();
  });

  async function source(label = 'form') {
    const owner = await ownerOf(app, label);
    const auth = { authorization: `Bearer ${owner.accessToken}` };
    const made = await http()
      .post('/sources')
      .set(auth)
      .send({ name: 'Site', type: 'WEBHOOK' })
      .expect(201);
    return { id: made.body.source.id as string, auth };
  }
  const leadCount = (sourceId: string) => prisma.lead.count({ where: { sourceId } });
  const visitor = (n: number) => ({
    name: `Visitor ${n}`,
    email: `visitor.${n}.${Date.now()}@acme-test.com`,
    message: 'Hello',
  });

  it('is closed until the owner switches it on: info and submit both answer 404', async () => {
    const s = await source();
    await http().get(`/v1/forms/${s.id}`).expect(404);
    await http().post(`/v1/forms/${s.id}`).send(visitor(1)).expect(404);
    expect(await leadCount(s.id)).toBe(0);
    // A made-up id is the same answer: nothing tells whether a source exists.
    await http().get('/v1/forms/00000000-0000-4000-8000-000000000000').expect(404);
  });

  it('once on: shows the company name, takes a lead like any other, and counts it', async () => {
    const s = await source();
    await http().patch(`/sources/${s.id}`).set(s.auth).send({ formEnabled: true }).expect(200);
    const info = await http().get(`/v1/forms/${s.id}`).expect(200);
    expect(info.body).toEqual({ workspaceName: 'Harbour & Pine' });

    await http().post(`/v1/forms/${s.id}`).send(visitor(2)).expect(204);
    expect(await leadCount(s.id)).toBe(1);
    expect(
      await prisma.ingestAttempt.count({ where: { sourceId: s.id, outcome: 'CREATED' } }),
    ).toBe(1);

    // Switching the source itself off closes the form too.
    await http().patch(`/sources/${s.id}`).set(s.auth).send({ enabled: false }).expect(200);
    await http().post(`/v1/forms/${s.id}`).send(visitor(3)).expect(404);
  });

  it('drops a submission that fills the hidden trap field, and says nothing', async () => {
    const s = await source();
    await http().patch(`/sources/${s.id}`).set(s.auth).send({ formEnabled: true }).expect(200);
    await http()
      .post(`/v1/forms/${s.id}`)
      .send({ ...visitor(4), website: 'http://spam.example' })
      .expect(204);
    expect(await leadCount(s.id)).toBe(0);
  });

  it('refuses an unusable contact with a 400 and counts it as refused', async () => {
    const s = await source();
    await http().patch(`/sources/${s.id}`).set(s.auth).send({ formEnabled: true }).expect(200);
    const res = await http().post(`/v1/forms/${s.id}`).send({ name: 'No contact' });
    expect(res.status).toBe(400);
    expect(
      await prisma.ingestAttempt.count({ where: { sourceId: s.id, outcome: 'REJECTED' } }),
    ).toBe(1);
    // Unknown fields and oversized text are refused before anything is read.
    await http()
      .post(`/v1/forms/${s.id}`)
      .send({ ...visitor(5), isAdmin: true })
      .expect(400);
    await http()
      .post(`/v1/forms/${s.id}`)
      .send({ ...visitor(6), message: 'x'.repeat(2001) })
      .expect(400);
    expect(await leadCount(s.id)).toBe(0);
  });

  it('limits each address: past the limit it answers 429 with Retry-After', async () => {
    const s = await source();
    await http().patch(`/sources/${s.id}`).set(s.auth).send({ formEnabled: true }).expect(200);
    // A fresh counter, so the requests the other tests made from this address do not count.
    const limits = app.get(IngestLimits);
    const before = limits.formPerIp;
    Object.assign(limits, {
      formPerIp: new FixedWindowLimiter(2, app.get(WINDOW_STORE), `test-form-${Date.now()}`),
    });
    try {
      await http().post(`/v1/forms/${s.id}`).send(visitor(7)).expect(204);
      await http().post(`/v1/forms/${s.id}`).send(visitor(8)).expect(204);
      const third = await http().post(`/v1/forms/${s.id}`).send(visitor(9));
      expect(third.status).toBe(429);
      expect(Number(third.headers['retry-after'])).toBeGreaterThan(0);
    } finally {
      Object.assign(limits, { formPerIp: before });
    }
  });

  it('only the owner or an admin can switch it on', async () => {
    const s = await source();
    const stranger = await ownerOf(app, 'other');
    // Another workspace cannot reach this source at all.
    await http()
      .patch(`/sources/${s.id}`)
      .set('authorization', `Bearer ${stranger.accessToken}`)
      .send({ formEnabled: true })
      .expect(404);
    await http().get(`/v1/forms/${s.id}`).expect(404);
  });
});
