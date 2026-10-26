import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';

/**
 * Database-level tenancy guards (migration m1_auth_tenancy). The scoping
 * helper only filters the table being queried; these composite foreign keys
 * make Postgres itself reject a row in workspace A that points at a parent in
 * workspace B. Each case below tries exactly that and expects P2003.
 */
describe('Tenancy constraints (e2e)', () => {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  const run = `tenancy-test-${Date.now()}`;
  const farFuture = new Date('2030-01-01T00:00:00.000Z');

  afterAll(async () => {
    await prisma.workspace.deleteMany({ where: { slug: { startsWith: 'tenancy-test-' } } });
    await prisma.user.deleteMany({ where: { email: { startsWith: 'tenancy-test-' } } });
    await prisma.promptVersion.deleteMany({ where: { name: { startsWith: 'tenancy-test-' } } });
    await prisma.$disconnect();
  });

  let promptVersionId: string;
  beforeAll(async () => {
    const prompt = await prisma.promptVersion.create({
      data: { name: `${run}-prompt`, version: 1, template: 'Score this lead.' },
    });
    promptVersionId = prompt.id;
  });

  /** One workspace with one row of every parent a tenant child can point at. */
  async function createTenant(suffix: string) {
    const workspace = await prisma.workspace.create({
      data: { name: `Tenant ${suffix}`, slug: `${run}-${suffix}` },
    });
    const workspaceId = workspace.id;
    const user = await prisma.user.create({
      data: { email: `${run}-${suffix}@example.test`, passwordHash: 'argon2-placeholder' },
    });
    const membership = await prisma.membership.create({
      data: { workspaceId, userId: user.id, role: 'OWNER' },
    });
    const team = await prisma.team.create({ data: { workspaceId, name: 'EMEA' } });
    const source = await prisma.source.create({
      data: {
        workspaceId,
        name: 'Website form',
        type: 'FORM',
        apiKeyPrefix: `lp_${run}_${suffix}`,
        apiKeyHash: 'sha256-placeholder',
      },
    });
    const lead = await prisma.lead.create({
      data: { workspaceId, sourceId: source.id, rawPayload: {} },
    });
    const score = await prisma.score.create({
      data: {
        workspaceId,
        leadId: lead.id,
        promptVersionId,
        provider: 'mock',
        model: 'mock-1',
        output: {},
        score: 80,
        tier: 'HOT',
        confidence: 0.9,
        isSpam: false,
        latencyMs: 12,
      },
    });
    const rule = await prisma.routingRule.create({
      data: { workspaceId, name: 'Hot leads', order: 1, conditions: {}, actions: {} },
    });
    const integration = await prisma.integration.create({
      data: { workspaceId, type: 'SLACK', name: 'Slack', configEnc: 'encrypted-placeholder' },
    });
    return { workspaceId, user, membership, team, source, lead, score, rule, integration };
  }

  type Tenant = Awaited<ReturnType<typeof createTenant>>;
  let a: Tenant;
  let b: Tenant;
  beforeAll(async () => {
    a = await createTenant('a');
    b = await createTenant('b');
  });

  /** Each case writes a row in workspace A whose reference points into B. */
  const crossWorkspaceWrites: Array<[string, () => Promise<unknown>]> = [
    [
      'TeamMember -> Team',
      () =>
        prisma.teamMember.create({
          data: { workspaceId: a.workspaceId, teamId: b.team.id, membershipId: a.membership.id },
        }),
    ],
    [
      'TeamMember -> Membership',
      () =>
        prisma.teamMember.create({
          data: { workspaceId: a.workspaceId, teamId: a.team.id, membershipId: b.membership.id },
        }),
    ],
    [
      'Lead -> Source',
      () =>
        prisma.lead.create({
          data: { workspaceId: a.workspaceId, sourceId: b.source.id, rawPayload: {} },
        }),
    ],
    [
      'Lead -> owner (Membership)',
      () => prisma.lead.update({ where: { id: a.lead.id }, data: { ownerId: b.user.id } }),
    ],
    [
      'IdempotencyKey -> Source',
      () =>
        prisma.idempotencyKey.create({
          data: {
            workspaceId: a.workspaceId,
            sourceId: b.source.id,
            key: 'k-1',
            requestHash: 'hash',
            expiresAt: farFuture,
          },
        }),
    ],
    [
      'LeadEvent -> Lead',
      () =>
        prisma.leadEvent.create({
          data: { workspaceId: a.workspaceId, leadId: b.lead.id, type: 'ingested' },
        }),
    ],
    [
      'Score -> Lead',
      () =>
        prisma.score.create({
          data: {
            workspaceId: a.workspaceId,
            leadId: b.lead.id,
            promptVersionId,
            provider: 'mock',
            model: 'mock-1',
            output: {},
            score: 10,
            tier: 'COLD',
            confidence: 0.5,
            isSpam: false,
            latencyMs: 5,
          },
        }),
    ],
    [
      'Feedback -> Lead',
      () =>
        prisma.feedback.create({
          data: {
            workspaceId: a.workspaceId,
            leadId: b.lead.id,
            userId: a.user.id,
            newTier: 'WARM',
          },
        }),
    ],
    [
      'Feedback -> Score',
      () =>
        prisma.feedback.create({
          data: {
            workspaceId: a.workspaceId,
            leadId: a.lead.id,
            scoreId: b.score.id,
            userId: a.user.id,
            newTier: 'WARM',
          },
        }),
    ],
    [
      'ActionRun -> Lead',
      () =>
        prisma.actionRun.create({
          data: {
            workspaceId: a.workspaceId,
            leadId: b.lead.id,
            type: 'assign',
            jobKey: `${run}-1`,
          },
        }),
    ],
    [
      'ActionRun -> RoutingRule',
      () =>
        prisma.actionRun.create({
          data: {
            workspaceId: a.workspaceId,
            leadId: a.lead.id,
            ruleId: b.rule.id,
            type: 'assign',
            jobKey: `${run}-2`,
          },
        }),
    ],
    [
      'ActionRun -> Integration',
      () =>
        prisma.actionRun.create({
          data: {
            workspaceId: a.workspaceId,
            leadId: a.lead.id,
            integrationId: b.integration.id,
            type: 'slack',
            jobKey: `${run}-3`,
          },
        }),
    ],
    [
      'RefreshToken -> Membership',
      () =>
        prisma.refreshToken.create({
          data: {
            workspaceId: a.workspaceId,
            userId: b.user.id,
            tokenHash: `${run}-token`,
            familyId: a.workspaceId,
            expiresAt: farFuture,
          },
        }),
    ],
  ];

  it.each(crossWorkspaceWrites)('rejects a cross-workspace reference: %s', async (_name, write) => {
    await expect(write()).rejects.toMatchObject({ code: 'P2003' });
  });

  it('accepts the same references inside one workspace', async () => {
    const { workspaceId } = a;
    await prisma.teamMember.create({
      data: { workspaceId, teamId: a.team.id, membershipId: a.membership.id },
    });
    await prisma.lead.update({ where: { id: a.lead.id }, data: { ownerId: a.user.id } });
    await prisma.feedback.create({
      data: {
        workspaceId,
        leadId: a.lead.id,
        scoreId: a.score.id,
        userId: a.user.id,
        newTier: 'HOT',
      },
    });
    await prisma.actionRun.create({
      data: {
        workspaceId,
        leadId: a.lead.id,
        ruleId: a.rule.id,
        integrationId: a.integration.id,
        type: 'slack',
        jobKey: `${run}-ok`,
      },
    });
    await expect(
      prisma.refreshToken.create({
        data: {
          workspaceId,
          userId: a.user.id,
          tokenHash: `${run}-token-ok`,
          familyId: workspaceId,
          expiresAt: farFuture,
        },
      }),
    ).resolves.toBeDefined();
  });

  describe('optional references use NoAction, so the service clears them first', () => {
    it('a membership that still owns leads cannot be deleted', async () => {
      const t = await createTenant('owner-noaction');
      await prisma.lead.update({ where: { id: t.lead.id }, data: { ownerId: t.user.id } });

      await expect(
        prisma.membership.delete({ where: { id: t.membership.id } }),
      ).rejects.toMatchObject({ code: 'P2003' });

      // What the members service does: unassign, then remove.
      await prisma.lead.updateMany({
        where: { workspaceId: t.workspaceId, ownerId: t.user.id },
        data: { ownerId: null },
      });
      await prisma.membership.delete({ where: { id: t.membership.id } });
      const lead = await prisma.lead.findUniqueOrThrow({ where: { id: t.lead.id } });
      expect(lead).toMatchObject({ ownerId: null, workspaceId: t.workspaceId });
    });

    it('a score that has feedback cannot be deleted until the feedback is detached', async () => {
      const t = await createTenant('score-noaction');
      const feedback = await prisma.feedback.create({
        data: {
          workspaceId: t.workspaceId,
          leadId: t.lead.id,
          scoreId: t.score.id,
          userId: t.user.id,
          newTier: 'WARM',
        },
      });

      await expect(prisma.score.delete({ where: { id: t.score.id } })).rejects.toMatchObject({
        code: 'P2003',
      });

      await prisma.feedback.update({ where: { id: feedback.id }, data: { scoreId: null } });
      await prisma.score.delete({ where: { id: t.score.id } });
      await expect(
        prisma.feedback.findUniqueOrThrow({ where: { id: feedback.id } }),
      ).resolves.toMatchObject({ scoreId: null, workspaceId: t.workspaceId });
    });

    it('a routing rule or integration with action runs cannot be deleted until detached', async () => {
      const t = await createTenant('action-noaction');
      const actionRun = await prisma.actionRun.create({
        data: {
          workspaceId: t.workspaceId,
          leadId: t.lead.id,
          ruleId: t.rule.id,
          integrationId: t.integration.id,
          type: 'slack',
          jobKey: `${run}-action-noaction`,
        },
      });

      await expect(prisma.routingRule.delete({ where: { id: t.rule.id } })).rejects.toMatchObject({
        code: 'P2003',
      });
      await expect(
        prisma.integration.delete({ where: { id: t.integration.id } }),
      ).rejects.toMatchObject({ code: 'P2003' });

      await prisma.actionRun.update({
        where: { id: actionRun.id },
        data: { ruleId: null, integrationId: null },
      });
      await prisma.routingRule.delete({ where: { id: t.rule.id } });
      await prisma.integration.delete({ where: { id: t.integration.id } });
      await expect(
        prisma.actionRun.findUniqueOrThrow({ where: { id: actionRun.id } }),
      ).resolves.toMatchObject({ ruleId: null, integrationId: null, workspaceId: t.workspaceId });
    });

    it('removing a membership deletes its sessions (RefreshToken cascade)', async () => {
      const t = await createTenant('session-cascade');
      await prisma.refreshToken.create({
        data: {
          workspaceId: t.workspaceId,
          userId: t.user.id,
          tokenHash: `${run}-session-cascade`,
          familyId: t.workspaceId,
          expiresAt: farFuture,
        },
      });

      await prisma.membership.delete({ where: { id: t.membership.id } });
      expect(await prisma.refreshToken.count({ where: { userId: t.user.id } })).toBe(0);
    });

    it('deleting a workspace still cascades through every NoAction reference', async () => {
      const t = await createTenant('cascade');
      const { workspaceId } = t;
      await prisma.lead.update({ where: { id: t.lead.id }, data: { ownerId: t.user.id } });
      await prisma.feedback.create({
        data: {
          workspaceId,
          leadId: t.lead.id,
          scoreId: t.score.id,
          userId: t.user.id,
          newTier: 'HOT',
        },
      });
      await prisma.actionRun.create({
        data: {
          workspaceId,
          leadId: t.lead.id,
          ruleId: t.rule.id,
          integrationId: t.integration.id,
          type: 'slack',
          jobKey: `${run}-cascade`,
        },
      });

      await prisma.workspace.delete({ where: { id: workspaceId } });

      expect(await prisma.lead.count({ where: { workspaceId } })).toBe(0);
      expect(await prisma.membership.count({ where: { workspaceId } })).toBe(0);
      expect(await prisma.actionRun.count({ where: { workspaceId } })).toBe(0);
    });
  });

  it('a lead cannot be moved to another workspace while it points at its old source', async () => {
    const t = await createTenant('move-lead');
    // Changing only workspaceId leaves (sourceId, workspaceId) pointing at a
    // source that does not exist in the target workspace.
    await expect(
      prisma.lead.update({ where: { id: t.lead.id }, data: { workspaceId: b.workspaceId } }),
    ).rejects.toMatchObject({ code: 'P2003' });
    expect(await prisma.lead.findUniqueOrThrow({ where: { id: t.lead.id } })).toMatchObject({
      workspaceId: t.workspaceId,
    });
  });

  it('a parent cannot move to another workspace under its children (onUpdate Restrict)', async () => {
    const t = await createTenant('move-parent');
    // A non-owner, so the move cannot trip B's one-owner index first.
    const rep = await prisma.user.create({
      data: { email: `${run}-move-parent-rep@example.test`, passwordHash: 'argon2-placeholder' },
    });
    const repMembership = await prisma.membership.create({
      data: { workspaceId: t.workspaceId, userId: rep.id },
    });
    await prisma.refreshToken.create({
      data: {
        workspaceId: t.workspaceId,
        userId: rep.id,
        tokenHash: `${run}-move-parent`,
        familyId: t.workspaceId,
        expiresAt: farFuture,
      },
    });

    // With ON UPDATE CASCADE the session would silently follow into B.
    await expect(
      prisma.membership.update({
        where: { id: repMembership.id },
        data: { workspaceId: b.workspaceId },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
    await expect(
      prisma.source.update({ where: { id: t.source.id }, data: { workspaceId: b.workspaceId } }),
    ).rejects.toMatchObject({ code: 'P2003' });
  });

  it('feedback can only point at a score of the same lead', async () => {
    const t = await createTenant('feedback-other-lead');
    const otherLead = await prisma.lead.create({
      data: { workspaceId: t.workspaceId, sourceId: t.source.id, rawPayload: {} },
    });
    await expect(
      prisma.feedback.create({
        data: {
          workspaceId: t.workspaceId,
          leadId: otherLead.id,
          scoreId: t.score.id,
          userId: t.user.id,
          newTier: 'COLD',
        },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
  });

  it('deleting the inviting user keeps the invite and clears invitedById', async () => {
    const t = await createTenant('inviter-setnull');
    const inviter = await prisma.user.create({
      data: { email: `${run}-inviter@example.test`, passwordHash: 'argon2-placeholder' },
    });
    const invite = await prisma.invite.create({
      data: {
        workspaceId: t.workspaceId,
        email: `${run}-invitee-setnull@example.test`,
        tokenHash: `${run}-invite-setnull`,
        invitedById: inviter.id,
        expiresAt: farFuture,
      },
    });

    await prisma.user.delete({ where: { id: inviter.id } });
    await expect(
      prisma.invite.findUniqueOrThrow({ where: { id: invite.id } }),
    ).resolves.toMatchObject({ invitedById: null, workspaceId: t.workspaceId });
  });

  describe('hand-written guards', () => {
    it('ownership transfer must demote the old owner before promoting the new one', async () => {
      const t = await createTenant('transfer');
      const next = await prisma.user.create({
        data: { email: `${run}-next-owner@example.test`, passwordHash: 'argon2-placeholder' },
      });
      const nextMembership = await prisma.membership.create({
        data: { workspaceId: t.workspaceId, userId: next.id, role: 'ADMIN' },
      });

      // Promoting first collides with the partial unique index.
      await expect(
        prisma.membership.update({ where: { id: nextMembership.id }, data: { role: 'OWNER' } }),
      ).rejects.toMatchObject({ code: 'P2002' });

      await prisma.$transaction([
        prisma.membership.update({ where: { id: t.membership.id }, data: { role: 'ADMIN' } }),
        prisma.membership.update({ where: { id: nextMembership.id }, data: { role: 'OWNER' } }),
      ]);
      const owners = await prisma.membership.findMany({
        where: { workspaceId: t.workspaceId, role: 'OWNER' },
      });
      expect(owners.map((m) => m.userId)).toEqual([next.id]);
    });

    it('allows only one OWNER per workspace', async () => {
      const t = await createTenant('one-owner');
      const second = await prisma.user.create({
        data: { email: `${run}-second-owner@example.test`, passwordHash: 'argon2-placeholder' },
      });
      await expect(
        prisma.membership.create({
          data: { workspaceId: t.workspaceId, userId: second.id, role: 'OWNER' },
        }),
      ).rejects.toMatchObject({ code: 'P2002' });
      await expect(
        prisma.membership.create({
          data: { workspaceId: t.workspaceId, userId: second.id, role: 'ADMIN' },
        }),
      ).resolves.toBeDefined();
    });

    it('allows one pending invite per address, and a new one once accepted', async () => {
      const invite = (n: number) =>
        prisma.invite.create({
          data: {
            workspaceId: a.workspaceId,
            email: `${run}-invitee@example.test`,
            tokenHash: `${run}-invite-${n}`,
            invitedById: a.user.id,
            expiresAt: farFuture,
          },
        });

      const first = await invite(1);
      await expect(invite(2)).rejects.toMatchObject({ code: 'P2002' });
      await prisma.invite.update({ where: { id: first.id }, data: { acceptedAt: new Date() } });
      await expect(invite(3)).resolves.toBeDefined();
      // The same address can be invited to another workspace at the same time.
      await expect(
        prisma.invite.create({
          data: {
            workspaceId: b.workspaceId,
            email: `${run}-invitee@example.test`,
            tokenHash: `${run}-invite-b`,
            expiresAt: farFuture,
          },
        }),
      ).resolves.toMatchObject({ invitedById: null });
    });

    it('rejects user and invite emails that are not lowercased', async () => {
      await expect(
        prisma.user.create({
          data: { email: `${run}-Mixed@Example.test`, passwordHash: 'argon2-placeholder' },
        }),
      ).rejects.toThrow(/User_email_lowercase_check/);
      await expect(
        prisma.invite.create({
          data: {
            workspaceId: a.workspaceId,
            email: `${run}-Mixed@Example.test`,
            tokenHash: `${run}-invite-mixed`,
            expiresAt: farFuture,
          },
        }),
      ).rejects.toThrow(/Invite_email_lowercase_check/);
    });

    it('rejects a negative AI cost limit and applies the workspace defaults', async () => {
      const ws = await prisma.workspace.findUniqueOrThrow({ where: { id: a.workspaceId } });
      expect(ws).toMatchObject({
        defaultLocale: 'en',
        currency: 'USD',
        timezone: 'UTC',
        aiMonthlyLimitUsd: null,
      });
      await expect(
        prisma.workspace.update({ where: { id: a.workspaceId }, data: { aiMonthlyLimitUsd: -1 } }),
      ).rejects.toThrow(/Workspace_aiMonthlyLimitUsd_check/);
    });
  });
});
