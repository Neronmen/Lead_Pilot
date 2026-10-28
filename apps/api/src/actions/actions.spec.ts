import { ConfigService } from '@nestjs/config';
import { buildHotLeadEmail } from '../email/hot-lead-email';
import { hotLeadCopy, hotLeadText } from '../email/templates/hot-lead-copy';
import { deliverWebhook, leadMessage, type RoutedLead, signWebhook, slackEscape } from './delivery';
import { checkWebhookUrl, isPrivateAddress, UrlNotAllowedError } from './net-guard';
import { ActionError, ActionTransport } from './transport';

const lead: RoutedLead = {
  id: '0194f7a0-0000-7000-8000-000000000002',
  name: 'Mia Tran',
  email: 'mia@acme.example',
  phone: '+84901234567',
  company: 'Acme Freight',
  country: 'VN',
  jobTitle: 'Head of Logistics',
  tier: 'HOT',
  score: 92,
  reasons: ['Matches the ideal customer', 'Asked for a demo', 'Has a budget', 'A fourth one'],
  link: 'https://app.example.com/leads/1',
};

const transport = (mode: 'mock' | 'live') =>
  new ActionTransport({ get: () => mode } as unknown as ConfigService<never, true>);

describe('outgoing address guard (SSRF)', () => {
  it.each([
    'http://hooks.example.com/x', // not https
    'https://127.0.0.1/x',
    'https://localhost/x',
    'https://169.254.169.254/latest/meta-data', // cloud metadata
    'https://10.0.0.5/x',
    'https://192.168.1.10/x',
    'https://[::1]/x',
    'https://intranet/x', // no dot: an internal name
    'https://printer.local/x',
    'https://user:pass@hooks.example.com/x',
  ])('refuses %s', (url) => {
    expect(() => checkWebhookUrl(url)).toThrow(UrlNotAllowedError);
  });

  it.each([
    'https://[::ffff:127.0.0.1]/', // IPv4-mapped IPv6: the URL parser turns it into ::ffff:7f00:1
    'https://[::ffff:a9fe:a9fe]/', // 169.254.169.254 in hex
    'https://[::7f00:1]/', // IPv4-compatible
    'https://[64:ff9b::7f00:1]/', // NAT64
    'https://[2002:7f00:1::1]/', // 6to4 wrapping 127.0.0.1
    'https://[fec0::1]/', // old site-local
  ])('refuses an IPv6 spelling of a private address: %s', (url) => {
    expect(() => checkWebhookUrl(url)).toThrow(UrlNotAllowedError);
  });

  it('accepts a public IPv6 address', () => {
    expect(() => checkWebhookUrl('https://[2606:4700::1111]/x')).not.toThrow();
  });

  it('accepts a public https address', () => {
    expect(checkWebhookUrl('https://hooks.example.com/in/123').hostname).toBe('hooks.example.com');
  });

  it('knows private ranges (IPv4, mapped IPv4 and IPv6)', () => {
    for (const a of [
      '10.1.2.3',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.0.1',
      '::ffff:127.0.0.1',
      'fd00::1',
      'fe80::1',
    ]) {
      expect(isPrivateAddress(a)).toBe(true);
    }
    for (const a of ['8.8.8.8', '172.32.0.1', '2606:4700::1111'])
      expect(isPrivateAddress(a)).toBe(false);
  });

  it('live mode refuses a private address before any request is made', async () => {
    const t = transport('live');
    const fetchSpy = jest.fn();
    t.fetchImpl = fetchSpy as unknown as typeof fetch;
    await expect(t.post({ url: 'https://169.254.169.254/', body: {} })).rejects.toMatchObject({
      code: 'url_not_allowed',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('transport', () => {
  it('mock mode sends nothing and remembers the request', async () => {
    const t = transport('mock');
    const fetchSpy = jest.fn();
    t.fetchImpl = fetchSpy as unknown as typeof fetch;
    await t.post({ url: 'https://hooks.example.com/x', body: { a: 1 } });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(t.sent).toHaveLength(1);
  });

  it('live mode turns a bad answer into a short code and never follows a redirect', async () => {
    const t = transport('live');
    const answers = [
      new Response('secret token in here', { status: 500 }),
      new Response(null, { status: 302, headers: { location: 'http://10.0.0.1/' } }),
    ];
    t.fetchImpl = (async () => answers.shift()) as unknown as typeof fetch;
    // 93.184.216.34 is a public address, so no DNS lookup is needed.
    await expect(t.post({ url: 'https://93.184.216.34/x', body: {} })).rejects.toThrow(
      new ActionError('http_500'),
    );
    await expect(t.post({ url: 'https://93.184.216.34/x', body: {} })).rejects.toThrow(
      new ActionError('redirect'),
    );
  });
});

describe('webhook signature', () => {
  it('is an HMAC over "<timestamp>.<body>" that a receiver can recompute', async () => {
    const t = transport('mock');
    await deliverWebhook(
      t,
      { url: 'https://hooks.example.com/x', signingSecret: 'whsec_test' },
      lead,
      new Date('2026-10-28T10:00:00Z'),
    );
    const sent = t.sent[0]!;
    const timestamp = sent.headers!['X-LeadPilot-Timestamp']!;
    expect(timestamp).toBe(String(Date.parse('2026-10-28T10:00:00Z') / 1000));
    expect(sent.headers!['X-LeadPilot-Signature']).toBe(
      signWebhook('whsec_test', timestamp, JSON.stringify(sent.body)),
    );
    // A different secret gives a different signature.
    expect(signWebhook('whsec_other', timestamp, JSON.stringify(sent.body))).not.toBe(
      sent.headers!['X-LeadPilot-Signature'],
    );
  });

  it('Slack text cannot ping a channel or plant a link', () => {
    const text = leadMessage(
      { ...lead, name: '<!channel> <https://evil.example|Click>', reasons: ['<@U123> & more'] },
      slackEscape,
    );
    expect(text).not.toMatch(/<[!@h]/);
    expect(text).toContain('&lt;!channel&gt;');
    expect(text).toContain('&amp; more');
  });

  it('chat messages carry no email or phone', () => {
    const text = leadMessage(lead);
    expect(text).toContain('Mia Tran (Acme Freight)');
    expect(text).not.toContain('mia@acme.example');
    expect(text).not.toContain('+84901234567');
  });
});

describe('Hot lead email', () => {
  const input = {
    to: 'owner@example.com',
    locale: 'en' as const,
    leadName: 'Mia Tran\r\nBcc: evil@example.com',
    company: 'Acme Freight',
    score: 92,
    reasons: lead.reasons,
    link: lead.link,
    workspaceName: 'Acme',
    webOrigin: 'https://app.example.com',
  };

  it('keeps a lead-typed name on one line in the subject', () => {
    expect(hotLeadCopy(input).subject).not.toMatch(/[\r\n]/);
  });

  it('the plain text has the same words as the HTML: top three reasons and the link', async () => {
    const message = await buildHotLeadEmail(input);
    expect(message.text).toContain(lead.link);
    expect(message.html).toContain(lead.link);
    for (const reason of lead.reasons.slice(0, 3)) {
      expect(message.text).toContain(reason);
      expect(message.html).toContain(reason);
    }
    expect(message.text).not.toContain('A fourth one');
  });

  it('is written in Vietnamese for a Vietnamese workspace', () => {
    const copy = hotLeadCopy({ ...input, locale: 'vi' });
    expect(copy.subject).toMatch(/Hot mới/);
    expect(hotLeadText(copy, lead.link)).toContain(copy.reasonsTitle);
  });
});
