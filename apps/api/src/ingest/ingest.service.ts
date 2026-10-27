import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { HttpStatus, Injectable } from '@nestjs/common';
import { ErrorCode } from '@leadpilot/shared';
import { DomainError } from '../common/errors/domain-error';
import { CryptoService } from '../crypto/crypto.service';
import { Prisma } from '../generated/prisma/client';
import { TenantPrisma } from '../prisma/tenant-prisma.service';
import { hmacAad } from '../sources/sources.service';
import { type AuthenticatedSource, IngestAuthService } from './ingest-auth.service';
import { type NormalizedLead, normalizePayload } from './normalize';
import { FixedWindowLimiter } from './rate-limiter';

/** Signed requests older (or newer) than this are refused: a captured request cannot be replayed later. */
export const REPLAY_WINDOW_SECONDS = 5 * 60;
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_JSON_DEPTH = 10;
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;
/** A reserved key with no answer after this long belongs to a request that died. */
const ABANDONED_AFTER_MS = 60_000;
const IDEMPOTENCY_KEY = /^[\x21-\x7e]{1,128}$/;

/** The two limits (SPEC §4.8). Fields are public so tests can lower or raise them. */
export class IngestLimits {
  /** Leads per source per minute. */
  perSource = new FixedWindowLimiter(120);
  /** Failed authentications per IP per minute: slows down guessing keys. */
  failedAuthPerIp = new FixedWindowLimiter(20);
}

export class RateLimitedError extends DomainError {
  constructor(readonly retryAfter: number) {
    super(ErrorCode.RATE_LIMITED, 'Too many requests', HttpStatus.TOO_MANY_REQUESTS);
  }
}

/** One answer for every authentication problem: unknown source, other workspace's source, wrong key, disabled, bad signature. */
const unauthorized = () =>
  new DomainError(ErrorCode.UNAUTHORIZED, 'Authentication failed', HttpStatus.UNAUTHORIZED);

const badRequest = (issues: { path: string; code: string }[]) =>
  new DomainError(ErrorCode.VALIDATION_FAILED, 'Invalid request', HttpStatus.BAD_REQUEST, {
    issues,
  });

export interface IngestRequest {
  sourceId: string;
  ip: string;
  header: (name: string) => string | undefined;
  rawBody: Buffer;
}

export interface IngestOutcome {
  status: number;
  body: { leadId: string; result: 'created' | 'merged' };
  replayed: boolean;
}

type Db = ReturnType<TenantPrisma['for']>;
type Tx = Parameters<Parameters<Db['$transaction']>[0]>[0];

@Injectable()
export class IngestService {
  constructor(
    private readonly auth: IngestAuthService,
    private readonly tenant: TenantPrisma,
    private readonly crypto: CryptoService,
    private readonly limits: IngestLimits,
  ) {}

  async handle(req: IngestRequest): Promise<IngestOutcome> {
    const source = await this.authenticate(req);
    const retryAfter = this.limits.perSource.hit(source.sourceId);
    if (retryAfter > 0) throw new RateLimitedError(retryAfter);

    const payload = this.parse(req);
    const db = this.tenant.for(source.workspaceId);

    const key = req.header('idempotency-key');
    if (key === undefined) return { ...(await this.store(db, source, payload)), replayed: false };
    if (!IDEMPOTENCY_KEY.test(key)) {
      throw badRequest([{ path: 'Idempotency-Key', code: 'invalid_idempotency_key' }]);
    }

    const requestHash = createHash('sha256').update(req.rawBody).digest('hex');
    const claim = await this.claim(db, source, key, requestHash);
    if (claim.replay) return { ...claim.replay, replayed: true };
    let outcome: Omit<IngestOutcome, 'replayed'>;
    try {
      outcome = await this.store(db, source, payload);
    } catch (error) {
      // Nothing was stored: free the key so the sender can retry (a corrected body, or the same one).
      await db.idempotencyKey.deleteMany({ where: { id: claim.id } }).catch(() => undefined);
      throw error;
    }
    // The lead is stored. If saving the answer fails the key stays reserved
    // (never freed), so a retry cannot add the lead twice.
    await db.idempotencyKey.update({
      where: { id: claim.id },
      data: { responseStatus: outcome.status, responseBody: outcome.body },
    });
    return { ...outcome, replayed: false };
  }

  // ── Who is calling ──────────────────────────────────────────────────────

  private async authenticate(req: IngestRequest): Promise<AuthenticatedSource> {
    const presented = presentedKey(req);
    const source = presented ? await this.auth.authenticate(req.sourceId, presented) : null;
    if (!source || !this.signatureOk(source, req)) {
      // Too many failures from one address: stop answering it. A request that
      // authenticates is never blocked, so a noisy neighbour behind the same
      // proxy or NAT cannot lock customers out.
      const blocked = this.limits.failedAuthPerIp.blockedFor(req.ip);
      if (blocked > 0) throw new RateLimitedError(blocked);
      this.limits.failedAuthPerIp.record(req.ip);
      throw unauthorized();
    }
    return source;
  }

  /**
   * HMAC: the sender proves it knows the secret by signing `<timestamp>.<body>`.
   * The timestamp is inside the signature, so it cannot be changed to dodge the
   * 5-minute window. Signing off: nothing to check.
   */
  private signatureOk(source: AuthenticatedSource, req: IngestRequest): boolean {
    if (source.hmacSecretEnc === null) return true;
    const timestamp = req.header('x-timestamp') ?? '';
    const signature = /^sha256=([0-9a-f]{64})$/i.exec(req.header('x-signature') ?? '')?.[1];
    if (!/^\d{1,12}$/.test(timestamp) || !signature) return false;
    if (Math.abs(Date.now() / 1000 - Number(timestamp)) > REPLAY_WINDOW_SECONDS) return false;

    let secret: string;
    try {
      secret = this.crypto.decrypt(
        source.hmacSecretEnc,
        hmacAad(source.workspaceId, source.sourceId),
      );
    } catch {
      return false; // unreadable secret: refuse rather than accept unsigned data
    }
    const expected = createHmac('sha256', secret)
      .update(`${timestamp}.`)
      .update(req.rawBody)
      .digest();
    return timingSafeEqual(expected, Buffer.from(signature, 'hex'));
  }

  // ── The body ────────────────────────────────────────────────────────────

  private parse(req: IngestRequest): Record<string, unknown> {
    const type = (req.header('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
    if (type !== 'application/json') {
      throw new DomainError(
        ErrorCode.UNSUPPORTED_MEDIA_TYPE,
        'Send the body as application/json',
        HttpStatus.UNSUPPORTED_MEDIA_TYPE,
      );
    }
    let value: unknown;
    try {
      value = JSON.parse(req.rawBody.toString('utf8'));
    } catch {
      throw badRequest([{ path: '', code: 'invalid_json' }]);
    }
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw badRequest([{ path: '', code: 'object_required' }]);
    }
    const problem = inspect(value, 0);
    if (problem) throw badRequest([{ path: '', code: problem }]);
    return value as Record<string, unknown>;
  }

  // ── Idempotency ─────────────────────────────────────────────────────────

  /**
   * Reserves the key (a unique row per source + key) or returns the stored
   * answer. Two requests with the same key at once: one wins the insert; the
   * other waits briefly for the winner's answer instead of creating a second lead.
   */
  private async claim(
    db: Db,
    source: AuthenticatedSource,
    key: string,
    requestHash: string,
  ): Promise<
    { id: string; replay?: undefined } | { replay: Omit<IngestOutcome, 'replayed'>; id?: undefined }
  > {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const row = await db.idempotencyKey.create({
          data: {
            workspaceId: source.workspaceId,
            sourceId: source.sourceId,
            key,
            requestHash,
            expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
          },
        });
        return { id: row.id };
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
          throw error;
        }
      }
      for (let wait = 0; wait < 12; wait += 1) {
        const existing = await db.idempotencyKey.findFirst({
          where: { sourceId: source.sourceId, key },
        });
        if (!existing) break; // released meanwhile: try to claim again
        if (existing.expiresAt.getTime() <= Date.now()) {
          await db.idempotencyKey.deleteMany({
            where: { id: existing.id, expiresAt: { lte: new Date() } },
          });
          break;
        }
        if (existing.requestHash !== requestHash) {
          throw new DomainError(
            ErrorCode.IDEMPOTENCY_KEY_REUSED,
            'This Idempotency-Key was used with a different body',
            HttpStatus.UNPROCESSABLE_ENTITY,
          );
        }
        if (existing.responseStatus !== null) {
          return {
            replay: {
              status: existing.responseStatus,
              body: existing.responseBody as IngestOutcome['body'],
            },
          };
        }
        if (existing.createdAt.getTime() < Date.now() - ABANDONED_AFTER_MS) {
          // The first request died before answering: take the key over.
          await db.idempotencyKey.deleteMany({ where: { id: existing.id, responseStatus: null } });
          break;
        }
        await sleep(250); // the first request is still working
      }
    }
    throw new DomainError(
      ErrorCode.CONFLICT,
      'The first request with this Idempotency-Key is still being processed: retry shortly',
      HttpStatus.CONFLICT,
    );
  }

  // ── Normalize, dedup, store ─────────────────────────────────────────────

  private async store(
    db: Db,
    source: AuthenticatedSource,
    payload: Record<string, unknown>,
  ): Promise<Omit<IngestOutcome, 'replayed'>> {
    const normalized = normalizePayload(payload, source.defaultCountry);
    if (!normalized.ok) throw badRequest(normalized.issues);

    // Two submissions of one email at once: the unique index refuses the second
    // insert, and the retry then finds the first lead and merges into it.
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await db.$transaction((tx) => this.upsert(tx, source, normalized.lead, payload));
      } catch (error) {
        const conflict =
          error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
        if (!conflict || attempt >= 2) throw error;
      }
    }
  }

  private async upsert(
    tx: Tx,
    source: AuthenticatedSource,
    lead: NormalizedLead,
    payload: Record<string, unknown>,
  ): Promise<Omit<IngestOutcome, 'replayed'>> {
    // Dedup order (SPEC §4.2): exact email, then exact phone.
    const byEmail = lead.email ? await tx.lead.findFirst({ where: { email: lead.email } }) : null;
    const byPhone =
      !byEmail && lead.phone
        ? await tx.lead.findFirst({ where: { phone: lead.phone }, orderBy: { createdAt: 'asc' } })
        : null;
    const existing = byEmail ?? byPhone;
    const raw = payload as Prisma.InputJsonObject;

    if (!existing) {
      const created = await tx.lead.create({
        data: {
          workspaceId: source.workspaceId,
          sourceId: source.sourceId,
          ...lead,
          isFreeMail: lead.isFreeMail ?? false,
          customFields: lead.customFields as Prisma.InputJsonObject,
          rawPayload: raw,
        },
      });
      await tx.leadEvent.create({
        data: {
          workspaceId: source.workspaceId,
          leadId: created.id,
          type: 'ingested',
          payload: { sourceId: source.sourceId, rawPayload: raw },
        },
      });
      return { status: HttpStatus.CREATED, body: { leadId: created.id, result: 'created' } };
    }

    // Merge: the newest non-empty value wins; nothing is ever blanked out.
    // Matched by phone: the stored email stays (it is the dedup key); a different
    // one is only recorded in the "merged" event.
    const { customFields, email, ...rest } = lead;
    const keepEmail = byEmail || !existing.email;
    // isFreeMail describes the stored email: leave it alone when that email stays.
    if (!keepEmail) delete rest.isFreeMail;
    const fields = keepEmail ? { ...rest, email } : rest;
    const otherEmail =
      !byEmail && existing.email && email && email !== existing.email ? email : undefined;
    const changed = (Object.keys(fields) as (keyof typeof fields)[]).filter(
      (name) =>
        fields[name] !== undefined && fields[name] !== existing[name as keyof typeof existing],
    );
    await tx.lead.update({
      where: { id: existing.id },
      data: {
        ...fields,
        customFields: {
          ...(existing.customFields as Prisma.JsonObject),
          ...customFields,
        } as Prisma.InputJsonObject,
        rawPayload: raw,
      },
    });
    await tx.leadEvent.createMany({
      data: [
        {
          workspaceId: source.workspaceId,
          leadId: existing.id,
          type: 'ingested',
          payload: { sourceId: source.sourceId, rawPayload: raw },
        },
        {
          workspaceId: source.workspaceId,
          leadId: existing.id,
          type: 'merged',
          payload: {
            sourceId: source.sourceId,
            matchedBy: byEmail ? 'email' : 'phone',
            changed,
            ...(otherEmail ? { otherEmail } : {}),
          },
        },
      ],
    });
    return { status: HttpStatus.OK, body: { leadId: existing.id, result: 'merged' } };
  }
}

/** NUL and lone surrogates are valid JSON but Postgres `jsonb` refuses them (a 500 otherwise). */
function badString(text: string): string | null {
  if (text.includes('\u0000')) return 'nul_character';
  return LONE_SURROGATE.test(text) ? 'invalid_unicode' : null;
}

/** The API key from `Authorization: Bearer …` or `X-API-Key`. */
function presentedKey(req: IngestRequest): string | null {
  const bearer = /^Bearer (\S+)$/i.exec(req.header('authorization') ?? '')?.[1];
  return bearer ?? req.header('x-api-key') ?? null;
}

/**
 * Walks the parsed JSON once. Refuses what the database or later steps cannot
 * take: NUL characters (Postgres `jsonb` rejects \u0000 with a 500 otherwise)
 * and nesting deeper than MAX_JSON_DEPTH. Returns the problem code or null.
 */
function inspect(value: unknown, depth: number): string | null {
  if (typeof value === 'string') return badString(value);
  if (typeof value !== 'object' || value === null) return null;
  if (depth >= MAX_JSON_DEPTH) return 'too_deep';
  for (const [key, child] of Object.entries(value)) {
    // Copying objects that have an own "__proto__" key silently drops it: refuse it outright.
    if (key === '__proto__') return 'reserved_field';
    const keyProblem = badString(key);
    if (keyProblem) return keyProblem;
    const problem = inspect(child, depth + 1);
    if (problem) return problem;
  }
  return null;
}
