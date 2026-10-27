import { LlmError, type LlmProvider, type LlmRequest, type LlmResponse } from './llm.provider';

const TIMEOUT_MS = 30_000;

type Fetch = typeof fetch;

/**
 * POSTs JSON and returns the parsed answer. The key travels in a header only,
 * and every failure becomes an LlmError with a status code at most.
 */
async function post(
  doFetch: Fetch,
  url: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<unknown> {
  let response: Response;
  try {
    response = await doFetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new LlmError('The AI service could not be reached');
  }
  if (!response.ok) throw new LlmError(`The AI service answered ${response.status}`);
  try {
    return await response.json();
  } catch {
    throw new LlmError('The AI service sent an unreadable answer');
  }
}

const num = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;

/** Anthropic Messages API (https://api.anthropic.com/v1/messages). */
export class AnthropicLlmProvider implements LlmProvider {
  readonly name = 'anthropic';

  constructor(
    private readonly apiKey: string,
    readonly model: string,
    private readonly doFetch: Fetch = fetch,
  ) {}

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const data = (await post(
      this.doFetch,
      'https://api.anthropic.com/v1/messages',
      { 'x-api-key': this.apiKey, 'anthropic-version': '2023-06-01' },
      {
        model: this.model,
        max_tokens: 800,
        temperature: 0,
        system: request.system,
        messages: [{ role: 'user', content: request.user }],
      },
    )) as {
      content?: { type?: string; text?: string }[];
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const text = data.content?.find((part) => part.type === 'text')?.text;
    if (typeof text !== 'string') throw new LlmError('The AI service sent no text');
    return {
      text,
      inputTokens: num(data.usage?.input_tokens),
      outputTokens: num(data.usage?.output_tokens),
    };
  }
}

/** OpenAI Chat Completions API (https://api.openai.com/v1/chat/completions). */
export class OpenAiLlmProvider implements LlmProvider {
  readonly name = 'openai';

  constructor(
    private readonly apiKey: string,
    readonly model: string,
    private readonly doFetch: Fetch = fetch,
  ) {}

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const data = (await post(
      this.doFetch,
      'https://api.openai.com/v1/chat/completions',
      { authorization: `Bearer ${this.apiKey}` },
      {
        model: this.model,
        temperature: 0,
        max_tokens: 800,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: request.system },
          { role: 'user', content: request.user },
        ],
      },
    )) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const text = data.choices?.[0]?.message?.content;
    if (typeof text !== 'string') throw new LlmError('The AI service sent no text');
    return {
      text,
      inputTokens: num(data.usage?.prompt_tokens),
      outputTokens: num(data.usage?.completion_tokens),
    };
  }
}

/** A model name goes into the URL path: letters, digits, dots, dashes and underscores only. */
const GEMINI_MODEL = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

/**
 * Google Gemini API (generateContent, JSON output mode). The key goes in the
 * `x-goog-api-key` header, never in the URL (URLs end up in logs and proxies).
 *
 * The free tier lets Google use what is sent to improve its products: see the
 * warning in the README before sending anything that is not fake or demo data.
 */
export class GeminiLlmProvider implements LlmProvider {
  readonly name = 'gemini';

  constructor(
    private readonly apiKey: string,
    readonly model: string,
    private readonly doFetch: Fetch = fetch,
  ) {
    if (!GEMINI_MODEL.test(model)) throw new LlmError('The Gemini model name is not valid');
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const data = (await post(
      this.doFetch,
      `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent`,
      { 'x-goog-api-key': this.apiKey },
      {
        systemInstruction: { parts: [{ text: request.system }] },
        contents: [{ role: 'user', parts: [{ text: request.user }] }],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 800,
          responseMimeType: 'application/json',
        },
      },
    )) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    };
    const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('');
    if (!text) throw new LlmError('The AI service sent no text');
    return {
      text,
      inputTokens: num(data.usageMetadata?.promptTokenCount),
      outputTokens: num(data.usageMetadata?.candidatesTokenCount),
    };
  }
}
