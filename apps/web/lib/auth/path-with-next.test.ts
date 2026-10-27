import { describe, expect, it } from 'vitest';
import { DEFAULT_LANDING, loginUrl, pathWithNext, safeNext } from './safe-next';

const parse = (url: string) => new URL(url, 'http://x.test');
/** What the login page does with the query string: read `next` back out. */
const readNext = (url: string) => parse(url).searchParams.get('next');

describe('pathWithNext', () => {
  it('leaves the path alone for a missing, default or unsafe next', () => {
    for (const next of [
      null,
      undefined,
      '',
      '/leads',
      '//evil.com',
      'https://evil.com',
      '/login',
    ]) {
      expect(pathWithNext('/signup', next)).toBe('/signup');
    }
  });

  it.each([
    '/settings/team',
    '/leads?status=hot&owner=me#top',
    '/a?x=1&y=2',
    '/a#frag?not=query',
    '/search?q=a%26b%3Dc',
    '/files/%2Fetc%2Fpasswd',
    '/café/中文',
    '/a?q=x y',
    '/a?next=/b&next=/c',
    '/a?redirect=https://evil.com',
  ])('round-trips %j through ?next= intact', (target) => {
    const url = pathWithNext('/signup', target);
    const carried = readNext(url);
    expect(parse(url).searchParams.getAll('next')).toHaveLength(1);
    expect(carried).toBe(safeNext(target));
    expect(safeNext(carried)).toBe(carried);
    // Nothing leaks out of the encoded value into the outer query string.
    expect([...parse(url).searchParams.keys()]).toEqual(['next']);
    expect(parse(url).hash).toBe('');
  });

  it('keeps %2F encoded in the target (it is not turned into a slash)', () => {
    expect(safeNext('/files/%2Fetc')).toBe('/files/%2Fetc');
  });

  it('percent-encodes unicode in the target the way the browser would', () => {
    expect(safeNext('/café')).toBe('/caf%C3%A9');
  });

  it('is idempotent and chains with loginUrl', () => {
    const target = '/leads?status=hot&owner=me#top';
    const back = safeNext(readNext(loginUrl(target)));
    expect(back).toBe(target);
    expect(pathWithNext('/signup', back)).toBe(pathWithNext('/signup', target));
  });

  it('does not decode a double-encoded slash pair into a protocol-relative address', () => {
    const carried = readNext(pathWithNext('/signup', '/%252F%252Fevil.com'));
    expect(carried?.startsWith('//')).toBe(false);
    expect(safeNext(carried).startsWith('//')).toBe(false);
  });

  it('DEFAULT_LANDING as next does not add a parameter', () => {
    expect(pathWithNext('/signup', DEFAULT_LANDING)).toBe('/signup');
  });
});
