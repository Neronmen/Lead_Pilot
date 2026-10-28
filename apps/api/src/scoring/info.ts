import type { ScoreOutput } from '@leadpilot/shared';
import type { ScoringInput } from './rules';

export type InfoLevel = 'limited' | 'enough' | 'rich';

/** Why a lead waits for a person: shown in the Review queue in plain words. */
export type ReviewReason = 'limited_info' | 'low_confidence' | 'rated_without_ai';

/** The Hot tier starts here; a lead with limited information is kept below it. */
export const HOT_FROM = 75;

/**
 * How much we know about a lead, from which of these exist: company, what they wrote, budget,
 * timeline, job title, and a readable company website (the enrichment result).
 * 0-1 of them: limited. 2-3: enough. 4 or more: rich.
 */
export function informationLevel(
  lead: Pick<ScoringInput['lead'], 'company' | 'message' | 'budget' | 'timeline' | 'jobTitle'>,
  company: ScoringInput['company'],
): { level: InfoLevel; have: string[] } {
  const have = [
    lead.company ? 'company' : null,
    lead.message ? 'message' : null,
    lead.budget ? 'budget' : null,
    lead.timeline ? 'timeline' : null,
    lead.jobTitle ? 'jobTitle' : null,
    company && company.text ? 'website' : null,
  ].filter((name): name is string => name !== null);
  return { level: have.length <= 1 ? 'limited' : have.length <= 3 ? 'enough' : 'rich', have };
}

/**
 * With limited information the rating is a guess, so it never says Hot: the tier is lowered to
 * Warm and the score kept under the Hot line. (Cold and Junk stay as they are.)
 */
export function capForInfo(output: ScoreOutput, level: InfoLevel): ScoreOutput {
  if (level !== 'limited') return output;
  const tier = output.tier === 'hot' ? 'warm' : output.tier;
  return { ...output, tier, score: Math.min(output.score, HOT_FROM - 1) };
}

/** The reason a lead needs a human look, or null when it does not. Spam never does. */
export function reviewReasonOf(input: {
  fallback: boolean;
  level: InfoLevel;
  isSpam: boolean;
  confidence: number;
  threshold: number;
}): ReviewReason | null {
  if (input.fallback) return 'rated_without_ai';
  if (input.isSpam) return null;
  if (input.level === 'limited') return 'limited_info';
  return input.confidence < input.threshold ? 'low_confidence' : null;
}
