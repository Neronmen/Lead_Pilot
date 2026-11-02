import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaPg } from '@prisma/adapter-pg';
import request from 'supertest';
import { PrismaClient } from '../src/generated/prisma/client';
import { SignupGate } from '../src/auth/auth.service';
import { signupBody } from './utils/auth';
import { createTestApp } from './utils/create-test-app';
import { INVITES_EMAIL_PREFIX, joinAs, ownerOf } from './utils/invites';

/** Settings > General, account password, the sign-ups switch and the CSV export. */
describe('General settings and account (e2e)', () => {
  let app: NestExpressApplication;
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  const http = () => request(app.getHttpServer());
  const auth = (user: { accessToken: string }) => ({ authorization: `Bearer ${user.accessToken}` });

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

  it('closed sign-ups: a new workspace is refused, signing in still works', async () => {
    const owner = await ownerOf(app, 'gate');
    const gate = app.get(SignupGate);
    gate.open = false;
    try {
      const res = await http().post('/auth/signup').send(signupBody()).expect(403);
      expect(res.body.error.code).toBe('SIGNUP_CLOSED');
      await http()
        .post('/auth/login')
        .send({ email: owner.body.email, password: owner.body.password })
        .expect(200);
    } finally {
      gate.open = true;
    }
  });

  it('change password: needs the old one, ends the other sessions, the new one works', async () => {
    const owner = await ownerOf(app, 'pw');
    const newPassword = 'a-brand-new-password-9';
    const wrong = await http()
      .post('/auth/change-password')
      .set(auth(owner))
      .send({ currentPassword: 'not-the-password', newPassword })
      .expect(401);
    expect(wrong.body.error.code).toBe('AUTH_INVALID_CREDENTIALS');

    const ok = await http()
      .post('/auth/change-password')
      .set(auth(owner))
      .send({ currentPassword: owner.body.password, newPassword })
      .expect(200);
    expect(ok.body.accessToken).toEqual(expect.any(String));
    // The old session's refresh token no longer works; only the new password does.
    await http().post('/auth/refresh').set('cookie', owner.refreshCookie).expect(401);
    await http()
      .post('/auth/login')
      .send({ email: owner.body.email, password: owner.body.password })
      .expect(401);
    await http()
      .post('/auth/login')
      .send({ email: owner.body.email, password: newPassword })
      .expect(200);
  });

  it('workspace settings: an admin changes them and it is recorded; a member cannot', async () => {
    const owner = await ownerOf(app, 'gen');
    const admin = await joinAs(app, owner, 'ADMIN', 'gen-admin');
    const member = await joinAs(app, owner, 'MEMBER', 'gen-member');

    const res = await http()
      .patch('/workspace')
      .set(auth(admin))
      .send({
        name: 'Renamed Co',
        defaultLocale: 'vi',
        currency: 'VND',
        timezone: 'Asia/Ho_Chi_Minh',
      })
      .expect(200);
    expect(res.body).toMatchObject({
      name: 'Renamed Co',
      defaultLocale: 'vi',
      currency: 'VND',
      timezone: 'Asia/Ho_Chi_Minh',
    });
    const me = await http().get('/auth/me').set(auth(owner)).expect(200);
    expect(me.body.workspace.name).toBe('Renamed Co');
    const history = await http().get('/history?area=general').set(auth(owner)).expect(200);
    expect(history.body.entries[0]).toMatchObject({
      action: 'workspace.updated',
      after: { name: 'Renamed Co' },
    });

    await http()
      .patch('/workspace')
      .set(auth(admin))
      .send({ timezone: 'Mars/Olympus' })
      .expect(400);
    await http().patch('/workspace').set(auth(admin)).send({}).expect(400);
    await http().patch('/workspace').set(auth(member)).send({ name: 'Nope' }).expect(403);
  });

  it('delete workspace: Owner only, the name must match, then everything is gone', async () => {
    const owner = await ownerOf(app, 'del');
    const admin = await joinAs(app, owner, 'ADMIN', 'del-admin');
    const me = await http().get('/auth/me').set(auth(owner)).expect(200);
    const workspaceId = me.body.workspace.id as string;
    const name = me.body.workspace.name as string;

    await http().delete('/workspace').set(auth(admin)).send({ confirm: name }).expect(403);
    const wrong = await http()
      .delete('/workspace')
      .set(auth(owner))
      .send({ confirm: 'something else' })
      .expect(400);
    expect(wrong.body.error.code).toBe('CONFIRMATION_MISMATCH');
    expect(await prisma.workspace.count({ where: { id: workspaceId } })).toBe(1);

    await http().delete('/workspace').set(auth(owner)).send({ confirm: name }).expect(204);
    expect(await prisma.workspace.count({ where: { id: workspaceId } })).toBe(0);
    expect(await prisma.membership.count({ where: { workspaceId } })).toBe(0);
  });

  it('export: CSV of this workspace only, formulas defused, members refused', async () => {
    const a = await ownerOf(app, 'exp-a');
    const b = await ownerOf(app, 'exp-b');
    const member = await joinAs(app, a, 'MEMBER', 'exp-member');
    const seed = async (owner: { body: { email: string } }, email: string, company: string) => {
      const user = await prisma.user.findUniqueOrThrow({
        where: { email: owner.body.email },
        select: { memberships: { select: { workspaceId: true } } },
      });
      const workspaceId = user.memberships[0]!.workspaceId;
      const source = await prisma.source.create({
        data: {
          workspaceId,
          name: 'Zapier',
          type: 'WEBHOOK',
          apiKeyPrefix: `lp_x${Date.now()}${Math.random().toString(16).slice(2, 8)}`,
          apiKeyHash: 'x',
        },
      });
      await prisma.lead.create({
        data: { workspaceId, sourceId: source.id, rawPayload: {}, email, company },
      });
    };
    await seed(a, 'export-a@acme-test.com', '=HYPERLINK("http://x")');
    await seed(b, 'export-b@acme-test.com', 'Other Co');

    const res = await http().get('/leads/export').set(auth(a)).expect(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('attachment');
    expect(res.text).toContain('export-a@acme-test.com');
    expect(res.text).not.toContain('export-b@acme-test.com');
    expect(res.text).toContain(`"'=HYPERLINK(""http://x"")"`);
    await http().get('/leads/export').set(auth(member)).expect(403);
  });
});
