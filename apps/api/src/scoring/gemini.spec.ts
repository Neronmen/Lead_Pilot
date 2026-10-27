import { GeminiLlmProvider } from './http-llm.providers';
import { chooseLlm, geminiWarning } from './llm.factory';
import { costUsd, LlmError } from './llm.provider';
import { PacedLlm } from './paced-llm';

// A fake key, only ever sent to a fake fetch.
const KEY = 'FAKE-gemini-key-for-tests-0000';
const ok = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));

describe('GeminiLlmProvider (fake fetch: nothing leaves the machine)', () => {
  it('asks for JSON output, sends the key in a header only, and reads text and tokens', async () => {
    let seen: { url: string; headers: Headers; body: string } | undefined;
    const provider = new GeminiLlmProvider(KEY, 'gemini-2.5-flash-lite', (url, init) => {
      seen = { url: String(url), headers: new Headers(init?.headers), body: String(init?.body) };
      return ok({
        candidates: [{ content: { parts: [{ text: '{"score":' }, { text: '50}' }] } }],
        usageMetadata: { promptTokenCount: 321, candidatesTokenCount: 45 },
      });
    });
    expect(await provider.complete({ system: 'sys', user: 'usr' })).toEqual({
      text: '{"score":50}',
      inputTokens: 321,
      outputTokens: 45,
      thinkingTokens: 0,
    });
    expect(seen!.url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent',
    );
    expect(seen!.headers.get('x-goog-api-key')).toBe(KEY);
    // The key is in neither the URL nor the body (both end up in logs and proxies).
    expect(seen!.url).not.toContain(KEY);
    expect(seen!.body).not.toContain(KEY);
    expect(JSON.parse(seen!.body)).toEqual({
      systemInstruction: { parts: [{ text: 'sys' }] },
      contents: [{ role: 'user', parts: [{ text: 'usr' }] }],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 4096,
        responseMimeType: 'application/json',
      },
    });
  });

  it('turns every failure into an LlmError that holds no key, request or answer', async () => {
    const make = (doFetch: typeof fetch) =>
      new GeminiLlmProvider(KEY, 'gemini-2.5-flash-lite', doFetch);
    const failures: (typeof fetch)[] = [
      () => Promise.reject(new Error(`connect ECONNREFUSED with ${KEY}`)),
      () => Promise.resolve(new Response(`{"error":"bad key ${KEY}"}`, { status: 403 })),
      () => Promise.resolve(new Response('<html>', { status: 200 })),
      () => ok({ candidates: [] }),
      () => ok({ candidates: [{ content: { parts: [] } }] }),
      () => ok({ promptFeedback: { blockReason: 'SAFETY' } }),
      () =>
        ok({
          candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '{"sc' }] } }],
        }),
    ];
    for (const doFetch of failures) {
      const error = await make(doFetch)
        .complete({ system: 's', user: 'u' })
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(LlmError);
      expect(String((error as Error).message)).not.toMatch(/FAKE-gemini|html|bad key/);
    }
  });

  it('says WHY it stopped when the answer was cut off (a fixed word, never the answer)', async () => {
    const provider = new GeminiLlmProvider(KEY, 'gemini-3.5-flash-lite', () =>
      ok({
        candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '{"secret' }] } }],
      }),
    );
    const error = await provider.complete({ system: 's', user: 'u' }).catch((e: unknown) => e);
    expect((error as Error).message).toBe('The AI service stopped early (MAX_TOKENS)');
  });

  it('gives every failure a short fixed code that can be counted, and reports thinking tokens', async () => {
    const codeOf = async (doFetch: typeof fetch) =>
      (
        (await new GeminiLlmProvider(KEY, 'gemini-3.5-flash-lite', doFetch)
          .complete({ system: 's', user: 'u' })
          .catch((e: unknown) => e)) as LlmError
      ).code;
    const respond = (status: number) => () => Promise.resolve(new Response('{}', { status }));
    expect(await codeOf(respond(429))).toBe('http_429');
    expect(await codeOf(respond(503))).toBe('http_503');
    expect(await codeOf(() => Promise.reject(new Error('boom')))).toBe('unreachable');
    expect(
      await codeOf(() => Promise.reject(Object.assign(new Error('t'), { name: 'TimeoutError' }))),
    ).toBe('timeout');
    expect(await codeOf(() => Promise.resolve(new Response('<html>', { status: 200 })))).toBe(
      'unreadable',
    );
    expect(await codeOf(() => ok({ promptFeedback: { blockReason: 'SAFETY' } }))).toBe(
      'blocked_SAFETY',
    );
    expect(
      await codeOf(() =>
        ok({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '{' }] } }] }),
      ),
    ).toBe('finish_MAX_TOKENS');
    expect(await codeOf(() => ok({ candidates: [] }))).toBe('no_text');

    const answered = await new GeminiLlmProvider(KEY, 'gemini-3.5-flash-lite', () =>
      ok({
        candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{}' }] } }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, thoughtsTokenCount: 700 },
      }),
    ).complete({ system: 's', user: 'u' });
    expect(answered.thinkingTokens).toBe(700);
  });

  it('refuses a model name that could change the URL path', () => {
    for (const bad of [
      '',
      '../x',
      'a/b',
      'a b',
      'gemini?key=x',
      'gemini:generate',
      '-x',
      'a'.repeat(101),
    ]) {
      expect(() => new GeminiLlmProvider(KEY, bad, () => ok({}))).toThrow(LlmError);
    }
    expect(() => new GeminiLlmProvider(KEY, 'gemini-3.5-flash-lite', () => ok({}))).not.toThrow();
  });

  it('is tracked as free-tier ($0), while an unlisted model of another provider is not', () => {
    expect(costUsd('gemini-3.5-flash-lite', 1_000_000, 1_000_000)).toBe(0);
    expect(costUsd('some-other-model', 1_000_000, 1_000_000)).toBeGreaterThan(0);
  });
});

describe('choosing Gemini, and the production warning', () => {
  it('"gemini" needs its key; "auto" tries Anthropic, then OpenAI, then Gemini, else the free mock', () => {
    expect(chooseLlm({ LLM_PROVIDER: 'gemini', GEMINI_API_KEY: KEY }).name).toBe('gemini');
    expect(chooseLlm({ LLM_PROVIDER: 'gemini' }).name).toBe('mock'); // no key: stays free
    expect(chooseLlm({ LLM_PROVIDER: 'auto', GEMINI_API_KEY: KEY }).name).toBe('gemini');
    expect(
      chooseLlm({ LLM_PROVIDER: 'auto', GEMINI_API_KEY: KEY, OPENAI_API_KEY: 'sk-1234567890' })
        .name,
    ).toBe('openai');
    expect(chooseLlm({ LLM_PROVIDER: 'mock', GEMINI_API_KEY: KEY }).name).toBe('mock');
    expect(
      chooseLlm({ LLM_PROVIDER: 'gemini', GEMINI_API_KEY: KEY, LLM_MODEL: 'gemini-3.5-flash-lite' })
        .model,
    ).toBe('gemini-3.5-flash-lite');
  });

  it('warns only for Gemini in production without the paid-tier confirmation, and never prints a key', () => {
    const base = { provider: 'gemini', NODE_ENV: 'production', GEMINI_PAID_TIER: 'false' };
    const warning = geminiWarning(base);
    expect(warning).toMatch(/free tier/i);
    expect(warning).toMatch(/fake or demo data/);
    expect(warning).not.toContain(KEY);
    expect(geminiWarning({ ...base, GEMINI_PAID_TIER: 'true' })).toBeNull();
    expect(geminiWarning({ ...base, NODE_ENV: 'development' })).toBeNull();
    expect(geminiWarning({ ...base, NODE_ENV: 'test' })).toBeNull();
    expect(geminiWarning({ ...base, provider: 'anthropic' })).toBeNull();
    expect(geminiWarning({ ...base, provider: 'mock' })).toBeNull();
  });
});

describe('pacing (free tiers allow only a few calls a minute)', () => {
  it('spaces concurrent calls apart in order, and leaves the mock alone', async () => {
    const calls: number[] = [];
    const inner = {
      name: 'gemini',
      model: 'gemini-3.5-flash-lite',
      complete: () => {
        calls.push(Date.now());
        return Promise.resolve({ text: '{}', inputTokens: 1, outputTokens: 1 });
      },
    };
    const paced = new PacedLlm(inner, 600); // one call every 100 ms
    const started = Date.now();
    await Promise.all([1, 2, 3, 4].map(() => paced.complete({ system: 's', user: 'u' })));
    expect(calls).toHaveLength(4);
    expect(calls[3]! - started).toBeGreaterThanOrEqual(270); // the 4th waited about 300 ms
    for (let i = 1; i < calls.length; i += 1)
      expect(calls[i]! - calls[i - 1]!).toBeGreaterThanOrEqual(80);
    expect(paced.name).toBe('gemini');
    expect(paced.model).toBe('gemini-3.5-flash-lite');

    const real = chooseLlm({
      LLM_PROVIDER: 'gemini',
      GEMINI_API_KEY: KEY,
      LLM_MAX_REQUESTS_PER_MINUTE: 12,
    });
    expect(real).toBeInstanceOf(PacedLlm);
    expect(chooseLlm({ LLM_PROVIDER: 'mock', LLM_MAX_REQUESTS_PER_MINUTE: 12 })).not.toBeInstanceOf(
      PacedLlm,
    );
    expect(chooseLlm({ LLM_PROVIDER: 'gemini', GEMINI_API_KEY: KEY })).not.toBeInstanceOf(PacedLlm);
  });
});
