import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaPg } from '@prisma/adapter-pg';
import request from 'supertest';
import { PrismaClient } from '../src/generated/prisma/client';
import { createTestApp } from './utils/create-test-app';
import { INVITES_EMAIL_PREFIX, joinAs, ownerOf } from './utils/invites';
import { auditRows, workspaceOf } from './utils/workspace-data';

const RUBRIC = {
  industries: ['Logistics', 'Online learning'],
  companySizes: ['11-50', '51-200'],
  countries: ['vn', 'US'],
  budgetSignals: ['asks for a demo'],
  disqualifiers: ['students'],
  notes: 'We sell to teams, not individuals.\nPrefer companies with a website.',
};

/** Settings > Ideal customer API: who may, what is stored, what is refused. */
describe('Ideal customer rubric (e2e)', () => {
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

  const api = () => request(app.getHttpServer());
  const as = (who: { accessToken: string }) => ({ authorization: `Bearer ${who.accessToken}` });

  async function team() {
    const owner = await ownerOf(app);
    const member = await joinAs(app, owner, 'MEMBER', 'member');
    return { owner, member, workspaceId: await workspaceOf(prisma, owner.body.email) };
  }

  it('is empty until saved, then returns what was saved (country codes uppercased), with history', async () => {
    const t = await team();
    const empty = await api().get('/icp-rubric').set(as(t.owner)).expect(200);
    expect(empty.body).toEqual({
      industries: [],
      companySizes: [],
      countries: [],
      budgetSignals: [],
      disqualifiers: [],
      notes: null,
      updatedAt: null,
    });

    const saved = await api().put('/icp-rubric').set(as(t.owner)).send(RUBRIC).expect(200);
    expect(saved.body).toMatchObject({ ...RUBRIC, countries: ['VN', 'US'] });
    expect(saved.body.updatedAt).toEqual(expect.any(String));
    expect((await api().get('/icp-rubric').set(as(t.owner)).expect(200)).body.industries).toEqual(
      RUBRIC.industries,
    );

    // Saving again replaces; one history row for each real change, none for a no-op.
    await api().put('/icp-rubric').set(as(t.owner)).send(RUBRIC).expect(200);
    await api()
      .put('/icp-rubric')
      .set(as(t.owner))
      .send({ ...RUBRIC, industries: ['Logistics'] })
      .expect(200);
    const rows = (await auditRows(prisma, t.workspaceId)).filter(
      (r) => r.action === 'ideal_customer.updated',
    );
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({
      area: 'ideal_customer',
      before: { industries: 'Logistics, Online learning' },
      after: { industries: 'Logistics' },
    });
  });

  it('only Owner and Admin may read or write it', async () => {
    const t = await team();
    for (const res of [
      await api().get('/icp-rubric').set(as(t.member)),
      await api().put('/icp-rubric').set(as(t.member)).send(RUBRIC),
    ]) {
      expect(res.status).toBe(403);
    }
    await api().get('/icp-rubric').expect(401);
    expect(await prisma.icpRubric.count({ where: { workspaceId: t.workspaceId } })).toBe(0);
  });

  it('each workspace has its own, and a body naming another workspace is refused', async () => {
    const a = await team();
    const b = await team();
    await api().put('/icp-rubric').set(as(a.owner)).send(RUBRIC).expect(200);
    expect((await api().get('/icp-rubric').set(as(b.owner)).expect(200)).body.industries).toEqual(
      [],
    );
    await api()
      .put('/icp-rubric')
      .set(as(b.owner))
      .send({ ...RUBRIC, workspaceId: a.workspaceId })
      .expect(400);
    expect(await prisma.icpRubric.count({ where: { workspaceId: b.workspaceId } })).toBe(0);
  });

  it.each([
    [{ ...RUBRIC, industries: ['x'.repeat(101)] }],
    [{ ...RUBRIC, industries: Array.from({ length: 31 }, (_, i) => `i${i}`) }],
    [{ ...RUBRIC, industries: ['line\nbreak'] }],
    [{ ...RUBRIC, countries: ['ZZZ'] }],
    [{ ...RUBRIC, countries: ['1a'] }],
    [{ ...RUBRIC, notes: 'x'.repeat(2001) }],
    [{ ...RUBRIC, notes: 'null \u0000 byte' }],
    [{ ...RUBRIC, notes: 'bell \u0007' }],
    [{ ...RUBRIC, notes: 42 }],
    [{ industries: [] }],
    [{ ...RUBRIC, extra: 1 }],
  ])('refuses the body %j with 400', async (body) => {
    const t = await team();
    const res = await api().put('/icp-rubric').set(as(t.owner)).send(body).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(await prisma.icpRubric.count({ where: { workspaceId: t.workspaceId } })).toBe(0);
  });
});
