import type { CookieOptions, Request, Response } from 'express';
import {
  clearRefreshCookie,
  readRefreshCookie,
  REFRESH_COOKIE,
  setRefreshCookie,
} from './refresh-cookie';
import { REFRESH_TOKEN_TTL_MS } from './session.service';

/** A Response that records cookie calls instead of writing headers. */
function recordingResponse() {
  const set: { name: string; value: string; options: CookieOptions }[] = [];
  const cleared: { name: string; options: CookieOptions }[] = [];
  const res = {
    cookie: (name: string, value: string, options: CookieOptions) => {
      set.push({ name, value, options });
      return res;
    },
    clearCookie: (name: string, options: CookieOptions) => {
      cleared.push({ name, options });
      return res;
    },
  };
  return { res: res as unknown as Response, set, cleared };
}

describe('refresh cookie', () => {
  // A browser only deletes a cookie when name, Path and Domain match the ones it
  // was set with; a Secure cookie can only be overwritten by a Secure Set-Cookie.
  it.each([true, false])(
    'clears with exactly the attributes it was set with (secure=%s)',
    (secure) => {
      const { res, set, cleared } = recordingResponse();
      setRefreshCookie(res, 'token', secure);
      clearRefreshCookie(res, secure);

      const { maxAge, ...setAttributes } = set[0]?.options ?? {};
      expect(maxAge).toBe(REFRESH_TOKEN_TTL_MS);
      expect(cleared[0]).toEqual({ name: REFRESH_COOKIE, options: setAttributes });
      expect(setAttributes).toEqual({ httpOnly: true, secure, sameSite: 'lax', path: '/auth' });
    },
  );

  it('reads only a non-empty string cookie', () => {
    const req = (cookies: unknown) => ({ cookies }) as unknown as Request;
    expect(readRefreshCookie(req({ lp_refresh: 'abc' }))).toBe('abc');
    expect(readRefreshCookie(req({ lp_refresh: '' }))).toBeUndefined();
    // cookie-parser turns a "j:{...}" value into an object.
    expect(readRefreshCookie(req({ lp_refresh: { a: 1 } }))).toBeUndefined();
    expect(readRefreshCookie(req(undefined))).toBeUndefined();
  });
});
