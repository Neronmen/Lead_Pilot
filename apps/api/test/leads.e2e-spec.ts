import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaPg } from '@prisma/adapter-pg';
import request from 'supertest';
import { PrismaClient } from '../src/generated/prisma/client';
import { createTestApp } from './utils/create-test-app';
import { INVITES_EMAIL_PREFIX, joinAs, ownerOf } from './utils/invites';
import { workspaceOf } from './utils/workspace-data';

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
});
