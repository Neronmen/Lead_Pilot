import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { scopeToWorkspace, TenancyViolationError } from '../src/prisma/workspace-scope';

/**
 * The workspace scope against real Postgres: the unit tests prove how the
 * arguments are rewritten, these prove Prisma accepts the rewritten queries
 * and that workspace A can neither read nor change workspace B's rows.
 */
describe('Workspace scope (e2e)', () => {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  const run = `scope-test-${Date.now()}`;

  afterAll(async () => {
    await prisma.workspace.deleteMany({ where: { slug: { startsWith: 'scope-test-' } } });
    await prisma.$disconnect();
  });

  async function createTenant(suffix: string) {
    const workspace = await prisma.workspace.create({
      data: { name: `Scope ${suffix}`, slug: `${run}-${suffix}` },
    });
    const source = await prisma.source.create({
      data: {
        workspaceId: workspace.id,
        name: 'Website form',
        type: 'FORM',
        apiKeyPrefix: `lp_${run}_${suffix}`,
        apiKeyHash: 'sha256-placeholder',
      },
    });
    const lead = await prisma.lead.create({
      data: {
        workspaceId: workspace.id,
        sourceId: source.id,
        email: `lead-${suffix}@example.test`,
        rawPayload: {},
      },
    });
    return { workspaceId: workspace.id, source, lead };
  }

  type Tenant = Awaited<ReturnType<typeof createTenant>>;
  let a: Tenant;
  let b: Tenant;
  beforeAll(async () => {
    a = await createTenant('a');
    b = await createTenant('b');
  });

  const scopedA = () => scopeToWorkspace(prisma, a.workspaceId);

  it('reads only its own rows', async () => {
    const leads = await scopedA().lead.findMany();
    expect(leads.map((lead) => lead.id)).toEqual([a.lead.id]);
    expect(await scopedA().lead.count()).toBe(1);
  });

  it('cannot find another workspace row by id', async () => {
    await expect(scopedA().lead.findUnique({ where: { id: b.lead.id } })).resolves.toBeNull();
    await expect(scopedA().lead.findFirst({ where: { email: b.lead.email } })).resolves.toBeNull();
    await expect(
      scopedA().lead.findUniqueOrThrow({ where: { id: b.lead.id } }),
    ).rejects.toMatchObject({ code: 'P2025' });
  });

  it('cannot update or delete another workspace row', async () => {
    await expect(
      scopedA().lead.update({ where: { id: b.lead.id }, data: { firstName: 'Mallory' } }),
    ).rejects.toMatchObject({ code: 'P2025' });
    await expect(scopedA().lead.delete({ where: { id: b.lead.id } })).rejects.toMatchObject({
      code: 'P2025',
    });
    const { count } = await scopedA().lead.updateMany({ data: { firstName: 'Ada' } });
    expect(count).toBe(1);

    const untouched = await prisma.lead.findUniqueOrThrow({ where: { id: b.lead.id } });
    expect(untouched.firstName).toBeNull();
  });

  it('creates in its own workspace and finds the row again', async () => {
    const event = await scopedA().leadEvent.create({
      data: { workspaceId: a.workspaceId, leadId: a.lead.id, type: 'ingested' },
    });
    expect(event.workspaceId).toBe(a.workspaceId);
    await expect(
      scopedA().leadEvent.create({
        data: { workspaceId: b.workspaceId, leadId: b.lead.id, type: 'ingested' },
      }),
    ).rejects.toBeInstanceOf(TenancyViolationError);
    await expect(
      scopedA().leadEvent.findUnique({ where: { id: event.id } }),
    ).resolves.toMatchObject({ id: event.id });
  });

  it('upserts through a compound unique key inside the workspace', async () => {
    const where = {
      workspaceId_email: { workspaceId: a.workspaceId, email: 'upsert@example.test' },
    };
    const created = await scopedA().lead.upsert({
      where,
      create: {
        workspaceId: a.workspaceId,
        sourceId: a.source.id,
        email: 'upsert@example.test',
        rawPayload: {},
      },
      update: { firstName: 'First' },
    });
    const updated = await scopedA().lead.upsert({
      where,
      create: {
        workspaceId: a.workspaceId,
        sourceId: a.source.id,
        email: 'upsert@example.test',
        rawPayload: {},
      },
      update: { firstName: 'Second' },
    });
    expect(updated).toMatchObject({
      id: created.id,
      firstName: 'Second',
      workspaceId: a.workspaceId,
    });
  });

  it('keeps the scope inside an interactive transaction', async () => {
    const ids = await scopedA().$transaction(async (tx) => {
      const leads = await tx.lead.findMany({ where: { email: { endsWith: '@example.test' } } });
      return leads.map((lead) => lead.workspaceId);
    });
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids)).toEqual(new Set([a.workspaceId]));
  });

  it('limits Workspace queries to its own row', async () => {
    await expect(scopedA().workspace.findFirst()).resolves.toMatchObject({ id: a.workspaceId });
    await expect(
      scopedA().workspace.findUnique({ where: { id: b.workspaceId } }),
    ).rejects.toBeInstanceOf(TenancyViolationError);
  });

  it('includes only children of the scoped row', async () => {
    const lead = await scopedA().lead.findUniqueOrThrow({
      where: { id: a.lead.id },
      include: { source: true, events: true },
    });
    expect(lead.source.workspaceId).toBe(a.workspaceId);
    expect(lead.events.every((event) => event.workspaceId === a.workspaceId)).toBe(true);
  });
});
