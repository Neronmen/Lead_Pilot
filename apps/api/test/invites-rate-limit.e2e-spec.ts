import type { NestExpressApplication } from '@nestjs/platform-express';
import { errorBodySchema } from '@leadpilot/shared';
import { PrismaPg } from '@prisma/adapter-pg';
import request from 'supertest';
import { PrismaClient } from '../src/generated/prisma/client';
import { inviteeAddress, INVITES_EMAIL_PREFIX, mailbox, ownerOf } from './utils/invites';

/**
 * Invite and resend send email, so they are limited per workspace (not per
 * IP): a signed-up user must not be able to use the API as an email relay.
 * The limits are read when the app module loads, so they are set before the
 * module is imported, below.
 */
describe('Invite rate limit (e2e)', () => {
  let app: NestExpressApplication;
  const DAILY = 3;
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });

  beforeAll(async () => {
    process.env.INVITE_RATE_LIMIT_PER_DAY = String(DAILY);
    const { createTestApp } = await import('./utils/create-test-app.js');
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

  const http = () => request(app.getHttpServer());
  const invite = (token: string) =>
    http()
      .post('/invites')
      .set('authorization', `Bearer ${token}`)
      .send({ emails: [inviteeAddress('rl')], role: 'MEMBER' });

  it('answers 429 once a workspace used its invite budget, and sends nothing more', async () => {
    const owner = await ownerOf(app, 'limited');
    for (let i = 0; i < DAILY; i += 1) await invite(owner.accessToken).expect(201);
    const sent = mailbox(app).outbox.length;

    const res = await invite(owner.accessToken).expect(429);
    expect(errorBodySchema.parse(res.body).error.code).toBe('RATE_LIMITED');
    expect(mailbox(app).outbox.length).toBe(sent);
  });

  it('counts per workspace: another workspace is not affected', async () => {
    const [a, b] = [await ownerOf(app, 'busy'), await ownerOf(app, 'quiet')];
    for (let i = 0; i < DAILY; i += 1) await invite(a.accessToken).expect(201);
    await invite(a.accessToken).expect(429);
    await invite(b.accessToken).expect(201);
  });

  it('does not reset when invites are cancelled, and does not count listing or cancelling', async () => {
    const owner = await ownerOf(app, 'loop');
    const auth = `Bearer ${owner.accessToken}`;
    for (let i = 0; i < DAILY; i += 1) {
      await invite(owner.accessToken).expect(201);
      const list = await http().get('/invites').set('authorization', auth).expect(200);
      // Cancelling frees the "pending" slot but not the send budget.
      for (const row of list.body as Array<{ id: string }>) {
        await http().delete(`/invites/${row.id}`).set('authorization', auth).expect(204);
      }
    }
    await invite(owner.accessToken).expect(429);
    // Reading is never limited by this budget.
    for (let i = 0; i < DAILY + 2; i += 1) {
      await http().get('/invites').set('authorization', auth).expect(200);
    }
  });

  it('limits resend too', async () => {
    const owner = await ownerOf(app, 'resend');
    await invite(owner.accessToken).expect(201);
    const auth = `Bearer ${owner.accessToken}`;
    const [row] = (await http().get('/invites').set('authorization', auth)).body as Array<{
      id: string;
    }>;
    for (let i = 0; i < DAILY; i += 1) {
      await http().post(`/invites/${row?.id}/resend`).set('authorization', auth).expect(200);
    }
    await http().post(`/invites/${row?.id}/resend`).set('authorization', auth).expect(429);
  });
});
