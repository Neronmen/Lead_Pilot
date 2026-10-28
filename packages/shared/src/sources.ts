import { z } from 'zod';
import { displayTextSchema, idSchema, timestampSchema } from './common.ts';

/** Where leads come from. CSV sources exist in the data model; uploading is part of M6. */
export const sourceTypeSchema = z.enum(['WEBHOOK', 'FORM', 'CSV']);
export type SourceType = z.infer<typeof sourceTypeSchema>;

/** `POST /sources`. */
export const createSourceRequestSchema = z.strictObject({
  name: displayTextSchema(100),
  type: sourceTypeSchema,
});

/** `PATCH /sources/:id`: rename, or switch off / on. At least one field. */
export const updateSourceRequestSchema = z
  .strictObject({
    name: displayTextSchema(100).optional(),
    enabled: z.boolean().optional(),
  })
  .refine((body) => body.name !== undefined || body.enabled !== undefined, {
    message: 'send a name or enabled',
  });

/** The eight fields that make a lead easy to rate. */
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

/** Every reason a submission can be refused for; the web app has plain wording for each. */
export const INGEST_REJECTION_REASONS = [
  'invalid_email',
  'disposable_email',
  'invalid_phone',
  'invalid_text',
  'invalid_type',
  'invalid_domain',
  'invalid_country',
  'too_many_fields',
  'field_name_too_long',
  'contact_required',
  'invalid_json',
  'object_required',
  'nul_character',
  'invalid_unicode',
  'reserved_field',
  'too_deep',
  'invalid_idempotency_key',
  'unsupported_media_type',
  'idempotency_key_reused',
  'rate_limited',
] as const;

/**
 * What happened to the submissions of the last 30 days. `received` is always
 * created + merged + rejected. Idempotent retries answered from the stored
 * first response are `replayed`, counted apart and not part of `received`.
 * Only submissions with a valid key are counted (the source is known).
 */
export const sourceStatsSchema = z.object({
  received: z.number().int().nonnegative(),
  created: z.number().int().nonnegative(),
  merged: z.number().int().nonnegative(),
  rejected: z.number().int().nonnegative(),
  replayed: z.number().int().nonnegative(),
  /** The most common reasons, most frequent first (at most 3). A code from INGEST_REJECTION_REASONS. */
  topRejections: z.array(z.object({ reason: z.string(), count: z.number().int().positive() })),
  /**
   * Which of the eight useful fields this source sends, from the last 30 days of accepted
   * submissions: a field counts as sent when at least half of them had it.
   */
  readiness: z.object({
    accepted: z.number().int().nonnegative(),
    sends: z.array(z.enum(USEFUL_FIELDS)),
    missing: z.array(z.enum(USEFUL_FIELDS)),
  }),
});

/**
 * A source as the Lead sources page shows it. The API key itself is never
 * here (only its public prefix): it is shown once, when it is made.
 */
export const sourceSchema = z.object({
  id: idSchema,
  name: z.string(),
  type: sourceTypeSchema,
  enabled: z.boolean(),
  /** The public part of the key (`lp_<prefix>.<secret>`), so a person can tell keys apart. */
  apiKeyPrefix: z.string(),
  /** Whether requests must carry an HMAC signature. The secret is never shown again. */
  hmacEnabled: z.boolean(),
  createdAt: timestampSchema,
  leadsLast30Days: z.number().int().nonnegative(),
  lastLeadAt: timestampSchema.nullable(),
  last30Days: sourceStatsSchema,
});

/** `POST /sources` and `POST /sources/:id/api-key`: the new key, shown once. */
export const sourceWithKeySchema = z.object({ source: sourceSchema, apiKey: z.string() });

/** `POST /sources/:id/hmac-secret`: the new signing secret, shown once. */
export const hmacSecretResponseSchema = z.object({ secret: z.string() });

export type CreateSourceRequest = z.infer<typeof createSourceRequestSchema>;
export type UpdateSourceRequest = z.infer<typeof updateSourceRequestSchema>;
export type SourceStats = z.infer<typeof sourceStatsSchema>;
export type Source = z.infer<typeof sourceSchema>;
export type SourceWithKey = z.infer<typeof sourceWithKeySchema>;
export type HmacSecretResponse = z.infer<typeof hmacSecretResponseSchema>;
