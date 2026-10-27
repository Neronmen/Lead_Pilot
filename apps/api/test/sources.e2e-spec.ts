import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { CryptoService } from '../src/crypto/crypto.service';
import { hmacAad } from '../src/sources/sources.service';
import { PrismaClient } from '../src/generated/prisma/client';
import { apiKeyMatches, apiKeyPrefix } from '../src/sources/api-key';
import { createTestApp } from './utils/create-test-app';
import { INVITES_EMAIL_PREFIX, joinAs, ownerOf } from './utils/invites';
import { auditRows, workspaceOf } from './utils/workspace-data';

/** Lead sources and their credentials: who may, what is stored, and what is never shown again. */
describe('Sources (e2e)', () => {
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
  const create = (who: { accessToken: string }, body: unknown) =>
    http()
      .post('/sources')
      .set('authorization', bearer(who))
      .send(body as object);

  async function workspace() {
    const owner = await ownerOf(app);
    const admin = await joinAs(app, owner, 'ADMIN', 'admin');
    const member = await joinAs(app, owner, 'MEMBER', 'member');
    return { owner, admin, member, workspaceId: await workspaceOf(prisma, owner.body.email) };
  }

  async function lead(workspaceId: string, sourceId: string, ageDays = 0) {
    return prisma.lead.create({
      data: {
        workspaceId,
        sourceId,
        email: `lead-${randomBytes(5).toString('hex')}@example.com`,
        rawPayload: {},
        createdAt: new Date(Date.now() - ageDays * 86_400_000),
      },
    });
  }

  describe('who may', () => {
    it('owners and admins manage sources; a member gets 403 on every route', async () => {
      const t = await workspace();
      const made = await create(t.admin, { name: 'Website form', type: 'FORM' }).expect(201);
      const id = made.body.source.id as string;
      await http().get('/sources').set('authorization', bearer(t.owner)).expect(200);
      for (const res of [
        await http().get('/sources').set('authorization', bearer(t.member)),
        await create(t.member, { name: 'x', type: 'FORM' }),
        await http()
          .patch(`/sources/${id}`)
          .set('authorization', bearer(t.member))
          .send({ name: 'y' }),
        await http().delete(`/sources/${id}`).set('authorization', bearer(t.member)),
        await http().post(`/sources/${id}/api-key`).set('authorization', bearer(t.member)),
        await http().post(`/sources/${id}/hmac-secret`).set('authorization', bearer(t.member)),
        await http().delete(`/sources/${id}/hmac-secret`).set('authorization', bearer(t.member)),
      ]) {
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('FORBIDDEN');
      }
      const row = await prisma.source.findUniqueOrThrow({ where: { id } });
      expect(row.name).toBe('Website form');
      expect(row.hmacSecretEnc).toBeNull();
    });

    it('tells caches never to keep a response that carries a key or secret', async () => {
      const t = await workspace();
      const made = await create(t.owner, { name: 'Cache', type: 'WEBHOOK' }).expect(201);
      const id = made.body.source.id as string;
      expect(made.headers['cache-control']).toBe('no-store');
      const rotated = await http()
        .post(`/sources/${id}/api-key`)
        .set('authorization', bearer(t.owner));
      expect(rotated.headers['cache-control']).toBe('no-store');
      const secret = await http()
        .post(`/sources/${id}/hmac-secret`)
        .set('authorization', bearer(t.owner));
      expect(secret.headers['cache-control']).toBe('no-store');
    });

    it('answers 401 without a token', async () => {
      await http().get('/sources').expect(401);
      await http().post('/sources').send({ name: 'x', type: 'FORM' }).expect(401);
    });
  });

  describe('creating', () => {
    it('makes the source and a key that is shown once and stored only as a hash', async () => {
      const t = await workspace();
      const res = await create(t.owner, { name: '  Website form  ', type: 'FORM' }).expect(201);
      const { source, apiKey } = res.body as { source: Record<string, unknown>; apiKey: string };
      expect(source).toMatchObject({
        name: 'Website form',
        type: 'FORM',
        enabled: true,
        hmacEnabled: false,
        leadsLast30Days: 0,
        lastLeadAt: null,
      });
      expect(apiKey).toMatch(/^lp_[0-9a-f]{8}\.[A-Za-z0-9_-]{43}$/);
      expect(source.apiKeyPrefix).toBe(apiKeyPrefix(apiKey));

      const row = await prisma.source.findUniqueOrThrow({ where: { id: source.id as string } });
      expect(row.workspaceId).toBe(t.workspaceId);
      expect(row.apiKeyHash).not.toContain(apiKey);
      expect(JSON.stringify(row)).not.toContain(apiKey.split('.')[1]);
      expect(apiKeyMatches(apiKey, row.apiKeyHash)).toBe(true);
      expect(row.hmacSecretEnc).toBeNull();
    });

    it('shows the key in no later response', async () => {
      const t = await workspace();
      const made = await create(t.owner, { name: 'Zapier', type: 'WEBHOOK' }).expect(201);
      const secret = (made.body.apiKey as string).split('.')[1]!;
      const id = made.body.source.id as string;
      const responses = [
        await http().get('/sources').set('authorization', bearer(t.owner)),
        await http()
          .patch(`/sources/${id}`)
          .set('authorization', bearer(t.owner))
          .send({ enabled: false }),
      ];
      for (const res of responses) {
        expect(JSON.stringify(res.body)).not.toContain(secret);
        expect(JSON.stringify(res.body)).not.toContain('apiKeyHash');
        expect(JSON.stringify(res.body)).not.toContain('hmacSecretEnc');
      }
    });

    it('gives two sources two different keys', async () => {
      const t = await workspace();
      const a = await create(t.owner, { name: 'A', type: 'FORM' }).expect(201);
      const b = await create(t.owner, { name: 'B', type: 'FORM' }).expect(201);
      expect(a.body.apiKey).not.toBe(b.body.apiKey);
      expect(a.body.source.apiKeyPrefix).not.toBe(b.body.source.apiKeyPrefix);
    });

    it.each([
      [{}],
      [{ name: '', type: 'FORM' }],
      [{ name: '   ', type: 'FORM' }],
      [{ name: 'x'.repeat(101), type: 'FORM' }],
      [{ name: 'line\nbreak', type: 'FORM' }],
      [{ name: 'zero​width', type: 'FORM' }],
      [{ name: 'ok', type: 'EMAIL' }],
      [{ name: 'ok' }],
      [{ name: 'ok', type: 'FORM', enabled: false }],
      [{ name: 'ok', type: 'FORM', apiKeyHash: 'x' }],
      [{ name: 'ok', type: 'FORM', workspaceId: '00000000-0000-4000-8000-000000000000' }],
      [{ name: 42, type: 'FORM' }],
    ])('refuses the body %j with 400', async (body) => {
      const t = await workspace();
      const res = await create(t.owner, body).expect(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      expect(await prisma.source.count({ where: { workspaceId: t.workspaceId } })).toBe(0);
    });

    it('accepts names in other scripts', async () => {
      const t = await workspace();
      await create(t.owner, { name: 'Biểu mẫu website', type: 'FORM' }).expect(201);
    });

    it('writes one history row with the name and type and no key', async () => {
      const t = await workspace();
      const made = await create(t.owner, { name: 'Website form', type: 'FORM' }).expect(201);
      const rows = (await auditRows(prisma, t.workspaceId)).filter(
        (r) => r.entityType === 'source',
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        area: 'sources',
        action: 'source.created',
        actorUserId: expect.any(String),
        entityId: made.body.source.id,
        after: { name: 'Website form', type: 'FORM' },
      });
      expect(JSON.stringify(rows)).not.toContain((made.body.apiKey as string).split('.')[1]);
    });
  });

  describe('listing', () => {
    it('shows the leads of the last 30 days and the last lead, per source', async () => {
      const t = await workspace();
      const busy = await create(t.owner, { name: 'Busy', type: 'WEBHOOK' }).expect(201);
      const quiet = await create(t.owner, { name: 'Quiet', type: 'FORM' }).expect(201);
      const busyId = busy.body.source.id as string;
      await lead(t.workspaceId, busyId, 0);
      await lead(t.workspaceId, busyId, 10);
      const old = await lead(t.workspaceId, busyId, 45);
      const oldQuiet = await lead(t.workspaceId, quiet.body.source.id, 60);
      const res = await http().get('/sources').set('authorization', bearer(t.owner)).expect(200);
      type Row = { id: string; leadsLast30Days: number; lastLeadAt: string | null };
      const byId = new Map((res.body as Row[]).map((s) => [s.id, s]));
      expect(byId.get(busyId)).toMatchObject({ leadsLast30Days: 2 });
      const latest = byId.get(busyId)!.lastLeadAt!;
      expect(Date.now() - new Date(latest).getTime()).toBeLessThan(60_000);
      expect(old.id).toBeTruthy();
      expect(byId.get(quiet.body.source.id)).toMatchObject({
        leadsLast30Days: 0,
        lastLeadAt: oldQuiet.createdAt.toISOString(),
      });
    });

    it('lists oldest first', async () => {
      const t = await workspace();
      await create(t.owner, { name: 'First', type: 'FORM' }).expect(201);
      await create(t.owner, { name: 'Second', type: 'FORM' }).expect(201);
      const res = await http().get('/sources').set('authorization', bearer(t.owner)).expect(200);
      expect((res.body as Array<{ name: string }>).map((s) => s.name)).toEqual(['First', 'Second']);
    });
  });

  describe('changing', () => {
    it('renames and switches off, each with one history row; a no-op writes none', async () => {
      const t = await workspace();
      const made = await create(t.owner, { name: 'Old name', type: 'FORM' }).expect(201);
      const id = made.body.source.id as string;
      const patch = (body: unknown) =>
        http()
          .patch(`/sources/${id}`)
          .set('authorization', bearer(t.admin))
          .send(body as object);
      expect((await patch({ name: ' New name ' }).expect(200)).body).toMatchObject({
        name: 'New name',
        enabled: true,
      });
      expect((await patch({ enabled: false }).expect(200)).body).toMatchObject({
        name: 'New name',
        enabled: false,
      });
      await patch({ enabled: false }).expect(200); // already off
      await patch({ name: 'New name' }).expect(200); // same name
      const rows = (await auditRows(prisma, t.workspaceId)).filter(
        (r) => r.action === 'source.updated',
      );
      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({
        before: { name: 'Old name', enabled: true },
        after: { name: 'New name', enabled: true },
      });
      expect(rows[1]).toMatchObject({ before: { enabled: true }, after: { enabled: false } });
    });

    it.each([[{}], [{ name: '' }], [{ enabled: 'yes' }], [{ type: 'CSV' }], [{ apiKeyHash: 'x' }]])(
      'refuses the body %j',
      async (body) => {
        const t = await workspace();
        const made = await create(t.owner, { name: 'N', type: 'FORM' }).expect(201);
        await http()
          .patch(`/sources/${made.body.source.id}`)
          .set('authorization', bearer(t.owner))
          .send(body as object)
          .expect(400);
      },
    );

    it('answers 404 for an unknown id and 400 for a malformed one', async () => {
      const t = await workspace();
      const unknown = crypto.randomUUID();
      for (const res of [
        await http()
          .patch(`/sources/${unknown}`)
          .set('authorization', bearer(t.owner))
          .send({ name: 'x' }),
        await http().delete(`/sources/${unknown}`).set('authorization', bearer(t.owner)),
        await http().post(`/sources/${unknown}/api-key`).set('authorization', bearer(t.owner)),
        await http().post(`/sources/${unknown}/hmac-secret`).set('authorization', bearer(t.owner)),
        await http()
          .delete(`/sources/${unknown}/hmac-secret`)
          .set('authorization', bearer(t.owner)),
      ]) {
        expect(res.status).toBe(404);
        expect(res.body.error.code).toBe('NOT_FOUND');
      }
      await http().delete('/sources/not-a-uuid').set('authorization', bearer(t.owner)).expect(400);
    });
  });

  describe('deleting', () => {
    it('deletes a source without leads, and says why not when it has leads', async () => {
      const t = await workspace();
      const empty = await create(t.owner, { name: 'Empty', type: 'FORM' }).expect(201);
      const used = await create(t.owner, { name: 'Used', type: 'FORM' }).expect(201);
      await lead(t.workspaceId, used.body.source.id);

      await http()
        .delete(`/sources/${empty.body.source.id}`)
        .set('authorization', bearer(t.owner))
        .expect(204);
      expect(await prisma.source.count({ where: { id: empty.body.source.id } })).toBe(0);

      const refused = await http()
        .delete(`/sources/${used.body.source.id}`)
        .set('authorization', bearer(t.owner))
        .expect(409);
      expect(refused.body.error.code).toBe('SOURCE_HAS_LEADS');
      expect(await prisma.source.count({ where: { id: used.body.source.id } })).toBe(1);

      const rows = (await auditRows(prisma, t.workspaceId)).filter(
        (r) => r.action === 'source.deleted',
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        entityId: empty.body.source.id,
        before: { name: 'Empty', type: 'FORM' },
      });
    });

    it('a lead arriving while the source is being deleted: the source stays, never a 500', async () => {
      for (let i = 0; i < 4; i += 1) {
        const t = await workspace();
        const made = await create(t.owner, { name: 'Race', type: 'WEBHOOK' }).expect(201);
        const id = made.body.source.id as string;
        const [removed] = await Promise.all([
          http().delete(`/sources/${id}`).set('authorization', bearer(t.owner)),
          lead(t.workspaceId, id).catch(() => null), // refused by the foreign key when the delete won
        ]);
        expect([204, 409]).toContain(removed.status);
        const left = await prisma.source.count({ where: { id } });
        const leads = await prisma.lead.count({ where: { sourceId: id } });
        // Never a lead without its source, and never a source deleted while it had a lead.
        expect(left === 1 || leads === 0).toBe(true);
        if (removed.status === 204) expect(left).toBe(0);
      }
    });
  });

  describe('API keys', () => {
    it('a new key replaces the old one at once and is shown once', async () => {
      const t = await workspace();
      const made = await create(t.owner, { name: 'Form', type: 'FORM' }).expect(201);
      const id = made.body.source.id as string;
      const before = await prisma.source.findUniqueOrThrow({ where: { id } });

      const rotated = await http()
        .post(`/sources/${id}/api-key`)
        .set('authorization', bearer(t.admin))
        .expect(200);
      const fresh = rotated.body.apiKey as string;
      expect(fresh).not.toBe(made.body.apiKey);
      const after = await prisma.source.findUniqueOrThrow({ where: { id } });
      expect(after.apiKeyHash).not.toBe(before.apiKeyHash);
      expect(apiKeyMatches(fresh, after.apiKeyHash)).toBe(true);
      expect(apiKeyMatches(made.body.apiKey, after.apiKeyHash)).toBe(false);
      expect(rotated.body.source.apiKeyPrefix).toBe(apiKeyPrefix(fresh));

      const rows = (await auditRows(prisma, t.workspaceId)).filter(
        (r) => r.action === 'source.key_rotated',
      );
      expect(rows).toHaveLength(1);
      expect(JSON.stringify(rows)).not.toContain(fresh.split('.')[1]);
    });
  });

  describe('request signing (HMAC)', () => {
    it('makes a secret that is shown once and stored encrypted', async () => {
      const t = await workspace();
      const made = await create(t.owner, { name: 'Signed', type: 'WEBHOOK' }).expect(201);
      const id = made.body.source.id as string;
      const res = await http()
        .post(`/sources/${id}/hmac-secret`)
        .set('authorization', bearer(t.owner))
        .expect(201);
      const secret = res.body.secret as string;
      expect(secret).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/);

      const row = await prisma.source.findUniqueOrThrow({ where: { id } });
      expect(row.hmacSecretEnc).toMatch(/^v1:/);
      expect(row.hmacSecretEnc).not.toContain(secret);
      expect(
        app.get(CryptoService).decrypt(row.hmacSecretEnc!, hmacAad(row.workspaceId, row.id)),
      ).toBe(secret);
      // Bound to its row: the same ciphertext does not decrypt as another source's.
      expect(() =>
        app
          .get(CryptoService)
          .decrypt(row.hmacSecretEnc!, hmacAad(row.workspaceId, crypto.randomUUID())),
      ).toThrow();

      const list = await http().get('/sources').set('authorization', bearer(t.owner)).expect(200);
      expect(
        (list.body as Array<{ id: string; hmacEnabled: boolean }>).find((s) => s.id === id)
          ?.hmacEnabled,
      ).toBe(true);
      expect(JSON.stringify(list.body)).not.toContain(secret);
      expect(JSON.stringify(list.body)).not.toContain(row.hmacSecretEnc!);

      const rows = (await auditRows(prisma, t.workspaceId)).filter(
        (r) => r.action === 'source.hmac_enabled',
      );
      expect(rows).toHaveLength(1);
      expect(JSON.stringify(rows)).not.toContain(secret);
    });

    it('is refused a second time (HMAC_ALREADY_ENABLED) and the secret is not replaced', async () => {
      const t = await workspace();
      const made = await create(t.owner, { name: 'Signed', type: 'WEBHOOK' }).expect(201);
      const id = made.body.source.id as string;
      const first = await http()
        .post(`/sources/${id}/hmac-secret`)
        .set('authorization', bearer(t.owner))
        .expect(201);
      const stored = (await prisma.source.findUniqueOrThrow({ where: { id } })).hmacSecretEnc;
      const second = await http()
        .post(`/sources/${id}/hmac-secret`)
        .set('authorization', bearer(t.owner))
        .expect(409);
      expect(second.body.error.code).toBe('HMAC_ALREADY_ENABLED');
      expect(JSON.stringify(second.body)).not.toContain(first.body.secret);
      expect((await prisma.source.findUniqueOrThrow({ where: { id } })).hmacSecretEnc).toBe(stored);
    });

    it('two requests at once make exactly one secret', async () => {
      for (let i = 0; i < 4; i += 1) {
        const t = await workspace();
        const made = await create(t.owner, { name: 'Race', type: 'WEBHOOK' }).expect(201);
        const id = made.body.source.id as string;
        const [a, b] = await Promise.all([
          http().post(`/sources/${id}/hmac-secret`).set('authorization', bearer(t.owner)),
          http().post(`/sources/${id}/hmac-secret`).set('authorization', bearer(t.admin)),
        ]);
        expect([a.status, b.status].sort()).toEqual([201, 409]);
        const winner = a.status === 201 ? a : b;
        const row = await prisma.source.findUniqueOrThrow({ where: { id } });
        expect(
          app.get(CryptoService).decrypt(row.hmacSecretEnc!, hmacAad(row.workspaceId, row.id)),
        ).toBe(winner.body.secret);
        const rows = (await auditRows(prisma, t.workspaceId)).filter(
          (r) => r.action === 'source.hmac_enabled',
        );
        expect(rows).toHaveLength(1);
      }
    });

    it('switching it off deletes the secret, and a new one can be made after', async () => {
      const t = await workspace();
      const made = await create(t.owner, { name: 'Signed', type: 'WEBHOOK' }).expect(201);
      const id = made.body.source.id as string;
      const first = await http()
        .post(`/sources/${id}/hmac-secret`)
        .set('authorization', bearer(t.owner))
        .expect(201);
      await http()
        .delete(`/sources/${id}/hmac-secret`)
        .set('authorization', bearer(t.owner))
        .expect(204);
      expect((await prisma.source.findUniqueOrThrow({ where: { id } })).hmacSecretEnc).toBeNull();
      await http()
        .delete(`/sources/${id}/hmac-secret`)
        .set('authorization', bearer(t.owner))
        .expect(204); // already off
      const again = await http()
        .post(`/sources/${id}/hmac-secret`)
        .set('authorization', bearer(t.owner))
        .expect(201);
      expect(again.body.secret).not.toBe(first.body.secret);
      const rows = (await auditRows(prisma, t.workspaceId)).filter((r) =>
        r.action.startsWith('source.hmac'),
      );
      expect(rows.map((r) => r.action)).toEqual([
        'source.hmac_enabled',
        'source.hmac_disabled',
        'source.hmac_enabled',
      ]);
    });
  });

  describe('hardening', () => {
    it('refuses odd names: control characters, invisible characters, lone surrogates, only spaces', async () => {
      const t = await workspace();
      const names = [
        'tab\there',
        'nul\u0000byte',
        'bidi‮override',
        'sep line',
        'para line',
        'bom﻿name',
        'soft­hyphen',
        'privateuse',
        'lone\uD800surrogate',
        '　　',
        ' ',
      ];
      for (const name of names) {
        const res = await create(t.owner, { name, type: 'FORM' });
        expect([name, res.status]).toEqual([name, 400]);
      }
      expect(await prisma.source.count({ where: { workspaceId: t.workspaceId } })).toBe(0);
    });

    it('keeps accepted unicode names as they are (emoji, combining marks, right-to-left)', async () => {
      const t = await workspace();
      for (const name of ['Form 🚀', 'école', 'مرحبا', '日本語のフォーム', '<b>x</b>']) {
        const res = await create(t.owner, { name, type: 'FORM' }).expect(201);
        expect(res.body.source.name).toBe(name);
      }
    });

    it('accepts a name of exactly 100 characters and refuses 101', async () => {
      const t = await workspace();
      await create(t.owner, { name: 'n'.repeat(100), type: 'FORM' }).expect(201);
      await create(t.owner, { name: 'n'.repeat(101), type: 'FORM' }).expect(400);
    });

    it('refuses bodies that are not an object, broken JSON, and a __proto__ key', async () => {
      const t = await workspace();
      const raws = [
        '[]',
        'null',
        '"text"',
        '42',
        '{"name":"x","type":"FORM","__proto__":{"a":1}}',
        '{"name":',
      ];
      for (const raw of raws) {
        const res = await http()
          .post('/sources')
          .set('authorization', bearer(t.owner))
          .set('content-type', 'application/json')
          .send(raw);
        expect([raw, res.status]).toEqual([raw, 400]);
        expect(res.body.error?.code).toEqual(expect.any(String));
      }
      const wrongType = await http()
        .post('/sources')
        .set('authorization', bearer(t.owner))
        .set('content-type', 'text/plain')
        .send('name=x');
      expect(wrongType.status).toBe(400);
      expect(await prisma.source.count({ where: { workspaceId: t.workspaceId } })).toBe(0);
    });

    it('refuses a huge body with a 4xx in the error format, never a 500', async () => {
      const t = await workspace();
      const res = await create(t.owner, { name: 'x', type: 'FORM', junk: 'j'.repeat(3_000_000) });
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
      expect(res.body.error?.code).toEqual(expect.any(String));
    });

    it('an uppercase uuid is never a way into another workspace', async () => {
      const a = await workspace();
      const b = await workspace();
      const made = await create(a.owner, { name: 'U', type: 'FORM' }).expect(201);
      const id = (made.body.source.id as string).toUpperCase();
      const res = await http()
        .post(`/sources/${id}/api-key`)
        .set('authorization', bearer(b.owner))
        .send({ workspaceId: a.workspaceId });
      expect([400, 404]).toContain(res.status);
      const row = await prisma.source.findUniqueOrThrow({ where: { id: made.body.source.id } });
      expect(apiKeyMatches(made.body.apiKey, row.apiKeyHash)).toBe(true);
    });

    it('rotating twice at once leaves exactly one working key', async () => {
      for (let i = 0; i < 3; i += 1) {
        const t = await workspace();
        const made = await create(t.owner, { name: 'Rot', type: 'FORM' }).expect(201);
        const id = made.body.source.id as string;
        const [a, b] = await Promise.all([
          http().post(`/sources/${id}/api-key`).set('authorization', bearer(t.owner)),
          http().post(`/sources/${id}/api-key`).set('authorization', bearer(t.admin)),
        ]);
        expect([a.status, b.status]).toEqual([200, 200]);
        const row = await prisma.source.findUniqueOrThrow({ where: { id } });
        const matching = [a, b].filter((r) => apiKeyMatches(r.body.apiKey, row.apiKeyHash));
        expect(matching).toHaveLength(1);
        expect(row.apiKeyPrefix).toBe(apiKeyPrefix(matching[0]!.body.apiKey));
        expect(apiKeyMatches(made.body.apiKey, row.apiKeyHash)).toBe(false);
        const rotated = (await auditRows(prisma, t.workspaceId)).filter(
          (r) => r.action === 'source.key_rotated',
        );
        expect(rotated).toHaveLength(2);
      }
    });

    it('rotating while deleting: one outcome, never a 500', async () => {
      for (let i = 0; i < 3; i += 1) {
        const t = await workspace();
        const made = await create(t.owner, { name: 'RD', type: 'FORM' }).expect(201);
        const id = made.body.source.id as string;
        const [rot, del] = await Promise.all([
          http().post(`/sources/${id}/api-key`).set('authorization', bearer(t.owner)),
          http().delete(`/sources/${id}`).set('authorization', bearer(t.admin)),
        ]);
        expect([200, 404]).toContain(rot.status);
        expect(del.status).toBe(204);
        expect(await prisma.source.count({ where: { id } })).toBe(0);
      }
    });

    it('switching signing on and off at once: the history agrees with the final state', async () => {
      for (let i = 0; i < 4; i += 1) {
        const t = await workspace();
        const made = await create(t.owner, { name: 'Sw', type: 'WEBHOOK' }).expect(201);
        const id = made.body.source.id as string;
        await http()
          .post(`/sources/${id}/hmac-secret`)
          .set('authorization', bearer(t.owner))
          .expect(201);
        const [off, on] = await Promise.all([
          http().delete(`/sources/${id}/hmac-secret`).set('authorization', bearer(t.owner)),
          http().post(`/sources/${id}/hmac-secret`).set('authorization', bearer(t.admin)),
        ]);
        expect(off.status).toBe(204);
        expect([201, 409]).toContain(on.status);
        const row = await prisma.source.findUniqueOrThrow({ where: { id } });
        if (on.status === 201) {
          expect(
            app.get(CryptoService).decrypt(row.hmacSecretEnc!, hmacAad(row.workspaceId, row.id)),
          ).toBe(on.body.secret);
        }
        const actions = (await auditRows(prisma, t.workspaceId))
          .filter((r) => r.action.startsWith('source.hmac'))
          .map((r) => r.action);
        const enabled = actions.filter((a) => a === 'source.hmac_enabled').length;
        const disabled = actions.filter((a) => a === 'source.hmac_disabled').length;
        expect(enabled - disabled).toBe(row.hmacSecretEnc ? 1 : 0);
      }
    });

    it('renaming and switching off at once keeps both changes', async () => {
      const t = await workspace();
      const made = await create(t.owner, { name: 'Both', type: 'FORM' }).expect(201);
      const id = made.body.source.id as string;
      const [a, b] = await Promise.all([
        http()
          .patch(`/sources/${id}`)
          .set('authorization', bearer(t.owner))
          .send({ name: 'Renamed' }),
        http()
          .patch(`/sources/${id}`)
          .set('authorization', bearer(t.admin))
          .send({ enabled: false }),
      ]);
      expect([a.status, b.status]).toEqual([200, 200]);
      const row = await prisma.source.findUniqueOrThrow({ where: { id } });
      expect(row).toMatchObject({ name: 'Renamed', enabled: false });
    });

    it('deleting a source leaves no key or secret in its history', async () => {
      const t = await workspace();
      const made = await create(t.owner, { name: 'Gone', type: 'FORM' }).expect(201);
      const id = made.body.source.id as string;
      const hmac = await http()
        .post(`/sources/${id}/hmac-secret`)
        .set('authorization', bearer(t.owner))
        .expect(201);
      await http().delete(`/sources/${id}`).set('authorization', bearer(t.owner)).expect(204);
      const text = JSON.stringify(await auditRows(prisma, t.workspaceId));
      expect(text).not.toContain((made.body.apiKey as string).split('.')[1]);
      expect(text).not.toContain((hmac.body.secret as string).slice(7));
      expect(text).not.toContain('hmacSecretEnc');
      expect(text).not.toContain('apiKeyHash');
      const list = await http().get('/sources').set('authorization', bearer(t.owner)).expect(200);
      expect(list.body).toEqual([]);
    });

    it('error responses never carry a key, a hash or a stored secret, and do not echo input', async () => {
      const t = await workspace();
      const made = await create(t.owner, { name: 'Err', type: 'FORM' }).expect(201);
      const id = made.body.source.id as string;
      const hmac = await http()
        .post(`/sources/${id}/hmac-secret`)
        .set('authorization', bearer(t.owner))
        .expect(201);
      const row = await prisma.source.findUniqueOrThrow({ where: { id } });
      const echoed = 'ECHO-CANARY-9f3a';
      const responses = [
        await http().post(`/sources/${id}/hmac-secret`).set('authorization', bearer(t.owner)),
        await http()
          .patch(`/sources/${id}`)
          .set('authorization', bearer(t.owner))
          .send({ apiKeyHash: echoed }),
        await create(t.owner, { name: made.body.apiKey, type: 'EMAIL' }),
        await http().post(`/sources/${id}/api-key`).set('authorization', bearer(t.member)),
      ];
      for (const res of responses) {
        const text = JSON.stringify(res.body);
        expect(text).not.toContain(hmac.body.secret);
        expect(text).not.toContain(row.hmacSecretEnc!);
        expect(text).not.toContain(row.apiKeyHash);
        expect(text).not.toContain((made.body.apiKey as string).split('.')[1]);
      }
      expect(JSON.stringify(responses[1]!.body)).not.toContain(echoed);
    });

    it('the API document has no route that reads a key or a secret back', async () => {
      const doc = await http().get('/docs-json').expect(200);
      const text = JSON.stringify(doc.body.paths ?? {});
      expect(text).not.toContain('apiKeyHash');
      expect(text).not.toContain('hmacSecretEnc');
      expect(doc.body.paths['/sources/{id}/api-key']?.get).toBeUndefined();
      expect(doc.body.paths['/sources/{id}/hmac-secret']?.get).toBeUndefined();
    });
  });

  describe('another workspace', () => {
    it('can neither see nor change this workspace’s sources (404, nothing changes)', async () => {
      const a = await workspace();
      const b = await workspace();
      const made = await create(a.owner, { name: 'Mine', type: 'FORM' }).expect(201);
      const id = made.body.source.id as string;
      await http()
        .post(`/sources/${id}/hmac-secret`)
        .set('authorization', bearer(a.owner))
        .expect(201);
      const before = await prisma.source.findUniqueOrThrow({ where: { id } });
      for (const res of [
        await http()
          .patch(`/sources/${id}`)
          .set('authorization', bearer(b.admin))
          .send({ name: 'Stolen', enabled: false }),
        await http().post(`/sources/${id}/api-key`).set('authorization', bearer(b.admin)),
        await http().post(`/sources/${id}/hmac-secret`).set('authorization', bearer(b.owner)),
        await http().delete(`/sources/${id}/hmac-secret`).set('authorization', bearer(b.owner)),
        await http().delete(`/sources/${id}`).set('authorization', bearer(b.owner)),
      ]) {
        expect(res.status).toBe(404);
      }
      expect(await prisma.source.findUniqueOrThrow({ where: { id } })).toEqual(before);
      const list = await http().get('/sources').set('authorization', bearer(b.owner)).expect(200);
      expect(list.body).toEqual([]);
    });
  });
});
