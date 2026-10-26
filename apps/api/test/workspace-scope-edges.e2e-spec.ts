import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { scopeToWorkspace, TenancyViolationError } from '../src/prisma/workspace-scope';

/**
 * Edge cases of the workspace scope against real Postgres: every unique key
 * shape with the added `workspaceId`, transactions, aggregates, relation
 * filters, nested reads through relations and nested writes. The basic
 * read/update/delete cases live in workspace-scope.e2e-spec.ts.
 *
 * A user ("shared") belongs to both workspaces, so global models (User,
 * PromptVersion) would be a bridge from A's rows to B's rows. The scope's
 * walker refuses that bridge; these tests assert it refuses with
 * TenancyViolationError (so the right layer stopped the query) and, for
 * writes, that B's rows are unchanged afterwards.
 */
describe('Workspace scope edge cases (e2e)', () => {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  const run = `scope-edge-${Date.now()}`;
  const farFuture = new Date('2030-01-01T00:00:00.000Z');

  afterAll(async () => {
    await prisma.workspace.deleteMany({ where: { slug: { startsWith: 'scope-edge-' } } });
    await prisma.user.deleteMany({ where: { email: { startsWith: 'scope-edge-' } } });
    await prisma.promptVersion.deleteMany({ where: { name: { startsWith: 'scope-edge-' } } });
    await prisma.$disconnect();
  });

  let promptVersionId: string;
  let sharedUserId: string;

  async function createTenant(suffix: string) {
    const workspace = await prisma.workspace.create({
      data: { name: `Edge ${suffix}`, slug: `${run}-${suffix}` },
    });
    const workspaceId = workspace.id;
    const membership = await prisma.membership.create({
      data: { workspaceId, userId: sharedUserId, role: 'OWNER' },
    });
    const team = await prisma.team.create({ data: { workspaceId, name: 'EMEA' } });
    const teamMember = await prisma.teamMember.create({
      data: { workspaceId, teamId: team.id, membershipId: membership.id },
    });
    const rubric = await prisma.icpRubric.create({
      data: { workspaceId, industries: ['saas'] },
    });
    const source = await prisma.source.create({
      data: {
        workspaceId,
        name: 'Website form',
        type: 'FORM',
        apiKeyPrefix: `lp_${run}_${suffix}`,
        apiKeyHash: 'sha256-placeholder',
      },
    });
    const idempotencyKey = await prisma.idempotencyKey.create({
      data: {
        workspaceId,
        sourceId: source.id,
        key: 'k-1',
        requestHash: 'hash',
        expiresAt: farFuture,
      },
    });
    const lead = await prisma.lead.create({
      data: {
        workspaceId,
        sourceId: source.id,
        email: `lead-${suffix}@example.test`,
        status: 'NEW',
        rawPayload: {},
      },
    });
    const event = await prisma.leadEvent.create({
      data: { workspaceId, leadId: lead.id, type: 'ingested' },
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
    const actionRun = await prisma.actionRun.create({
      data: { workspaceId, leadId: lead.id, type: 'assign', jobKey: `${run}-${suffix}-assign` },
    });
    const invite = await prisma.invite.create({
      data: {
        workspaceId,
        email: `invitee-${suffix}@example.test`,
        tokenHash: `${run}-${suffix}-invite`,
        invitedById: sharedUserId,
        expiresAt: farFuture,
      },
    });
    return {
      workspaceId,
      membership,
      team,
      teamMember,
      rubric,
      source,
      idempotencyKey,
      lead,
      event,
      score,
      actionRun,
      invite,
    };
  }

  type Tenant = Awaited<ReturnType<typeof createTenant>>;
  let a: Tenant;
  let b: Tenant;
  beforeAll(async () => {
    const prompt = await prisma.promptVersion.create({
      data: { name: `${run}-prompt`, version: 1, template: 'Score this lead.' },
    });
    promptVersionId = prompt.id;
    const shared = await prisma.user.create({
      data: { email: `${run}-shared@example.test`, passwordHash: 'argon2-placeholder' },
    });
    sharedUserId = shared.id;
    a = await createTenant('a');
    b = await createTenant('b');
  });

  const scopedA = () => scopeToWorkspace(prisma, a.workspaceId);

  /** Runs a query through A's scope; returns every workspaceId in the result. */
  async function workspacesSeen(query: () => Promise<unknown>): Promise<string[]> {
    const result = await query();
    const seen = new Set<string>();
    const walk = (value: unknown): void => {
      if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === 'object') {
        for (const [key, child] of Object.entries(value)) {
          if (key === 'workspaceId' && typeof child === 'string') seen.add(child);
          else walk(child);
        }
      }
    };
    walk(result);
    return [...seen];
  }

  describe('findUnique with every unique key shape', () => {
    // [name, query(row)]: run for A's row it finds it, for B's row it returns null.
    const cases: Array<[string, (t: Tenant) => Promise<unknown>]> = [
      ['Lead by id', (t) => scopedA().lead.findUnique({ where: { id: t.lead.id } })],
      [
        'Lead by workspaceId_email',
        (t) =>
          scopedA().lead.findUnique({
            where: { workspaceId_email: { workspaceId: t.workspaceId, email: t.lead.email! } },
          }),
      ],
      [
        'Lead by id_workspaceId',
        (t) =>
          scopedA().lead.findUnique({
            where: { id_workspaceId: { id: t.lead.id, workspaceId: t.workspaceId } },
          }),
      ],
      [
        'Membership by workspaceId_userId',
        (t) =>
          scopedA().membership.findUnique({
            where: { workspaceId_userId: { workspaceId: t.workspaceId, userId: sharedUserId } },
          }),
      ],
      [
        'TeamMember by @@id teamId_membershipId',
        (t) =>
          scopedA().teamMember.findUnique({
            where: {
              teamId_membershipId: { teamId: t.team.id, membershipId: t.membership.id },
            },
          }),
      ],
      [
        'Team by workspaceId_name',
        (t) =>
          scopedA().team.findUnique({
            where: { workspaceId_name: { workspaceId: t.workspaceId, name: 'EMEA' } },
          }),
      ],
      ['IcpRubric by id', (t) => scopedA().icpRubric.findUnique({ where: { id: t.rubric.id } })],
      [
        'Source by apiKeyPrefix',
        (t) => scopedA().source.findUnique({ where: { apiKeyPrefix: t.source.apiKeyPrefix } }),
      ],
      [
        'IdempotencyKey by sourceId_key',
        (t) =>
          scopedA().idempotencyKey.findUnique({
            where: { sourceId_key: { sourceId: t.source.id, key: 'k-1' } },
          }),
      ],
      [
        'Score by id_leadId_workspaceId',
        (t) =>
          scopedA().score.findUnique({
            where: {
              id_leadId_workspaceId: {
                id: t.score.id,
                leadId: t.lead.id,
                workspaceId: t.workspaceId,
              },
            },
          }),
      ],
      [
        'ActionRun by jobKey',
        (t) => scopedA().actionRun.findUnique({ where: { jobKey: t.actionRun.jobKey } }),
      ],
      [
        'Invite by tokenHash',
        (t) => scopedA().invite.findUnique({ where: { tokenHash: t.invite.tokenHash } }),
      ],
    ];

    it.each(cases)('%s: finds its own row, not the other workspace row', async (_name, find) => {
      await expect(find(a)).resolves.toMatchObject({ workspaceId: a.workspaceId });
      await expect(find(b)).resolves.toBeNull();
    });

    it('IcpRubric by its unique workspaceId alone', async () => {
      await expect(
        scopedA().icpRubric.findUnique({ where: { workspaceId: a.workspaceId } }),
      ).resolves.toMatchObject({ id: a.rubric.id });
      await expect(
        scopedA().icpRubric.findUnique({ where: { workspaceId: b.workspaceId } }),
      ).rejects.toBeInstanceOf(TenancyViolationError);
    });

    it('keeps batched findUnique calls apart (Prisma groups same-tick findUnique)', async () => {
      const [own, other] = await Promise.all([
        scopedA().lead.findUnique({ where: { id: a.lead.id } }),
        scopedA().lead.findUnique({ where: { id: b.lead.id } }),
      ]);
      expect(own?.id).toBe(a.lead.id);
      expect(other).toBeNull();
    });
  });

  describe('where filters', () => {
    it('refuses an operator on workspaceId that could widen the scope', async () => {
      await expect(
        scopedA().lead.findMany({ where: { workspaceId: { in: [a.workspaceId, b.workspaceId] } } }),
      ).rejects.toBeInstanceOf(TenancyViolationError);
    });

    it('OR / NOT branches cannot escape the top-level workspaceId', async () => {
      const leads = await scopedA().lead.findMany({
        where: { OR: [{ workspaceId: b.workspaceId }, { id: b.lead.id }] },
      });
      expect(leads).toEqual([]);
      const notA = await scopedA().lead.findMany({ where: { NOT: { id: a.lead.id } } });
      expect(notA.every((lead) => lead.workspaceId === a.workspaceId)).toBe(true);
    });

    it('a relation filter naming the other workspace matches nothing', async () => {
      await expect(
        scopedA().lead.findMany({ where: { source: { workspaceId: b.workspaceId } } }),
      ).resolves.toEqual([]);
      await expect(
        scopedA().lead.findMany({ where: { source: { id: b.source.id } } }),
      ).resolves.toEqual([]);
      await expect(
        scopedA().source.findMany({ where: { leads: { some: { id: b.lead.id } } } }),
      ).resolves.toEqual([]);
    });
  });

  describe('nested reads from a tenant row', () => {
    it('include with a nested where cannot reach the other workspace', async () => {
      const seen = await workspacesSeen(() =>
        scopedA().source.findMany({
          include: { leads: { where: { workspaceId: b.workspaceId }, include: { events: true } } },
        }),
      );
      expect(seen).toEqual([a.workspaceId]);
    });

    it('lead -> workspace -> leads stays in the workspace', async () => {
      const seen = await workspacesSeen(() =>
        scopedA().lead.findMany({
          include: { workspace: { include: { leads: true, sources: true, memberships: true } } },
        }),
      );
      expect(seen).toEqual([a.workspaceId]);
    });

    it('_count of a tenant relation counts only own rows', async () => {
      const source = await scopedA().source.findFirstOrThrow({
        select: { _count: { select: { leads: true } } },
      });
      expect(source._count.leads).toBe(
        await prisma.lead.count({ where: { sourceId: a.source.id } }),
      );
    });
  });

  // Global models (User, PromptVersion) have back-relations to tenant tables,
  // so a path through a global row would reach every workspace. The walker
  // lets a path enter a global model but never leave it towards tenant data.
  describe('nested reads through a global model', () => {
    const refused = (query: () => Promise<unknown>) =>
      expect(query()).rejects.toBeInstanceOf(TenancyViolationError);

    it('membership -> user -> memberships is refused', async () => {
      await refused(() =>
        scopedA().membership.findMany({ include: { user: { include: { memberships: true } } } }),
      );
    });

    it('invite -> invitedBy -> memberships -> workspace -> leads is refused', async () => {
      await refused(() =>
        scopedA().invite.findMany({
          include: {
            invitedBy: {
              include: { memberships: { include: { workspace: { include: { leads: true } } } } },
            },
          },
        }),
      );
    });

    it('score -> promptVersion -> scores is refused', async () => {
      await refused(() =>
        scopedA().score.findMany({ include: { promptVersion: { include: { scores: true } } } }),
      );
    });

    it('a global model cannot be the root of a scoped query', async () => {
      await refused(() =>
        scopedA().user.findMany({
          where: { id: sharedUserId },
          include: { memberships: true, invitesSent: true },
        }),
      );
    });

    it('a relation filter through a global model cannot probe the other workspace', async () => {
      // "Which of my members also belong to workspace B?" must not be answerable.
      await refused(() =>
        scopedA().membership.findMany({
          where: { user: { memberships: { some: { workspaceId: b.workspaceId } } } },
        }),
      );
    });

    it('reading scalars of a global model from a tenant row is allowed', async () => {
      const rows = await scopedA().membership.findMany({
        include: { user: { select: { email: true } } },
      });
      expect(rows.map((row) => row.workspaceId)).toEqual([a.workspaceId]);
      expect(rows[0]?.user.email).toBe(`${run}-shared@example.test`);
    });
  });

  describe('pagination', () => {
    it('a cursor naming the other workspace row returns nothing', async () => {
      await expect(
        scopedA().lead.findMany({ cursor: { id: b.lead.id }, take: 10 }),
      ).resolves.toEqual([]);
      const nested = await scopedA().lead.findUniqueOrThrow({
        where: { id: a.lead.id },
        select: { events: { cursor: { id: b.event.id }, take: 10 } },
      });
      expect(nested.events).toEqual([]);
    });
  });

  describe('transactions', () => {
    it('keeps the scope in the array form', async () => {
      const [leads, count, other] = await scopedA().$transaction([
        scopedA().lead.findMany(),
        scopedA().lead.count(),
        scopedA().lead.findUnique({ where: { id: b.lead.id } }),
      ]);
      expect(new Set(leads.map((lead) => lead.workspaceId))).toEqual(new Set([a.workspaceId]));
      expect(count).toBe(leads.length);
      expect(other).toBeNull();
    });

    it('cannot write the other workspace inside an interactive transaction', async () => {
      await expect(
        scopedA().$transaction(async (tx) => {
          await tx.lead.update({ where: { id: b.lead.id }, data: { firstName: 'Mallory' } });
        }),
      ).rejects.toMatchObject({ code: 'P2025' });
      const untouched = await prisma.lead.findUniqueOrThrow({ where: { id: b.lead.id } });
      expect(untouched.firstName).toBeNull();
    });
  });

  describe('aggregate and groupBy', () => {
    it('aggregate counts only own rows', async () => {
      const own = await prisma.lead.count({ where: { workspaceId: a.workspaceId } });
      const result = await scopedA().lead.aggregate({
        _count: { _all: true },
        _max: { score: true },
      });
      expect(result._count._all).toBe(own);
    });

    it('groupBy returns only own groups', async () => {
      const byWorkspace = await scopedA().lead.groupBy({ by: ['workspaceId'], _count: true });
      expect(byWorkspace.map((group) => group.workspaceId)).toEqual([a.workspaceId]);
      const byStatus = await scopedA().lead.groupBy({ by: ['status'], _count: { _all: true } });
      const total = byStatus.reduce((sum, group) => sum + group._count._all, 0);
      expect(total).toBe(await prisma.lead.count({ where: { workspaceId: a.workspaceId } }));
    });
  });

  describe('nested writes', () => {
    it('nested create inherits the parent workspace', async () => {
      const lead = await scopedA().lead.update({
        where: { id: a.lead.id },
        data: {
          events: {
            create: { type: 'note' },
            createMany: { data: [{ type: 'merged' }, { type: 'enriched' }] },
          },
        },
        include: { events: true },
      });
      expect(lead.events.every((event) => event.workspaceId === a.workspaceId)).toBe(true);
    });

    it('nested create under the other workspace row is not found', async () => {
      await expect(
        scopedA().lead.update({
          where: { id: b.lead.id },
          data: { events: { create: { type: 'note' } } },
        }),
      ).rejects.toMatchObject({ code: 'P2025' });
      expect(await prisma.leadEvent.count({ where: { leadId: b.lead.id, type: 'note' } })).toBe(0);
    });

    it('nested updateMany / deleteMany only touch own children', async () => {
      await scopedA().lead.update({
        where: { id: a.lead.id },
        data: { events: { updateMany: { where: {}, data: { type: 'touched' } } } },
      });
      const bEvent = await prisma.leadEvent.findUniqueOrThrow({ where: { id: b.event.id } });
      expect(bEvent.type).toBe('ingested');
    });

    // The cases below try to pull a row of workspace B into A with `connect`.
    // Each must fail, and B's row must stay in B.
    it('to-many connect cannot pull another workspace child into the row', async () => {
      const bEvent = await prisma.leadEvent.create({
        data: { workspaceId: b.workspaceId, leadId: b.lead.id, type: 'victim' },
      });
      await expect(
        scopedA().lead.update({
          where: { id: a.lead.id },
          data: { events: { connect: { id: bEvent.id } } },
        }),
      ).rejects.toBeInstanceOf(TenancyViolationError);
      const after = await prisma.leadEvent.findUniqueOrThrow({ where: { id: bEvent.id } });
      expect(after).toMatchObject({ workspaceId: b.workspaceId, leadId: b.lead.id });
    });

    it('to-one connect cannot move the row into another workspace', async () => {
      // A fresh lead with no children, so no onUpdate Restrict FK can stop the move.
      const lead = await prisma.lead.create({
        data: { workspaceId: a.workspaceId, sourceId: a.source.id, rawPayload: {} },
      });
      await expect(
        scopedA().lead.update({
          where: { id: lead.id },
          data: { source: { connect: { id: b.source.id } } },
        }),
      ).rejects.toBeInstanceOf(TenancyViolationError);
      const after = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
      expect(after.workspaceId).toBe(a.workspaceId);
    });

    it('Workspace.update with connect cannot pull a row of another workspace', async () => {
      const bInvite = await prisma.invite.create({
        data: {
          workspaceId: b.workspaceId,
          email: 'victim@example.test',
          tokenHash: `${run}-victim-invite`,
          expiresAt: farFuture,
        },
      });
      await expect(
        scopedA().workspace.update({
          where: { id: a.workspaceId },
          data: { invites: { connect: { id: bInvite.id } } },
        }),
      ).rejects.toBeInstanceOf(TenancyViolationError);
      const after = await prisma.invite.findUniqueOrThrow({ where: { id: bInvite.id } });
      expect(after.workspaceId).toBe(b.workspaceId);
    });

    it('a nested workspaceId cannot move a related row to another workspace', async () => {
      await expect(
        scopedA().lead.update({
          where: { id: a.lead.id },
          data: { source: { update: { workspaceId: b.workspaceId } } },
        }),
      ).rejects.toBeInstanceOf(TenancyViolationError);
      const source = await prisma.source.findUniqueOrThrow({ where: { id: a.source.id } });
      expect(source.workspaceId).toBe(a.workspaceId);
    });

    it('a nested write cannot create or change a Workspace row', async () => {
      await expect(
        scopedA().lead.update({
          where: { id: a.lead.id },
          data: {
            source: {
              update: { workspace: { create: { name: 'Rogue', slug: `${run}-rogue` } } },
            },
          },
        }),
      ).rejects.toBeInstanceOf(TenancyViolationError);
      expect(await prisma.workspace.count({ where: { slug: `${run}-rogue` } })).toBe(0);
    });

    it('nested deleteMany through a global model does not touch the other workspace', async () => {
      await expect(
        scopedA().promptVersion.update({
          where: { id: promptVersionId },
          data: { scores: { deleteMany: { leadId: b.lead.id } } },
        }),
      ).rejects.toBeInstanceOf(TenancyViolationError);
      await expect(prisma.score.findUnique({ where: { id: b.score.id } })).resolves.not.toBeNull();
    });
  });

  describe('upsert on a globally unique key held by the other workspace', () => {
    // Prisma turns this upsert into INSERT ... ON CONFLICT ("jobKey") DO UPDATE
    // ... WHERE workspaceId = A. On B's row the conflict fires, the WHERE
    // skips the update, and RETURNING yields no row: Prisma resolves `null`
    // although the return type says ActionRun. It must reject instead.
    it('does not update the other row and does not resolve to null', async () => {
      await expect(
        scopedA().actionRun.upsert({
          where: { jobKey: b.actionRun.jobKey },
          create: {
            workspaceId: a.workspaceId,
            leadId: a.lead.id,
            type: 'assign',
            jobKey: b.actionRun.jobKey,
          },
          update: { attempts: { increment: 1 } },
        }),
      ).rejects.toBeInstanceOf(TenancyViolationError);
      const other = await prisma.actionRun.findUniqueOrThrow({ where: { id: b.actionRun.id } });
      expect(other.attempts).toBe(0);
    });
  });
});
