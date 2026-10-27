import { describe, expect, it } from 'vitest';
import { hasFilters, leadsQuery, NO_FILTERS } from './use-leads';

describe('leadsQuery', () => {
  it('is empty with no filters, and trims the search', () => {
    expect(leadsQuery(NO_FILTERS)).toBe('');
    expect(leadsQuery({ ...NO_FILTERS, q: '   ' })).toBe('');
    expect(leadsQuery({ ...NO_FILTERS, q: ' ann ' })).toBe('?q=ann');
  });

  it('encodes characters that would break a query string, so % and & travel as typed', () => {
    expect(leadsQuery({ ...NO_FILTERS, q: '100% & co' })).toBe('?q=100%25+%26+co');
  });

  it('sends only the filters that are set, and the cursor', () => {
    expect(
      leadsQuery({ q: '', status: 'NEW', tier: '', sourceId: '', freeMail: 'true' }, 'abc'),
    ).toBe('?status=NEW&freeMail=true&cursor=abc');
  });
});

describe('hasFilters', () => {
  it('tells whether any filter is set', () => {
    expect(hasFilters(NO_FILTERS)).toBe(false);
    expect(hasFilters({ ...NO_FILTERS, freeMail: 'false' })).toBe(true);
  });
});
