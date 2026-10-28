import { createHmac, randomBytes } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaPg } from '@prisma/adapter-pg';
import request from 'supertest';
import { PrismaClient } from '../src/generated/prisma/client';
import { IngestLimits } from '../src/ingest/ingest.service';
import { createTestApp } from './utils/create-test-app';
import { INVITES_EMAIL_PREFIX, ownerOf } from './utils/invites';
import { workspaceOf } from './utils/workspace-data';

/** The public ingest endpoint: one test per security property, plus the happy path. */
describe('Ingest (e2e)', () => {
  let app: NestExpressApplication;
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    const limits = app.get(IngestLimits);
    await limits.perSource.reset();
    await limits.failedAuthPerIp.reset();
    limits.perSource.limit = 1000;
    limits.failedAuthPerIp.limit = 1000;
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
  const email = () => `lead-${randomBytes(5).toString('hex')}@acme-test.com`;

  /** A workspace with one source; `key` is its API key. */
  async function setup(opts: { signed?: boolean; country?: string } = {}) {
    const owner = await ownerOf(app);
    const workspaceId = await workspaceOf(prisma, owner.body.email);
    if (opts.country) {
      await prisma.workspace.update({
        where: { id: workspaceId },
        data: { defaultCountry: opts.country },
      });
    }
    const made = await api()
      .post('/sources')
      .set('authorization', `Bearer ${owner.accessToken}`)
      .send({ name: 'Webhook', type: 'WEBHOOK' })
      .expect(201);
    const sourceId = made.body.source.id as string;
    let secret: string | undefined;
    if (opts.signed) {
      const res = await api()
        .post(`/sources/${sourceId}/hmac-secret`)
        .set('authorization', `Bearer ${owner.accessToken}`)
        .expect(201);
      secret = res.body.secret as string;
    }
    return { owner, workspaceId, sourceId, key: made.body.apiKey as string, secret };
  }
  type Setup = Awaited<ReturnType<typeof setup>>;

  const send = (
    t: { sourceId: string; key: string },
    body: unknown,
    headers: Record<string, string> = {},
  ) =>
    api()
      .post(`/v1/ingest/${t.sourceId}`)
      .set('authorization', `Bearer ${t.key}`)
      .set('content-type', 'application/json')
      .set(headers)
      .send(typeof body === 'string' ? body : JSON.stringify(body));

  const sign = (secret: string, body: string, timestamp = Math.floor(Date.now() / 1000)) => ({
    'x-timestamp': String(timestamp),
    'x-signature': `sha256=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`,
  });

  const leadsOf = (workspaceId: string) => prisma.lead.findMany({ where: { workspaceId } });

  describe('a lead arrives', () => {
    it('is created, normalized, and kept raw with an "ingested" event', async () => {
      const t = await setup({ country: 'VN' });
      const address = email();
      const body = {
        email: ` ${address.toUpperCase()} `,
        phone: '0901 234 567',
        name: 'Ann Lee',
        loyalty: 5000,
      };
      const res = await send(t, body).expect(201);
      expect(res.body).toEqual({ leadId: expect.any(String), result: 'created' });

      const lead = await prisma.lead.findUniqueOrThrow({ where: { id: res.body.leadId } });
      expect(lead).toMatchObject({
        workspaceId: t.workspaceId,
        sourceId: t.sourceId,
        email: address,
        phone: '+84901234567',
        firstName: 'Ann',
        lastName: 'Lee',
        customFields: { loyalty: 5000 },
        rawPayload: body,
      });
      const events = await prisma.leadEvent.findMany({ where: { leadId: lead.id } });
      expect(events.map((e) => e.type)).toEqual(['ingested']);
    });

    it('merges into the lead with the same email (200), keeping the newest non-empty values', async () => {
      const t = await setup();
      const address = email();
      const first = await send(t, { email: address, firstName: 'Ann', company: 'Acme' }).expect(
        201,
      );
      const second = await send(t, {
        email: address.toUpperCase(),
        company: 'Acme Inc',
        phone: '+84901234567',
      }).expect(200);
      expect(second.body).toEqual({ leadId: first.body.leadId, result: 'merged' });

      expect(await leadsOf(t.workspaceId)).toHaveLength(1);
      const lead = await prisma.lead.findUniqueOrThrow({ where: { id: first.body.leadId } });
      expect(lead).toMatchObject({ firstName: 'Ann', company: 'Acme Inc', phone: '+84901234567' });
      const merged = await prisma.leadEvent.findFirstOrThrow({
        where: { leadId: lead.id, type: 'merged' },
      });
      const { matchedBy, changed } = merged.payload as { matchedBy: string; changed: string[] };
      expect(matchedBy).toBe('email');
      expect(changed.sort()).toEqual(['company', 'phone']);
    });

    it('merges on phone only when the submission has no email; never across workspaces', async () => {
      const a = await setup();
      const b = await setup();
      const first = await send(a, { phone: '+84901234567', firstName: 'Ann' }).expect(201);
      const same = await send(a, { phone: '+84 901 234 567', company: 'Acme' }).expect(200);
      expect(same.body.leadId).toBe(first.body.leadId);
      // The same phone in another workspace is a different lead.
      const other = await send(b, { phone: '+84901234567' }).expect(201);
      expect(other.body.leadId).not.toBe(first.body.leadId);
    });

    it('same phone with a different email is NOT merged: a separate lead flagged as a possible duplicate', async () => {
      const t = await setup();
      const first = await send(t, { email: 'ann@gmail.com', phone: '+84901234567' }).expect(201);
      const second = await send(t, { email: email(), phone: '+84 901 234 567' }).expect(201);
      expect(second.body.leadId).not.toBe(first.body.leadId);

      const created = await prisma.lead.findUniqueOrThrow({ where: { id: second.body.leadId } });
      expect(created.possibleDuplicateOfId).toBe(first.body.leadId);
      const older = await prisma.lead.findUniqueOrThrow({ where: { id: first.body.leadId } });
      expect(older).toMatchObject({
        email: 'ann@gmail.com',
        isFreeMail: true,
        possibleDuplicateOfId: null,
      });
      for (const [leadId, other] of [
        [created.id, 'ofLeadId'],
        [older.id, 'newLeadId'],
      ] as const) {
        const events = await prisma.leadEvent.findMany({
          where: { leadId, type: 'possible_duplicate' },
        });
        expect(events).toHaveLength(1);
        expect(events[0]!.payload).toMatchObject({
          [other]: leadId === created.id ? older.id : created.id,
        });
      }
      // A phone-only submission afterwards merges into the OLDER lead and keeps its email and flag.
      const third = await send(t, { phone: '+84901234567' }).expect(200);
      expect(third.body.leadId).toBe(first.body.leadId);
      expect(
        await prisma.lead.findUniqueOrThrow({ where: { id: first.body.leadId } }),
      ).toMatchObject({
        email: 'ann@gmail.com',
        isFreeMail: true,
      });
    });

    it('a phone-only merge fills blanks only: it never overwrites another person on a shared line', async () => {
      const t = await setup();
      const first = await send(t, {
        phone: '+84901234567',
        firstName: 'Alice',
        company: 'Acme',
      }).expect(201);
      await send(t, {
        phone: '+84901234567',
        firstName: 'Bob',
        company: 'Other',
        country: 'VN',
      }).expect(200);
      const lead = await prisma.lead.findUniqueOrThrow({ where: { id: first.body.leadId } });
      expect(lead).toMatchObject({ firstName: 'Alice', company: 'Acme', country: 'VN' });
      // Bob's submission is still on the timeline, raw.
      const events = await prisma.leadEvent.findMany({
        where: { leadId: lead.id, type: 'ingested' },
      });
      expect(events).toHaveLength(2);
    });

    it('every submission keeps its own timeline event with its own raw payload and time, merged or not', async () => {
      const t = await setup();
      const address = email();
      const first = await send(t, { email: address, note: 'first' }).expect(201);
      await send(t, { email: address, note: 'second', phone: '+84901234567' }).expect(200);
      await send(t, { email: address, note: 'third' }).expect(200);
      const events = await prisma.leadEvent.findMany({
        where: { leadId: first.body.leadId },
        orderBy: { createdAt: 'asc' },
      });
      const ingested = events.filter((e) => e.type === 'ingested');
      expect(
        ingested.map((e) => (e.payload as { rawPayload: { note: string } }).rawPayload.note),
      ).toEqual(['first', 'second', 'third']);
      expect(new Set(ingested.map((e) => e.createdAt.getTime())).size).toBe(3);
      expect(events.filter((e) => e.type === 'merged')).toHaveLength(2);
      // The lead itself keeps only the latest payload; the earlier ones live on the timeline.
      const lead = await prisma.lead.findUniqueOrThrow({ where: { id: first.body.leadId } });
      expect((lead.rawPayload as { note: string }).note).toBe('third');
    });

    it('counts what happened per source: received = created + merged + rejected, replays apart', async () => {
      const t = await setup();
      const auth = { authorization: `Bearer ${t.owner.accessToken}` };
      const address = email();
      await send(t, { email: address }).expect(201);
      await send(t, { email: address }).expect(200);
      await send(t, { email: 'x@mailinator.com' }).expect(400);
      await send(t, { email: 'y@mailinator.com' }).expect(400);
      await send(t, { name: 'no contact' }).expect(400);
      await send(t, { email: email() }, { 'idempotency-key': 'k1' }).expect(201);
      await send(t, { email: email() }, { 'idempotency-key': 'k1' }).expect(422); // different body
      const body = { email: email() };
      await send(t, body, { 'idempotency-key': 'k2' }).expect(201);
      await send(t, body, { 'idempotency-key': 'k2' }).expect(201); // a replay
      await send({ sourceId: t.sourceId, key: `${t.key}x` }, { email: email() }).expect(401); // not counted

      const list = await api().get('/sources').set(auth).expect(200);
      const stats = (list.body as Array<{ id: string; last30Days: Record<string, unknown> }>).find(
        (s) => s.id === t.sourceId,
      )!.last30Days;
      expect(stats).toMatchObject({
        received: 8, // 3 created + 1 merged + 4 rejected
        created: 3,
        merged: 1,
        rejected: 4,
        replayed: 1,
        topRejections: [
          { reason: 'disposable_email', count: 2 },
          expect.objectContaining({ count: 1 }),
          expect.objectContaining({ count: 1 }),
        ],
      });
    });

    it('two submissions of one email at once make one lead', async () => {
      const t = await setup();
      const address = email();
      const results = await Promise.all(
        Array.from({ length: 4 }, () => send(t, { email: address })),
      );
      expect(results.map((r) => r.status).sort()).toEqual([200, 200, 200, 201]);
      expect(await leadsOf(t.workspaceId)).toHaveLength(1);
    });

    it('refuses a bad payload with codes only, and stores nothing', async () => {
      const t = await setup();
      const res = await send(t, { email: 'x@mailinator.com' }).expect(400);
      expect(res.body.error).toMatchObject({
        code: 'VALIDATION_FAILED',
        details: { issues: [{ path: 'email', code: 'disposable_email' }] },
      });
      await send(t, { name: 'No contact' }).expect(400);
      expect(await leadsOf(t.workspaceId)).toHaveLength(0);
    });
  });

  describe('who may send (API key)', () => {
    it('answers every authentication problem with the same 401, and writes nothing', async () => {
      const a = await setup();
      const b = await setup();
      const unknownSource = '00000000-0000-4000-8000-000000000000';
      const body = { email: email() };
      const attempts = [
        send({ sourceId: a.sourceId, key: b.key }, body), // another workspace's key on this source
        send({ sourceId: b.sourceId, key: a.key }, body), // and the other way round
        send({ sourceId: unknownSource, key: a.key }, body), // source that does not exist
        send({ sourceId: 'not-a-uuid', key: a.key }, body),
        send({ sourceId: a.sourceId, key: `${a.key}x` }, body), // wrong secret, right prefix
        send({ sourceId: a.sourceId, key: 'lp_deadbeef.' + 'a'.repeat(43) }, body), // unknown prefix
        api().post(`/v1/ingest/${a.sourceId}`).set('content-type', 'application/json').send(body), // no key
      ];
      const results = await Promise.all(attempts);
      for (const res of results) {
        expect(res.status).toBe(401);
        expect(res.body).toEqual({
          error: { code: 'UNAUTHORIZED', message: 'Authentication failed' },
        });
      }
      expect(await leadsOf(a.workspaceId)).toHaveLength(0);
      expect(await leadsOf(b.workspaceId)).toHaveLength(0);
    });

    it('stops working at once when the source is switched off or its key is replaced', async () => {
      const t = await setup();
      const auth = { authorization: `Bearer ${t.owner.accessToken}` };
      await send(t, { email: email() }).expect(201);

      const rotated = await api().post(`/sources/${t.sourceId}/api-key`).set(auth).expect(200);
      await send(t, { email: email() }).expect(401); // the old key
      const fresh = { sourceId: t.sourceId, key: rotated.body.apiKey as string };
      await send(fresh, { email: email() }).expect(201);

      await api().patch(`/sources/${t.sourceId}`).set(auth).send({ enabled: false }).expect(200);
      const off = await send(fresh, { email: email() }).expect(401);
      expect(off.body.error.code).toBe('UNAUTHORIZED');
    });

    it('accepts the key in X-API-Key too', async () => {
      const t = await setup();
      await api()
        .post(`/v1/ingest/${t.sourceId}`)
        .set('x-api-key', t.key)
        .set('content-type', 'application/json')
        .send({ email: email() })
        .expect(201);
    });

    it('limits failed attempts per IP, and a spoofed X-Forwarded-For does not get around it', async () => {
      const t = await setup();
      app.get(IngestLimits).failedAuthPerIp.limit = 3;
      const bad = (i: number) =>
        send(
          { sourceId: t.sourceId, key: 'lp_deadbeef.' + 'a'.repeat(43) },
          { email: email() },
          { 'x-forwarded-for': `10.0.0.${i}` },
        );
      for (let i = 0; i < 3; i += 1) await bad(i).expect(401);
      const limited = await bad(99).expect(429);
      expect(limited.body.error.code).toBe('RATE_LIMITED');
      expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
      // A valid key is never blocked, so a noisy neighbour cannot lock customers out.
      await send(t, { email: email() }, { 'x-forwarded-for': '203.0.113.7' }).expect(201);
    });

    it('limits each source per minute (429 with Retry-After) without touching other sources', async () => {
      const a = await setup();
      const b = await setup();
      app.get(IngestLimits).perSource.limit = 2;
      await send(a, { email: email() }).expect(201);
      await send(a, { email: email() }).expect(201);
      const limited = await send(a, { email: email() }).expect(429);
      expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
      await send(b, { email: email() }).expect(201);
      expect(await leadsOf(a.workspaceId)).toHaveLength(2);
      // A flood costs no database row per refused request: it is not counted.
      expect(
        await prisma.ingestAttempt.count({ where: { sourceId: a.sourceId, outcome: 'REJECTED' } }),
      ).toBe(0);
    });
  });

  describe('signed requests (HMAC)', () => {
    const post = (t: Setup, body: string, headers: Record<string, string>) =>
      send(t, body, headers);

    it('accepts a valid signature, and refuses a missing, wrong, changed-body or unsigned request alike (401)', async () => {
      const t = await setup({ signed: true });
      const body = JSON.stringify({ email: email() });
      await post(t, body, sign(t.secret!, body)).expect(201);

      const refused = await Promise.all([
        post(t, body, {}), // no signature at all
        post(t, body, sign('whsec_wrong', body)),
        post(t, JSON.stringify({ email: email() }), sign(t.secret!, body)), // body changed after signing
        post(t, body, { ...sign(t.secret!, body), 'x-signature': 'sha256=abc' }),
        post(t, body, { ...sign(t.secret!, body), 'x-timestamp': 'abc' }),
      ]);
      for (const res of refused) {
        expect(res.status).toBe(401);
        expect(res.body.error.code).toBe('UNAUTHORIZED');
      }
      expect(await leadsOf(t.workspaceId)).toHaveLength(1);
    });

    it('refuses a correct signature whose timestamp is outside the 5-minute window', async () => {
      const t = await setup({ signed: true });
      const body = JSON.stringify({ email: email() });
      const now = Math.floor(Date.now() / 1000);
      await post(t, body, sign(t.secret!, body, now - 290)).expect(201);
      for (const offset of [-310, 310, -86_400]) {
        const fresh = JSON.stringify({ email: email() });
        await post(t, fresh, sign(t.secret!, fresh, now + offset)).expect(401);
      }
      // The timestamp is part of what is signed: moving it breaks the signature.
      const replay = JSON.stringify({ email: email() });
      const old = sign(t.secret!, replay, now - 400);
      await post(t, replay, { ...old, 'x-timestamp': String(now) }).expect(401);
    });

    it('a captured signed request sent again inside the window changes nothing, even with a new Idempotency-Key', async () => {
      const t = await setup({ signed: true });
      const body = JSON.stringify({ email: email(), note: 'captured' });
      const headers = sign(t.secret!, body);
      const first = await post(t, body, headers).expect(201);
      const again = await post(t, body, headers).expect(201);
      const withKey = await post(t, body, { ...headers, 'idempotency-key': 'attacker-key' }).expect(
        201,
      );
      for (const res of [again, withKey]) {
        expect(res.body).toEqual(first.body);
        expect(res.headers['idempotent-replayed']).toBe('true');
      }
      expect(await prisma.leadEvent.count({ where: { leadId: first.body.leadId } })).toBe(1);
      // A legitimate retry: new timestamp and signature, same Idempotency-Key as the first try.
      const retryBody = JSON.stringify({ email: email() });
      await post(t, retryBody, {
        ...sign(t.secret!, retryBody),
        'idempotency-key': 'order-9',
      }).expect(201);
      const retry = await post(t, retryBody, {
        ...sign(t.secret!, retryBody, Math.floor(Date.now() / 1000) + 1),
        'idempotency-key': 'order-9',
      }).expect(201);
      expect(retry.headers['idempotent-replayed']).toBe('true');
      expect(await leadsOf(t.workspaceId)).toHaveLength(2);
    });

    it('the signature cannot be checked against an unsigned source: signing off ignores the headers', async () => {
      const t = await setup();
      const body = JSON.stringify({ email: email() });
      await post(t, body, sign('whsec_anything', body)).expect(201);
    });
  });

  describe('Idempotency-Key', () => {
    it('the same key and body gives the first answer again, with one lead', async () => {
      const t = await setup();
      const body = { email: email() };
      const first = await send(t, body, { 'idempotency-key': 'order-1' }).expect(201);
      const again = await send(t, body, { 'idempotency-key': 'order-1' }).expect(201);
      expect(again.body).toEqual(first.body);
      expect(again.headers['idempotent-replayed']).toBe('true');
      expect(first.headers['idempotent-replayed']).toBeUndefined();
      expect(await leadsOf(t.workspaceId)).toHaveLength(1);
      expect(await prisma.leadEvent.count({ where: { workspaceId: t.workspaceId } })).toBe(1);
    });

    it('the same key with a different body is refused (422) and changes nothing', async () => {
      const t = await setup();
      const first = await send(t, { email: email() }, { 'idempotency-key': 'k' }).expect(201);
      const other = await send(t, { email: email() }, { 'idempotency-key': 'k' }).expect(422);
      expect(other.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
      expect(await leadsOf(t.workspaceId)).toHaveLength(1);
      expect(first.body.leadId).toBeTruthy();
    });

    it('two requests with one key at once make one lead and both get the same answer', async () => {
      const t = await setup();
      const body = { email: email() };
      const [a, b] = await Promise.all([
        send(t, body, { 'idempotency-key': 'race' }),
        send(t, body, { 'idempotency-key': 'race' }),
      ]);
      expect(a.status).toBe(201);
      expect(b.status).toBe(201);
      expect(a.body).toEqual(b.body);
      expect(await leadsOf(t.workspaceId)).toHaveLength(1);
    });

    it('a request that failed frees its key; keys are per source; an expired key is reusable', async () => {
      const t = await setup();
      await send(t, { name: 'no contact' }, { 'idempotency-key': 'fix-me' }).expect(400);
      await send(t, { email: email() }, { 'idempotency-key': 'fix-me' }).expect(201);

      const other = await setup();
      await send(other, { email: email() }, { 'idempotency-key': 'fix-me' }).expect(201);

      await prisma.idempotencyKey.updateMany({
        where: { sourceId: t.sourceId },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      await send(t, { email: email() }, { 'idempotency-key': 'fix-me' }).expect(201);
      expect(await leadsOf(t.workspaceId)).toHaveLength(2);
    });

    it('refuses a malformed key', async () => {
      const t = await setup();
      await send(t, { email: email() }, { 'idempotency-key': 'x'.repeat(129) }).expect(400);
      await send(t, { email: email() }, { 'idempotency-key': 'has space' }).expect(400);
    });
  });

  describe('what the body may be', () => {
    it('refuses a body over 256 KB (413), however it is sent', async () => {
      const t = await setup();
      const big = JSON.stringify({ email: email(), note: 'x'.repeat(300 * 1024) });
      const res = await send(t, big).expect(413);
      expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
      expect(await leadsOf(t.workspaceId)).toHaveLength(0);
    });

    it('refuses a chunked body over the limit that never declares a size', async () => {
      const t = await setup();
      const server = app.getHttpServer() as http.Server;
      if (!server.listening) await new Promise<void>((resolve) => server.listen(0, resolve));
      const { port } = server.address() as AddressInfo;
      const status = await new Promise<number>((resolve, reject) => {
        const req = http.request(
          {
            port,
            method: 'POST',
            path: `/v1/ingest/${t.sourceId}`,
            headers: {
              authorization: `Bearer ${t.key}`,
              'content-type': 'application/json',
              'transfer-encoding': 'chunked',
            },
          },
          (res) => {
            res.resume();
            resolve(res.statusCode ?? 0);
          },
        );
        req.on('error', (error) => (req.destroyed ? undefined : reject(error)));
        req.write('{"email":"a@acme-test.com","note":"');
        for (let i = 0; i < 4; i += 1) req.write('x'.repeat(100 * 1024));
        req.end('"}');
      });
      expect(status).toBe(413);
      expect(await leadsOf(t.workspaceId)).toHaveLength(0);
    });

    it('refuses lone surrogates (Postgres jsonb would fail) in values and keys, and refuses a __proto__ field', async () => {
      const t = await setup();
      for (const body of [
        `{"email":"${email()}","note":"\\ud800"}`,
        `{"email":"${email()}","\\udc00":1}`,
      ]) {
        const res = await send(t, body).expect(400);
        expect(res.body.error.details.issues).toEqual([{ path: '', code: 'invalid_unicode' }]);
      }
      const proto = await send(t, `{"email":"${email()}","__proto__":{"a":1}}`).expect(400);
      expect(proto.body.error.details.issues).toEqual([{ path: '', code: 'reserved_field' }]);
      // A valid surrogate pair (an emoji) is fine.
      await send(t, `{"email":"${email()}","note":"\\ud83d\\ude00"}`).expect(201);
    });

    it('refuses a wrong content type, broken JSON, and a body that is not an object', async () => {
      const t = await setup();
      const text = await send(t, '{"email":"a@acme-test.com"}', {
        'content-type': 'text/plain',
      }).expect(415);
      expect(text.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
      await send(t, '{"email":').expect(400);
      await send(t, '[1,2]').expect(400);
      await send(t, '"hello"').expect(400);
      await send(t, '').expect(400);
    });

    it('refuses NUL characters (Postgres jsonb would fail) and over-deep nesting, never a 500', async () => {
      const t = await setup();
      const nulValue = `{"email":"${email()}","note":"a\\u0000b"}`;
      const nulKey = `{"email":"${email()}","a\\u0000b":1}`;
      for (const body of [nulValue, nulKey]) {
        const res = await send(t, body).expect(400);
        expect(res.body.error.details.issues).toEqual([{ path: '', code: 'nul_character' }]);
      }
      let deep: unknown = 1;
      for (let i = 0; i < 12; i += 1) deep = { a: deep };
      const res = await send(t, { email: email(), deep }).expect(400);
      expect(res.body.error.details.issues).toEqual([{ path: '', code: 'too_deep' }]);
      expect(await leadsOf(t.workspaceId)).toHaveLength(0);
    });
  });

  it('never repeats the key in an answer', async () => {
    const t = await setup();
    for (const res of [
      await send(t, { email: email() }),
      await send({ sourceId: t.sourceId, key: `${t.key}x` }, { email: email() }),
      await send(t, { name: 'bad' }),
    ]) {
      expect(JSON.stringify(res.body)).not.toContain(t.key.split('.')[1]);
    }
  });
  describe('qualifying fields and what a source sends', () => {
    it('stores message, budget, timeline, job title and interest, and a merge keeps the newest', async () => {
      const t = await setup();
      const address = email();
      const first = await send(t, {
        email: address,
        message: 'We need tracking.\nCall me.',
        budget: '$10k',
        job_title: 'CTO',
        timeframe: 'Q4',
        product: 'Tracking',
      }).expect(201);
      const lead = await prisma.lead.findUniqueOrThrow({ where: { id: first.body.leadId } });
      expect(lead).toMatchObject({
        message: 'We need tracking.\nCall me.',
        budget: '$10k',
        jobTitle: 'CTO',
        timeline: 'Q4',
        interest: 'Tracking',
      });
      expect(lead.customFields).toEqual({});
      await send(t, { email: address, budget: '$20k' }).expect(200);
      expect(
        await prisma.lead.findUniqueOrThrow({ where: { id: first.body.leadId } }),
      ).toMatchObject({ budget: '$20k', message: 'We need tracking.\nCall me.' });
    });

    it('Lead sources says which useful fields a source sends (half or more of its submissions)', async () => {
      const t = await setup();
      const auth = { authorization: `Bearer ${t.owner.accessToken}` };
      for (let i = 0; i < 4; i += 1) {
        await send(t, {
          email: email(),
          name: 'Ann Lee',
          ...(i < 2 ? { message: 'hi', company: 'Acme' } : {}),
        }).expect(201);
      }
      await send(t, { email: email(), phone: '+84901234567' }).expect(201);
      const list = await api().get('/sources').set(auth).expect(200);
      type Row = {
        id: string;
        last30Days: { readiness: { accepted: number; sends: string[]; missing: string[] } };
      };
      const readiness = (list.body as Row[]).find((s) => s.id === t.sourceId)!.last30Days.readiness;
      // 5 accepted: name 4/5 and email 5/5 (sent); message and company 2/5 and phone 1/5 (not sent).
      expect(readiness.accepted).toBe(5);
      expect(readiness.sends).toEqual(['name', 'email']);
      expect(readiness.missing).toEqual([
        'phone',
        'company',
        'message',
        'budget',
        'timeline',
        'jobTitle',
      ]);
    });
  });
});
