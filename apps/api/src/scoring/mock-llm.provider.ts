import { LlmError, type LlmProvider, type LlmRequest, type LlmResponse } from './llm.provider';
import { ruleScore, type ScoringInput } from './rules';

/** The text between `<tag>` and `</tag>`, parsed as JSON. */
function block(message: string, tag: string): unknown {
  const match = new RegExp(`<${tag}>\\n([\\s\\S]*?)\\n</${tag}>`).exec(message);
  if (!match) throw new LlmError('mock: prompt block missing');
  return JSON.parse(match[1]!);
}

/**
 * A stand-in AI for the demo and the tests: no network, no key, no cost, and
 * the same lead always gets the same answer. It reads the very prompt a real
 * model would get and answers with the rule-based score, in the JSON shape the
 * real ones must use. Not intelligent, but it exercises everything around it.
 */
export class MockLlmProvider implements LlmProvider {
  readonly name = 'mock';
  readonly model = 'mock-1';

  complete(request: LlmRequest): Promise<LlmResponse> {
    const rubric = block(request.user, 'ideal_customer') as ScoringInput['rubric'];
    const data = block(request.user, 'lead_data') as {
      name: string | null;
      email: string | null;
      freeEmail: boolean;
      phone: string | null;
      company: string | null;
      website: string | null;
      country: string | null;
      other: Record<string, unknown>;
    };
    const company = block(request.user, 'company_website') as ScoringInput['company'];
    const [first, ...rest] = (data.name ?? '').split(' ');
    const { facts: _facts, ...answer } = ruleScore({
      rubric,
      company,
      lead: {
        email: data.email,
        phone: data.phone,
        firstName: first || null,
        lastName: rest.join(' ') || null,
        company: data.company,
        domain: data.website,
        country: data.country,
        isFreeMail: data.freeEmail,
        customFields: data.other,
      },
    });
    const text = JSON.stringify(answer);
    return Promise.resolve({
      text,
      inputTokens: Math.ceil((request.system.length + request.user.length) / 4),
      outputTokens: Math.ceil(text.length / 4),
    });
  }
}
