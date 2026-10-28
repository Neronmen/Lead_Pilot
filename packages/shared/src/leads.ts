import { z } from 'zod';
import { idSchema, timestampSchema } from './common.ts';
import { sourceTypeSchema } from './sources.ts';

export const leadStatusSchema = z.enum([
  'NEW',
  'PROCESSING',
  'NEEDS_REVIEW',
  'SCORED',
  'ROUTED',
  'FAILED',
]);

export const infoLevelSchema = z.enum(['limited', 'enough', 'rich']);
/** Why a lead waits for a person (Review queue). */
export const reviewReasonSchema = z.enum(['limited_info', 'low_confidence', 'rated_without_ai']);
export const leadOutcomeSchema = z.enum(['NONE', 'CONTACTED', 'QUALIFIED', 'WON', 'LOST', 'BAD']);

export const leadTierSchema = z.enum(['HOT', 'WARM', 'COLD', 'JUNK']);

/** `GET /leads` query: all optional. `q` searches email, name, company and phone. */
export const listLeadsQuerySchema = z.strictObject({
  q: z.string().trim().max(100).optional(),
  status: leadStatusSchema.optional(),
  sourceId: idSchema.optional(),
  tier: leadTierSchema.optional(),
  /** "true": only free-mail leads; "false": only company addresses. */
  freeMail: z.enum(['true', 'false']).optional(),
  /** "oldest" is the Review queue (oldest waiting first); the default is newest first. */
  order: z.enum(['newest', 'oldest']).default('newest'),
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
  /** Null until the lead has been scored. */
  tier: leadTierSchema.nullable(),
  score: z.number().int().nullable(),
  confidence: z.number().nullable(),
  /** How much the lead told us (null until rated). */
  infoLevel: infoLevelSchema.nullable(),
  reviewReason: reviewReasonSchema.nullable(),
  /** What sales did with the lead: Won, Lost or Bad lead are set by a person. */
  outcome: leadOutcomeSchema,
  source: z.object({ id: idSchema, name: z.string(), type: sourceTypeSchema }),
  owner: z.object({ id: idSchema, name: z.string().nullable() }).nullable(),
  /** How many submissions this lead holds: more than 1 means later ones were merged into it. */
  submissions: z.number().int().positive(),
  /** Set when a later submission had the same phone but a different email: kept apart, for a person to decide. */
  possibleDuplicateOf: z
    .object({ id: idSchema, name: z.string().nullable(), email: z.string().nullable() })
    .nullable(),
  createdAt: timestampSchema,
});

/** Newest first. `nextCursor` is null on the last page. */
export const leadListSchema = z.object({
  items: z.array(leadListItemSchema),
  nextCursor: idSchema.nullable(),
});

/** The AI's latest answer about a lead, as the detail page shows it. */
export const leadScoreSchema = z.object({
  id: idSchema,
  /** "anthropic" | "openai" | "mock" | "rules". */
  provider: z.string(),
  model: z.string(),
  /** True when the rules rated it, not the AI (budget reached, or the AI's answer was unusable). */
  ratedWithoutAi: z.boolean(),
  reasons: z.array(z.string()),
  suggestedReply: z.string().nullable(),
  costUsd: z.number(),
  createdAt: timestampSchema,
});

export const leadEventSchema = z.object({
  id: idSchema,
  /** "ingested" | "merged" | "possible_duplicate" | "enriched" | "scored" | "reviewed". */
  type: z.string(),
  payload: z.record(z.string(), z.unknown()),
  createdAt: timestampSchema,
});

/** `GET /leads/:id`. */
export const leadDetailSchema = leadListItemSchema.extend({
  domain: z.string().nullable(),
  /** What the person wrote and said about the deal. */
  message: z.string().nullable(),
  budget: z.string().nullable(),
  timeline: z.string().nullable(),
  jobTitle: z.string().nullable(),
  interest: z.string().nullable(),
  outcomeSetBy: z.object({ id: idSchema, name: z.string().nullable() }).nullable(),
  outcomeSetAt: timestampSchema.nullable(),
  customFields: z.record(z.string(), z.unknown()),
  /** What was read from the company's website; null when there is no domain or no lookup yet. */
  companyInfo: z
    .object({
      status: z.enum(['ok', 'unreachable']),
      title: z.string().nullable(),
      description: z.string().nullable(),
    })
    .nullable(),
  latestScore: leadScoreSchema.nullable(),
  /** Newest first. */
  events: z.array(leadEventSchema),
});

/**
 * `POST /leads/:id/review`: a person checks the AI. "approve" keeps its rating and
 * clears the review flag; "override" sets the tier (and optionally the score) and
 * is kept as a correction the AI is later measured against. A person's rating is
 * never replaced by a later automatic one.
 */
export const reviewLeadRequestSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('approve') }),
  z.strictObject({
    action: z.literal('override'),
    tier: leadTierSchema,
    score: z.number().int().min(0).max(100).optional(),
    note: z.string().trim().min(1).max(500).optional(),
  }),
]);

/** `POST /leads/:id/outcome`: a rep records how the lead ended. "BAD" means not a real lead (counts as junk). */
export const setOutcomeRequestSchema = z.strictObject({
  outcome: z.enum(['NONE', 'WON', 'LOST', 'BAD']),
});

/** `GET /overview`: the last 30 days. */
export const overviewSchema = z.object({
  /** Leads created in the last 30 days. */
  leads: z.number().int().nonnegative(),
  rated: z.number().int().nonnegative(),
  /** Share of rated leads that were filtered as junk, 0-100; null before any lead is rated. */
  junkPercent: z.number().min(0).max(100).nullable(),
  /** Median seconds from a lead arriving to its first rating; null before any lead is rated. */
  medianSecondsToFirstRating: z.number().nonnegative().nullable(),
  byTier: z.object({
    HOT: z.number().int().nonnegative(),
    WARM: z.number().int().nonnegative(),
    COLD: z.number().int().nonnegative(),
    JUNK: z.number().int().nonnegative(),
  }),
  byInfoLevel: z.object({
    limited: z.number().int().nonnegative(),
    enough: z.number().int().nonnegative(),
    rich: z.number().int().nonnegative(),
  }),
});

/** `POST /leads/rescore` (Owner/Admin): ask the AI to look again. */
export const rescoreRequestSchema = z.strictObject({
  /** "without_ai": leads rated by the rules; "open": every lead not yet routed or failed. */
  scope: z.enum(['without_ai', 'open']),
});
export const rescoreResponseSchema = z.object({ queued: z.number().int().nonnegative() });

export type LeadStatus = z.infer<typeof leadStatusSchema>;
export type ListLeadsQuery = z.infer<typeof listLeadsQuerySchema>;
export type LeadListItem = z.infer<typeof leadListItemSchema>;
export type LeadList = z.infer<typeof leadListSchema>;
export type LeadTier = z.infer<typeof leadTierSchema>;
export type LeadScore = z.infer<typeof leadScoreSchema>;
export type LeadEvent = z.infer<typeof leadEventSchema>;
export type LeadDetail = z.infer<typeof leadDetailSchema>;
export type ReviewLeadRequest = z.infer<typeof reviewLeadRequestSchema>;
export type SetOutcomeRequest = z.infer<typeof setOutcomeRequestSchema>;
export type Overview = z.infer<typeof overviewSchema>;
export type InfoLevel = z.infer<typeof infoLevelSchema>;
export type ReviewReason = z.infer<typeof reviewReasonSchema>;
export type RescoreRequest = z.infer<typeof rescoreRequestSchema>;
export type RescoreResponse = z.infer<typeof rescoreResponseSchema>;
