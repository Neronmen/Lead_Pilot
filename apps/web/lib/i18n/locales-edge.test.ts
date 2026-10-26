import { describe, expect, it } from 'vitest';
import { negotiateLocale, resolveLocale } from './locales';

describe('negotiateLocale edge cases', () => {
  it.each([
    ['VI-vn', 'vi'],
    ['EN', 'en'],
    ['  vi  ;  q=0.8 , en;q=0.1', 'vi'],
    ['vi;Q=0.9,en;q=0.1', 'vi'],
    ['en;q=0.5,vi;q=0.5', 'en'],
    ['vi;q=0.5,en;q=0.5', 'vi'],
    ['vi;q=-1,en;q=0.1', 'en'],
    ['vi;q=1e-9,fr', 'vi'],
    ['vi;q=,en;q=0.1', 'en'],
    ['vi;q=0.0,en', 'en'],
    [',,,;;;,vi', 'vi'],
    ['vietnamese', 'en'],
    ['vix', 'en'],
    ['zh-vi', 'en'],
    ['vi_VN', 'en'],
    ['en;q=Infinity,vi;q=0.9', 'en'],
    ['vi;q=NaN,en;q=0.1', 'en'],
  ])('%s -> %s', (header, expected) => {
    expect(negotiateLocale(header)).toBe(expected);
  });

  it('survives a huge header quickly', () => {
    const header = `${'fr;q=0.5,'.repeat(50_000)}vi;q=0.4`;
    const start = Date.now();
    expect(negotiateLocale(header)).toBe('vi');
    expect(Date.now() - start).toBeLessThan(2000);
  });

  it('does not treat prototype names as languages', () => {
    expect(negotiateLocale('constructor,__proto__,toString')).toBe('en');
  });
});

describe('resolveLocale edge cases', () => {
  it('ignores empty, null and wrongly-cased cookies', () => {
    expect(resolveLocale({ cookie: '', acceptLanguage: 'vi' })).toBe('vi');
    expect(resolveLocale({ cookie: null, acceptLanguage: 'vi' })).toBe('vi');
    expect(resolveLocale({ cookie: 'VI', acceptLanguage: 'en' })).toBe('en');
    expect(resolveLocale({ cookie: 'constructor', acceptLanguage: null })).toBe('en');
  });
});
