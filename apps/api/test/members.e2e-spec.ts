import type { NestExpressApplication } from '@nestjs/platform-express';
import { errorBodySchema, memberSchema } from '@leadpilot/shared';
import { PrismaPg } from '@prisma/adapter-pg';
import request from 'supertest';
import { PrismaClient } from '../src/generated/prisma/client';
import { AuditService } from '../src/audit/audit.service';
import { createTestApp } from './utils/create-test-app';
import {
  INVITES_EMAIL_PREFIX,
  inviteAddress,
  inviteeAddress,
  joinAs,
  mailbox,
  ownerOf,
  tokenFromEmail,
} from './utils/invites';
import { auditRows, makeLead, membershipOf, workspaceOf } from './utils/workspace-data';

describe('Members (e2e)', () => {
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
  const bearer = (user: { accessToken: string }) => `Bearer ${user.accessToken}`;
  const errorCode = (res: request.Response) => errorBodySchema.parse(res.body).error.code;

  /** A workspace with an owner, an admin and a member. */
  async function team() {
    const owner = await ownerOf(app);
    const admin = await joinAs(app, owner, 'ADMIN', 'admin');
    const member = await joinAs(app, owner, 'MEMBER', 'member');
    const workspaceId = await workspaceOf(prisma, owner.body.email);
    return {
      owner,
      admin,
      member,
      workspaceId,
      ownerM: await membershipOf(prisma, owner.body.email, workspaceId),
      adminM: await membershipOf(prisma, admin.email, workspaceId),
      memberM: await membershipOf(prisma, member.email, workspaceId),
    };
  }

  describe('GET /members', () => {
    it('lists the people with role, name, email, open leads, last active and join date', async () => {
      const t = await team();
      await makeLead(prisma, t.workspaceId, { ownerId: t.memberM.userId });
      await makeLead(prisma, t.workspaceId, { ownerId: t.memberM.userId, outcome: 'CONTACTED' });
      await makeLead(prisma, t.workspaceId, { ownerId: t.memberM.userId, outcome: 'QUALIFIED' });
      await makeLead(prisma, t.workspaceId, { ownerId: t.memberM.userId, outcome: 'WON' });
      await makeLead(prisma, t.workspaceId, { ownerId: t.memberM.userId, outcome: 'LOST' });
      await makeLead(prisma, t.workspaceId, { ownerId: t.adminM.userId });
      await makeLead(prisma, t.workspaceId); // unassigned

      const res = await http().get('/members').set('authorization', bearer(t.owner)).expect(200);
      const members = (res.body as unknown[]).map((row) => memberSchema.parse(row));
      expect(members.map((m) => m.role)).toEqual(['OWNER', 'ADMIN', 'MEMBER']);
      expect(members[0]).toMatchObject({
        id: t.ownerM.id,
        email: t.owner.body.email,
        name: 'Chloe Martin',
        openLeads: 0,
      });
      // Won and lost leads are closed; unassigned leads belong to nobody.
      expect(members.find((m) => m.role === 'MEMBER')).toMatchObject({
        id: t.memberM.id,
        userId: t.memberM.userId,
        name: `Member member`,
        openLeads: 3,
        lastActiveAt: expect.any(String),
        joinedAt: expect.any(String),
      });
      expect(members.find((m) => m.role === 'ADMIN')?.openLeads).toBe(1);
    });

    it('counts only the leads of this workspace for a person who is in two', async () => {
      const a = await team();
      const b = await ownerOf(app, 'other-ws');
      const bWorkspaceId = await workspaceOf(prisma, b.body.email);
      // The member of A also joins B (the real path: B invites their address).
      const token = await inviteAddress(app, b, a.member.email);
      await http()
        .post('/auth/invites/accept')
        .send({ token, password: a.member.password })
        .expect(200);
      await makeLead(prisma, bWorkspaceId, { ownerId: a.memberM.userId });
      await makeLead(prisma, a.workspaceId, { ownerId: a.memberM.userId });

      const inA = await http().get('/members').set('authorization', bearer(a.owner)).expect(200);
      expect(inA.body.find((m: { id: string }) => m.id === a.memberM.id).openLeads).toBe(1);
      const inB = await http().get('/members').set('authorization', bearer(b)).expect(200);
      expect(inB.body).toHaveLength(2);
      expect(inB.body.find((m: { role: string }) => m.role === 'MEMBER').openLeads).toBe(1);
    });

    it('is Admin and Owner only', async () => {
      const t = await team();
      await http().get('/members').set('authorization', bearer(t.admin)).expect(200);
      const res = await http().get('/members').set('authorization', bearer(t.member)).expect(403);
      expect(errorCode(res)).toBe('FORBIDDEN');
      await http().get('/members').expect(401);
    });

    it("never lists another workspace's people", async () => {
      const a = await team();
      const b = await ownerOf(app, 'alone');
      const res = await http().get('/members').set('authorization', bearer(b)).expect(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].email).toBe(b.body.email);
      expect(JSON.stringify(res.body)).not.toContain(a.member.email);
    });
  });

  describe('PATCH /members/:id', () => {
    const patch = (who: { accessToken: string }, id: string, body: unknown) =>
      http()
        .patch(`/members/${id}`)
        .set('authorization', bearer(who))
        .send(body as object);

    it('lets the owner make a member an admin, and writes the change history', async () => {
      const t = await team();
      const res = await patch(t.owner, t.memberM.id, { role: 'ADMIN' }).expect(200);
      expect(memberSchema.parse(res.body)).toMatchObject({ id: t.memberM.id, role: 'ADMIN' });
      expect((await membershipOf(prisma, t.member.email, t.workspaceId)).role).toBe('ADMIN');

      const rows = (await auditRows(prisma, t.workspaceId)).filter(
        (row) => row.action === 'member.role_changed',
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        area: 'team',
        actorUserId: t.ownerM.userId,
        entityType: 'membership',
        entityId: t.memberM.id,
        before: { email: t.member.email, role: 'MEMBER' },
        after: { email: t.member.email, role: 'ADMIN' },
      });
    });

    it('lets the owner manage members and admins (an admin only members: see team-owner-admins)', async () => {
      const t = await team();
      const second = await joinAs(app, t.owner, 'ADMIN', 'admin2');
      const secondM = await membershipOf(prisma, second.email, t.workspaceId);
      await patch(t.owner, t.memberM.id, { role: 'ADMIN' }).expect(200);
      await patch(t.owner, secondM.id, { role: 'MEMBER' }).expect(200);
      expect((await membershipOf(prisma, second.email, t.workspaceId)).role).toBe('MEMBER');
    });

    it('takes effect at once: a demoted admin loses access with the same token', async () => {
      const t = await team();
      await http().get('/members').set('authorization', bearer(t.admin)).expect(200);
      await patch(t.owner, t.adminM.id, { role: 'MEMBER' }).expect(200);
      const res = await http().get('/members').set('authorization', bearer(t.admin)).expect(403);
      expect(errorCode(res)).toBe('FORBIDDEN');
      // And a promoted member gains it at once.
      await patch(t.owner, t.memberM.id, { role: 'ADMIN' }).expect(200);
      await http().get('/members').set('authorization', bearer(t.member)).expect(200);
    });

    it('does nothing and writes no history when the role is already that', async () => {
      const t = await team();
      await patch(t.owner, t.memberM.id, { role: 'MEMBER' }).expect(200);
      const rows = (await auditRows(prisma, t.workspaceId)).filter(
        (row) => row.action === 'member.role_changed',
      );
      expect(rows).toHaveLength(0);
    });

    it('never touches the owner, and nobody changes themselves', async () => {
      const t = await team();
      const owner = await patch(t.admin, t.ownerM.id, { role: 'MEMBER' }).expect(403);
      expect(errorCode(owner)).toBe('OWNER_IMMUTABLE');
      const ownerSelf = await patch(t.owner, t.ownerM.id, { role: 'ADMIN' }).expect(403);
      expect(errorCode(ownerSelf)).toBe('CANNOT_MODIFY_SELF');
      const adminSelf = await patch(t.admin, t.adminM.id, { role: 'MEMBER' }).expect(403);
      expect(errorCode(adminSelf)).toBe('CANNOT_MODIFY_SELF');
      expect((await membershipOf(prisma, t.owner.body.email, t.workspaceId)).role).toBe('OWNER');
      expect((await membershipOf(prisma, t.admin.email, t.workspaceId)).role).toBe('ADMIN');
    });

    it('can never grant OWNER, or accept other fields', async () => {
      const t = await team();
      for (const body of [
        { role: 'OWNER' },
        { role: 'ADMIN', userId: crypto.randomUUID() },
        { role: 'ADMIN', workspaceId: crypto.randomUUID() },
        {},
        { role: 'admin' },
      ]) {
        const res = await patch(t.owner, t.memberM.id, body).expect(400);
        expect(errorCode(res)).toBe('VALIDATION_FAILED');
      }
      expect((await membershipOf(prisma, t.member.email, t.workspaceId)).role).toBe('MEMBER');
      const owners = await prisma.membership.count({
        where: { workspaceId: t.workspaceId, role: 'OWNER' },
      });
      expect(owners).toBe(1);
    });

    it('answers 404 for an unknown id, 400 for a malformed one, 403 for a member', async () => {
      const t = await team();
      const unknown = await patch(t.owner, crypto.randomUUID(), { role: 'ADMIN' }).expect(404);
      expect(errorCode(unknown)).toBe('NOT_FOUND');
      await patch(t.owner, 'not-a-uuid', { role: 'ADMIN' }).expect(400);
      await patch(t.member, t.adminM.id, { role: 'MEMBER' }).expect(403);
      await http().patch(`/members/${t.memberM.id}`).send({ role: 'ADMIN' }).expect(401);
    });
  });

  describe('DELETE /members/:id', () => {
    const remove = (who: { accessToken: string }, id: string) =>
      http().delete(`/members/${id}`).set('authorization', bearer(who));

    it('removes the person: leads unassigned, sessions ended, account and other workspaces kept', async () => {
      const a = await team();
      const b = await ownerOf(app, 'second-home');
      const bWorkspaceId = await workspaceOf(prisma, b.body.email);
      // The member of A also belongs to B, with a lead and a session there.
      const token = await inviteAddress(app, b, a.member.email);
      const inB = await http()
        .post('/auth/invites/accept')
        .send({ token, password: a.member.password })
        .expect(200);
      const open = await makeLead(prisma, a.workspaceId, { ownerId: a.memberM.userId });
      const won = await makeLead(prisma, a.workspaceId, {
        ownerId: a.memberM.userId,
        outcome: 'WON',
      });
      const leadInB = await makeLead(prisma, bWorkspaceId, { ownerId: a.memberM.userId });

      await remove(a.owner, a.memberM.id).expect(204);

      expect(await prisma.membership.count({ where: { id: a.memberM.id } })).toBe(0);
      expect(await prisma.user.count({ where: { email: a.member.email } })).toBe(1);
      for (const id of [open.id, won.id]) {
        const lead = await prisma.lead.findUniqueOrThrow({ where: { id } });
        expect(lead).toMatchObject({ ownerId: null, workspaceId: a.workspaceId });
      }
      // Nothing happened in the other workspace.
      expect(await prisma.lead.findUniqueOrThrow({ where: { id: leadInB.id } })).toMatchObject({
        ownerId: a.memberM.userId,
      });
      await http().get('/auth/me').set('authorization', bearer(inB.body)).expect(200);

      // Their session in A ended at once: the old token and the refresh cookie.
      const me = await http().get('/auth/me').set('authorization', bearer(a.member)).expect(401);
      expect(errorCode(me)).toBe('AUTH_SESSION_EXPIRED');
      await http().post('/auth/refresh').set('cookie', a.member.refreshCookie).expect(401);

      const rows = (await auditRows(prisma, a.workspaceId)).filter(
        (row) => row.action === 'member.removed',
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        area: 'team',
        actorUserId: a.ownerM.userId,
        before: { email: a.member.email, role: 'MEMBER' },
        after: { unassignedLeads: 2 },
      });
    });

    it('lets an admin remove members, the owner remove admins, and nobody the owner or themselves', async () => {
      const t = await team();
      const second = await joinAs(app, t.owner, 'ADMIN', 'admin2');
      const secondM = await membershipOf(prisma, second.email, t.workspaceId);
      await remove(t.admin, t.memberM.id).expect(204);
      await remove(t.admin, secondM.id).expect(403); // an admin cannot remove an admin
      await remove(t.owner, secondM.id).expect(204);

      const owner = await remove(t.admin, t.ownerM.id).expect(403);
      expect(errorCode(owner)).toBe('OWNER_IMMUTABLE');
      const self = await remove(t.admin, t.adminM.id).expect(403);
      expect(errorCode(self)).toBe('CANNOT_MODIFY_SELF');
      const ownerSelf = await remove(t.owner, t.ownerM.id).expect(403);
      expect(errorCode(ownerSelf)).toBe('CANNOT_MODIFY_SELF');
      expect(await prisma.membership.count({ where: { workspaceId: t.workspaceId } })).toBe(2);
    });

    it('can be invited again afterwards', async () => {
      const t = await team();
      await remove(t.owner, t.memberM.id).expect(204);
      const token = await inviteAddress(app, t.owner, t.member.email);
      const res = await http()
        .post('/auth/invites/accept')
        .send({ token, password: t.member.password })
        .expect(200);
      const me = await http().get('/auth/me').set('authorization', bearer(res.body)).expect(200);
      expect(me.body.workspace.id).toBe(t.workspaceId);
    });

    it('answers 404 for an unknown id, 403 for a member, 401 without a token', async () => {
      const t = await team();
      const res = await remove(t.owner, crypto.randomUUID()).expect(404);
      expect(errorCode(res)).toBe('NOT_FOUND');
      await remove(t.member, t.adminM.id).expect(403);
      await http().delete(`/members/${t.memberM.id}`).expect(401);
      expect(await prisma.membership.count({ where: { workspaceId: t.workspaceId } })).toBe(3);
    });
  });

  describe('change history of team changes', () => {
    it('records invites, joins, role changes and removals, in order, without any token', async () => {
      const owner = await ownerOf(app);
      const workspaceId = await workspaceOf(prisma, owner.body.email);
      const address = inviteeAddress('history');
      const auth = bearer(owner);

      await http()
        .post('/invites')
        .set('authorization', auth)
        .send({ emails: [address], role: 'MEMBER' })
        .expect(201);
      const invite = await prisma.invite.findFirstOrThrow({ where: { email: address } });
      await http().post(`/invites/${invite.id}/resend`).set('authorization', auth).expect(200);
      const token = tokenFromEmail(mailbox(app).lastTo(address));
      await http()
        .post('/auth/invites/accept')
        .send({ token, name: 'History Hank', password: 'a-long-enough-password-1' })
        .expect(200);
      const hank = await membershipOf(prisma, address, workspaceId);
      await http()
        .patch(`/members/${hank.id}`)
        .set('authorization', auth)
        .send({ role: 'ADMIN' })
        .expect(200);
      await http().delete(`/members/${hank.id}`).set('authorization', auth).expect(204);
      const second = inviteeAddress('history-cancel');
      await http()
        .post('/invites')
        .set('authorization', auth)
        .send({ emails: [second], role: 'ADMIN' })
        .expect(201);
      const toCancel = await prisma.invite.findFirstOrThrow({ where: { email: second } });
      await http().delete(`/invites/${toCancel.id}`).set('authorization', auth).expect(204);

      const rows = await auditRows(prisma, workspaceId);
      expect(rows.map((row) => row.action)).toEqual([
        'invite.created',
        'invite.resent',
        'member.joined',
        'member.role_changed',
        'member.removed',
        'invite.created',
        'invite.cancelled',
      ]);
      expect(rows.every((row) => row.area === 'team')).toBe(true);
      // Who did it: the owner, except joining, which the new member did.
      expect(rows.map((row) => row.actorUserId === hank.userId)).toEqual([
        false,
        false,
        true,
        false,
        false,
        false,
        false,
      ]);
      expect(rows[0]).toMatchObject({
        entityType: 'invite',
        entityId: invite.id,
        after: { email: address, role: 'MEMBER' },
      });
      expect(rows[6]).toMatchObject({ before: { email: second, role: 'ADMIN' } });
      // Never a token, or its hash, in the history.
      const dump = JSON.stringify(rows);
      expect(dump).not.toContain(token);
      expect(dump).not.toContain(invite.tokenHash);
    });

    it('is written in the same transaction as the change', async () => {
      const t = await team();
      const lead = await makeLead(prisma, t.workspaceId, { ownerId: t.memberM.userId });
      const spy = jest
        .spyOn(app.get(AuditService), 'record')
        .mockRejectedValueOnce(new Error('history unavailable'));

      // The history entry fails, so the removal is rolled back with it.
      await http()
        .delete(`/members/${t.memberM.id}`)
        .set('authorization', bearer(t.owner))
        .expect(500);
      spy.mockRestore();
      expect(await prisma.membership.count({ where: { id: t.memberM.id } })).toBe(1);
      expect(await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).toMatchObject({
        ownerId: t.memberM.userId,
      });

      // The same for a role change.
      jest.spyOn(app.get(AuditService), 'record').mockRejectedValueOnce(new Error('unavailable'));
      await http()
        .patch(`/members/${t.memberM.id}`)
        .set('authorization', bearer(t.owner))
        .send({ role: 'ADMIN' })
        .expect(500);
      expect((await membershipOf(prisma, t.member.email, t.workspaceId)).role).toBe('MEMBER');
      jest.restoreAllMocks();
    });
  });
});
