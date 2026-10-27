// @vitest-environment node
import { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthClient } from './auth-client';
import { ME_QUERY_KEY } from './auth-provider';
import { finishSignIn } from './sign-in-flow';

/** finishSignIn(followWorkspace) as used right after sign-up. */
describe('finishSignIn with followWorkspace', () => {
  afterEach(() => vi.unstubAllGlobals());

  const me = (userLocale: 'en' | 'vi' | null, workspaceLocale: 'en' | 'vi') => ({
    user: {
      id: '11111111-1111-4111-8111-111111111111',
      email: 'a@b.co',
      name: null,
      locale: userLocale,
    },
    workspace: {
      id: '22222222-2222-4222-8222-222222222222',
      name: 'N',
      slug: 'n',
      defaultLocale: workspaceLocale,
      currency: 'USD',
      timezone: 'UTC',
      defaultCountry: null,
    },
    role: 'OWNER',
  });
  const jar = (cookie: string) => {
    const doc = { cookie };
    vi.stubGlobal('document', doc);
    return doc;
  };
  const answering = (value: unknown) =>
    ({ request: vi.fn().mockResolvedValue(value) }) as unknown as AuthClient;
  const follow = { followWorkspace: true };

  it('user.locale null: the workspace language replaces a different cookie', async () => {
    const doc = jar('lp_locale=en');
    await finishSignIn(answering(me(null, 'vi')), new QueryClient(), follow);
    expect(doc.cookie).toContain('lp_locale=vi');
  });

  it('user.locale null: a cookie that already matches is left alone', async () => {
    const doc = jar('lp_locale=vi');
    await finishSignIn(answering(me(null, 'vi')), new QueryClient(), follow);
    expect(doc.cookie).toBe('lp_locale=vi');
  });

  it('user.locale null and no cookie: the workspace language is saved', async () => {
    const doc = jar('');
    await finishSignIn(answering(me(null, 'vi')), new QueryClient(), follow);
    expect(doc.cookie).toContain('lp_locale=vi');
  });

  it('user.locale set wins over the workspace language', async () => {
    const doc = jar('lp_locale=vi');
    await finishSignIn(answering(me('en', 'vi')), new QueryClient(), follow);
    expect(doc.cookie).toContain('lp_locale=en');
  });

  it('without the option, the workspace language is ignored (sign in)', async () => {
    const doc = jar('lp_locale=en');
    await finishSignIn(answering(me(null, 'vi')), new QueryClient());
    expect(doc.cookie).toBe('lp_locale=en');
  });

  it('caches who is signed in', async () => {
    jar('');
    const qc = new QueryClient();
    const value = me(null, 'en');
    await finishSignIn(answering(value), qc, follow);
    expect(qc.getQueryData(ME_QUERY_KEY)).toEqual(value);
  });

  it('never throws when /auth/me fails, and leaves the cookie alone', async () => {
    const doc = jar('lp_locale=en');
    const client = {
      request: vi.fn().mockRejectedValue(new Error('down')),
    } as unknown as AuthClient;
    await expect(finishSignIn(client, new QueryClient(), follow)).resolves.toBeUndefined();
    expect(doc.cookie).toBe('lp_locale=en');
  });

  it('a malformed /auth/me answer (the client throws on the schema) is swallowed', async () => {
    const doc = jar('lp_locale=en');
    const client = {
      request: vi.fn().mockRejectedValue(new TypeError('bad shape')),
    } as unknown as AuthClient;
    await expect(finishSignIn(client, new QueryClient(), follow)).resolves.toBeUndefined();
    expect(doc.cookie).toBe('lp_locale=en');
  });
});
