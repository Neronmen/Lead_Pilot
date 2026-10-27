import { AnthropicLlmProvider, GeminiLlmProvider, OpenAiLlmProvider } from './http-llm.providers';
import type { LlmProvider } from './llm.provider';
import { PacedLlm } from './paced-llm';
import { MockLlmProvider } from './mock-llm.provider';

/**
 * Which AI answers: "auto" uses a real one only when its key is set (Anthropic
 * first), so with no key the mock runs and the whole app works for free.
 */
export function chooseLlm(env: {
  /** Calls per minute the AI may receive from this process (0 or unset: no pacing). */
  LLM_MAX_REQUESTS_PER_MINUTE?: number;
  LLM_PROVIDER: 'auto' | 'mock' | 'anthropic' | 'openai' | 'gemini';
  LLM_MODEL?: string;
  ANTHROPIC_API_KEY?: string;
  OPENAI_API_KEY?: string;
  GEMINI_API_KEY?: string;
}): LlmProvider {
  const llm = pick(env);
  const perMinute = env.LLM_MAX_REQUESTS_PER_MINUTE ?? 0;
  return perMinute > 0 && llm.name !== 'mock' ? new PacedLlm(llm, perMinute) : llm;
}

function pick(env: Parameters<typeof chooseLlm>[0]): LlmProvider {
  const wanted = env.LLM_PROVIDER;
  if ((wanted === 'anthropic' || wanted === 'auto') && env.ANTHROPIC_API_KEY) {
    return new AnthropicLlmProvider(env.ANTHROPIC_API_KEY, env.LLM_MODEL ?? 'claude-haiku-5-5');
  }
  if ((wanted === 'openai' || wanted === 'auto') && env.OPENAI_API_KEY) {
    return new OpenAiLlmProvider(env.OPENAI_API_KEY, env.LLM_MODEL ?? 'gpt-4o-mini');
  }
  if ((wanted === 'gemini' || wanted === 'auto') && env.GEMINI_API_KEY) {
    return new GeminiLlmProvider(env.GEMINI_API_KEY, env.LLM_MODEL ?? 'gemini-2.5-flash-lite');
  }
  return new MockLlmProvider();
}

/**
 * Gemini's free tier lets Google use the content sent to it to improve its products. In production
 * that is only acceptable on a paid tier, so running it there without saying so (GEMINI_PAID_TIER=true)
 * gets a warning at startup. Returns the warning, or null.
 */
export function geminiWarning(env: {
  provider: string;
  NODE_ENV: string;
  GEMINI_PAID_TIER: string;
}): string | null {
  if (
    env.provider !== 'gemini' ||
    env.NODE_ENV !== 'production' ||
    env.GEMINI_PAID_TIER === 'true'
  ) {
    return null;
  }
  return 'Gemini is the AI in production, but GEMINI_PAID_TIER is not "true". On Google\'s free tier, Google may use submitted leads to improve its products: use it only with fake or demo data. For real customers use a paid tier (then set GEMINI_PAID_TIER=true) or another provider.';
}
