import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '../src/generated/prisma/client';

/**
 * Smoke tests for schema v1 against the real test database: the migration
 * applied, defaults work, and the constraints we rely on for correctness
 * (dedup guard, cascades) are enforced by Postgres itself.
 */
describe('Prisma schema v1 (e2e)', () => {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  // Unique per run, so parallel or repeated runs never collide.
  const slug = `schema-test-${Date.now()}`;

  afterAll(async () => {
    await prisma.workspace.deleteMany({ where: { slug: { startsWith: 'schema-test-' } } });
    // Users are global (not tenant data), so they do not cascade from workspaces.
    await prisma.user.deleteMany({ where: { email: { startsWith: 'schema-test-' } } });
    await prisma.$disconnect();
  });

  async function createWorkspaceWithSource(suffix: string) {
    const workspace = await prisma.workspace.create({
      data: { name: 'Acme', slug: `${slug}-${suffix}` },
    });
    const source = await prisma.source.create({
      data: {
        workspaceId: workspace.id,
        name: 'Website form',
        type: 'FORM',
        apiKeyPrefix: `lp_${slug}_${suffix}`,
        apiKeyHash: 'sha256-placeholder',
      },
    });
    return { workspace, source };
  }

  it('creates a lead with defaults, UUIDv7 id and a decimal dealValue', async () => {
    const { workspace, source } = await createWorkspaceWithSource('a');
    const lead = await prisma.lead.create({
      data: {
        workspaceId: workspace.id,
        sourceId: source.id,
        email: 'jane@northwind.io',
        rawPayload: { email: 'jane@northwind.io' },
        dealValue: new Prisma.Decimal('12500.50'),
      },
    });

    expect(lead.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-/); // version nibble = 7
    expect(lead.status).toBe('NEW');
    expect(lead.outcome).toBe('NONE');
    expect(lead.customFields).toEqual({});
    expect(lead.dealValue?.toString()).toBe('12500.5');
    expect(workspace.reviewThreshold).toBe(0.6);
  });

  it('rejects a second lead with the same email in the same workspace', async () => {
    const { workspace, source } = await createWorkspaceWithSource('b');
    const data = {
      workspaceId: workspace.id,
      sourceId: source.id,
      email: 'dup@contoso.com',
      rawPayload: {},
    };
    await prisma.lead.create({ data });
    await expect(prisma.lead.create({ data })).rejects.toMatchObject({ code: 'P2002' });
  });

  it('allows the same email in another workspace, and many leads without email', async () => {
    const one = await createWorkspaceWithSource('c');
    const two = await createWorkspaceWithSource('d');
    const lead = (ws: typeof one, email: string | null) =>
      prisma.lead.create({
        data: { workspaceId: ws.workspace.id, sourceId: ws.source.id, email, rawPayload: {} },
      });

    await lead(one, 'same@fabrikam.com');
    await expect(lead(two, 'same@fabrikam.com')).resolves.toBeDefined();
    await lead(one, null);
    await expect(lead(one, null)).resolves.toBeDefined();
  });

  it('deleting a workspace cascades to its tenant data', async () => {
    const { workspace, source } = await createWorkspaceWithSource('e');
    const lead = await prisma.lead.create({
      data: { workspaceId: workspace.id, sourceId: source.id, rawPayload: {} },
    });
    await prisma.leadEvent.create({
      data: { workspaceId: workspace.id, leadId: lead.id, type: 'ingested' },
    });

    await prisma.workspace.delete({ where: { id: workspace.id } });

    expect(await prisma.lead.count({ where: { workspaceId: workspace.id } })).toBe(0);
    expect(await prisma.leadEvent.count({ where: { workspaceId: workspace.id } })).toBe(0);
    expect(await prisma.source.count({ where: { workspaceId: workspace.id } })).toBe(0);
  });

  describe('constraints relied on by later milestones', () => {
    it('Source.apiKeyPrefix is unique across all workspaces (API key lookup)', async () => {
      const { source } = await createWorkspaceWithSource('f');
      const other = await prisma.workspace.create({ data: { name: 'Other', slug: `${slug}-g` } });
      await expect(
        prisma.source.create({
          data: {
            workspaceId: other.id,
            name: 'Copycat',
            type: 'FORM',
            apiKeyPrefix: source.apiKeyPrefix,
            apiKeyHash: 'sha256-other',
          },
        }),
      ).rejects.toMatchObject({ code: 'P2002' });
    });

    it('IdempotencyKey is unique per (sourceId, key) but reusable on another source', async () => {
      const one = await createWorkspaceWithSource('h');
      const two = await createWorkspaceWithSource('i');
      const expiresAt = new Date('2030-01-01T00:00:00.000Z');
      const idem = (ws: typeof one) =>
        prisma.idempotencyKey.create({
          data: {
            workspaceId: ws.workspace.id,
            sourceId: ws.source.id,
            key: 'order-123',
            requestHash: 'hash-a',
            expiresAt,
          },
        });

      await idem(one);
      await expect(idem(one)).rejects.toMatchObject({ code: 'P2002' });
      await expect(idem(two)).resolves.toBeDefined();
    });

    it('Membership is unique per (workspaceId, userId); a user can join several workspaces', async () => {
      const one = await prisma.workspace.create({ data: { name: 'One', slug: `${slug}-j` } });
      const two = await prisma.workspace.create({ data: { name: 'Two', slug: `${slug}-k` } });
      const user = await prisma.user.create({
        data: { email: `${slug}-user@example.test`, passwordHash: 'argon2-placeholder' },
      });

      await prisma.membership.create({ data: { workspaceId: one.id, userId: user.id } });
      await expect(
        prisma.membership.create({
          data: { workspaceId: one.id, userId: user.id, role: 'ADMIN' },
        }),
      ).rejects.toMatchObject({ code: 'P2002' });
      await expect(
        prisma.membership.create({ data: { workspaceId: two.id, userId: user.id } }),
      ).resolves.toMatchObject({ role: 'MEMBER' });
    });

    it('a Source that still has leads cannot be deleted (Lead.sourceId onDelete Restrict)', async () => {
      const { workspace, source } = await createWorkspaceWithSource('l');
      await prisma.lead.create({
        data: { workspaceId: workspace.id, sourceId: source.id, rawPayload: {} },
      });

      await expect(prisma.source.delete({ where: { id: source.id } })).rejects.toBeInstanceOf(
        Prisma.PrismaClientKnownRequestError,
      );
      expect(await prisma.source.count({ where: { id: source.id } })).toBe(1);
      expect(await prisma.lead.count({ where: { sourceId: source.id } })).toBe(1);
    });

    it('rejects a lead email that is not lowercased (keeps the dedup guard case-proof)', async () => {
      const { workspace, source } = await createWorkspaceWithSource('n');
      await expect(
        prisma.lead.create({
          data: {
            workspaceId: workspace.id,
            sourceId: source.id,
            email: 'Jane@Northwind.io',
            rawPayload: {},
          },
        }),
      ).rejects.toThrow(/Lead_email_lowercase_check/);
    });

    it('deleting a Source without leads cascades to its idempotency keys', async () => {
      const { workspace, source } = await createWorkspaceWithSource('m');
      await prisma.idempotencyKey.create({
        data: {
          workspaceId: workspace.id,
          sourceId: source.id,
          key: 'k-1',
          requestHash: 'hash',
          expiresAt: new Date('2030-01-01T00:00:00.000Z'),
        },
      });

      await prisma.source.delete({ where: { id: source.id } });
      expect(await prisma.idempotencyKey.count({ where: { sourceId: source.id } })).toBe(0);
    });
  });
});
