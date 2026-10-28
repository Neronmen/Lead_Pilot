import type { Source } from '@leadpilot/shared';
import { describe, expect, it } from 'vitest';
import { ingestUrl, sourceStatus } from './status';

const NOW = Date.parse('2026-10-27T12:00:00Z');
const day = (n: number) => new Date(NOW - n * 86_400_000).toISOString();
const source = (over: Partial<Source>): Source => ({
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Zapier',
  type: 'WEBHOOK',
  enabled: true,
  formEnabled: false,
  apiKeyPrefix: 'abcd1234',
  hmacEnabled: false,
  createdAt: day(100),
  leadsLast30Days: 0,
  lastLeadAt: null,
  last30Days: {
    received: 0,
    created: 0,
    merged: 0,
    rejected: 0,
    replayed: 0,
    topRejections: [],
    readiness: { accepted: 0, sends: [], missing: [] },
  },
  ...over,
});

describe('sourceStatus', () => {
  it('is off when switched off, whatever else is true', () => {
    expect(sourceStatus(source({ enabled: false, lastLeadAt: day(1) }), NOW)).toEqual({
      kind: 'off',
    });
  });

  it('waits for the first lead', () => {
    expect(sourceStatus(source({}), NOW)).toEqual({ kind: 'waiting' });
  });

  it('works with a recent lead, and is quiet from 14 days without one', () => {
    expect(sourceStatus(source({ lastLeadAt: day(13), leadsLast30Days: 7 }), NOW)).toEqual({
      kind: 'working',
      count: 7,
    });
    expect(sourceStatus(source({ lastLeadAt: day(14), leadsLast30Days: 1 }), NOW)).toEqual({
      kind: 'quiet',
      days: 14,
    });
  });
});

describe('ingestUrl', () => {
  it('joins the API address and the source id without double slashes', () => {
    expect(ingestUrl('http://localhost:3001/', 'abc')).toBe('http://localhost:3001/v1/ingest/abc');
  });
});
