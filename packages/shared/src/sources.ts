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
});

/** `POST /sources` and `POST /sources/:id/api-key`: the new key, shown once. */
export const sourceWithKeySchema = z.object({ source: sourceSchema, apiKey: z.string() });

/** `POST /sources/:id/hmac-secret`: the new signing secret, shown once. */
export const hmacSecretResponseSchema = z.object({ secret: z.string() });

export type CreateSourceRequest = z.infer<typeof createSourceRequestSchema>;
export type UpdateSourceRequest = z.infer<typeof updateSourceRequestSchema>;
export type Source = z.infer<typeof sourceSchema>;
export type SourceWithKey = z.infer<typeof sourceWithKeySchema>;
export type HmacSecretResponse = z.infer<typeof hmacSecretResponseSchema>;
