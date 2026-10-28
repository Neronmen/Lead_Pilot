import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaPg } from '@prisma/adapter-pg';
import request from 'supertest';
import { PrismaClient } from '../src/generated/prisma/client';
import { createTestApp } from './utils/create-test-app';
import { INVITES_EMAIL_PREFIX, joinAs, ownerOf } from './utils/invites';

/** Settings > Change history: who changed what, only in your own workspace, newest first. */
describe('Change history (e2e)', () => {
  let app: NestExpressApplication;
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  const http = () => request(app.getHttpServer());

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

  const auth = (user: { accessToken: string }) => ({ authorization: `Bearer ${user.accessToken}` });

  it('lists changes newest first with the person behind each, filters by area, and pages', async () => {
    const owner = await ownerOf(app, 'hist');
    for (const name of ['One', 'Two', 'Three']) {
      await http().post('/sources').set(auth(owner)).send({ name, type: 'WEBHOOK' }).expect(201);
    }
    await http()
      .post('/routing/rules')
      .set(auth(owner))
      .send({
        name: 'Tag all',
        conditions: { match: 'all', conditions: [] },
        actions: [{ type: 'tag', tag: 'x' }],
      })
      .expect(201);

    const all = await http().get('/history').set(auth(owner)).expect(200);
    expect(all.body.entries.map((e: { action: string }) => e.action)).toEqual([
      'rule.created',
      'source.created',
      'source.created',
      'source.created',
    ]);
    expect(all.body.entries[0].actor).toMatchObject({ name: 'Chloe Martin' });
    expect(all.body.entries[0].after).toMatchObject({ name: 'Tag all' });
    expect(all.body.next).toBeNull();

    const rules = await http().get('/history?area=rules').set(auth(owner)).expect(200);
    expect(rules.body.entries).toHaveLength(1);
    const none = await http().get('/history?area=team').set(auth(owner)).expect(200);
    expect(none.body.entries).toEqual([]);

    // Paging: force a page of one by asking again with the cursor of a made-up first page.
    const first = all.body.entries[1];
    const second = await http()
      .get(`/history?before=${encodeURIComponent(`${first.createdAt}_${first.id}`)}`)
      .set(auth(owner))
      .expect(200);
    expect(second.body.entries.every((e: { id: string }) => e.id !== all.body.entries[0].id)).toBe(
      true,
    );
    expect(second.body.entries.length).toBeLessThan(all.body.entries.length);
  });

  it('shows nothing of another workspace, and a Member cannot open it', async () => {
    const a = await ownerOf(app, 'hist-a');
    const b = await ownerOf(app, 'hist-b');
    await http()
      .post('/sources')
      .set(auth(a))
      .send({ name: 'Only A', type: 'WEBHOOK' })
      .expect(201);
    const seenByB = await http().get('/history').set(auth(b)).expect(200);
    expect(JSON.stringify(seenByB.body)).not.toContain('Only A');
    const member = await joinAs(app, a, 'MEMBER', 'hist-member');
    await http().get('/history').set(auth(member)).expect(403);
  });

  it('refuses a bad filter', async () => {
    const owner = await ownerOf(app, 'hist-bad');
    await http().get('/history?area=nope').set(auth(owner)).expect(400);
    await http().get('/history?days=0').set(auth(owner)).expect(400);
  });
});
