import { normalizePayload } from './normalize';
import { FixedWindowLimiter, MemoryWindowStore } from './rate-limiter';

const ok = (payload: Record<string, unknown>, country: string | null = null) => {
  const result = normalizePayload(payload, country);
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.issues)}`);
  return result.lead;
};
const issues = (payload: Record<string, unknown>, country: string | null = null) => {
  const result = normalizePayload(payload, country);
  if (result.ok) throw new Error('expected issues');
  return result.issues;
};

describe('normalizePayload', () => {
  it('lowercases the email, derives the company domain, and keeps unknown fields', () => {
    expect(ok({ email: '  Ann@Acme.COM ', first_name: 'Ann', loyalty: 5000 })).toEqual({
      email: 'ann@acme.com',
      firstName: 'Ann',
      domain: 'acme.com',
      isFreeMail: false,
      customFields: { loyalty: 5000 },
    });
  });

  it('reads the qualifying fields under their usual names, and keeps line breaks in the message', () => {
    expect(
      ok({
        email: 'a@acme.com',
        comments: 'We need a tool.\nCan we talk this week?',
        budget_range: '$10k-20k',
        timeframe: 'this quarter',
        job_title: 'Head of Logistics',
        product: 'Tracking',
      }),
    ).toMatchObject({
      message: 'We need a tool.\nCan we talk this week?',
      budget: '$10k-20k',
      timeline: 'this quarter',
      jobTitle: 'Head of Logistics',
      interest: 'Tracking',
      customFields: {},
    });
    expect(ok({ email: 'a@acme.com', budget: 5000 }).budget).toBe('5000');
  });

  it('cleans and limits them: control characters out, message cut at 2000, short fields refused when odd', () => {
    const lead = ok({ email: 'a@acme.com', message: `hi there‮ ${'x'.repeat(3000)}` });
    expect(lead.message).toHaveLength(2000);
    expect(lead.message).not.toMatch(/[‮]/);
    expect(ok({ email: 'a@acme.com', message: '   ' }).message).toBeUndefined();
    expect(issues({ email: 'a@acme.com', jobTitle: 'CEO\nInjected' })).toEqual([
      { path: 'jobTitle', code: 'invalid_text' },
    ]);
    expect(issues({ email: 'a@acme.com', budget: 'x'.repeat(201) })).toEqual([
      { path: 'budget', code: 'invalid_text' },
    ]);
    expect(issues({ email: 'a@acme.com', message: { a: 1 } })).toEqual([
      { path: 'message', code: 'invalid_type' },
    ]);
  });

  it('flags free mail and does not use it as the company domain', () => {
    const lead = ok({ email: 'ann@gmail.com', website: 'https://www.acme.com/pricing?x=1' });
    expect(lead).toMatchObject({ isFreeMail: true, domain: 'acme.com' });
    expect(ok({ email: 'ann@gmail.com' }).domain).toBeUndefined();
  });

  it('refuses disposable and malformed emails, with a code and no text', () => {
    expect(issues({ email: 'a@mailinator.com' })).toEqual([
      { path: 'email', code: 'disposable_email' },
    ]);
    expect(issues({ email: 'not-an-email' })).toEqual([{ path: 'email', code: 'invalid_email' }]);
    expect(issues({ email: 'a@acme.cmo' })).toEqual([{ path: 'email', code: 'invalid_email' }]);
  });

  it('turns a phone into E.164 using the workspace country, and refuses an invalid one', () => {
    expect(ok({ phone: '0901 234 567' }, 'VN').phone).toBe('+84901234567');
    expect(ok({ phone: '+84 901 234 567' }).phone).toBe('+84901234567');
    expect(issues({ phone: '0901 234 567' })).toEqual([{ path: 'phone', code: 'invalid_phone' }]);
    expect(issues({ phone: '123' }, 'VN')).toEqual([{ path: 'phone', code: 'invalid_phone' }]);
  });

  it('checks country codes against a real list', () => {
    expect(ok({ email: 'a@acme.com', country: 'vn' }).country).toBe('VN');
    expect(issues({ email: 'a@acme.com', country: 'ZZ' })).toEqual([
      { path: 'country', code: 'invalid_country' },
    ]);
  });

  it('needs an email or a phone; empty strings count as absent', () => {
    expect(issues({ name: 'Ann' })).toEqual([{ path: '', code: 'contact_required' }]);
    expect(issues({ email: '', phone: ' ' })).toEqual([{ path: '', code: 'contact_required' }]);
    expect(ok({ email: '', phone: '+84901234567' }).email).toBeUndefined();
  });

  it('splits a full name and refuses control characters in names', () => {
    expect(ok({ email: 'a@acme.com', name: 'Nguyễn Văn An' })).toMatchObject({
      firstName: 'Nguyễn',
      lastName: 'Văn An',
    });
    expect(issues({ email: 'a@acme.com', company: 'Evil\nCo' })).toEqual([
      { path: 'company', code: 'invalid_text' },
    ]);
    expect(issues({ email: 'a@acme.com', firstName: { a: 1 } })).toEqual([
      { path: 'firstName', code: 'invalid_type' },
    ]);
  });
});

describe('FixedWindowLimiter', () => {
  it('allows `limit` hits per window, then says how long to wait, and starts over', async () => {
    let now = 1_000_000;
    const limiter = new FixedWindowLimiter(2, new MemoryWindowStore(() => now), 'test');
    expect(await limiter.hit('a')).toBe(0);
    expect(await limiter.hit('a')).toBe(0);
    expect(await limiter.hit('a')).toBe(60);
    expect(await limiter.hit('b')).toBe(0);
    now += 59_000;
    expect(await limiter.hit('a')).toBe(1);
    now += 1_000;
    expect(await limiter.hit('a')).toBe(0);
  });

  it('blockedFor counts nothing; record counts without checking', async () => {
    const limiter = new FixedWindowLimiter(2, new MemoryWindowStore(), 'test');
    expect(await limiter.blockedFor('ip')).toBe(0);
    await limiter.record('ip');
    expect(await limiter.blockedFor('ip')).toBe(0);
    await limiter.record('ip');
    expect(await limiter.blockedFor('ip')).toBeGreaterThan(0);
  });

  it('two limiters sharing one store do not mix their counts (names keep them apart)', async () => {
    const store = new MemoryWindowStore();
    const a = new FixedWindowLimiter(1, store, 'a');
    const b = new FixedWindowLimiter(1, store, 'b');
    expect(await a.hit('k')).toBe(0);
    expect(await b.hit('k')).toBe(0);
    expect(await a.hit('k')).toBeGreaterThan(0);
  });
});
