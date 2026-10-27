import { z } from 'zod';
import { idSchema, timestampSchema } from './common.ts';
import { sourceTypeSchema } from './sources.ts';

export const leadStatusSchema = z.enum(['NEW', 'PROCESSING', 'NEEDS_REVIEW', 'ROUTED', 'FAILED']);

/** `GET /leads` query: all optional. `q` searches email, name, company and phone. */
export const listLeadsQuerySchema = z.strictObject({
  q: z.string().trim().max(100).optional(),
  status: leadStatusSchema.optional(),
  sourceId: idSchema.optional(),
  /** "true": only free-mail leads; "false": only company addresses. */
  freeMail: z.enum(['true', 'false']).optional(),
  /** `nextCursor` of the previous page. */
  cursor: idSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const leadListItemSchema = z.object({
  id: idSchema,
  /** First and last name joined; null when the sender gave none. */
  name: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  company: z.string().nullable(),
  country: z.string().nullable(),
  isFreeMail: z.boolean(),
  status: leadStatusSchema,
  source: z.object({ id: idSchema, name: z.string(), type: sourceTypeSchema }),
  owner: z.object({ id: idSchema, name: z.string().nullable() }).nullable(),
  createdAt: timestampSchema,
});

/** Newest first. `nextCursor` is null on the last page. */
export const leadListSchema = z.object({
  items: z.array(leadListItemSchema),
  nextCursor: idSchema.nullable(),
});

export type LeadStatus = z.infer<typeof leadStatusSchema>;
export type ListLeadsQuery = z.infer<typeof listLeadsQuerySchema>;
export type LeadListItem = z.infer<typeof leadListItemSchema>;
export type LeadList = z.infer<typeof leadListSchema>;
