import { createHash } from 'node:crypto';
import type { EnrichmentData, EnrichmentProvider } from './enrichment.provider';

const INDUSTRIES = [
  'software for logistics teams',
  'online learning for adults',
  'managed IT services for clinics',
  'wholesale building materials',
  'a design studio for retail brands',
  'payroll software for small businesses',
];

/** Repeatable made-up company info: the same domain always gives the same text. No network. */
export class MockEnrichmentProvider implements EnrichmentProvider {
  readonly name = 'mock';

  enrich(domain: string): Promise<EnrichmentData> {
    // A domain that says "unreachable" lets a test or a demo show that case.
    if (domain.startsWith('unreachable.')) {
      return Promise.resolve({ status: 'unreachable', title: null, description: null, text: '' });
    }
    const pick = createHash('sha256').update(domain).digest().readUInt8(0) % INDUSTRIES.length;
    const company = domain.split('.')[0]!.replace(/^./, (c) => c.toUpperCase());
    const about = `${company} makes ${INDUSTRIES[pick]!}.`;
    return Promise.resolve({
      status: 'ok',
      title: `${company} – ${INDUSTRIES[pick]!}`,
      description: about,
      text: `${about} Customers in more than 20 countries. Book a demo or contact sales.`,
    });
  }
}
