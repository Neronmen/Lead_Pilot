import { describe, expect, it } from 'vitest';
import { applySuggestion, editDistance, suggestEmailDomain } from './suggest-domain';

describe('editDistance', () => {
  it('counts a swap of neighbours as one change', () => {
    expect(editDistance('gmial.com', 'gmail.com')).toBe(1);
  });
  it('counts insertions, deletions and substitutions', () => {
    expect(editDistance('gmai.com', 'gmail.com')).toBe(1);
    expect(editDistance('gmaill.com', 'gmail.com')).toBe(1);
    expect(editDistance('gmail.con', 'gmail.com')).toBe(1);
    expect(editDistance('abc', 'xyz')).toBe(3);
  });
});

describe('suggestEmailDomain', () => {
  it.each([
    ['an@gmial.com', 'gmail.com'],
    ['an@gmail.con', 'gmail.com'],
    ['an@gmai.com', 'gmail.com'],
    ['an@yaho.com', 'yahoo.com'],
    ['an@hotmial.com', 'hotmail.com'],
    ['an@outlok.com', 'outlook.com'],
    ['an@acme.con', 'acme.com'],
    ['An@GMIAL.COM', 'gmail.com'],
  ])('%s -> %s', (email, expected) => {
    expect(suggestEmailDomain(email)).toBe(expected);
  });

  it.each([
    'an@gmail.com',
    'an@mail.com',
    'an@msn.com',
    'an@acme.com',
    'an@acme.vn',
    'an@company.co.uk',
    'an@ya.com',
    'an@protonmail.ch',
    'an@localhost',
    'no-at-sign',
    '@gmail.com',
    '',
  ])('leaves "%s" alone', (email) => {
    expect(suggestEmailDomain(email)).toBeNull();
  });
});

describe('applySuggestion', () => {
  it('replaces only the domain', () => {
    expect(applySuggestion('an.nguyen@gmial.com', 'gmail.com')).toBe('an.nguyen@gmail.com');
  });
});
