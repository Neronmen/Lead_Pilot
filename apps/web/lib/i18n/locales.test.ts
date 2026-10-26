import { describe, expect, it } from 'vitest';
import { localeCookie, negotiateLocale, resolveLocale } from './locales';

describe('negotiateLocale', () => {
  it.each([
    ['vi-VN,vi;q=0.9,en;q=0.8', 'vi'],
    ['en-GB,en;q=0.9', 'en'],
    ['fr-FR,fr;q=0.9,vi;q=0.5', 'vi'],
    ['en;q=0.2,vi;q=0.9', 'vi'],
    ['vi;q=0,en', 'en'],
    ['fr,de', 'en'],
    ['', 'en'],
    ['*', 'en'],
    ['vi;q=abc,en;q=0.5', 'en'],
  ])('%s -> %s', (header, expected) => {
    expect(negotiateLocale(header)).toBe(expected);
  });

  it('defaults to English without a header', () => {
    expect(negotiateLocale(null)).toBe('en');
    expect(negotiateLocale(undefined)).toBe('en');
  });
});

describe('resolveLocale', () => {
  it('prefers the cookie over the browser language', () => {
    expect(resolveLocale({ cookie: 'en', acceptLanguage: 'vi' })).toBe('en');
  });
  it('ignores a cookie that is not a supported language', () => {
    expect(resolveLocale({ cookie: 'fr', acceptLanguage: 'vi' })).toBe('vi');
  });
  it('falls back to the browser language, then English', () => {
    expect(resolveLocale({ acceptLanguage: 'vi-VN' })).toBe('vi');
    expect(resolveLocale({})).toBe('en');
  });
});

describe('localeCookie', () => {
  it('is a year-long Lax cookie for the whole site', () => {
    expect(localeCookie('vi')).toBe('lp_locale=vi; Path=/; Max-Age=31536000; SameSite=Lax');
  });
});
