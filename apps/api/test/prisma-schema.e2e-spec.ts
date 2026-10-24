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
});
