/** The two languages of the app (SPEC §4.9). Matches the API's `Locale`. */
export const LOCALES = ['en', 'vi'] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en';

/** The cookie that holds the language the page is rendered in. */
export const LOCALE_COOKIE = 'lp_locale';
const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/**
 * The best language for an `Accept-Language` header, `en` when none matches:
 * "vi-VN,vi;q=0.9,en;q=0.8" -> "vi". Entries are tried by weight, and only the
 * primary subtag counts ("en-GB" is English).
 */
export function negotiateLocale(header: string | null | undefined): Locale {
  if (!header) return DEFAULT_LOCALE;
  const ranked = header
    .split(',')
    .map((part, index) => {
      const [tag = '', ...params] = part.trim().split(';');
      const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
      const weight = q ? Number.parseFloat(q.slice(2)) : 1;
      return { tag: tag.trim().toLowerCase(), weight: Number.isNaN(weight) ? 0 : weight, index };
    })
    .filter((entry) => entry.tag && entry.weight > 0)
    .sort((a, b) => b.weight - a.weight || a.index - b.index);
  for (const { tag } of ranked) {
    const primary = tag.split('-')[0];
    if (isLocale(primary)) return primary;
  }
  return DEFAULT_LOCALE;
}

/**
 * The language to render: the cookie (the person's own choice, or what the
 * workspace default set at sign-in), else the browser's language, else `en`.
 */
export function resolveLocale(input: {
  cookie?: string | null;
  acceptLanguage?: string | null;
}): Locale {
  return isLocale(input.cookie) ? input.cookie : negotiateLocale(input.acceptLanguage);
}

/** The value for `document.cookie` that saves a language choice for a year. */
export function localeCookie(locale: Locale): string {
  return `${LOCALE_COOKIE}=${locale}; Path=/; Max-Age=${ONE_YEAR_SECONDS}; SameSite=Lax`;
}

/** Saves the language choice in the browser (the server reads it on the next request). */
export function saveLocale(locale: Locale): void {
  document.cookie = localeCookie(locale);
}
