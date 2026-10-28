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
    /** What the person wrote and said about the deal (the best signals). */
    message: string | null;
    budget: string | null;
    timeline: string | null;
    jobTitle: string | null;
    interest: string | null;
    customFields: Record<string, unknown>;
  };
  rubric: IcpRubric;
  /** The language the reasons and the suggested reply are written in (the workspace's language). */
  language?: 'en' | 'vi';
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
    lead.message,
    lead.budget,
    lead.timeline,
    lead.jobTitle,
    lead.interest,
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
  // The reasons are read by people, in the workspace's language.
  const say = (en: string, vi: string) => (input.language === 'vi' ? vi : en);
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
      reasons: [
        say(
          'The contact details look made up or like spam.',
          'Thông tin liên hệ có vẻ bịa đặt hoặc là thư rác.',
        ),
      ],
      facts,
    };
  }

  if (lead.email) {
    if (lead.isFreeMail) {
      score -= 5;
      reasons.push(
        say(
          'Uses a free email address, not a company one.',
          'Dùng email miễn phí, không phải email công ty.',
        ),
      );
    } else {
      score += 10;
      facts += 1;
      reasons.push(say('Uses a company email address.', 'Dùng email của công ty.'));
    }
  }
  if (lead.company) {
    score += 5;
    facts += 1;
    reasons.push(say(`Names a company (${lead.company}).`, `Có nêu công ty (${lead.company}).`));
  }
  if (lead.phone) {
    score += 3;
    facts += 1;
  }
  if (lead.firstName || lead.lastName) facts += 1;
  for (const field of [lead.message, lead.budget, lead.timeline, lead.jobTitle])
    if (field) facts += 1;

  if (lead.country) {
    facts += 1;
    if (rubric.countries.length > 0) {
      if (rubric.countries.includes(lead.country)) {
        score += 15;
        reasons.push(
          say(
            `Based in ${lead.country}, a country you target.`,
            `Ở ${lead.country}, một quốc gia bạn nhắm tới.`,
          ),
        );
      } else {
        score -= 5;
        reasons.push(
          say(
            `Based in ${lead.country}, outside the countries you target.`,
            `Ở ${lead.country}, ngoài các quốc gia bạn nhắm tới.`,
          ),
        );
      }
    }
  }

  const industry = rubric.industries.find((name) => text.includes(name.toLowerCase()));
  if (industry) {
    score += 25;
    reasons.push(say(`Looks like it works in ${industry}.`, `Có vẻ làm trong ngành ${industry}.`));
  }
  if (input.company && input.company.text) facts += 1;

  const signal = rubric.budgetSignals.find((name) => text.includes(name.toLowerCase()));
  if (signal) {
    score += 15;
    reasons.push(say(`Shows a buying signal: ${signal}.`, `Có dấu hiệu muốn mua: ${signal}.`));
  }

  const dealBreaker = rubric.disqualifiers.find((name) => text.includes(name.toLowerCase()));
  if (dealBreaker) {
    score -= 50;
    reasons.push(
      say(`Matches a deal-breaker: ${dealBreaker}.`, `Rơi vào điều loại trừ: ${dealBreaker}.`),
    );
  }

  score = Math.max(0, Math.min(100, score));
  if (reasons.length === 0) {
    reasons.push(say('Not enough information to tell.', 'Chưa đủ thông tin để đánh giá.'));
  }
  return {
    score,
    tier: tierOf(score),
    isSpam: false,
    confidence: Math.min(0.95, 0.35 + 0.1 * facts),
    reasons: reasons.slice(0, 8),
    facts,
  };
}
