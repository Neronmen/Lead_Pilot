import { createHmac } from 'node:crypto';
import { z } from 'zod';
import { ActionError, type ActionTransport } from './transport';

/** What goes into a message about a lead. Built once per run from the stored lead and its latest score. */
export interface RoutedLead {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  country: string | null;
  jobTitle: string | null;
  tier: string | null;
  score: number | null;
  reasons: string[];
  /** The page of this lead in the web app. */
  link: string;
}

/** Decrypted integration settings, one shape per type (written by IntegrationsService, so trusted but re-checked). */
export const slackConfigSchema = z.object({ webhookUrl: z.string() });
export const telegramConfigSchema = z.object({ botToken: z.string(), chatId: z.string() });
export const webhookConfigSchema = z.object({ url: z.string(), signingSecret: z.string() });
export const hubspotConfigSchema = z.object({ token: z.string() });

const oneLine = (value: string) => value.replace(/[\r\n]+/g, ' ').trim();

/** The sentence Slack and Telegram show. No email or phone: a chat channel is wider than the lead's owner. */
/** Slack reads `<!channel>`, `<@U1>` and `<url|text>`: lead-typed text must not turn into those. */
export const slackEscape = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function leadMessage(lead: RoutedLead, escape: (text: string) => string = (t) => t): string {
  const who = escape(
    lead.company ? `${oneLine(lead.name)} (${oneLine(lead.company)})` : oneLine(lead.name),
  );
  const tier = lead.tier ? lead.tier.charAt(0) + lead.tier.slice(1).toLowerCase() : 'New';
  const score = lead.score === null ? '' : `, score ${lead.score}`;
  const reasons = lead.reasons.slice(0, 3).map((r) => `- ${escape(oneLine(r))}`);
  return [`${tier} lead: ${who}${score}`, ...reasons, lead.link].join('\n');
}

/** `X-LeadPilot-Signature`: HMAC-SHA256 of "<timestamp>.<body>", so the receiver can check who sent it and when. */
export function signWebhook(secret: string, timestamp: string, body: string): string {
  return `sha256=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;
}

export interface Delivered {
  /** The id the other system gave the lead (HubSpot contact id). */
  externalId?: string;
}

export async function deliverSlack(
  transport: ActionTransport,
  config: unknown,
  lead: RoutedLead,
): Promise<Delivered> {
  const parsed = slackConfigSchema.safeParse(config);
  if (!parsed.success) throw new ActionError('bad_config');
  await transport.post({
    url: parsed.data.webhookUrl,
    body: { text: leadMessage(lead, slackEscape) },
  });
  return {};
}

export async function deliverTelegram(
  transport: ActionTransport,
  config: unknown,
  lead: RoutedLead,
): Promise<Delivered> {
  const parsed = telegramConfigSchema.safeParse(config);
  if (!parsed.success) throw new ActionError('bad_config');
  // The token is part of Telegram's address; it is encrypted at rest and never logged or returned.
  await transport.post({
    url: `https://api.telegram.org/bot${encodeURIComponent(parsed.data.botToken)}/sendMessage`,
    body: { chat_id: parsed.data.chatId, text: leadMessage(lead) },
  });
  return {};
}

export async function deliverWebhook(
  transport: ActionTransport,
  config: unknown,
  lead: RoutedLead,
  now: Date = new Date(),
  deliveryId?: string,
): Promise<Delivered> {
  const parsed = webhookConfigSchema.safeParse(config);
  if (!parsed.success) throw new ActionError('bad_config');
  const body = {
    event: 'lead.routed',
    lead: {
      id: lead.id,
      name: lead.name,
      email: lead.email,
      phone: lead.phone,
      company: lead.company,
      country: lead.country,
      jobTitle: lead.jobTitle,
    },
    score: { tier: lead.tier, value: lead.score, reasons: lead.reasons },
    link: lead.link,
  };
  const timestamp = String(Math.floor(now.getTime() / 1000));
  await transport.post({
    url: parsed.data.url,
    headers: {
      'X-LeadPilot-Timestamp': timestamp,
      // The same on every try of one action: a receiver can drop duplicates.
      ...(deliveryId ? { 'X-LeadPilot-Delivery': deliveryId } : {}),
      'X-LeadPilot-Signature': signWebhook(
        parsed.data.signingSecret,
        timestamp,
        JSON.stringify(body),
      ),
    },
    body,
  });
  return {};
}

export async function deliverHubspot(
  transport: ActionTransport,
  config: unknown,
  lead: RoutedLead,
): Promise<Delivered> {
  const parsed = hubspotConfigSchema.safeParse(config);
  if (!parsed.success) throw new ActionError('bad_config');
  if (!lead.email) throw new ActionError('no_email');
  const [firstname, ...rest] = lead.name.split(' ');
  const answer = await transport
    .post({
      url: 'https://api.hubapi.com/crm/v3/objects/contacts',
      headers: { Authorization: `Bearer ${parsed.data.token}` },
      body: {
        properties: {
          email: lead.email,
          firstname,
          lastname: rest.join(' ') || undefined,
          company: lead.company ?? undefined,
          phone: lead.phone ?? undefined,
        },
      },
    })
    .catch((error: unknown) => {
      // 409: HubSpot already has this contact. That is the goal, not a failure.
      if (error instanceof ActionError && error.code === 'http_409') return null;
      throw error;
    });
  const id = z.object({ id: z.string() }).safeParse(answer);
  return id.success ? { externalId: id.data.id } : {};
}

const TEST_LEAD: RoutedLead = {
  id: '00000000-0000-0000-0000-000000000000',
  name: 'Test message from LeadPilot',
  email: null,
  phone: null,
  company: null,
  country: null,
  jobTitle: null,
  tier: null,
  score: null,
  reasons: ['If you can read this, the connection works.'],
  link: 'https://leadpilot.invalid/',
};

/** "Send test message": the same call as a real action, with a made-up lead (HubSpot: a read-only search). */
export async function sendTest(
  transport: ActionTransport,
  type: 'slack' | 'telegram' | 'webhook' | 'hubspot',
  config: unknown,
): Promise<void> {
  switch (type) {
    case 'slack':
      await deliverSlack(transport, config, TEST_LEAD);
      return;
    case 'telegram':
      await deliverTelegram(transport, config, TEST_LEAD);
      return;
    case 'webhook':
      await deliverWebhook(transport, config, TEST_LEAD);
      return;
    case 'hubspot': {
      const parsed = hubspotConfigSchema.safeParse(config);
      if (!parsed.success) throw new ActionError('bad_config');
      await transport.post({
        url: 'https://api.hubapi.com/crm/v3/objects/contacts/search',
        headers: { Authorization: `Bearer ${parsed.data.token}` },
        body: { limit: 1 },
      });
    }
  }
}
