import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaPg } from '@prisma/adapter-pg';
import request from 'supertest';
import { PrismaClient } from '../src/generated/prisma/client';
import { PipelineService } from '../src/pipeline/pipeline.service';
import { PipelineQueue } from '../src/queue/pipeline.queue';
import { createTestApp } from './utils/create-test-app';
import { INVITES_EMAIL_PREFIX, joinAs, ownerOf } from './utils/invites';
import { membershipOf, workspaceOf } from './utils/workspace-data';

/** The Leads list: filters, search, paging, who may read it. */
describe('Leads list (e2e)', () => {
  let app: NestExpressApplication;
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
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

  const get = (who: { accessToken: string }, query = '') =>
    request(app.getHttpServer())
      .get(`/leads${query}`)
      .set('authorization', `Bearer ${who.accessToken}`);

  async function setup() {
    const owner = await ownerOf(app);
    const member = await joinAs(app, owner, 'MEMBER', 'member');
    const workspaceId = await workspaceOf(prisma, owner.body.email);
    const source = await prisma.source.create({
      data: {
        workspaceId,
        name: 'Zapier',
        type: 'WEBHOOK',
        apiKeyPrefix: `lp_t${Date.now()}${Math.random().toString(16).slice(2, 8)}`,
        apiKeyHash: 'x',
      },
    });
    const lead = (data: Record<string, unknown>) =>
      prisma.lead.create({ data: { workspaceId, sourceId: source.id, rawPayload: {}, ...data } });
    return { owner, member, workspaceId, source, lead };
  }

  it('lists newest first with the source and a joined name; members may read it', async () => {
    const t = await setup();
    await t.lead({ email: 'first@acme.com', firstName: 'Ann', lastName: 'Lee', company: 'Acme' });
    await t.lead({ email: 'second@acme.com' });
    const res = await get(t.member).expect(200);
    expect(res.body.nextCursor).toBeNull();
    expect(res.body.items.map((l: { email: string }) => l.email)).toEqual([
      'second@acme.com',
      'first@acme.com',
    ]);
    expect(res.body.items[1]).toMatchObject({
      name: 'Ann Lee',
      company: 'Acme',
      status: 'NEW',
      isFreeMail: false,
      owner: null,
      source: { id: t.source.id, name: 'Zapier', type: 'WEBHOOK' },
    });
    expect(res.body.items[0].name).toBeNull();
    await request(app.getHttpServer()).get('/leads').expect(401);
  });

  it('shows how many times a lead was submitted, and which lead it may duplicate', async () => {
    const t = await setup();
    const older = await t.lead({ email: 'ann@gmail.com', firstName: 'Ann', phone: '+84901234567' });
    const newer = await t.lead({ email: 'ann.lee@acme.com', possibleDuplicateOfId: older.id });
    const event = (leadId: string) => ({
      workspaceId: t.workspaceId,
      leadId,
      type: 'ingested',
      payload: {},
    });
    await prisma.leadEvent.createMany({
      data: [event(older.id), event(older.id), event(newer.id)],
    });
    const res = await get(t.owner).expect(200);
    const byId = new Map((res.body.items as Array<{ id: string }>).map((l) => [l.id, l as never]));
    expect(byId.get(older.id)).toMatchObject({ submissions: 2, possibleDuplicateOf: null });
    expect(byId.get(newer.id)).toMatchObject({
      submissions: 1,
      possibleDuplicateOf: { id: older.id, name: 'Ann', email: 'ann@gmail.com' },
    });
  });

  it('pages with a cursor: every lead once, no gaps', async () => {
    const t = await setup();
    for (let i = 0; i < 5; i += 1) await t.lead({ email: `p${i}@acme.com` });
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 5; page += 1) {
      const res: request.Response = await get(
        t.owner,
        `?limit=2${cursor ? `&cursor=${cursor}` : ''}`,
      ).expect(200);
      seen.push(...res.body.items.map((l: { id: string }) => l.id));
      cursor = res.body.nextCursor;
      if (!cursor) break;
    }
    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
  });

  it('filters by status, source, free mail; search is case-insensitive and "%" and "_" match themselves', async () => {
    const t = await setup();
    await t.lead({
      email: 'ann@gmail.com',
      isFreeMail: true,
      status: 'NEEDS_REVIEW',
      firstName: 'Ann',
    });
    await t.lead({ email: 'bob@acme.com', company: '100% Pure_Co' });
    await t.lead({ email: 'cat@acme.com', company: 'Plain' });
    const emails = async (q: string) =>
      ((await get(t.owner, q).expect(200)).body.items as Array<{ email: string }>)
        .map((l) => l.email)
        .sort();

    expect(await emails('?status=NEEDS_REVIEW')).toEqual(['ann@gmail.com']);
    expect(await emails('?freeMail=true')).toEqual(['ann@gmail.com']);
    expect(await emails('?freeMail=false')).toEqual(['bob@acme.com', 'cat@acme.com']);
    expect(await emails(`?sourceId=${crypto.randomUUID()}`)).toEqual([]);
    expect(await emails('?q=ANN')).toEqual(['ann@gmail.com']);
    expect(await emails('?q=%25')).toEqual(['bob@acme.com']); // a literal "%", not "match everything"
    expect(await emails('?q=_')).toEqual(['bob@acme.com']);
    expect(await emails(`?q=${encodeURIComponent("' OR 1=1 --")}`)).toEqual([]);
  });

  it('refuses a bad query with 400', async () => {
    const t = await setup();
    for (const q of [
      '?status=HOT',
      '?limit=0',
      '?limit=101',
      '?cursor=nope',
      '?freeMail=yes',
      '?x=1',
      `?q=${'a'.repeat(101)}`,
    ]) {
      const res = await get(t.owner, q).expect(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    }
  });

  describe("a lead's page, the review and the second look", () => {
    const post = (who: { accessToken: string }, path: string, body?: object) =>
      request(app.getHttpServer())
        .post(path)
        .set('authorization', `Bearer ${who.accessToken}`)
        .send(body);
    const scored = async (t: Awaited<ReturnType<typeof setup>>, data: object = {}) => {
      const l = await t.lead({
        email: `r-${Date.now()}-${Math.random().toString(16).slice(2, 6)}@acme.com`,
        company: 'Acme',
        ...data,
      });
      await app.get(PipelineService).run({ workspaceId: t.workspaceId, leadId: l.id });
      return l;
    };

    it('shows the lead with its timeline, the AI reasons and the company; a member may read it', async () => {
      const t = await setup();
      const l = await scored(t, { domain: 'acme.com', country: 'VN' });
      await prisma.leadEvent.create({
        data: {
          workspaceId: t.workspaceId,
          leadId: l.id,
          type: 'ingested',
          payload: { rawPayload: { a: 1 } },
        },
      });
      const detail = await request(app.getHttpServer())
        .get(`/leads/${l.id}`)
        .set('authorization', `Bearer ${t.member.accessToken}`)
        .expect(200);
      expect(detail.body).toMatchObject({
        id: l.id,
        domain: 'acme.com',
        status: expect.stringMatching(/SCORED|NEEDS_REVIEW/),
        latestScore: { provider: 'mock', ratedWithoutAi: false, reasons: expect.any(Array) },
        companyInfo: { status: 'ok' },
      });
      expect(detail.body.latestScore.reasons.length).toBeGreaterThan(0);
      const types = (detail.body.events as Array<{ type: string }>).map((e) => e.type);
      expect(types).toEqual(expect.arrayContaining(['ingested', 'enriched', 'scored']));
      expect(types.indexOf('ingested')).toBeLessThan(types.indexOf('enriched')); // newest first
      const list = await get(t.member).expect(200);
      expect(list.body.items[0]).toMatchObject({
        tier: expect.any(String),
        score: expect.any(Number),
      });
    });

    it('a lead of another workspace is a 404 on the page and on review, and nothing changes', async () => {
      const a = await setup();
      const b = await setup();
      const inB = await b.lead({
        email: 'b@acme.com',
        status: 'NEEDS_REVIEW',
        tier: 'COLD',
        score: 20,
      });
      const page = await request(app.getHttpServer())
        .get(`/leads/${inB.id}`)
        .set('authorization', `Bearer ${a.owner.accessToken}`)
        .expect(404);
      expect(page.body.error.code).toBe('NOT_FOUND');
      await post(a.owner, `/leads/${inB.id}/review`, { action: 'override', tier: 'HOT' }).expect(
        404,
      );
      await post(a.owner, `/leads/${inB.id}/review`, { action: 'approve' }).expect(404);
      expect(await prisma.lead.findUniqueOrThrow({ where: { id: inB.id } })).toMatchObject({
        tier: 'COLD',
        status: 'NEEDS_REVIEW',
      });
      expect(await prisma.feedback.count({ where: { leadId: inB.id } })).toBe(0);
      await request(app.getHttpServer())
        .get('/leads/not-a-uuid')
        .set('authorization', `Bearer ${a.owner.accessToken}`)
        .expect(400);
    });

    it('approve clears the review flag once; a second approve is a 409 and adds no correction', async () => {
      const t = await setup();
      const l = await t.lead({
        email: 'q@acme.com',
        status: 'NEEDS_REVIEW',
        tier: 'WARM',
        score: 55,
        confidence: 0.4,
      });
      await post(t.member, `/leads/${l.id}/review`, { action: 'approve' }).expect(204);
      expect(await prisma.lead.findUniqueOrThrow({ where: { id: l.id } })).toMatchObject({
        status: 'SCORED',
        tier: 'WARM',
      });
      const second = await post(t.owner, `/leads/${l.id}/review`, { action: 'approve' }).expect(
        409,
      );
      expect(second.body.error.code).toBe('CONFLICT');
      const feedback = await prisma.feedback.findMany({ where: { leadId: l.id } });
      expect(feedback).toHaveLength(1);
      expect(feedback[0]).toMatchObject({
        kind: 'approve',
        previousTier: 'WARM',
        newTier: 'WARM',
        userId: (await membershipOf(prisma, t.member.email, t.workspaceId)).userId,
      });
    });

    it('an override changes the tier, records who and why, and later automatic scoring cannot undo it', async () => {
      const t = await setup();
      const l = await scored(t, { country: 'VN' });
      const before = await prisma.lead.findUniqueOrThrow({ where: { id: l.id } });
      await post(t.member, `/leads/${l.id}/review`, {
        action: 'override',
        tier: 'JUNK',
        score: 3,
        note: 'A competitor, not a buyer',
      }).expect(204);
      expect(await prisma.lead.findUniqueOrThrow({ where: { id: l.id } })).toMatchObject({
        tier: 'JUNK',
        score: 3,
        status: 'SCORED',
      });
      const [fb] = await prisma.feedback.findMany({ where: { leadId: l.id } });
      expect(fb).toMatchObject({
        kind: 'override',
        previousTier: before.tier,
        newTier: 'JUNK',
        newScore: 3,
        note: 'A competitor, not a buyer',
        userId: (await membershipOf(prisma, t.member.email, t.workspaceId)).userId,
      });
      expect(fb!.scoreId).toBeTruthy();
      const event = await prisma.leadEvent.findFirstOrThrow({
        where: { leadId: l.id, type: 'reviewed' },
      });
      expect(event.actorUserId).toBe(
        (await membershipOf(prisma, t.member.email, t.workspaceId)).userId,
      );

      // Another submission arrives and the AI rates it again: the person's rating stays.
      await app.get(PipelineService).run({ workspaceId: t.workspaceId, leadId: l.id });
      expect(await prisma.lead.findUniqueOrThrow({ where: { id: l.id } })).toMatchObject({
        tier: 'JUNK',
        score: 3,
      });
      expect(await prisma.score.count({ where: { leadId: l.id } })).toBe(2); // still recorded
      const again = await prisma.leadEvent.findMany({
        where: { leadId: l.id, type: 'scored' },
        orderBy: { createdAt: 'desc' },
      });
      expect(again[0]!.payload).toMatchObject({ keptPersonsRating: true });
    });

    it.each([
      [{}],
      [{ action: 'maybe' }],
      [{ action: 'override' }],
      [{ action: 'override', tier: 'LUKEWARM' }],
      [{ action: 'override', tier: 'HOT', score: 101 }],
      [{ action: 'override', tier: 'HOT', note: '' }],
      [{ action: 'override', tier: 'HOT', userId: '00000000-0000-4000-8000-000000000000' }],
      [{ action: 'approve', tier: 'HOT' }],
    ])('refuses the review body %j with 400', async (body) => {
      const t = await setup();
      const l = await t.lead({
        email: 'v@acme.com',
        status: 'NEEDS_REVIEW',
        tier: 'COLD',
        score: 10,
      });
      await post(t.owner, `/leads/${l.id}/review`, body).expect(400);
      expect(await prisma.feedback.count({ where: { leadId: l.id } })).toBe(0);
    });

    it('rescore: only Owner and Admin, only this workspace, skips leads a person has rated', async () => {
      const t = await setup();
      const other = await setup();
      const fresh = await t.lead({
        email: 'n@acme.com',
        status: 'SCORED',
        tier: 'COLD',
        score: 20,
      });
      const rated = await t.lead({
        email: 'o@acme.com',
        status: 'SCORED',
        tier: 'COLD',
        score: 20,
      });
      await post(t.owner, `/leads/${rated.id}/review`, { action: 'override', tier: 'HOT' }).expect(
        204,
      );
      const foreign = await other.lead({
        email: 'f@acme.com',
        status: 'SCORED',
        tier: 'COLD',
        score: 20,
      });
      const routed = await t.lead({ email: 'p@acme.com', status: 'ROUTED' });

      await post(t.member, '/leads/rescore', { scope: 'open' }).expect(403);
      await post(t.owner, '/leads/rescore', { scope: 'nope' }).expect(400);
      const res = await post(t.owner, '/leads/rescore', { scope: 'open' }).expect(200);
      expect(res.body).toEqual({ queued: 1 });
      const queue = app.get(PipelineQueue).queue;
      expect(await queue.getJob(`${fresh.id}-score`)).toBeDefined();
      expect(await queue.getJob(`${rated.id}-score`)).toBeUndefined();
      expect(await queue.getJob(`${foreign.id}-score`)).toBeUndefined();
      expect(await queue.getJob(`${routed.id}-score`)).toBeUndefined();
    });

    it('lists oldest first for the review queue, paging in the same direction', async () => {
      const t = await setup();
      for (const n of ['a', 'b', 'c'])
        await t.lead({ email: `${n}@acme.com`, status: 'NEEDS_REVIEW' });
      const first = await get(t.owner, '?status=NEEDS_REVIEW&order=oldest&limit=2').expect(200);
      expect((first.body.items as Array<{ email: string }>).map((l) => l.email)).toEqual([
        'a@acme.com',
        'b@acme.com',
      ]);
      const next = await get(
        t.owner,
        `?status=NEEDS_REVIEW&order=oldest&limit=2&cursor=${first.body.nextCursor}`,
      ).expect(200);
      expect((next.body.items as Array<{ email: string }>).map((l) => l.email)).toEqual([
        'c@acme.com',
      ]);
      await get(t.owner, '?order=sideways').expect(400);
    });

    it('filters the list by tier', async () => {
      const t = await setup();
      await t.lead({ email: 'h@acme.com', tier: 'HOT', score: 90, status: 'SCORED' });
      await t.lead({ email: 'c@acme.com', tier: 'COLD', score: 20, status: 'SCORED' });
      const res = await get(t.owner, '?tier=HOT').expect(200);
      expect((res.body.items as Array<{ email: string }>).map((l) => l.email)).toEqual([
        'h@acme.com',
      ]);
      await get(t.owner, '?tier=hot').expect(400);
    });
  });
  describe('outcomes (Won, Lost, Bad lead) and the overview numbers', () => {
    const post = (who: { accessToken: string }, path: string, body?: object) =>
      request(app.getHttpServer())
        .post(path)
        .set('authorization', `Bearer ${who.accessToken}`)
        .send(body);

    it('a rep marks Won or Lost; it is kept with who and when, a repeat records nothing, and clearing removes it', async () => {
      const t = await setup();
      const l = await t.lead({ email: 'w@acme.com', tier: 'HOT', score: 90, status: 'SCORED' });
      await post(t.member, `/leads/${l.id}/outcome`, { outcome: 'WON' }).expect(204);
      const won = await prisma.lead.findUniqueOrThrow({ where: { id: l.id } });
      expect(won).toMatchObject({ outcome: 'WON', tier: 'HOT' });
      expect(won.outcomeSetBy).toBe(
        (await membershipOf(prisma, t.member.email, t.workspaceId)).userId,
      );
      expect(won.outcomeSetAt).toBeInstanceOf(Date);

      await post(t.member, `/leads/${l.id}/outcome`, { outcome: 'WON' }).expect(204); // no change
      expect(await prisma.leadEvent.count({ where: { leadId: l.id, type: 'outcome' } })).toBe(1);

      await post(t.owner, `/leads/${l.id}/outcome`, { outcome: 'LOST' }).expect(204);
      expect(await prisma.leadEvent.count({ where: { leadId: l.id, type: 'outcome' } })).toBe(2);

      await post(t.owner, `/leads/${l.id}/outcome`, { outcome: 'NONE' }).expect(204);
      expect(await prisma.lead.findUniqueOrThrow({ where: { id: l.id } })).toMatchObject({
        outcome: 'NONE',
        outcomeSetBy: null,
        outcomeSetAt: null,
      });

      const detail = await request(app.getHttpServer())
        .get(`/leads/${l.id}`)
        .set('authorization', `Bearer ${t.owner.accessToken}`)
        .expect(200);
      expect(detail.body).toMatchObject({ outcome: 'NONE', outcomeSetBy: null });
    });

    it('"Bad lead" makes it Junk as a person\'s final rating, leaves the queue, and is kept as a correction', async () => {
      const t = await setup();
      const l = await t.lead({
        email: 'b@acme.com',
        tier: 'WARM',
        score: 60,
        status: 'NEEDS_REVIEW',
        reviewReason: 'limited_info',
      });
      await post(t.member, `/leads/${l.id}/outcome`, { outcome: 'BAD' }).expect(204);
      expect(await prisma.lead.findUniqueOrThrow({ where: { id: l.id } })).toMatchObject({
        outcome: 'BAD',
        tier: 'JUNK',
        status: 'SCORED',
        reviewReason: null,
      });
      const [fb] = await prisma.feedback.findMany({ where: { leadId: l.id } });
      expect(fb).toMatchObject({ kind: 'override', previousTier: 'WARM', newTier: 'JUNK' });

      // The AI rating it again cannot bring it back.
      await app.get(PipelineService).run({ workspaceId: t.workspaceId, leadId: l.id });
      expect(await prisma.lead.findUniqueOrThrow({ where: { id: l.id } })).toMatchObject({
        tier: 'JUNK',
        outcome: 'BAD',
      });
    });

    it("another workspace's lead is a 404, and a bad body is a 400", async () => {
      const a = await setup();
      const b = await setup();
      const inB = await b.lead({ email: 'x@acme.com', tier: 'HOT', score: 90, status: 'SCORED' });
      await post(a.owner, `/leads/${inB.id}/outcome`, { outcome: 'WON' }).expect(404);
      expect(await prisma.lead.findUniqueOrThrow({ where: { id: inB.id } })).toMatchObject({
        outcome: 'NONE',
      });
      const own = await a.lead({ email: 'y@acme.com' });
      for (const body of [
        {},
        { outcome: 'MAYBE' },
        { outcome: 'CONTACTED' },
        { outcome: 'WON', by: 'me' },
      ]) {
        await post(a.owner, `/leads/${own.id}/outcome`, body).expect(400);
      }
    });

    it('overview: junk share, median time to the first rating, leads by tier and by information level, own workspace only', async () => {
      const t = await setup();
      const other = await setup();
      const at = (seconds: number) => new Date(Date.now() - 3600_000 + seconds * 1000);
      const rated = async (
        tier: 'HOT' | 'JUNK' | 'COLD',
        infoLevel: string,
        waitSeconds: number,
        i: number,
      ) => {
        const created = at(0);
        const l = await t.lead({
          email: `o${i}@acme.com`,
          tier,
          score: 50,
          infoLevel,
          createdAt: created,
        });
        const sourceModelScore = await prisma.promptVersion.findFirst();
        await prisma.score.create({
          data: {
            workspaceId: t.workspaceId,
            leadId: l.id,
            promptVersionId: sourceModelScore!.id,
            provider: 'mock',
            model: 'mock-1',
            output: {},
            score: 50,
            tier,
            confidence: 0.9,
            isSpam: false,
            latencyMs: 1,
            createdAt: at(waitSeconds),
          },
        });
      };
      // The prompt version row exists once something was scored; make sure there is one.
      await app
        .get(PipelineService)
        .run({ workspaceId: t.workspaceId, leadId: (await t.lead({ email: 'seed@acme.com' })).id });
      await rated('HOT', 'rich', 10, 1);
      await rated('HOT', 'enough', 20, 2);
      await rated('JUNK', 'limited', 30, 3);
      await rated('COLD', 'limited', 40, 4);
      await other.lead({ email: 'z@acme.com', tier: 'HOT', score: 80, infoLevel: 'rich' });

      const res = await request(app.getHttpServer())
        .get('/overview')
        .set('authorization', `Bearer ${t.member.accessToken}`)
        .expect(200);
      expect(res.body.byTier).toMatchObject({ HOT: 2, JUNK: 1 });
      expect(res.body.byInfoLevel).toMatchObject({ rich: 1, enough: 1 });
      expect(res.body.byInfoLevel.limited).toBeGreaterThanOrEqual(2);
      expect(res.body.junkPercent).toBeGreaterThan(0);
      expect(res.body.medianSecondsToFirstRating).toBeGreaterThan(0);
      // Nothing of the other workspace shows: its HOT lead is not in the count.
      expect(res.body.byTier.HOT).toBe(2);
      await request(app.getHttpServer()).get('/overview').expect(401);
    });
  });
});
