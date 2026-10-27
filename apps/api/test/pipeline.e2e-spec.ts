import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomBytes } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import request from 'supertest';
import { PrismaClient } from '../src/generated/prisma/client';
import { PipelineService } from '../src/pipeline/pipeline.service';
import { PipelineWorker } from '../src/pipeline/pipeline.worker';
import { PipelineQueue, type ProcessLeadJob } from '../src/queue/pipeline.queue';
import { createTestApp } from './utils/create-test-app';
import { INVITES_EMAIL_PREFIX, ownerOf } from './utils/invites';

/** The lead pipeline queue: queued after the commit, one job per lead, run by a worker. */
describe('Pipeline queue (e2e)', () => {
  let app: NestExpressApplication;
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  const queue = () => app.get(PipelineQueue).queue;

  beforeAll(async () => {
    app = await createTestApp();
    // This file runs a real worker (the other e2e files only queue).
    app.get(PipelineWorker).start();
  });

  afterAll(async () => {
    await queue().obliterate({ force: true });
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

  async function source() {
    const owner = await ownerOf(app);
    const made = await request(app.getHttpServer())
      .post('/sources')
      .set('authorization', `Bearer ${owner.accessToken}`)
      .send({ name: 'Queue test', type: 'WEBHOOK' })
      .expect(201);
    return { sourceId: made.body.source.id as string, key: made.body.apiKey as string };
  }

  const send = (s: { sourceId: string; key: string }, body: object) =>
    request(app.getHttpServer())
      .post(`/v1/ingest/${s.sourceId}`)
      .set('authorization', `Bearer ${s.key}`)
      .send(body);

  it('a stored lead is handed to the worker once, with its workspace and lead id', async () => {
    const seen: ProcessLeadJob[] = [];
    app.get(PipelineService).register(async (job) => {
      seen.push(job);
    });
    const s = await source();
    const res = await send(s, {
      email: `q-${randomBytes(4).toString('hex')}@acme-test.com`,
    }).expect(201);

    // Other test files queue jobs into the same queue too, so wait for this lead's own job.
    for (let i = 0; i < 80 && !seen.some((j) => j.leadId === res.body.leadId); i += 1) {
      await sleep(100);
    }
    const job = seen.find((j) => j.leadId === res.body.leadId);
    expect(job).toBeDefined();
    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: res.body.leadId } });
    expect(job!.workspaceId).toBe(lead.workspaceId);
    // A finished job is removed, so the next submission can queue a new one.
    await sleep(200);
    expect(await queue().getJob(`${res.body.leadId}-score`)).toBeUndefined();
  });

  it('queueing the same lead twice while a job waits makes one job (the id is lead + step)', async () => {
    const q = app.get(PipelineQueue);
    // Pause so the job stays waiting for the second add.
    await queue().pause();
    try {
      const job = { workspaceId: crypto.randomUUID(), leadId: crypto.randomUUID() };
      await q.enqueueLead(job);
      await q.enqueueLead(job);
      expect(await queue().getJobCounts('waiting', 'paused')).toMatchObject({});
      const found = await queue().getJob(`${job.leadId}-score`);
      expect(found?.data).toEqual(job);
      const all = await queue().getJobs(['waiting', 'paused']);
      expect(all.filter((j) => j.id === `${job.leadId}-score`)).toHaveLength(1);
    } finally {
      await queue().resume();
    }
  });

  it('a failing step does not lose the job: it is retried, not dropped', async () => {
    const job = { workspaceId: crypto.randomUUID(), leadId: crypto.randomUUID() };
    let calls = 0;
    app.get(PipelineService).register(async (j) => {
      if (j.leadId !== job.leadId) return;
      calls += 1;
      throw new Error('step failed');
    });
    await app.get(PipelineQueue).enqueueLead(job);
    for (let i = 0; i < 40 && calls === 0; i += 1) await sleep(100);
    expect(calls).toBeGreaterThanOrEqual(1);
    await sleep(300);
    const found = await queue().getJob(`${job.leadId}-score`);
    expect(found).toBeDefined(); // waiting for the backoff, with its attempts counted
    expect(found!.attemptsMade).toBeGreaterThanOrEqual(1);
    await found!.remove();
  });
});
