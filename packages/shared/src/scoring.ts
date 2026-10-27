import { z } from 'zod';
import { displayTextSchema, timestampSchema } from './common.ts';

/** One short phrase in a list ("Logistics", "ready to buy within 3 months"). */
const phraseSchema = displayTextSchema(100);
const phraseList = z.array(phraseSchema).max(30);

/** Free text for the AI: line breaks are fine, other control characters are not. */
const notesSchema = z
  .string()
  .trim()
  .max(2000)
  .regex(/^(?:[^\p{Cc}\p{Cf}\p{Cs}\p{Co}]|[\n\t])*$/u);

/**
 * The ideal customer, in plain terms (Settings > Ideal customer). The AI is
 * told to use it as the yardstick: a lead that fits scores higher, a lead that
 * hits a deal-breaker scores lower.
 */
export const icpRubricSchema = z.strictObject({
  industries: phraseList,
  /** e.g. "11-50", "51-200". */
  companySizes: phraseList,
  /** ISO 3166-1 alpha-2 codes, uppercase. */
  countries: z
    .array(
      z
        .string()
        .trim()
        .toUpperCase()
        .regex(/^[A-Z]{2}$/),
    )
    .max(60),
  /** What tells you a lead is ready to buy. */
  budgetSignals: phraseList,
  /** Deal-breakers. */
  disqualifiers: phraseList,
  notes: notesSchema.nullable(),
});

export const icpRubricResponseSchema = icpRubricSchema.extend({
  /** Null until the first save. */
  updatedAt: timestampSchema.nullable(),
});

export const tierSchema = z.enum(['hot', 'warm', 'cold', 'junk']);

/** What the AI must answer with (SPEC §4.4). Anything else is rejected and retried once. */
export const scoreOutputSchema = z.strictObject({
  score: z.number().int().min(0).max(100),
  tier: tierSchema,
  isSpam: z.boolean(),
  confidence: z.number().min(0).max(1),
  reasons: z.array(z.string().trim().min(1).max(300)).min(1).max(8),
  // Models often write "suggestedReply": null when they have nothing to suggest (Gemini did in 22 of
  // 50 eval answers): that means "none", not a broken answer.
  suggestedReply: z.preprocess(
    (value) => (value === null ? undefined : value),
    z.string().trim().max(2000).optional(),
  ),
});

export type IcpRubric = z.infer<typeof icpRubricSchema>;
export type IcpRubricResponse = z.infer<typeof icpRubricResponseSchema>;
export type ScoreOutput = z.infer<typeof scoreOutputSchema>;
