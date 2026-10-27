import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomBytes } from 'node:crypto';
import { PrismaClient } from '../src/generated/prisma/client';
import { ENRICHMENT_TTL_MS, UNREACHABLE_TTL_MS } from '../src/enrichment/enrichment.service';
import { PipelineService } from '../src/pipeline/pipeline.service';
import { PipelineQueue } from '../src/queue/pipeline.queue';
import { createTestApp } from './utils/create-test-app';
import { INVITES_EMAIL_PREFIX, ownerOf } from './utils/invites';
import { workspaceOf } from './utils/workspace-data';
import request from 'supertest';

/** The enrichment step of the pipeline: company info by domain, cached, scoped to the job's workspace. */
describe('Enrichment (e2e)', () => {
  let app: NestExpressApplication;
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  const domains: string[] = [];

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.get(PipelineQueue).queue.obliterate({ force: true });
    await prisma.enrichment.deleteMany({ where: { domain: { in: domains } } });
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

  async function workspace() {
    const owner = await ownerOf(app);
    const workspaceId = await workspaceOf(prisma, owner.body.email);
    const made = await request(app.getHttpServer())
      .post('/sources')
      .set('authorization', `Bearer ${owner.accessToken}`)
      .send({ name: 'Enrichment', type: 'WEBHOOK' })
      .expect(201);
    return { workspaceId, sourceId: made.body.source.id as string };
  }

  const lead = (t: { workspaceId: string; sourceId: string }, data: object) =>
    prisma.lead.create({
      data: {
        workspaceId: t.workspaceId,
        sourceId: t.sourceId,
        email: `e-${randomBytes(4).toString('hex')}@x-test.com`,
        rawPayload: {},
        ...data,
      },
    });
  const run = (workspaceId: string, leadId: string) =>
    app.get(PipelineService).run({ workspaceId, leadId });
  const events = (leadId: string) =>
    prisma.leadEvent.findMany({
      where: { leadId, type: 'enriched' },
      orderBy: { createdAt: 'asc' },
    });
  const domain = (name: string) => {
    const full = `${name}-${randomBytes(3).toString('hex')}.com`;
    domains.push(full);
    return full;
  };

  it('looks up the lead’s domain once, caches it for a week, and records an "enriched" event', async () => {
    const t = await workspace();
    const d = domain('acme');
    const first = await lead(t, { domain: d });
    const second = await lead(t, { domain: d });

    await run(t.workspaceId, first.id);
    await run(t.workspaceId, second.id);

    const rows = await prisma.enrichment.findMany({ where: { domain: d } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ provider: 'mock' });
    expect(rows[0]!.data).toMatchObject({ status: 'ok', title: expect.stringContaining('Acme') });
    expect(rows[0]!.expiresAt.getTime() - rows[0]!.fetchedAt.getTime()).toBe(ENRICHMENT_TTL_MS);
    expect((await events(first.id))[0]!.payload).toEqual({
      domain: d,
      provider: 'mock',
      status: 'ok',
      cached: false,
    });
    expect((await events(second.id))[0]!.payload).toMatchObject({ cached: true });
  });

  it('a page that cannot be read is remembered for a day, not a week', async () => {
    const t = await workspace();
    const d = `unreachable.${domain('down')}`;
    const l = await lead(t, { domain: d });
    await run(t.workspaceId, l.id);
    const row = await prisma.enrichment.findUniqueOrThrow({ where: { domain: d } });
    expect(row.data).toMatchObject({ status: 'unreachable' });
    expect(row.expiresAt.getTime() - row.fetchedAt.getTime()).toBe(UNREACHABLE_TTL_MS);
    expect((await events(l.id))[0]!.payload).toMatchObject({ status: 'unreachable' });
  });

  it('does nothing for a lead without a domain (free mail), and for a lead of another workspace', async () => {
    const a = await workspace();
    const b = await workspace();
    const free = await lead(a, { email: 'ann@gmail.com', isFreeMail: true });
    const d = domain('other');
    const inB = await lead(b, { domain: d });
    await run(a.workspaceId, free.id);
    // A job that names workspace A but a lead of workspace B finds nothing there.
    await run(a.workspaceId, inB.id);
    expect(await events(free.id)).toHaveLength(0);
    expect(await events(inB.id)).toHaveLength(0);
    expect(await prisma.enrichment.count({ where: { domain: d } })).toBe(0);
  });
});
