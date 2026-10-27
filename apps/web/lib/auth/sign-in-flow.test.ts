// @vitest-environment node
import { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthClient } from './auth-client';
import { finishSignIn, isSigningIn, readLocaleCookie, whileSigningIn } from './sign-in-flow';

describe('whileSigningIn', () => {
  it('is on only while the work runs', async () => {
    expect(isSigningIn()).toBe(false);
    await whileSigningIn(async () => {
      expect(isSigningIn()).toBe(true);
    });
    expect(isSigningIn()).toBe(false);
  });

  it('nests: the flag stays on until the outermost call ends', async () => {
    await whileSigningIn(async () => {
      await whileSigningIn(async () => undefined);
      expect(isSigningIn()).toBe(true);
    });
    expect(isSigningIn()).toBe(false);
  });

  it('overlapping calls: the first to end does not switch it off', async () => {
    let release!: () => void;
    const slow = whileSigningIn(() => new Promise<void>((r) => (release = r)));
    await whileSigningIn(async () => undefined);
    expect(isSigningIn()).toBe(true);
    release();
    await slow;
    expect(isSigningIn()).toBe(false);
  });

  it('turns off and rethrows when the work rejects', async () => {
    await expect(
      whileSigningIn(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(isSigningIn()).toBe(false);
  });

  it('turns off when the work throws before returning a promise', async () => {
    const work = (() => {
      throw new Error('sync');
    }) as () => Promise<void>;
    await expect(whileSigningIn(work)).rejects.toThrow('sync');
    expect(isSigningIn()).toBe(false);
  });

  it('returns the value of the work', async () => {
    await expect(whileSigningIn(async () => 42)).resolves.toBe(42);
  });
});

describe('readLocaleCookie', () => {
  it.each([
    ['', null],
    ['lp_locale=vi', 'vi'],
    ['a=1; lp_locale=en; b=2', 'en'],
    ['  lp_locale=vi  ', 'vi'],
    ['lp_locale=fr', null],
    ['lp_locale=', null],
    ['lp_locale', null],
    ['xlp_locale=vi', null],
    ['lp_locale2=vi', null],
    ['lp_locale=VI', null],
    ['lp_locale=%76i', null],
    ['lp_locale="vi"', null],
    ['other=lp_locale=vi', null],
    [';;;', null],
  ])('%j -> %j', (cookies, expected) => {
    expect(readLocaleCookie(cookies)).toBe(expected);
  });

  it('with two lp_locale cookies, the first valid one wins', () => {
    expect(readLocaleCookie('lp_locale=vi; lp_locale=en')).toBe('vi');
    expect(readLocaleCookie('lp_locale=fr; lp_locale=en')).toBe('en');
  });

  // Known bug: `part.split('=')` drops everything after a second "=", so the
  // value "vi=en" is read as "vi". Real cookies never contain that; harmless but wrong.
  it('a value with a second "=" is not a language', () => {
    expect(readLocaleCookie('lp_locale=vi=en')).toBeNull();
  });

  it('does not match the Object prototype names', () => {
    expect(readLocaleCookie('__proto__=vi; constructor=en')).toBeNull();
  });
});

describe('finishSignIn', () => {
  afterEach(() => vi.unstubAllGlobals());

  const me = (locale: 'en' | 'vi' | null) => ({
    user: { id: '11111111-1111-4111-8111-111111111111', email: 'a@b.co', name: null, locale },
    workspace: {
      id: '22222222-2222-4222-8222-222222222222',
      name: 'N',
      slug: 'n',
      defaultLocale: 'en',
      currency: 'USD',
      timezone: 'UTC',
      defaultCountry: null,
    },
    role: 'OWNER',
  });
  const doc = (cookie: string) => {
    const jar = { cookie };
    vi.stubGlobal('document', jar);
    return jar;
  };
  const clientAnswering = (value: unknown) =>
    ({ request: vi.fn().mockResolvedValue(value) }) as unknown as AuthClient;

  it('never throws when /auth/me fails', async () => {
    doc('');
    const client = {
      request: vi.fn().mockRejectedValue(new Error('down')),
    } as unknown as AuthClient;
    const qc = new QueryClient();
    await expect(finishSignIn(client, qc)).resolves.toBeUndefined();
    expect(qc.getQueryCache().getAll()).toHaveLength(0);
  });

  it('saves the account language only when it differs from the cookie', async () => {
    const jar = doc('lp_locale=en');
    await finishSignIn(clientAnswering(me('vi')), new QueryClient());
    expect(jar.cookie).toContain('lp_locale=vi');
  });

  it('leaves the cookie alone when the account has no language or the same one', async () => {
    const jar = doc('lp_locale=en');
    await finishSignIn(clientAnswering(me(null)), new QueryClient());
    await finishSignIn(clientAnswering(me('en')), new QueryClient());
    expect(jar.cookie).toBe('lp_locale=en');
  });
});
