import type { IcpRubric, ScoreOutput } from '@leadpilot/shared';

/** What scoring looks at about one lead. All of it is data from the outside world. */
export interface ScoringInput {
  lead: {
    email: string | null;
    phone: string | null;
    firstName: string | null;
    lastName: string | null;
    company: string | null;
    domain: string | null;
    country: string | null;
    isFreeMail: boolean;
    customFields: Record<string, unknown>;
  };
  rubric: IcpRubric;
  /** What enrichment read from the company's website (may be empty). */
  company: { title: string | null; description: string | null; text: string } | null;
}

export const tierOf = (score: number): ScoreOutput['tier'] =>
  score >= 75 ? 'hot' : score >= 50 ? 'warm' : score >= 25 ? 'cold' : 'junk';

const SPAM_LOCAL = /^(test|asdf|qwerty|xxx|aaa+|none|noreply|no-reply)\d*$/i;

/** All the text we have about the lead, lower-cased, for phrase matching. */
function haystack(input: ScoringInput): string {
  const { lead, company } = input;
  return [
    lead.email,
    lead.company,
    lead.domain,
    JSON.stringify(lead.customFields),
    company?.title,
    company?.description,
    company?.text,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

/**
 * A deterministic score from the ideal customer, with no AI. It is the fallback
 * when the AI is unavailable or its answer is unusable, and the engine of the
 * mock provider (so the demo and the tests are repeatable). `facts` is how much
 * we know about the lead: it sets the mock's confidence.
 */
export function ruleScore(input: ScoringInput): ScoreOutput & { facts: number } {
  const { lead, rubric } = input;
  const text = haystack(input);
  const reasons: string[] = [];
  let score = 35;
  let facts = 0;

  const local = lead.email?.split('@')[0] ?? '';
  const names = `${lead.firstName ?? ''} ${lead.lastName ?? ''}`;
  const isSpam = SPAM_LOCAL.test(local) || /https?:|www\./i.test(names);
  if (isSpam) {
    return {
      score: 5,
      tier: 'junk',
      isSpam: true,
      confidence: 0.9,
      reasons: ['The contact details look made up or like spam.'],
      facts,
    };
  }

  if (lead.email) {
    if (lead.isFreeMail) {
      score -= 5;
      reasons.push('Uses a free email address, not a company one.');
    } else {
      score += 10;
      facts += 1;
      reasons.push('Uses a company email address.');
    }
  }
  if (lead.company) {
    score += 5;
    facts += 1;
    reasons.push(`Names a company (${lead.company}).`);
  }
  if (lead.phone) {
    score += 3;
    facts += 1;
  }
  if (lead.firstName || lead.lastName) facts += 1;

  if (lead.country) {
    facts += 1;
    if (rubric.countries.length > 0) {
      if (rubric.countries.includes(lead.country)) {
        score += 15;
        reasons.push(`Based in ${lead.country}, a country you target.`);
      } else {
        score -= 5;
        reasons.push(`Based in ${lead.country}, outside the countries you target.`);
      }
    }
  }

  const industry = rubric.industries.find((name) => text.includes(name.toLowerCase()));
  if (industry) {
    score += 25;
    reasons.push(`Looks like it works in ${industry}.`);
  }
  if (input.company && input.company.text) facts += 1;

  const signal = rubric.budgetSignals.find((name) => text.includes(name.toLowerCase()));
  if (signal) {
    score += 15;
    reasons.push(`Shows a buying signal: ${signal}.`);
  }

  const dealBreaker = rubric.disqualifiers.find((name) => text.includes(name.toLowerCase()));
  if (dealBreaker) {
    score -= 50;
    reasons.push(`Matches a deal-breaker: ${dealBreaker}.`);
  }

  score = Math.max(0, Math.min(100, score));
  if (reasons.length === 0) reasons.push('Not enough information to tell.');
  return {
    score,
    tier: tierOf(score),
    isSpam: false,
    confidence: Math.min(0.95, 0.35 + 0.1 * facts),
    reasons: reasons.slice(0, 8),
    facts,
  };
}
