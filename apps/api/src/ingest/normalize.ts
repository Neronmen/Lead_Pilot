import { displayTextSchema, emailSchema } from '@leadpilot/shared';
import { type CountryCode, getCountries, parsePhoneNumberFromString } from 'libphonenumber-js/min';
import { DISPOSABLE_DOMAINS, FREE_MAIL_DOMAINS } from './email-domains';

/** One problem with the payload. `code` and `path` only: the sender gets no free text. */
export interface PayloadIssue {
  path: string;
  code: string;
}

export interface NormalizedLead {
  email?: string;
  /** E.164, e.g. +84901234567. */
  phone?: string;
  firstName?: string;
  lastName?: string;
  company?: string;
  domain?: string;
  /** ISO 3166-1 alpha-2, uppercase. */
  country?: string;
  /** What the person wrote, and what they said about the deal: the best signals for rating. */
  message?: string;
  budget?: string;
  timeline?: string;
  jobTitle?: string;
  interest?: string;
  /** Only set when an email was given: a merge must not reset it. */
  isFreeMail?: boolean;
  /** Everything that is not a known field, kept as sent. */
  customFields: Record<string, unknown>;
}

const MAX_CUSTOM_FIELDS = 50;
const MAX_CUSTOM_KEY = 64;

/** The names senders use for each field: camelCase, snake_case and common synonyms. */
const ALIASES = {
  email: ['email', 'emailAddress', 'email_address'],
  phone: ['phone', 'phoneNumber', 'phone_number', 'mobile'],
  firstName: ['firstName', 'first_name'],
  lastName: ['lastName', 'last_name'],
  name: ['name', 'fullName', 'full_name'],
  company: ['company', 'companyName', 'company_name'],
  website: ['website', 'domain', 'url'],
  country: ['country', 'countryCode', 'country_code'],
  message: ['message', 'comment', 'comments', 'inquiry', 'enquiry'],
  budget: ['budget', 'budget_range', 'budgetRange'],
  timeline: ['timeline', 'timeframe', 'time_frame'],
  jobTitle: ['jobTitle', 'job_title', 'title', 'position'],
  interest: ['interest', 'interests', 'product', 'product_interest'],
} as const;

const KNOWN = new Set<string>(Object.values(ALIASES).flat());

const squash = (key: string) => key.toLowerCase().replace(/[^a-z0-9]/g, '');
const HEADERS = new Map<string, string>();
for (const aliases of Object.values(ALIASES)) {
  for (const alias of aliases) HEADERS.set(squash(alias), aliases[0]);
}

/**
 * A spreadsheet column name as the field it means: "First Name", "E-mail" and "EMAIL" are firstName and
 * email. A column that means nothing known keeps its own name (it becomes a custom field).
 */
export function canonicalHeader(key: string): string {
  return HEADERS.get(squash(key)) ?? key;
}
const COUNTRIES = new Set<string>(getCountries());
const DOMAIN = /^(?=.{3,253}$)[a-z0-9-]+(\.[a-z0-9-]+)+$/;
const nameSchema = displayTextSchema(100);
const shortSchema = displayTextSchema(200);
const MAX_MESSAGE = 2000;

/** Free text from a form: line breaks stay, other control characters and lone surrogates go, and it is cut at `max`. */
function plainText(text: string, max: number): string {
  return text
    .replace(/[^\P{Cc}\n\t]|[\p{Cf}\p{Zl}\p{Zp}]/gu, ' ')
    .replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim()
    .slice(0, max);
}

type Result = { ok: true; lead: NormalizedLead } | { ok: false; issues: PayloadIssue[] };

/**
 * Turns a sender's JSON into the fields we store. Empty strings count as
 * absent (forms send them). A lead needs a valid email or a valid phone; a
 * field that is present but wrong is reported, not silently dropped.
 */
export function normalizePayload(
  payload: Record<string, unknown>,
  defaultCountry: string | null,
): Result {
  const issues: PayloadIssue[] = [];
  const bad = (path: string, code: string) => issues.push({ path, code });

  /** The first alias present with a non-empty value, as trimmed text. */
  const pick = (field: keyof typeof ALIASES): { key: string; text: string } | undefined => {
    for (const key of ALIASES[field]) {
      const value = payload[key];
      if (value === undefined || value === null) continue;
      if (typeof value !== 'string' && typeof value !== 'number') {
        bad(key, 'invalid_type');
        return undefined;
      }
      const text = String(value).trim();
      if (text !== '') return { key, text };
    }
    return undefined;
  };

  const lead: NormalizedLead = { customFields: {} };
  const custom: [string, unknown][] = [];

  const email = pick('email');
  if (email) {
    const parsed = emailSchema.safeParse(email.text);
    if (!parsed.success) bad(email.key, 'invalid_email');
    else {
      const domain = parsed.data.slice(parsed.data.lastIndexOf('@') + 1);
      if (DISPOSABLE_DOMAINS.has(domain)) bad(email.key, 'disposable_email');
      else {
        lead.email = parsed.data;
        const free = FREE_MAIL_DOMAINS.has(domain);
        lead.isFreeMail = free;
        if (!free) lead.domain = domain;
      }
    }
  }

  const phone = pick('phone');
  if (phone) {
    const region =
      defaultCountry && COUNTRIES.has(defaultCountry) ? (defaultCountry as CountryCode) : undefined;
    const parsed = parsePhoneNumberFromString(phone.text, region);
    if (parsed?.isValid()) lead.phone = parsed.number;
    else bad(phone.key, 'invalid_phone');
  }

  const text = (field: 'firstName' | 'lastName' | 'company') => {
    const found = pick(field);
    if (!found) return undefined;
    const parsed = nameSchema.safeParse(found.text);
    if (parsed.success) return parsed.data;
    bad(found.key, 'invalid_text');
    return undefined;
  };
  lead.firstName = text('firstName');
  lead.lastName = text('lastName');
  lead.company = text('company');
  const full = pick('name');
  if (full && !lead.firstName && !lead.lastName) {
    const parsed = nameSchema.safeParse(full.text);
    if (!parsed.success) bad(full.key, 'invalid_text');
    else {
      const [first, ...rest] = parsed.data.split(/\s+/);
      lead.firstName = first;
      if (rest.length > 0) lead.lastName = rest.join(' ');
    }
  }

  const message = pick('message');
  if (message) lead.message = plainText(message.text, MAX_MESSAGE) || undefined;
  const short = (field: 'budget' | 'timeline' | 'jobTitle' | 'interest') => {
    const found = pick(field);
    if (!found) return undefined;
    const parsed = shortSchema.safeParse(found.text);
    if (parsed.success) return parsed.data;
    bad(found.key, 'invalid_text');
    return undefined;
  };
  lead.budget = short('budget');
  lead.timeline = short('timeline');
  lead.jobTitle = short('jobTitle');
  lead.interest = short('interest');

  const website = pick('website');
  if (website) {
    const host = website.text
      .toLowerCase()
      .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
      .replace(/^www\./, '')
      .split(/[/?#:]/)[0]!;
    if (DOMAIN.test(host)) lead.domain = host;
    else bad(website.key, 'invalid_domain');
  }

  const country = pick('country');
  if (country) {
    const code = country.text.toUpperCase();
    if (COUNTRIES.has(code)) lead.country = code;
    else bad(country.key, 'invalid_country');
  }

  const extra = Object.entries(payload).filter(([key]) => !KNOWN.has(key));
  if (extra.length > MAX_CUSTOM_FIELDS) bad('', 'too_many_fields');
  for (const [key, value] of extra) {
    if (key.length > MAX_CUSTOM_KEY) bad('', 'field_name_too_long');
    else custom.push([key, value]);
  }
  lead.customFields = Object.fromEntries(custom);

  if (issues.length === 0 && !lead.email && !lead.phone) bad('', 'contact_required');

  // Drop undefined fields so a merge never overwrites a stored value with nothing.
  for (const key of Object.keys(lead) as (keyof NormalizedLead)[]) {
    if (lead[key] === undefined) delete lead[key];
  }
  return issues.length > 0 ? { ok: false, issues } : { ok: true, lead };
}
