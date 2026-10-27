// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { readInviteToken, resetInviteTokenForTests, serverInviteToken } from './token';

const TOKEN = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-AbCdE';
const OTHER = 'ZyXwVuTsRqPoNmLkJiHgFeDcBa9876543210_-ZyXwV';

function open(url: string) {
  window.history.replaceState({}, '', url);
}

beforeEach(() => resetInviteTokenForTests());

describe('readInviteToken: awkward fragments', () => {
  it('the server snapshot is undefined (nothing known before the browser runs)', () => {
    expect(serverInviteToken()).toBeUndefined();
  });

  it('keeps the query string and removes the fragment', () => {
    open(`/invite?a=1&b=2#t=${TOKEN}`);
    expect(readInviteToken()).toBe(TOKEN);
    expect(window.location.search).toBe('?a=1&b=2');
    expect(window.location.hash).toBe('');
  });

  it('a token in the query string is NOT accepted (only the fragment is private)', () => {
    open(`/invite?t=${TOKEN}`);
    expect(readInviteToken()).toBeNull();
  });

  it('repeated t=: the last one wins (documented behaviour)', () => {
    open(`/invite#t=${OTHER}&t=${TOKEN}`);
    expect(readInviteToken()).toBe(TOKEN);
  });

  it('repeated t= with the last one bad gives null, not the first', () => {
    open(`/invite#t=${TOKEN}&t=abc`);
    expect(readInviteToken()).toBeNull();
  });

  it.each([
    ['uppercase key', `#T=${TOKEN}`],
    ['hash-router style', `#/t=${TOKEN}`],
    ['hash-router path with query', `#/invite?t=${TOKEN}`],
    ['leading whitespace in the value', `#t=%20${TOKEN}`],
    ['trailing whitespace in the value', `#t=${TOKEN}%20`],
    ['trailing newline', `#t=${TOKEN}%0A`],
    ['a second hash', `#t=${TOKEN}#x`],
    ['an encoded slash inside', `#t=${TOKEN.slice(0, 20)}%2F${TOKEN.slice(21)}`],
    ['129 characters', `#t=${'a'.repeat(129)}`],
    ['31 characters', `#t=${'a'.repeat(31)}`],
    ['a very long value', `#t=${'a'.repeat(100_000)}`],
    ['a NUL byte', `#t=${TOKEN.slice(0, 20)}%00${TOKEN.slice(21)}`],
    ['double encoding hides the dash only after one decode', `#t=${TOKEN}%2520`],
  ])('answers null for %s and still cleans the address', (_n, hash) => {
    open(`/invite${hash}`);
    expect(readInviteToken()).toBeNull();
    expect(window.location.hash).toBe('');
  });

  it('accepts the boundary lengths 32 and 128', () => {
    open(`/invite#t=${'a'.repeat(32)}`);
    expect(readInviteToken()).toBe('a'.repeat(32));
    resetInviteTokenForTests();
    open(`/invite#t=${'b'.repeat(128)}`);
    expect(readInviteToken()).toBe('b'.repeat(128));
  });

  it('is case sensitive in the value', () => {
    open(`/invite#t=${TOKEN.toLowerCase()}`);
    expect(readInviteToken()).toBe(TOKEN.toLowerCase());
  });

  it('a bad link does not stick: a later good fragment is used', () => {
    open('/invite#t=abc');
    expect(readInviteToken()).toBeNull();
    open(`/invite#t=${TOKEN}`);
    expect(readInviteToken()).toBe(TOKEN);
  });
});

describe('readInviteToken: a second link in the same page (known gap)', () => {
  // Pasting another invite link into a tab already on /invite is a hash-only navigation:
  // the document is not reloaded, so the module variable still holds the FIRST token and
  // the new link is silently ignored. Fix: re-read on `hashchange`, or key the memo.
  it('a new #t= after the first read is picked up', () => {
    open(`/invite#t=${TOKEN}`);
    expect(readInviteToken()).toBe(TOKEN);
    open(`/invite#t=${OTHER}`);
    expect(readInviteToken()).toBe(OTHER);
  });
});
