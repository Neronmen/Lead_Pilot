import { AnthropicLlmProvider, OpenAiLlmProvider } from './http-llm.providers';
import type { LlmProvider } from './llm.provider';
import { MockLlmProvider } from './mock-llm.provider';

/**
 * Which AI answers: "auto" uses a real one only when its key is set (Anthropic
 * first), so with no key the mock runs and the whole app works for free.
 */
export function chooseLlm(env: {
  LLM_PROVIDER: 'auto' | 'mock' | 'anthropic' | 'openai';
  LLM_MODEL?: string;
  ANTHROPIC_API_KEY?: string;
  OPENAI_API_KEY?: string;
}): LlmProvider {
  const wanted = env.LLM_PROVIDER;
  if ((wanted === 'anthropic' || wanted === 'auto') && env.ANTHROPIC_API_KEY) {
    return new AnthropicLlmProvider(env.ANTHROPIC_API_KEY, env.LLM_MODEL ?? 'claude-haiku-5-5');
  }
  if ((wanted === 'openai' || wanted === 'auto') && env.OPENAI_API_KEY) {
    return new OpenAiLlmProvider(env.OPENAI_API_KEY, env.LLM_MODEL ?? 'gpt-4o-mini');
  }
  return new MockLlmProvider();
}
