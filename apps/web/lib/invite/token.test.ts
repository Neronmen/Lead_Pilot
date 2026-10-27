// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readInviteToken, resetInviteTokenForTests } from './token';

const TOKEN = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-AbCdE'; // 43 base64url characters

function open(url: string) {
  window.history.replaceState({ marker: 1 }, '', url);
}

beforeEach(() => {
  resetInviteTokenForTests();
  vi.restoreAllMocks();
});

describe('readInviteToken', () => {
  it('reads the token and removes the fragment, keeping the path and query', () => {
    open(`/invite?lang=vi#t=${TOKEN}`);
    expect(readInviteToken()).toBe(TOKEN);
    expect(window.location.hash).toBe('');
    expect(window.location.pathname + window.location.search).toBe('/invite?lang=vi');
  });

  it('keeps the history state of the framework', () => {
    open(`/invite#t=${TOKEN}`);
    readInviteToken();
    expect(window.history.state).toEqual({ marker: 1 });
  });

  it('cleans the address exactly once however many times it is asked', () => {
    open(`/invite#t=${TOKEN}`);
    const replace = vi.spyOn(window.history, 'replaceState');
    // StrictMode and re-renders ask again and again: same answer, one clean-up.
    expect(readInviteToken()).toBe(TOKEN);
    expect(readInviteToken()).toBe(TOKEN);
    expect(readInviteToken()).toBe(TOKEN);
    expect(replace).toHaveBeenCalledTimes(1);
  });

  it('still answers after the fragment is gone (the second mount of StrictMode)', () => {
    open(`/invite#t=${TOKEN}`);
    readInviteToken();
    expect(window.location.hash).toBe('');
    expect(readInviteToken()).toBe(TOKEN);
  });

  it('finds the token among other fragment parameters', () => {
    open(`/invite#utm=x&t=${TOKEN}`);
    expect(readInviteToken()).toBe(TOKEN);
  });

  it('decodes a percent-encoded token', () => {
    open(`/invite#t=${TOKEN.replace('-', '%2D')}`);
    expect(readInviteToken()).toBe(TOKEN);
  });

  it.each([
    ['no fragment', '/invite'],
    ['an empty token', '/invite#t='],
    ['a short token', '/invite#t=abc'],
    ['characters outside base64url', `/invite#t=${TOKEN.slice(0, 40)}!!!`],
    ['a different parameter', `/invite#token=${TOKEN}`],
    ['a malformed escape', '/invite#t=%E0%A4%A'],
  ])('answers null for %s', (_name, url) => {
    open(url);
    expect(readInviteToken()).toBeNull();
  });

  it('removes even an unusable fragment, and leaves a clean address alone', () => {
    open('/invite#t=abc');
    readInviteToken();
    expect(window.location.hash).toBe('');
    resetInviteTokenForTests();
    open('/invite');
    const replace = vi.spyOn(window.history, 'replaceState');
    readInviteToken();
    expect(replace).not.toHaveBeenCalled();
  });

  it('never stores the token anywhere a script or another tab could read it', () => {
    open(`/invite#t=${TOKEN}`);
    readInviteToken();
    expect(JSON.stringify({ ...localStorage })).not.toContain(TOKEN);
    expect(JSON.stringify({ ...sessionStorage })).not.toContain(TOKEN);
    expect(document.cookie).not.toContain(TOKEN);
    expect(window.location.href).not.toContain(TOKEN);
  });
});
