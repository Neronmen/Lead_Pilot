import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { PrismaClient } from '../src/generated/prisma/client';
import { MaintenanceService } from '../src/maintenance/maintenance.service';
import { PipelineQueue } from '../src/queue/pipeline.queue';
import { createTestApp } from './utils/create-test-app';
import { INVITES_EMAIL_PREFIX, ownerOf } from './utils/invites';
import { workspaceOf } from './utils/workspace-data';

const DAY = 86_400_000;

/** Retention clean-up and the recovery sweep: they only remove or re-queue what is due. */
describe('Maintenance jobs (e2e)', () => {
  let app: NestExpressApplication;
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });

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

  async function setup() {
    const owner = await ownerOf(app);
    const workspaceId = await workspaceOf(prisma, owner.body.email);
    const made = await request(app.getHttpServer())
      .post('/sources')
      .set('authorization', `Bearer ${owner.accessToken}`)
      .send({ name: 'Maintenance', type: 'WEBHOOK' })
      .expect(201);
    return { owner, workspaceId, sourceId: made.body.source.id as string };
  }

  it('drops old raw payloads (lead and timeline) and old rows, and keeps recent ones', async () => {
    const t = await setup();
    const old = new Date(Date.now() - 100 * DAY);
    const lead = (extra: object) =>
      prisma.lead.create({
        data: {
          workspaceId: t.workspaceId,
          sourceId: t.sourceId,
          email: `m-${randomBytes(4).toString('hex')}@acme-test.com`,
          rawPayload: { secret: 'personal data' },
          ...extra,
        },
      });
    const oldLead = await lead({});
    const freshLead = await lead({});
    // Back-date the old lead (updatedAt is set by Prisma, so write it with a raw timestamp via update).
    await prisma.$executeRaw`UPDATE "Lead" SET "updatedAt" = ${old} WHERE id = ${oldLead.id}::uuid`;
    const event = (leadId: string, createdAt: Date) =>
      prisma.leadEvent.create({
        data: {
          workspaceId: t.workspaceId,
          leadId,
          type: 'ingested',
          createdAt,
          payload: { sourceId: t.sourceId, rawPayload: { secret: 'personal data' } },
        },
      });
    const oldEvent = await event(oldLead.id, old);
    const freshEvent = await event(freshLead.id, new Date());
    await prisma.ingestAttempt.createMany({
      data: [
        { workspaceId: t.workspaceId, sourceId: t.sourceId, outcome: 'CREATED', createdAt: old },
        { workspaceId: t.workspaceId, sourceId: t.sourceId, outcome: 'CREATED' },
      ],
    });
    await prisma.idempotencyKey.createMany({
      data: [
        {
          workspaceId: t.workspaceId,
          sourceId: t.sourceId,
          key: 'expired',
          requestHash: 'h',
          expiresAt: new Date(Date.now() - 1000),
        },
        {
          workspaceId: t.workspaceId,
          sourceId: t.sourceId,
          key: 'live',
          requestHash: 'h',
          expiresAt: new Date(Date.now() + DAY),
        },
      ],
    });

    const maintenance = app.get(MaintenanceService);
    const first = await maintenance.cleanup();
    expect(first.rawPayloadsPurged).toBeGreaterThanOrEqual(1);
    expect(first.eventPayloadsPurged).toBeGreaterThanOrEqual(1);

    expect((await prisma.lead.findUniqueOrThrow({ where: { id: oldLead.id } })).rawPayload).toEqual(
      {},
    );
    expect(
      (await prisma.lead.findUniqueOrThrow({ where: { id: freshLead.id } })).rawPayload,
    ).toEqual({
      secret: 'personal data',
    });
    expect(
      (await prisma.leadEvent.findUniqueOrThrow({ where: { id: oldEvent.id } })).payload,
    ).toEqual({
      sourceId: t.sourceId,
      purged: true,
    });
    expect(
      (await prisma.leadEvent.findUniqueOrThrow({ where: { id: freshEvent.id } })).payload,
    ).toMatchObject({ rawPayload: { secret: 'personal data' } });
    expect(await prisma.ingestAttempt.count({ where: { sourceId: t.sourceId } })).toBe(1);
    expect(
      (await prisma.idempotencyKey.findMany({ where: { sourceId: t.sourceId } })).map((k) => k.key),
    ).toEqual(['live']);

    // Running it again changes nothing for this workspace.
    await maintenance.cleanup();
    expect(await prisma.ingestAttempt.count({ where: { sourceId: t.sourceId } })).toBe(1);
  });

  it('re-queues a lead that is still NEW after a while, and not a fresh one', async () => {
    const t = await setup();
    const queue = app.get(PipelineQueue).queue;
    const mk = (createdAt: Date) =>
      prisma.lead.create({
        data: {
          workspaceId: t.workspaceId,
          sourceId: t.sourceId,
          email: `s-${randomBytes(4).toString('hex')}@acme-test.com`,
          rawPayload: {},
          createdAt,
        },
      });
    const stuck = await mk(new Date(Date.now() - 10 * 60_000));
    const fresh = await mk(new Date());
    await app.get(MaintenanceService).requeueStuckLeads();
    expect((await queue.getJob(`${stuck.id}-score`))?.data).toEqual({
      workspaceId: t.workspaceId,
      leadId: stuck.id,
    });
    expect(await queue.getJob(`${fresh.id}-score`)).toBeUndefined();
    await queue.getJob(`${stuck.id}-score`).then((job) => job?.remove());
  });
});
