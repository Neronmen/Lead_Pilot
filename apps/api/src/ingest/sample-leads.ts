/**
 * Made-up leads for the demo: "Send a sample lead" on Lead sources, and the seed script. Every
 * person and company here is invented. They cover every tier, so the demo shows the whole range:
 * a clear Hot lead, a fit with little said, a weak fit, and spam.
 */
export interface SampleLead {
  /** What the AI should make of it, for the seed's own summary (not stored). */
  expect: 'hot' | 'warm' | 'cold' | 'junk';
  payload: Record<string, string>;
}

export const SAMPLE_LEADS: SampleLead[] = [
  {
    expect: 'hot',
    payload: {
      name: 'Mia Tran',
      email: 'mia.tran@acme-logistics.com',
      company: 'Acme Logistics',
      country: 'US',
      jobTitle: 'Head of Logistics',
      message:
        'We need to replace our tracking tool this quarter. Budget is approved, can we book a demo?',
      budget: '$20k-50k',
      timeline: 'This quarter',
    },
  },
  {
    expect: 'hot',
    payload: {
      name: 'Lukas Becker',
      email: 'lukas.becker@brightlane.com',
      company: 'Brightlane Logistics',
      country: 'DE',
      jobTitle: 'Head of Operations',
      message:
        'Looking for software to manage 40 trucks. We want to start within a month, please send pricing.',
      budget: 'Approved',
      timeline: 'Within a month',
    },
  },
  {
    expect: 'hot',
    payload: {
      name: 'Nguyễn Văn An',
      email: 'an.nguyen@vietfreight.com',
      company: 'VietFreight',
      country: 'VN',
      jobTitle: 'CTO',
      message:
        'Our team of 60 needs a platform for shipments. Please send pricing and a demo slot.',
      budget: '$10k',
      timeline: 'This quarter',
    },
  },
  {
    expect: 'warm',
    payload: {
      name: 'Priya Shah',
      email: 'priya@northwind-freight.com',
      company: 'Northwind Freight',
      country: 'GB',
      message: 'Interested in learning how your product works.',
    },
  },
  {
    expect: 'warm',
    payload: {
      name: 'Carlos Mendes',
      email: 'carlos@transmar.com',
      company: 'Transmar',
      country: 'US',
      jobTitle: 'Operations Manager',
      message: 'We may need something like this next year. Can you send information?',
      timeline: 'Next year',
    },
  },
  {
    expect: 'cold',
    payload: {
      name: 'Tom Baker',
      email: 'tom.baker.1987@gmail.com',
      message: 'Just browsing.',
      country: 'AU',
    },
  },
  {
    expect: 'cold',
    payload: {
      name: 'Hana Ito',
      email: 'hana@corner-bakery.com',
      company: 'Corner Bakery',
      country: 'JP',
      message: 'Is there a free version?',
    },
  },
  {
    expect: 'junk',
    payload: {
      name: 'SEO Expert www.rank-now-seo.com',
      email: 'seo.expert.deals@gmail.com',
      message: 'Buy cheap backlinks and rank #1 on Google!!! Click http://spam-site.com now',
    },
  },
  {
    expect: 'junk',
    payload: {
      name: 'Prize Claim www.prize-claim.com',
      email: 'claims.desk@gmail.com',
      message: 'You won a prize! Reply with your bank details to claim it.',
      country: 'VN',
    },
  },
];

/**
 * A sample for "Send a sample lead": a different one each time, with a unique address so it always
 * becomes a new lead (the same email would be merged into the old one).
 */
export function nextSample(counter: number, token: string): Record<string, string> {
  const sample = SAMPLE_LEADS[counter % SAMPLE_LEADS.length]!;
  const [local, domain] = sample.payload.email!.split('@') as [string, string];
  return { ...sample.payload, email: `${local}+${token}@${domain}`, source: 'sample' };
}
