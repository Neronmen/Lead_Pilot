import { cookies, headers } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';
import { LOCALE_COOKIE, resolveLocale } from '@/lib/i18n/locales';

/**
 * next-intl without language routes: the language is not part of the URL, it
 * comes from the cookie and, on a first visit, the browser's Accept-Language.
 * (After sign-in the cookie is set from the person's saved language, else the
 * workspace default: see the session provider.)
 */
export default getRequestConfig(async () => {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  const locale = resolveLocale({
    cookie: cookieStore.get(LOCALE_COOKIE)?.value,
    acceptLanguage: headerStore.get('accept-language'),
  });
  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
