import type { NestExpressApplication } from '@nestjs/platform-express';
import { errorBodySchema } from '@leadpilot/shared';
import { PrismaPg } from '@prisma/adapter-pg';
import request from 'supertest';
import { SessionService } from '../src/auth/session.service';
import { PrismaClient } from '../src/generated/prisma/client';
import { TenantPrisma } from '../src/prisma/tenant-prisma.service';
import { createTestApp } from './utils/create-test-app';
import {
  INVITES_EMAIL_PREFIX,
  inviteAddress,
  inviteeAddress,
  joinAs,
  ownerOf,
} from './utils/invites';
import { auditRows, makeLead, membershipOf, workspaceOf } from './utils/workspace-data';

type Fn = (...args: unknown[]) => unknown;
type Obj = Record<string | symbol, unknown>;

/**
 * Deterministic collisions. A parallel request is simulated by running `before`
 * (on a separate connection, committed at once) right before the service runs
 * `operation` on `model` inside its transaction: exactly the window in which a
 * real parallel request would land. It fires once, then the hook is inert.
 */
function interceptOnce(
  tenant: TenantPrisma,
  model: string,
  operation: string,
  before: () => Promise<unknown>,
): jest.SpyInstance {
  const original = tenant.for.bind(tenant);
  let fired = false;
  const bind = (target: Obj, prop: string | symbol) => {
    const value = target[prop];
    return typeof value === 'function' ? (value as Fn).bind(target) : value;
  };
  return jest.spyOn(tenant, 'for').mockImplementation((workspaceId: string) => {
    const client = original(workspaceId) as unknown as Obj;
    return new Proxy(client, {
      get(target, prop) {
        if (prop !== '$transaction') return bind(target, prop);
        return (callback: (tx: unknown) => unknown, ...rest: unknown[]) =>
          (target.$transaction as Fn)(
            (tx: unknown) =>
              callback(
                new Proxy(tx as Obj, {
                  get(txTarget, txProp) {
                    if (txProp !== model) return bind(txTarget, txProp);
                    return new Proxy(txTarget[model] as Obj, {
                      get(delegate, name) {
                        if (name !== operation) return bind(delegate, name);
                        return async (...args: unknown[]) => {
                          if (!fired) {
                            fired = true;
                            await before();
                          }
                          return (delegate[name] as Fn)(...args);
                        };
                      },
                    });
                  },
                }),
              ),
            ...rest,
          );
      },
    }) as unknown as ReturnType<TenantPrisma['for']>;
  }) as unknown as jest.SpyInstance;
}

describe('Members and invites: forced collisions and raw-transaction audit (e2e)', () => {
  let app: NestExpressApplication;
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterEach(() => {
    jest.restoreAllMocks();
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
  const patch = (who: { accessToken: string }, id: string, body: unknown) =>
    http()
      .patch(`/members/${id}`)
      .set('authorization', bearer(who))
      .send(body as object);
  const remove = (who: { accessToken: string }, id: string) =>
    http().delete(`/members/${id}`).set('authorization', bearer(who));
  const code = (res: request.Response) => errorBodySchema.parse(res.body).error.code;

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
      memberM: await membershipOf(prisma, member.email, workspaceId),
    };
  }

  const roleRows = async (workspaceId: string, action: string) =>
    (await auditRows(prisma, workspaceId)).filter((row) => row.action === action);

  describe('changeRole collision', () => {
    it('loses the conditional update to an identical request: idempotent 200, no second history row', async () => {
      const t = await team();
      const rowsBefore = (await auditRows(prisma, t.workspaceId)).length;
      const spy = interceptOnce(app.get(TenantPrisma), 'membership', 'updateMany', () =>
        // The winner: another admin made the person an ADMIN after our read.
        prisma.membership.update({ where: { id: t.memberM.id }, data: { role: 'ADMIN' } }),
      );

      const res = await patch(t.admin, t.memberM.id, { role: 'ADMIN' });
      spy.mockRestore();

      // The winner already made the person an ADMIN, which is what was asked.
      expect(res.status).toBe(200);
      expect(res.body.role).toBe('ADMIN');
      expect((await membershipOf(prisma, t.member.email, t.workspaceId)).role).toBe('ADMIN');
      expect(await roleRows(t.workspaceId, 'member.role_changed')).toHaveLength(0);
      expect(await auditRows(prisma, t.workspaceId)).toHaveLength(rowsBefore);
    });

    it('a retry after the collision is the same idempotent 200, and a later demotion writes one row', async () => {
      const t = await team();
      const spy = interceptOnce(app.get(TenantPrisma), 'membership', 'updateMany', () =>
        prisma.membership.update({ where: { id: t.memberM.id }, data: { role: 'ADMIN' } }),
      );
      await patch(t.admin, t.memberM.id, { role: 'ADMIN' }).expect(200);
      spy.mockRestore();

      // The role is already ADMIN: the retry is an idempotent 200 with no row.
      const retry = await patch(t.admin, t.memberM.id, { role: 'ADMIN' }).expect(200);
      expect(retry.body.role).toBe('ADMIN');
      expect(await roleRows(t.workspaceId, 'member.role_changed')).toHaveLength(0);
      // Demoting really changes it and writes the one row, with the real "before".
      await patch(t.owner, t.memberM.id, { role: 'MEMBER' }).expect(200);
      const rows = await roleRows(t.workspaceId, 'member.role_changed');
      expect(rows).toHaveLength(1);
      expect(rows[0]?.before).toMatchObject({ role: 'ADMIN' });
      expect(rows[0]?.after).toMatchObject({ role: 'MEMBER' });
    });

    it('removed meanwhile: 404, no role row, no removed row by this request', async () => {
      const t = await team();
      const spy = interceptOnce(app.get(TenantPrisma), 'membership', 'updateMany', () =>
        prisma.membership.delete({ where: { id: t.memberM.id } }),
      );

      const res = await patch(t.admin, t.memberM.id, { role: 'ADMIN' });
      spy.mockRestore();

      expect(res.status).toBe(404);
      expect(code(res)).toBe('NOT_FOUND');
      expect(await prisma.membership.count({ where: { id: t.memberM.id } })).toBe(0);
      expect(await roleRows(t.workspaceId, 'member.role_changed')).toHaveLength(0);
    });

    it('a failed history write rolls the role change back', async () => {
      const t = await team();
      const spy = interceptOnce(app.get(TenantPrisma), 'auditLog', 'create', async () => {
        throw new Error('history unavailable');
      });
      const res = await patch(t.admin, t.memberM.id, { role: 'ADMIN' });
      spy.mockRestore();
      expect(res.status).toBe(500);
      expect((await membershipOf(prisma, t.member.email, t.workspaceId)).role).toBe('MEMBER');
      expect(await roleRows(t.workspaceId, 'member.role_changed')).toHaveLength(0);
    });
  });

  describe('remove collision', () => {
    it('records the role the person had at deletion, even when it changed after the first read', async () => {
      const t = await team();
      await makeLead(prisma, t.workspaceId, { ownerId: t.memberM.userId });
      const spy = interceptOnce(app.get(TenantPrisma), 'lead', 'updateMany', () =>
        prisma.membership.update({ where: { id: t.memberM.id }, data: { role: 'ADMIN' } }),
      );

      await remove(t.owner, t.memberM.id).expect(204);
      spy.mockRestore();

      const rows = await roleRows(t.workspaceId, 'member.removed');
      expect(rows).toHaveLength(1);
      expect(rows[0]?.before).toMatchObject({ role: 'ADMIN' });
      expect(rows[0]?.after).toEqual({ unassignedLeads: 1 });
    });

    it('deleted by someone else after our first read: 404, no removed row, nothing half done', async () => {
      const t = await team();
      const lead = await makeLead(prisma, t.workspaceId, { ownerId: t.memberM.userId });
      // The parallel request removes the person completely (leads first, as the service does).
      const spy = interceptOnce(app.get(TenantPrisma), 'lead', 'updateMany', async () => {
        await prisma.lead.updateMany({
          where: { ownerId: t.memberM.userId },
          data: { ownerId: null },
        });
        await prisma.membership.delete({ where: { id: t.memberM.id } });
      });

      const res = await remove(t.owner, t.memberM.id);
      spy.mockRestore();

      expect(res.status).toBe(404);
      expect(code(res)).toBe('NOT_FOUND');
      expect(await roleRows(t.workspaceId, 'member.removed')).toHaveLength(0);
      expect((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).ownerId).toBeNull();
    });
  });

  describe('invite accept writes member.joined through a raw transaction', () => {
    it('carries the invite workspace, the new person as actor, and the membership as entity', async () => {
      const owner = await ownerOf(app);
      const workspaceId = await workspaceOf(prisma, owner.body.email);
      const email = inviteeAddress('joined');
      const token = await inviteAddress(app, owner, email, 'ADMIN');
      await http()
        .post('/auth/invites/accept')
        .send({ token, name: 'Joined Jo', password: 'a-long-enough-password-1' })
        .expect(200);

      const user = await prisma.user.findUniqueOrThrow({ where: { email } });
      const membership = await membershipOf(prisma, email, workspaceId);
      const joined = await roleRows(workspaceId, 'member.joined');
      expect(joined).toHaveLength(1);
      expect(joined[0]).toMatchObject({
        workspaceId,
        actorUserId: user.id,
        area: 'team',
        entityType: 'membership',
        entityId: membership.id,
        before: null,
        after: { email, role: 'ADMIN' },
      });
    });

    it('an existing account joining a second workspace writes the row only in that workspace', async () => {
      const a = await team();
      const b = await ownerOf(app, 'b-owner');
      const bId = await workspaceOf(prisma, b.body.email);
      const aRows = (await auditRows(prisma, a.workspaceId)).length;
      const token = await inviteAddress(app, b, a.member.email);
      await http()
        .post('/auth/invites/accept')
        .send({ token, password: a.member.password })
        .expect(200);

      const joined = await roleRows(bId, 'member.joined');
      expect(joined).toHaveLength(1);
      expect(joined[0]?.actorUserId).toBe(a.memberM.userId);
      expect(joined[0]?.workspaceId).toBe(bId);
      expect(await auditRows(prisma, a.workspaceId)).toHaveLength(aRows);
    });

    it('a failure after the history write rolls everything back: no user, membership or row', async () => {
      const owner = await ownerOf(app);
      const workspaceId = await workspaceOf(prisma, owner.body.email);
      const email = inviteeAddress('rollback');
      const token = await inviteAddress(app, owner, email);
      const joinedBefore = await roleRows(workspaceId, 'member.joined');
      // `issue` runs after the member.joined row is written, inside the same transaction.
      const issue = jest
        .spyOn(app.get(SessionService), 'issue')
        .mockRejectedValueOnce(new Error('sessions unavailable'));

      const failed = await http()
        .post('/auth/invites/accept')
        .send({ token, name: 'Roll Back', password: 'a-long-enough-password-1' });
      expect(issue).toHaveBeenCalledTimes(1);
      expect(failed.status).toBe(500);

      expect(await prisma.user.count({ where: { email } })).toBe(0);
      expect(await roleRows(workspaceId, 'member.joined')).toHaveLength(joinedBefore.length);
      expect(await prisma.membership.count({ where: { workspaceId } })).toBe(1);
      // The invite was not used up: the same link works on the next try.
      expect((await prisma.invite.findFirstOrThrow({ where: { email } })).acceptedAt).toBeNull();
      await http()
        .post('/auth/invites/accept')
        .send({ token, name: 'Roll Back', password: 'a-long-enough-password-1' })
        .expect(200);
      expect(await roleRows(workspaceId, 'member.joined')).toHaveLength(joinedBefore.length + 1);
    });
  });

  describe('invite reissue history', () => {
    it('records the old role in before and the new one in after', async () => {
      const owner = await ownerOf(app);
      const workspaceId = await workspaceOf(prisma, owner.body.email);
      const address = inviteeAddress('reissue');
      await inviteAddress(app, owner, address, 'ADMIN');
      await prisma.invite.updateMany({
        where: { email: address },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      const res = await http()
        .post('/invites')
        .set('authorization', bearer(owner))
        .send({ emails: [address], role: 'MEMBER' })
        .expect(201);
      expect(res.body.results).toEqual([{ email: address, status: 'invited' }]);

      const rows = await roleRows(workspaceId, 'invite.reissued');
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        actorUserId: expect.any(String),
        before: { email: address, role: 'ADMIN' },
        after: { email: address, role: 'MEMBER' },
      });
      // The reissue is not a second "created".
      expect(await roleRows(workspaceId, 'invite.created')).toHaveLength(1);
    });

    it('a reissue that loses to a parallel one writes no row', async () => {
      const owner = await ownerOf(app);
      const workspaceId = await workspaceOf(prisma, owner.body.email);
      const address = inviteeAddress('reissue-lost');
      await inviteAddress(app, owner, address, 'ADMIN');
      await prisma.invite.updateMany({
        where: { email: address },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      // The parallel winner renewed the invite between our read and our update.
      const spy = interceptOnce(app.get(TenantPrisma), 'invite', 'updateMany', () =>
        prisma.invite.updateMany({
          where: { email: address },
          data: { expiresAt: new Date(Date.now() + 3_600_000) },
        }),
      );
      const res = await http()
        .post('/invites')
        .set('authorization', bearer(owner))
        .send({ emails: [address], role: 'MEMBER' })
        .expect(201);
      spy.mockRestore();

      expect(res.body.results).toEqual([{ email: address, status: 'already_invited' }]);
      expect(await roleRows(workspaceId, 'invite.reissued')).toHaveLength(0);
      expect((await prisma.invite.findFirstOrThrow({ where: { email: address } })).role).toBe(
        'ADMIN',
      );
    });
  });
});
