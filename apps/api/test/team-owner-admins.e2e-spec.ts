import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaPg } from '@prisma/adapter-pg';
import request from 'supertest';
import { PrismaClient } from '../src/generated/prisma/client';
import { createTestApp } from './utils/create-test-app';
import {
  INVITES_EMAIL_PREFIX,
  inviteAddress,
  inviteeAddress,
  joinAs,
  ownerOf,
} from './utils/invites';
import { auditRows, membershipOf, workspaceOf } from './utils/workspace-data';

/**
 * Only the Owner manages Admins. An Admin manages Members: it cannot grant the
 * Admin role (to a member or in an invite), nor change, remove or re-invite an
 * Admin. Every cross-role case, and that a refused request changes nothing.
 */
describe('Team: the owner manages admins, admins manage members (e2e)', () => {
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

  const http = () => request(app.getHttpServer());
  const bearer = (who: { accessToken: string }) => `Bearer ${who.accessToken}`;
  const patch = (who: { accessToken: string }, id: string, role: string) =>
    http().patch(`/members/${id}`).set('authorization', bearer(who)).send({ role });
  const remove = (who: { accessToken: string }, id: string) =>
    http().delete(`/members/${id}`).set('authorization', bearer(who));
  const invite = (who: { accessToken: string }, emails: string[], role: string) =>
    http().post('/invites').set('authorization', bearer(who)).send({ emails, role });
  const resend = (who: { accessToken: string }, id: string) =>
    http().post(`/invites/${id}/resend`).set('authorization', bearer(who));
  const cancel = (who: { accessToken: string }, id: string) =>
    http().delete(`/invites/${id}`).set('authorization', bearer(who));

  async function team() {
    const owner = await ownerOf(app);
    const admin = await joinAs(app, owner, 'ADMIN', 'admin');
    const admin2 = await joinAs(app, owner, 'ADMIN', 'admin2');
    const member = await joinAs(app, owner, 'MEMBER', 'member');
    const workspaceId = await workspaceOf(prisma, owner.body.email);
    return {
      owner,
      admin,
      admin2,
      member,
      workspaceId,
      ownerM: await membershipOf(prisma, owner.body.email, workspaceId),
      adminM: await membershipOf(prisma, admin.email, workspaceId),
      admin2M: await membershipOf(prisma, admin2.email, workspaceId),
      memberM: await membershipOf(prisma, member.email, workspaceId),
    };
  }

  const roleOf = async (id: string) =>
    (await prisma.membership.findUnique({ where: { id }, select: { role: true } }))?.role ?? null;

  describe('members', () => {
    it('the owner can change an admin, remove an admin and grant the admin role', async () => {
      const t = await team();
      await patch(t.owner, t.adminM.id, 'MEMBER').expect(200);
      expect(await roleOf(t.adminM.id)).toBe('MEMBER');
      await patch(t.owner, t.memberM.id, 'ADMIN').expect(200);
      expect(await roleOf(t.memberM.id)).toBe('ADMIN');
      await remove(t.owner, t.admin2M.id).expect(204);
      expect(await roleOf(t.admin2M.id)).toBeNull();
    });

    it('an admin cannot change another admin', async () => {
      const t = await team();
      const before = (await auditRows(prisma, t.workspaceId)).length;
      const res = await patch(t.admin, t.admin2M.id, 'MEMBER').expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
      expect(await roleOf(t.admin2M.id)).toBe('ADMIN');
      expect((await auditRows(prisma, t.workspaceId)).length).toBe(before);
    });

    it('an admin cannot remove another admin', async () => {
      const t = await team();
      const res = await remove(t.admin, t.admin2M.id).expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
      expect(await roleOf(t.admin2M.id)).toBe('ADMIN');
    });

    it('an admin cannot grant the admin role to a member', async () => {
      const t = await team();
      const res = await patch(t.admin, t.memberM.id, 'ADMIN').expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
      expect(await roleOf(t.memberM.id)).toBe('MEMBER');
    });

    it('an admin can still remove a member and keep a member a member', async () => {
      const t = await team();
      await patch(t.admin, t.memberM.id, 'MEMBER').expect(200);
      await remove(t.admin, t.memberM.id).expect(204);
      expect(await roleOf(t.memberM.id)).toBeNull();
    });

    it('the other rules win where they apply: owner and self first', async () => {
      const t = await team();
      const owner = await patch(t.admin, t.ownerM.id, 'MEMBER').expect(403);
      expect(owner.body.error.code).toBe('OWNER_IMMUTABLE');
      const self = await patch(t.admin, t.adminM.id, 'MEMBER').expect(403);
      expect(self.body.error.code).toBe('CANNOT_MODIFY_SELF');
      const selfRemove = await remove(t.admin, t.adminM.id).expect(403);
      expect(selfRemove.body.error.code).toBe('CANNOT_MODIFY_SELF');
      const ownerSelf = await patch(t.owner, t.ownerM.id, 'MEMBER').expect(403);
      expect(ownerSelf.body.error.code).toBe('CANNOT_MODIFY_SELF');
    });

    it('a member can do none of it', async () => {
      const t = await team();
      for (const res of [
        await patch(t.member, t.memberM.id, 'MEMBER'),
        await patch(t.member, t.admin2M.id, 'MEMBER'),
        await remove(t.member, t.admin2M.id),
        await http().get('/members').set('authorization', bearer(t.member)),
      ]) {
        expect(res.status).toBe(403);
      }
      expect(await roleOf(t.admin2M.id)).toBe('ADMIN');
    });

    it('an admin from another workspace gets 404, not 403 (nothing is revealed)', async () => {
      const t = await team();
      const other = await ownerOf(app, 'other');
      await patch(other, t.admin2M.id, 'MEMBER').expect(404);
      await remove(other, t.admin2M.id).expect(404);
    });
  });

  describe('invites', () => {
    it('an owner can invite an admin; an admin cannot', async () => {
      const t = await team();
      const address = inviteeAddress('newadmin');
      const refused = await invite(t.admin, [address], 'ADMIN').expect(403);
      expect(refused.body.error.code).toBe('FORBIDDEN');
      expect(await prisma.invite.count({ where: { email: address } })).toBe(0);
      const ok = await invite(t.owner, [address], 'ADMIN').expect(201);
      expect(ok.body.results).toEqual([{ email: address, status: 'invited' }]);
    });

    it('an admin can invite a member', async () => {
      const t = await team();
      const address = inviteeAddress('newmember');
      const ok = await invite(t.admin, [address], 'MEMBER').expect(201);
      expect(ok.body.results).toEqual([{ email: address, status: 'invited' }]);
    });

    it('an admin cannot resend or cancel an admin invite; the owner can', async () => {
      const t = await team();
      const address = inviteeAddress('pendingadmin');
      await inviteAddress(app, t.owner, address, 'ADMIN');
      const row = await prisma.invite.findFirstOrThrow({ where: { email: address } });
      expect((await resend(t.admin, row.id).expect(403)).body.error.code).toBe('FORBIDDEN');
      expect((await cancel(t.admin, row.id).expect(403)).body.error.code).toBe('FORBIDDEN');
      expect(await prisma.invite.count({ where: { id: row.id } })).toBe(1);
      const unchanged = await prisma.invite.findUniqueOrThrow({ where: { id: row.id } });
      expect(unchanged.tokenHash).toBe(row.tokenHash);
      await resend(t.owner, row.id).expect(200);
      await cancel(t.owner, row.id).expect(204);
      expect(await prisma.invite.count({ where: { id: row.id } })).toBe(0);
    });

    it('an admin can resend and cancel a member invite', async () => {
      const t = await team();
      const address = inviteeAddress('pendingmember');
      await inviteAddress(app, t.admin, address, 'MEMBER');
      const row = await prisma.invite.findFirstOrThrow({ where: { email: address } });
      await resend(t.admin, row.id).expect(200);
      await cancel(t.admin, row.id).expect(204);
    });

    it('an admin cannot downgrade an expired admin invite by inviting the address again', async () => {
      const t = await team();
      const address = inviteeAddress('expiredadmin');
      await inviteAddress(app, t.owner, address, 'ADMIN');
      await prisma.invite.updateMany({
        where: { email: address },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      const res = await invite(t.admin, [address], 'MEMBER').expect(201);
      expect(res.body.results).toEqual([{ email: address, status: 'already_invited' }]);
      const row = await prisma.invite.findFirstOrThrow({ where: { email: address } });
      expect(row.role).toBe('ADMIN');
      // The owner can reissue it.
      const again = await invite(t.owner, [address], 'ADMIN').expect(201);
      expect(again.body.results).toEqual([{ email: address, status: 'invited' }]);
    });

    it('an unknown or foreign invite id is a 404 for an admin', async () => {
      const t = await team();
      const other = await ownerOf(app, 'other-ws');
      const address = inviteeAddress('foreign');
      await inviteAddress(app, other, address, 'MEMBER');
      const foreign = await prisma.invite.findFirstOrThrow({ where: { email: address } });
      await resend(t.admin, foreign.id).expect(404);
      await cancel(t.admin, foreign.id).expect(404);
      await cancel(t.admin, '00000000-0000-4000-8000-000000000000').expect(404);
    });

    it('a member cannot touch invites at all', async () => {
      const t = await team();
      await invite(t.member, [inviteeAddress('x')], 'MEMBER').expect(403);
    });
  });
});
