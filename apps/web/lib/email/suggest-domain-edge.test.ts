import { describe, expect, it } from 'vitest';
import { applySuggestion, suggestEmailDomain } from './suggest-domain';

describe('suggestEmailDomain: real domains are left alone', () => {
  it.each([
    'an@gmx.com',
    'an@live.com',
    'an@live.com.vn',
    'an@me.com',
    'an@mac.com',
    'an@hey.com',
    'an@pm.me',
    'an@outlook.es',
    'an@outlook.fr',
    'an@outlook.com.vn',
    'an@company.com.vn',
    'an@company.com',
    'an@gmail.com.vn',
    'an@yahoo.co.uk',
    'an@yahoo.fr',
    'an@hotmail.co.uk',
    'an@icloud.com',
    'an@proton.me',
    'an@aol.com',
    'an@fpt.com.vn',
    'an@vnu.edu.vn',
    'an@example.org',
    'an@acme.io',
    'an@acme.co',
    'an@acme.net',
  ])('%s', (email) => {
    expect(suggestEmailDomain(email)).toBeNull();
  });
});

describe('suggestEmailDomain: typos', () => {
  it.each([
    ['an@gmail.cmo', 'gmail.com'],
    ['an@gmaill.com', 'gmail.com'],
    ['an@yahooo.com', 'yahoo.com'],
    ['an@iclould.com', 'icloud.com'],
    ['an@hotmal.com', 'hotmail.com'],
    ['an@acme.cmo', 'acme.com'],
    ['an@acme.ogr', 'acme.org'],
  ])('%s -> %s', (email, expected) => {
    expect(suggestEmailDomain(email)).toBe(expected);
  });

  it('uses the last @ and ignores trailing space', () => {
    expect(suggestEmailDomain('"a@b"@gmial.com')).toBe('gmail.com');
    expect(suggestEmailDomain('an@gmial.com ')).toBe('gmail.com');
  });
});

describe('suggestEmailDomain: odd input', () => {
  it.each([
    'an@',
    'an@.',
    'an@...',
    'an@a.b',
    'an@xn--80ak6aa92e.com',
    'an@gmäil.com',
    'an@пример.рф',
    'an@例え.jp',
    'an@😀.com',
    'an@gmail',
    'an@-.-.-',
  ])('does not throw on "%s"', (email) => {
    expect(() => suggestEmailDomain(email)).not.toThrow();
  });

  it('does not throw on a very long domain', () => {
    const email = `an@${'a'.repeat(300)}.com`;
    expect(suggestEmailDomain(email)).toBeNull();
  });

  it('never suggests the address it was given', () => {
    for (const email of ['an@gmial.com', 'an@acme.con', 'an@gmail.com']) {
      const s = suggestEmailDomain(email);
      if (s) expect(applySuggestion(email, s)).not.toBe(email);
    }
  });
});

describe('applySuggestion edge cases', () => {
  it('keeps an earlier @ in the local part', () => {
    expect(applySuggestion('"a@b"@gmial.com', 'gmail.com')).toBe('"a@b"@gmail.com');
  });
});
