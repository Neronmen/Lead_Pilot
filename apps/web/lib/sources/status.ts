import type { Source } from '@leadpilot/shared';

/** After this many days without a lead, a source reads "Quiet" (Lead sources design). */
export const QUIET_AFTER_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

export type SourceStatus =
  | { kind: 'off' }
  | { kind: 'waiting' }
  | { kind: 'working'; count: number }
  | { kind: 'quiet'; days: number };

/** The plain-language state of a source, from what the API reports. */
export function sourceStatus(source: Source, now: number = Date.now()): SourceStatus {
  if (!source.enabled) return { kind: 'off' };
  if (!source.lastLeadAt) return { kind: 'waiting' };
  const days = Math.floor((now - Date.parse(source.lastLeadAt)) / DAY_MS);
  if (days >= QUIET_AFTER_DAYS) return { kind: 'quiet', days };
  return { kind: 'working', count: source.leadsLast30Days };
}

/** The address a sender posts leads to. */
export function ingestUrl(apiUrl: string, sourceId: string): string {
  return `${apiUrl.replace(/\/+$/, '')}/v1/ingest/${sourceId}`;
}
