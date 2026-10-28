import { z } from 'zod';
import { idSchema, timestampSchema } from './common.ts';

/** The filter on Settings > Change history. */
export const auditAreaSchema = z.enum([
  'rules',
  'sources',
  'ideal_customer',
  'integrations',
  'team',
  'general',
]);
export type AuditArea = z.infer<typeof auditAreaSchema>;

export const listHistoryQuerySchema = z.strictObject({
  area: auditAreaSchema.optional(),
  /** Only changes made by this person (a user id). */
  actor: idSchema.optional(),
  /** Only the last N days. */
  days: z.coerce.number().int().min(1).max(365).optional(),
  /** The `next` of the previous page. */
  before: z.string().max(100).optional(),
});
export type ListHistoryQuery = z.infer<typeof listHistoryQuerySchema>;

const flatValues = z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]));

export const historyEntrySchema = z.object({
  id: idSchema,
  createdAt: timestampSchema,
  area: auditAreaSchema,
  /** `entity.verb`, for example `rule.updated`. The web app has a sentence for each. */
  action: z.string(),
  entityType: z.string(),
  entityId: z.string().nullable(),
  /** Null when the system did it, or when the person has left (then name and email are null). */
  actor: z
    .object({ id: idSchema, name: z.string().nullable(), email: z.string().nullable() })
    .nullable(),
  /** Flat, readable values only: never a secret. */
  before: flatValues.nullable(),
  after: flatValues.nullable(),
});
export type HistoryEntry = z.infer<typeof historyEntrySchema>;

export const historyPageSchema = z.object({
  entries: z.array(historyEntrySchema),
  /** Pass as `before` for the next page; null on the last one. */
  next: z.string().nullable(),
});
export type HistoryPage = z.infer<typeof historyPageSchema>;
