import { describe, expect, it } from 'vitest';
import { DEFAULT_LANDING, loginUrl, safeNext } from './safe-next';

const ORIGIN = 'https://app.test';

/** What a browser would do with the result: it must stay on our origin. */
function staysOnSite(result: string): boolean {
  if (!result.startsWith('/') || result.startsWith('//') || result.includes('\\')) return false;
  return new URL(result, ORIGIN).origin === ORIGIN;
}

describe('safeNext open-redirect forms', () => {
  it.each([
    '/\t/evil.com',
    '/\n/evil.com',
    '/\r/evil.com',
    '/\t\\evil.com',
    '\t//evil.com',
    ' //evil.com',
    '/.%2e//evil.com',
    '/%2e%2e//evil.com',
    '/./\\evil.com',
    '/a/%2e%2e//evil.com',
    '/x/../\\evil.com',
    '/∕evil.com',
    '/／evil.com',
    '/⁄evil.com',
    '/\\/evil.com',
    '//\\evil.com',
    '/\u007f/evil.com',
    'https:/evil.com',
    'https:evil.com',
    '/\\\\evil.com',
    '\\/evil.com',
    'data:text/html,hi',
    'JaVaScRiPt:alert(1)',
    '/' + 'a'.repeat(2048),
    '/' + '/'.repeat(5000),
  ])('does not leave the site with %j', (raw) => {
    expect(staysOnSite(safeNext(raw))).toBe(true);
  });

  it.each([
    '/\t/evil.com',
    '/\n/evil.com',
    '//evil.com',
    '/\\evil.com',
    '/\u0000x',
    '/.%2e//evil.com',
  ])('falls back for %j', (raw) => {
    expect(safeNext(raw)).toBe(DEFAULT_LANDING);
  });

  it.each([
    ['/%5Cevil.com', '/%5Cevil.com'],
    ['/@evil.com', '/@evil.com'],
    ['/evil.com@good.com', '/evil.com@good.com'],
    ['/∕evil.com', '/%E2%88%95evil.com'],
    ['/%2F/evil.com', '/%2F/evil.com'],
    ['/?next=//evil.com', '/?next=//evil.com'],
    ['/#//evil.com', '/#//evil.com'],
  ])('keeps %j as an inert same-site path', (raw, expected) => {
    expect(safeNext(raw)).toBe(expected);
  });

  it('accepts the 2048 limit and rejects one more', () => {
    const ok = '/' + 'a'.repeat(2047);
    expect(safeNext(ok)).toBe(ok);
    expect(safeNext(ok + 'a')).toBe(DEFAULT_LANDING);
  });

  it('handles null and undefined', () => {
    expect(safeNext(null)).toBe(DEFAULT_LANDING);
    expect(safeNext(undefined)).toBe(DEFAULT_LANDING);
  });

  it.each([
    '/login',
    '/login/',
    '/login?next=/leads',
    '/login#x',
    '/signup/',
    '/invite/abc',
    '/./login',
    '/leads/../login',
    '/a/../../login',
  ])('does not bounce back to the sign-in page %j', (raw) => {
    expect(safeNext(raw)).toBe(DEFAULT_LANDING);
  });

  it('does not block pages that merely start with the same letters', () => {
    expect(safeNext('/login-help')).toBe('/login-help');
    expect(safeNext('/invites')).toBe('/invites');
  });

  // Next.js routes are case-sensitive, so /LOGIN is an ordinary (404) path, not a loop.
  it('treats /LOGIN as an ordinary path', () => {
    expect(safeNext('/LOGIN')).toBe('/LOGIN');
  });

  it('random mixes of dangerous characters never escape the site', () => {
    const alphabet = [
      '/',
      '\\',
      '.',
      '%2e',
      '%2f',
      '%5c',
      '\t',
      '\n',
      '∕',
      '@',
      ':',
      'a',
      '?',
      '#',
    ];
    let seed = 42;
    const rand = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    for (let i = 0; i < 20000; i++) {
      const len = 1 + Math.floor(rand() * 8);
      let raw = '/';
      for (let j = 0; j < len; j++) raw += alphabet[Math.floor(rand() * alphabet.length)];
      const result = safeNext(raw);
      expect(staysOnSite(result), raw).toBe(true);
      expect(/\p{Cc}/u.test(result), raw).toBe(false);
    }
  });
});

describe('loginUrl', () => {
  it('encodes the next path and drops unsafe ones', () => {
    expect(loginUrl('/leads/1?x=1')).toBe('/login?next=%2Fleads%2F1%3Fx%3D1');
    expect(loginUrl('//evil.com')).toBe('/login');
    expect(loginUrl('/login')).toBe('/login');
  });
});
