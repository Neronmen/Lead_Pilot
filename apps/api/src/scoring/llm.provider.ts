/** One question to the AI and what it answered, with the usage that costs money. */
export interface LlmRequest {
  system: string;
  user: string;
}

export interface LlmResponse {
  /** The model's raw text answer (we validate it ourselves). */
  text: string;
  inputTokens: number;
  outputTokens: number;
  /** Tokens the model spent "thinking" before answering, when the provider reports them. */
  thinkingTokens?: number;
}

/** A way to ask an AI model. Real ones need an API key; the mock needs nothing. */
export interface LlmProvider {
  /** "anthropic" | "openai" | "mock": recorded on every score. */
  readonly name: string;
  readonly model: string;
  complete(request: LlmRequest): Promise<LlmResponse>;
}

export const LLM_PROVIDER = Symbol('LLM_PROVIDER');

/**
 * The AI could not be reached or refused. The message holds a status code at
 * most: never the request, the answer or a key, because it ends up in logs.
 */
export class LlmError extends Error {
  /**
   * A short fixed code for counting failures (`http_429`, `timeout`, `finish_MAX_TOKENS`...): safe to
   * print, unlike anything the AI service sent back.
   */
  constructor(
    message: string,
    readonly code: string = 'error',
  ) {
    super(message);
    this.name = 'LlmError';
  }
}

/**
 * Prices per million tokens in US dollars, for the cost shown in the app. These
 * are estimates kept by hand: update them when a provider changes its prices.
 * A model that is not listed costs 0 here (the usage is still recorded).
 */
const PRICE_PER_MILLION: Record<string, { input: number; output: number }> = {
  'claude-haiku-5-5': { input: 1, output: 5 },
  'claude-sonnet-5-5': { input: 3, output: 15 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
};

/** Used for a model that is not listed: deliberately high, so the budget still works (and is never free by accident). */
const UNLISTED_PRICE = { input: 15, output: 75 };

export function costUsd(model: string, inputTokens: number, outputTokens: number): number {
  // The mock and the rules cost nothing; everything else costs at least the unlisted price.
  if (model === 'mock-1' || model === 'rules-1') return 0;
  // Gemini is tracked as $0: it is used on Google's free tier (rate-limited, no charge). If you
  // move to a paid tier, add the model and its prices to the table above and drop this line.
  if (model.startsWith('gemini-')) return 0;
  const price = PRICE_PER_MILLION[model] ?? UNLISTED_PRICE;
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
}
