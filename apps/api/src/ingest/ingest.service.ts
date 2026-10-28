import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ErrorCode } from '@leadpilot/shared';
import { DomainError } from '../common/errors/domain-error';
import { CryptoService } from '../crypto/crypto.service';
import { Prisma } from '../generated/prisma/client';
import { TenantPrisma } from '../prisma/tenant-prisma.service';
import { PipelineQueue } from '../queue/pipeline.queue';
import { hmacAad } from '../sources/sources.service';
import { type AuthenticatedSource, IngestAuthService } from './ingest-auth.service';
import { type NormalizedLead, normalizePayload } from './normalize';
import { nextSample, SAMPLE_LEADS } from './sample-leads';
import { FixedWindowLimiter, type WindowStore } from './rate-limiter';

/** Signed requests older (or newer) than this are refused: a captured request cannot be replayed later. */
export const REPLAY_WINDOW_SECONDS = 5 * 60;
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_JSON_DEPTH = 10;
/** The eight fields that make a lead easy to rate (Lead sources: "3 of 8 useful fields"). */
export const USEFUL_FIELDS = [
  'name',
  'email',
  'phone',
  'company',
  'message',
  'budget',
  'timeline',
  'jobTitle',
] as const;
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;
/** A reserved key with no answer after this long belongs to a request that died. */
const ABANDONED_AFTER_MS = 60_000;
const IDEMPOTENCY_KEY = /^[\x21-\x7e]{1,128}$/;

/** The two limits (SPEC §4.8). Fields are public so tests can lower or raise them. */
export class IngestLimits {
  /** Leads per source per minute. */
  readonly perSource: FixedWindowLimiter;
  /** Failed authentications per IP per minute: slows down guessing keys. */
  readonly failedAuthPerIp: FixedWindowLimiter;

  constructor(store: WindowStore) {
    this.perSource = new FixedWindowLimiter(120, store, 'ingest:source');
    this.failedAuthPerIp = new FixedWindowLimiter(20, store, 'ingest:failed-auth');
  }
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
  private readonly logger = new Logger(IngestService.name);

  constructor(
    private readonly auth: IngestAuthService,
    private readonly tenant: TenantPrisma,
    private readonly crypto: CryptoService,
    private readonly limits: IngestLimits,
    private readonly pipeline: PipelineQueue,
  ) {}

  /**
   * "Send a sample lead" on Lead sources (Admin and Owner): a made-up lead goes through the same
   * cleaning, dedup, saving and queueing as a real submission, so the demo needs no command line.
   */
  async submitSample(workspaceId: string, sourceId: string): Promise<IngestOutcome> {
    const db = this.tenant.for(workspaceId);
    const source = await db.source.findUnique({ where: { id: sourceId } });
    if (!source)
      throw new DomainError(ErrorCode.NOT_FOUND, 'Source not found', HttpStatus.NOT_FOUND);
    if (!source.enabled) {
      throw new DomainError(ErrorCode.CONFLICT, 'Switch the source on first', HttpStatus.CONFLICT);
    }
    const workspace = await db.workspace.findFirstOrThrow({ select: { defaultCountry: true } });
    const payload = nextSample(randomInt(SAMPLE_LEADS.length), randomBytes(3).toString('hex'));
    const authenticated: AuthenticatedSource = {
      sourceId,
      workspaceId,
      hmacSecretEnc: null,
      defaultCountry: workspace.defaultCountry,
    };
    return { ...(await this.store(db, authenticated, payload)), replayed: false };
  }

  async handle(req: IngestRequest): Promise<IngestOutcome> {
    const source = await this.authenticate(req);
    const db = this.tenant.for(source.workspaceId);
    try {
      return await this.process(req, source, db);
    } catch (error) {
      // From here the source is known, so a refusal counts in its numbers (Lead sources).
      const reason = rejectionReason(error);
      if (reason) await this.record(db, source, 'REJECTED', reason);
      throw error;
    }
  }

  private async process(
    req: IngestRequest,
    source: AuthenticatedSource,
    db: Db,
  ): Promise<IngestOutcome> {
    const retryAfter = await this.limits.perSource.hit(source.sourceId);
    if (retryAfter > 0) throw new RateLimitedError(retryAfter);

    const payload = this.parse(req);

    const explicit = req.header('idempotency-key');
    if (explicit !== undefined && !IDEMPOTENCY_KEY.test(explicit)) {
      throw badRequest([{ path: 'Idempotency-Key', code: 'invalid_idempotency_key' }]);
    }
    // A signed request is valid for 5 minutes, so a captured copy could be sent
    // again inside that window. Its signature is therefore claimed like an
    // Idempotency-Key: the second copy gets the first answer back and changes nothing.
    const signature = source.hmacSecretEnc === null ? undefined : signatureOf(req);
    const keys = [signature ? `sig:${signature}` : undefined, explicit].filter(
      (key): key is string => key !== undefined,
    );
    if (keys.length === 0) return { ...(await this.store(db, source, payload)), replayed: false };

    const requestHash = createHash('sha256').update(req.rawBody).digest('hex');
    const claimed: string[] = [];
    const release = () =>
      db.idempotencyKey.deleteMany({ where: { id: { in: claimed } } }).catch(() => undefined);
    for (const key of keys) {
      const claim = await this.claim(db, source, key, requestHash);
      if (claim.replay) {
        await release();
        await this.record(db, source, 'REPLAYED');
        return { ...claim.replay, replayed: true };
      }
      claimed.push(claim.id);
    }
    let outcome: Omit<IngestOutcome, 'replayed'>;
    try {
      outcome = await this.store(db, source, payload);
    } catch (error) {
      // Nothing was stored: free the keys so the sender can retry (a corrected body, or the same one).
      await release();
      throw error;
    }
    // The lead is stored. If saving the answer fails, the keys stay reserved until
    // they are taken over as abandoned (60 s): a quick retry is answered "still
    // processing" rather than adding the lead twice.
    await db.idempotencyKey.updateMany({
      where: { id: { in: claimed } },
      data: { responseStatus: outcome.status, responseBody: outcome.body },
    });
    return { ...outcome, replayed: false };
  }

  /** One row per submission for the Lead sources numbers. Never fails the request. */
  private async record(
    db: Db,
    source: AuthenticatedSource,
    outcome: 'REJECTED' | 'REPLAYED',
    reason?: string,
  ): Promise<void> {
    await db.ingestAttempt
      .create({
        data: {
          workspaceId: source.workspaceId,
          sourceId: source.sourceId,
          outcome,
          reason: reason ?? null,
        },
      })
      .catch(() => undefined);
  }

  // ── Who is calling ──────────────────────────────────────────────────────

  private async authenticate(req: IngestRequest): Promise<AuthenticatedSource> {
    const presented = presentedKey(req);
    const source = presented ? await this.auth.authenticate(req.sourceId, presented) : null;
    if (!source || !this.signatureOk(source, req)) {
      // Too many failures from one address: stop answering it. A request that
      // authenticates is never blocked, so a noisy neighbour behind the same
      // proxy or NAT cannot lock customers out.
      const blocked = await this.limits.failedAuthPerIp.blockedFor(req.ip);
      if (blocked > 0) throw new RateLimitedError(blocked);
      await this.limits.failedAuthPerIp.record(req.ip);
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
      // Unreadable secret (the ENCRYPTION_KEY changed?): refuse rather than accept
      // unsigned data, and tell the operator, since the sender only sees a 401.
      this.logger.warn({ sourceId: source.sourceId }, 'Signing secret could not be decrypted');
      return false;
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
        const stored = await db.$transaction((tx) =>
          this.upsert(tx, source, normalized.lead, payload),
        );
        // After the commit, so a worker never looks for a lead that is not saved yet.
        await this.pipeline.enqueueLead({
          workspaceId: source.workspaceId,
          leadId: stored.body.leadId,
        });
        return stored;
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
    // Dedup (decided in M2, a deviation from SPEC §4.2, which also merged on phone):
    // - exact email: the same person, merge;
    // - no email in the submission, exact phone: merge into that lead;
    // - an email we do not know with a phone we do: a different email may be a
    //   different person (a shared office line), so NO silent merge: a separate
    //   lead flagged "possible duplicate" for a person to decide.
    const byEmail = lead.email ? await tx.lead.findFirst({ where: { email: lead.email } }) : null;
    const byPhone =
      !byEmail && lead.phone
        ? await tx.lead.findFirst({ where: { phone: lead.phone }, orderBy: { createdAt: 'asc' } })
        : null;
    const existing = byEmail ?? (lead.email ? null : byPhone);
    const raw = payload as Prisma.InputJsonObject;
    // Each submission leaves its own "ingested" event (own received time, own raw payload).
    const ingested = (leadId: string) => ({
      workspaceId: source.workspaceId,
      leadId,
      type: 'ingested',
      payload: { sourceId: source.sourceId, rawPayload: raw },
    });
    // Which useful fields this submission had: Lead sources says what each source sends.
    const present = USEFUL_FIELDS.filter((name) =>
      name === 'name' ? Boolean(lead.firstName ?? lead.lastName) : Boolean(lead[name]),
    );
    const attempt = (outcome: 'CREATED' | 'MERGED') =>
      tx.ingestAttempt.create({
        data: {
          workspaceId: source.workspaceId,
          sourceId: source.sourceId,
          outcome,
          fields: present,
        },
      });

    if (!existing) {
      const possibleDuplicate = lead.email ? byPhone : null;
      const created = await tx.lead.create({
        data: {
          workspaceId: source.workspaceId,
          sourceId: source.sourceId,
          ...lead,
          isFreeMail: lead.isFreeMail ?? false,
          customFields: lead.customFields as Prisma.InputJsonObject,
          rawPayload: raw,
          possibleDuplicateOfId: possibleDuplicate?.id ?? null,
        },
      });
      await tx.leadEvent.create({ data: ingested(created.id) });
      if (possibleDuplicate) {
        // Written on both leads, so either timeline tells the story.
        await tx.leadEvent.createMany({
          data: [
            {
              workspaceId: source.workspaceId,
              leadId: created.id,
              type: 'possible_duplicate',
              payload: { ofLeadId: possibleDuplicate.id, matchedBy: 'phone' },
            },
            {
              workspaceId: source.workspaceId,
              leadId: possibleDuplicate.id,
              type: 'possible_duplicate',
              payload: { newLeadId: created.id, matchedBy: 'phone' },
            },
          ],
        });
      }
      await attempt('CREATED');
      return { status: HttpStatus.CREATED, body: { leadId: created.id, result: 'created' } };
    }

    // Merge: the newest non-empty value wins; nothing is ever blanked out.
    const { customFields, ...incoming } = lead;
    // Matched by email: the same person, the newest values win. Matched by phone
    // alone (a shared line can belong to several people): only blanks are filled,
    // so one person's name and company never overwrite another's.
    const fields = byEmail
      ? incoming
      : Object.fromEntries(
          Object.entries(incoming).filter(
            ([name]) => existing[name as keyof typeof existing] == null,
          ),
        );
    const changed = (Object.keys(fields) as (keyof typeof fields)[]).filter(
      (name) =>
        fields[name] !== undefined && fields[name] !== existing[name as keyof typeof existing],
    );
    await tx.lead.update({
      where: { id: existing.id },
      data: {
        ...fields,
        customFields: (byEmail
          ? { ...(existing.customFields as Prisma.JsonObject), ...customFields }
          : {
              ...customFields,
              ...(existing.customFields as Prisma.JsonObject),
            }) as Prisma.InputJsonObject,
        rawPayload: raw,
      },
    });
    await tx.leadEvent.createMany({
      data: [
        ingested(existing.id),
        {
          workspaceId: source.workspaceId,
          leadId: existing.id,
          type: 'merged',
          payload: {
            sourceId: source.sourceId,
            matchedBy: byEmail ? 'email' : 'phone',
            changed,
          },
        },
      ],
    });
    await attempt('MERGED');
    return { status: HttpStatus.OK, body: { leadId: existing.id, result: 'merged' } };
  }
}

/** NUL and lone surrogates are valid JSON but Postgres `jsonb` refuses them (a 500 otherwise). */
function badString(text: string): string | null {
  if (text.includes('\u0000')) return 'nul_character';
  return LONE_SURROGATE.test(text) ? 'invalid_unicode' : null;
}

/** The lowercase hex of a well-formed `X-Signature`, else undefined. */
function signatureOf(req: IngestRequest): string | undefined {
  return /^sha256=([0-9a-f]{64})$/i.exec(req.header('x-signature') ?? '')?.[1]?.toLowerCase();
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

/** The reason code a refused submission is counted under (Lead sources), or null when it is not a refusal. */
function rejectionReason(error: unknown): string | null {
  // A rate-limited request is NOT recorded: a flood must not cost one database row per request.
  if (!(error instanceof DomainError)) return null;
  if (error.code === ErrorCode.UNSUPPORTED_MEDIA_TYPE) return 'unsupported_media_type';
  if (error.code === ErrorCode.IDEMPOTENCY_KEY_REUSED) return 'idempotency_key_reused';
  if (error.code === ErrorCode.VALIDATION_FAILED) {
    const issues = (error.details as { issues?: { code?: string }[] } | undefined)?.issues;
    return issues?.[0]?.code ?? 'invalid_request';
  }
  return null;
}
