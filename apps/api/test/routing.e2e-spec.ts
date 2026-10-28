import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { ActionsQueue } from '../src/actions/actions.queue';
import { ActionsService } from '../src/actions/actions.service';
import { ActionError, ActionTransport } from '../src/actions/transport';
import { PipelineQueue } from '../src/queue/pipeline.queue';
import { PrismaClient } from '../src/generated/prisma/client';
import { RoutingRunner } from '../src/routing/routing.runner';
import { createTestApp } from './utils/create-test-app';
import { INVITES_EMAIL_PREFIX, joinAs, mailbox, ownerOf } from './utils/invites';
import { membershipOf, workspaceOf } from './utils/workspace-data';

const SLACK = 'https://hooks.slack.com/services/T0/B0/SECRETSECRET';

/** Routing rules, integrations and actions: from a rated lead to an assigned owner and a sent alert. */
describe('Routing and actions (e2e)', () => {
  let app: NestExpressApplication;
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.get(ActionsQueue).queue.obliterate({ force: true });
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

  /** A workspace with an owner, two members in a team, a Slack integration and one "hot" rule. */
  async function setup() {
    const owner = await ownerOf(app);
    const auth = { authorization: `Bearer ${owner.accessToken}` };
    const workspaceId = await workspaceOf(prisma, owner.body.email);
    const m1 = await joinAs(app, owner, 'MEMBER', 'rep1');
    const m2 = await joinAs(app, owner, 'MEMBER', 'rep2');
    const member1 = await membershipOf(prisma, m1.email, workspaceId);
    const member2 = await membershipOf(prisma, m2.email, workspaceId);
    const team = await prisma.team.create({
      data: { workspaceId, name: `AEs ${randomBytes(3).toString('hex')}` },
    });
    await prisma.teamMember.createMany({
      data: [member1, member2].map((m) => ({ teamId: team.id, membershipId: m.id, workspaceId })),
    });
    const source = await http()
      .post('/sources')
      .set(auth)
      .send({ name: 'Form', type: 'FORM' })
      .expect(201);
    const slack = await http()
      .post('/integrations')
      .set(auth)
      .send({ type: 'SLACK', name: 'Sales channel', config: { webhookUrl: SLACK } })
      .expect(201);
    const rule = await http()
      .post('/routing/rules')
      .set(auth)
      .send({
        name: 'Hot leads',
        conditions: { match: 'all', conditions: [{ field: 'tier', op: 'is', value: 'hot' }] },
        actions: [
          { type: 'assign', to: { kind: 'team', teamId: team.id } },
          { type: 'tag', tag: 'hot' },
          { type: 'email', template: 'hot_lead', to: 'owner' },
          { type: 'slack', integrationId: slack.body.id },
        ],
      })
      .expect(201);
    return {
      owner,
      auth,
      workspaceId,
      team,
      members: [member1, member2],
      sourceId: source.body.source.id as string,
      slackId: slack.body.id as string,
      ruleId: rule.body.id as string,
    };
  }
  type World = Awaited<ReturnType<typeof setup>>;

  const makeLead = (w: World, data: object = {}) =>
    prisma.lead.create({
      data: {
        workspaceId: w.workspaceId,
        sourceId: w.sourceId,
        email: `r-${randomBytes(4).toString('hex')}@acme-test.com`,
        firstName: 'Mia',
        company: 'Acme',
        country: 'US',
        tier: 'HOT',
        score: 91,
        status: 'SCORED',
        rawPayload: {},
        ...data,
      },
    });
  const runsOf = (leadId: string) =>
    prisma.actionRun.findMany({ where: { leadId }, orderBy: { createdAt: 'asc' } });
  const route = (w: World, leadId: string) =>
    app.get(RoutingRunner).routeLead({ workspaceId: w.workspaceId, leadId });
  const execute = (w: World, runId: string, finalTry = false) =>
    app.get(ActionsService).execute({ workspaceId: w.workspaceId, runId }, finalTry);

  it('routes a hot lead: assigns the next rep, tags it, queues the email and the Slack message', async () => {
    const w = await setup();
    const lead = await makeLead(w);
    await route(w, lead.id);

    const after = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(w.members.map((m) => m.userId)).toContain(after.ownerId);
    expect(after.tags).toEqual(['hot']);
    expect(after.status).toBe('ROUTED');
    const runs = await runsOf(lead.id);
    expect(runs.map((r) => [r.type, r.status])).toEqual([
      ['assign', 'SUCCEEDED'],
      ['tag', 'SUCCEEDED'],
      ['email', 'PENDING'],
      ['slack', 'PENDING'],
    ]);

    // The queued ones run (the worker is off in tests, so run them directly).
    const transport = app.get(ActionTransport);
    const sentBefore = transport.sent.length;
    for (const run of runs.filter((r) => r.status === 'PENDING')) await execute(w, run.id);
    expect((await runsOf(lead.id)).every((r) => r.status === 'SUCCEEDED')).toBe(true);
    // Mock mode: the Slack call was recorded, not made.
    expect(transport.sent).toHaveLength(sentBefore + 1);
    expect(JSON.stringify(transport.sent.at(-1))).toContain('Hot lead: Mia (Acme)');
    // The alert went to the person the lead was assigned to.
    const owner = await prisma.user.findUniqueOrThrow({ where: { id: after.ownerId! } });
    expect(mailbox(app).outbox.at(-1)).toMatchObject({ to: owner.email });
    expect(mailbox(app).outbox.at(-1)?.subject).toMatch(/New Hot lead: Mia/);
  });

  it('is idempotent: routing a lead twice makes no second run and no second message', async () => {
    const w = await setup();
    const lead = await makeLead(w);
    await route(w, lead.id);
    const first = await runsOf(lead.id);
    await route(w, lead.id);
    expect((await runsOf(lead.id)).map((r) => r.id)).toEqual(first.map((r) => r.id));
  });

  it('round-robin: two leads in a row go to different members of the team', async () => {
    const w = await setup();
    const [a, b] = [await makeLead(w), await makeLead(w)];
    await route(w, a.id);
    await route(w, b.id);
    const owners = (await prisma.lead.findMany({ where: { id: { in: [a.id, b.id] } } })).map(
      (l) => l.ownerId,
    );
    expect(new Set(owners).size).toBe(2);
  });

  it('never takes a lead away from a person who already has it', async () => {
    const w = await setup();
    const lead = await makeLead(w, { ownerId: w.members[0]!.userId });
    await route(w, lead.id);
    // The timeline does not claim an assignment that did not happen.
    expect(await prisma.leadEvent.count({ where: { leadId: lead.id, type: 'assigned' } })).toBe(0);
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).ownerId).toBe(
      w.members[0]!.userId,
    );
  });

  it('finishes a run that was left PENDING (a crash, or Redis down) the next time the lead is routed', async () => {
    const w = await setup();
    const lead = await makeLead(w);
    await route(w, lead.id);
    const tagRun = (await runsOf(lead.id)).find((r) => r.type === 'tag')!;
    await prisma.actionRun.update({ where: { id: tagRun.id }, data: { status: 'PENDING' } });
    await prisma.lead.update({ where: { id: lead.id }, data: { tags: [] } });
    await route(w, lead.id);
    expect((await prisma.actionRun.findUniqueOrThrow({ where: { id: tagRun.id } })).status).toBe(
      'SUCCEEDED',
    );
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).tags).toEqual(['hot']);
  });

  it('waits for a person: a lead in the review queue is not routed until it is approved', async () => {
    const w = await setup();
    const lead = await makeLead(w, { status: 'NEEDS_REVIEW', reviewReason: 'low_confidence' });
    await route(w, lead.id);
    expect(await runsOf(lead.id)).toHaveLength(0);

    await http()
      .post(`/leads/${lead.id}/review`)
      .set(w.auth)
      .send({ action: 'approve' })
      .expect(204);
    expect((await runsOf(lead.id)).length).toBe(4);
  });

  it('the tester says which rule decides and why, and changes nothing', async () => {
    const w = await setup();
    const before = await prisma.actionRun.count({ where: { workspaceId: w.workspaceId } });
    const res = await http()
      .post('/routing/test')
      .set(w.auth)
      .send({ lead: { tier: 'COLD', score: 20 } })
      .expect(200);
    expect(res.body).toMatchObject({ dryRun: true, decidingRuleId: null });
    expect(res.body.verdicts[0].checks[0]).toMatchObject({
      field: 'tier',
      actual: 'COLD',
      passed: false,
    });
    const hot = await http()
      .post('/routing/test')
      .set(w.auth)
      .send({ lead: { tier: 'HOT' } })
      .expect(200);
    expect(hot.body.decidingRuleId).toBe(w.ruleId);
    expect(await prisma.actionRun.count({ where: { workspaceId: w.workspaceId } })).toBe(before);
  });

  it('a failed send is kept, marked dead after the last try, and can be retried from the UI', async () => {
    const w = await setup();
    const lead = await makeLead(w);
    await route(w, lead.id);
    const slackRun = (await runsOf(lead.id)).find((r) => r.type === 'slack')!;

    const transport = app.get(ActionTransport);
    const spy = jest.spyOn(transport, 'post').mockRejectedValue(new ActionError('http_500'));
    await expect(execute(w, slackRun.id, false)).rejects.toThrow('http_500');
    expect(await prisma.actionRun.findUniqueOrThrow({ where: { id: slackRun.id } })).toMatchObject({
      status: 'FAILED',
      attempts: 1,
      lastError: 'http_500',
    });
    await expect(execute(w, slackRun.id, true)).rejects.toThrow('http_500');
    expect(await prisma.actionRun.findUniqueOrThrow({ where: { id: slackRun.id } })).toMatchObject({
      status: 'DEAD',
      attempts: 2,
    });
    expect(await prisma.integration.findUniqueOrThrow({ where: { id: w.slackId } })).toMatchObject({
      status: 'needs_attention',
      lastError: 'http_500',
    });
    spy.mockRestore();

    await http().post(`/actions/${slackRun.id}/retry`).set(w.auth).expect(204);
    expect((await prisma.actionRun.findUniqueOrThrow({ where: { id: slackRun.id } })).status).toBe(
      'PENDING',
    );
    await execute(w, slackRun.id);
    expect((await prisma.actionRun.findUniqueOrThrow({ where: { id: slackRun.id } })).status).toBe(
      'SUCCEEDED',
    );
    expect((await prisma.integration.findUniqueOrThrow({ where: { id: w.slackId } })).status).toBe(
      'connected',
    );
    // A run that did not fail cannot be retried.
    await http().post(`/actions/${slackRun.id}/retry`).set(w.auth).expect(409);
    // A run that succeeded is never sent twice.
    const sent = transport.sent.length;
    await execute(w, slackRun.id);
    expect(transport.sent).toHaveLength(sent);
  });

  it('an action that cannot work (integration switched off) is dead at once, not retried', async () => {
    const w = await setup();
    const lead = await makeLead(w);
    await route(w, lead.id);
    await http()
      .patch(`/integrations/${w.slackId}`)
      .set(w.auth)
      .send({ enabled: false })
      .expect(200);
    const slackRun = (await runsOf(lead.id)).find((r) => r.type === 'slack')!;
    await expect(execute(w, slackRun.id)).rejects.toThrow('integration_disabled');
    expect((await prisma.actionRun.findUniqueOrThrow({ where: { id: slackRun.id } })).status).toBe(
      'DEAD',
    );
  });

  describe('integrations keep their secrets', () => {
    it('stores the token encrypted and never returns it; the webhook secret is shown once', async () => {
      const w = await setup();
      const list = await http().get('/integrations').set(w.auth).expect(200);
      expect(JSON.stringify(list.body)).not.toContain('SECRETSECRET');
      expect(list.body[0]).toMatchObject({ type: 'SLACK', summary: 'hooks.slack.com' });
      const row = await prisma.integration.findUniqueOrThrow({ where: { id: w.slackId } });
      expect(row.configEnc).not.toContain('SECRETSECRET');

      const hook = await http()
        .post('/integrations')
        .set(w.auth)
        .send({
          type: 'WEBHOOK',
          name: 'n8n',
          config: { url: 'https://n8n.example.com/webhook/abc' },
        })
        .expect(201);
      expect(hook.body.signingSecret).toMatch(/^whsec_/);
      const again = await http().get('/integrations').set(w.auth).expect(200);
      expect(JSON.stringify(again.body)).not.toContain(hook.body.signingSecret);
    });

    it('refuses an address that points inside a network, or a "Slack" address that is not Slack', async () => {
      const w = await setup();
      for (const config of [
        { url: 'https://169.254.169.254/latest' },
        { url: 'https://localhost:5432/' },
      ]) {
        const res = await http()
          .post('/integrations')
          .set(w.auth)
          .send({ type: 'WEBHOOK', name: 'x', config });
        // Two layers say no: the request schema (an IP or "localhost" is not a domain name: 400)
        // and the service guard (a name that looks public but is internal: 422, see actions.spec.ts).
        expect([400, 422]).toContain(res.status);
      }
      expect(
        await prisma.integration.count({ where: { workspaceId: w.workspaceId, type: 'WEBHOOK' } }),
      ).toBe(0);
      const notSlack = await http()
        .post('/integrations')
        .set(w.auth)
        .send({
          type: 'SLACK',
          name: 'x',
          config: { webhookUrl: 'https://evil.example.com/services/x' },
        });
      expect([notSlack.status, notSlack.body.error?.code]).toEqual([422, 'URL_NOT_ALLOWED']);
    });

    it('"Send test message" records the result on the integration', async () => {
      const w = await setup();
      const res = await http().post(`/integrations/${w.slackId}/test`).set(w.auth).expect(200);
      expect(res.body).toEqual({ ok: true, error: null });
      expect(
        (await prisma.integration.findUniqueOrThrow({ where: { id: w.slackId } })).lastTestedAt,
      ).not.toBeNull();
    });

    it('cannot be deleted while a rule uses it', async () => {
      const w = await setup();
      const res = await http().delete(`/integrations/${w.slackId}`).set(w.auth);
      expect([res.status, res.body.error.code]).toEqual([409, 'INTEGRATION_IN_USE']);
    });
  });

  describe('a rule can only point at things of its own workspace', () => {
    it("refuses another workspace's integration, team and person", async () => {
      const mine = await setup();
      const theirs = await setup();
      const bad = [
        { type: 'slack', integrationId: theirs.slackId },
        { type: 'assign', to: { kind: 'team', teamId: theirs.team.id } },
        { type: 'assign', to: { kind: 'user', userId: theirs.members[0]!.userId } },
      ];
      for (const action of bad) {
        const res = await http()
          .post('/routing/rules')
          .set(mine.auth)
          .send({
            name: 'Stolen',
            conditions: { match: 'all', conditions: [] },
            actions: [action],
          });
        expect([res.status, res.body.error?.code]).toEqual([422, 'RULE_REFERENCE_INVALID']);
      }
    });

    it('a Slack action cannot use a webhook integration (wrong type)', async () => {
      const w = await setup();
      const hook = await http()
        .post('/integrations')
        .set(w.auth)
        .send({ type: 'WEBHOOK', name: 'n8n', config: { url: 'https://n8n.example.com/x' } })
        .expect(201);
      const res = await http()
        .post('/routing/rules')
        .set(w.auth)
        .send({
          name: 'Mixed up',
          conditions: { match: 'all', conditions: [] },
          actions: [{ type: 'slack', integrationId: hook.body.id }],
        });
      expect(res.status).toBe(422);
    });

    it('reorder needs every rule once, and a Member cannot touch rules', async () => {
      const w = await setup();
      const second = await http()
        .post('/routing/rules')
        .set(w.auth)
        .send({
          name: 'Rest',
          conditions: { match: 'all', conditions: [] },
          actions: [{ type: 'tag', tag: 'rest' }],
        })
        .expect(201);
      const bad = await http()
        .put('/routing/rules/order')
        .set(w.auth)
        .send({ ids: [w.ruleId] });
      expect([bad.status, bad.body.error.code]).toEqual([422, 'RULE_ORDER_INVALID']);
      const ok = await http()
        .put('/routing/rules/order')
        .set(w.auth)
        .send({ ids: [second.body.id, w.ruleId] })
        .expect(200);
      expect(ok.body.map((r: { id: string }) => r.id)).toEqual([second.body.id, w.ruleId]);

      const member = await joinAs(app, w.owner, 'MEMBER', 'viewer');
      await http()
        .get('/routing/rules')
        .set('authorization', `Bearer ${member.accessToken}`)
        .expect(403);
    });
  });
});
