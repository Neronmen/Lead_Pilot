import type { PageMeta } from './html-meta';

/** What enrichment found out about a company's website. */
export interface EnrichmentData extends PageMeta {
  /** `ok`: page read. `unreachable`: no usable page (kept for a day so we do not hammer it). */
  status: 'ok' | 'unreachable';
}

/**
 * Where company info comes from. A real provider reads the public website; the
 * mock invents plausible, repeatable text so the demo and the tests need no
 * network. Both answer for a bare domain such as "acme.com".
 */
export interface EnrichmentProvider {
  readonly name: string;
  enrich(domain: string): Promise<EnrichmentData>;
}

export const ENRICHMENT_PROVIDER = Symbol('ENRICHMENT_PROVIDER');
