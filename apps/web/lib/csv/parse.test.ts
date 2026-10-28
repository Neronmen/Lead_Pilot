import { describe, expect, it } from 'vitest';
import { hasContactColumn, parseCsv } from './parse';

describe('parseCsv', () => {
  it('reads a plain file', () => {
    expect(parseCsv('Name,Email\nAnn,ann@acme.com\nBob,bob@acme.com\n')).toEqual({
      headers: ['Name', 'Email'],
      rows: [
        { Name: 'Ann', Email: 'ann@acme.com' },
        { Name: 'Bob', Email: 'bob@acme.com' },
      ],
    });
  });

  it('handles quotes, a comma and a line break inside a cell, doubled quotes, Windows line ends and a BOM', () => {
    const text = '﻿Name,Message\r\n"Smith, Ann","He said ""hi""\nand left"\r\nBob,ok\r\n';
    expect(parseCsv(text).rows).toEqual([
      { Name: 'Smith, Ann', Message: 'He said "hi"\nand left' },
      { Name: 'Bob', Message: 'ok' },
    ]);
  });

  it('detects a semicolon or a tab as the delimiter', () => {
    expect(parseCsv('Name;Email\nAnn;a@b.co').rows).toEqual([{ Name: 'Ann', Email: 'a@b.co' }]);
    expect(parseCsv('Name\tEmail\nAnn\ta@b.co').rows).toEqual([{ Name: 'Ann', Email: 'a@b.co' }]);
  });

  it('drops empty cells, empty lines and rows with nothing in them', () => {
    expect(parseCsv('Name,Email,Company\nAnn,,\n\n,,\nBob,b@b.co,Acme\n').rows).toEqual([
      { Name: 'Ann' },
      { Name: 'Bob', Email: 'b@b.co', Company: 'Acme' },
    ]);
  });

  it('copes with a last line without a line break and with a header only', () => {
    expect(parseCsv('a,b\n1,2').rows).toEqual([{ a: '1', b: '2' }]);
    expect(parseCsv('a,b\n').rows).toEqual([]);
    expect(parseCsv('')).toEqual({ headers: [], rows: [] });
  });
});

describe('hasContactColumn', () => {
  it.each([['Email'], ['E-mail'], ['Phone Number'], ['mobile']])('%s counts', (header) => {
    expect(hasContactColumn(['Name', header])).toBe(true);
  });
  it('is false without an email or phone column', () => {
    expect(hasContactColumn(['Name', 'Company'])).toBe(false);
  });
});
