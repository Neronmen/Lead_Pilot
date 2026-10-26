import { describe, expect, it } from 'vitest';
import { DEFAULT_LANDING, loginUrl, safeNext } from './safe-next';

describe('safeNext', () => {
  it.each([
    ['/leads', '/leads'],
    ['/settings/team', '/settings/team'],
    ['/leads?status=hot#top', '/leads?status=hot#top'],
    ['/leads/abc-123', '/leads/abc-123'],
  ])('keeps the local path %s', (raw, expected) => {
    expect(safeNext(raw)).toBe(expected);
  });

  it.each([
    'https://evil.com',
    'http://evil.com/leads',
    '//evil.com',
    '///evil.com',
    '/\\evil.com',
    '\\\\evil.com',
    'javascript:alert(1)',
    'evil.com',
    'leads',
    '',
    '/lea\nds',
    '/leads\u0000',
    '/x/..//evil.com',
    '/%2F%2Fevil.com/../..//evil.com',
    '/login',
    '/signup',
    '/invite/accept',
    'x'.repeat(3000),
  ])('falls back for %j', (raw) => {
    const result = safeNext(raw);
    // Whatever comes back is a same-site path that does not leave the site.
    expect(result.startsWith('/')).toBe(true);
    expect(result.startsWith('//')).toBe(false);
    expect(result).toBe(DEFAULT_LANDING);
  });

  it('falls back for null and undefined', () => {
    expect(safeNext(null)).toBe(DEFAULT_LANDING);
    expect(safeNext(undefined)).toBe(DEFAULT_LANDING);
  });
});

describe('loginUrl', () => {
  it('remembers where the person was going', () => {
    expect(loginUrl('/settings/team')).toBe('/login?next=%2Fsettings%2Fteam');
  });
  it('does not add a next that is the default or unsafe', () => {
    expect(loginUrl('/leads')).toBe('/login');
    expect(loginUrl('//evil.com')).toBe('/login');
  });
});
