import { meResponseSchema } from '@leadpilot/shared';
import type { QueryClient } from '@tanstack/react-query';
import { LOCALE_COOKIE, isLocale, saveLocale, type Locale } from '@/lib/i18n/locales';
import type { AuthClient } from './auth-client';
import { ME_QUERY_KEY } from './auth-provider';

/**
 * Signing in changes the session state the moment the API answers, and the
 * "already signed in? go to the app" redirect watches that state. This flag
 * lets the sign-in page finish its own work first (load who the person is,
 * switch to their language) and then navigate by itself.
 */
let inProgress = 0;

export function isSigningIn(): boolean {
  return inProgress > 0;
}

export async function whileSigningIn<T>(work: () => Promise<T>): Promise<T> {
  inProgress++;
  try {
    return await work();
  } finally {
    inProgress--;
  }
}

/** The language saved in this browser's cookie, if any. */
export function readLocaleCookie(cookies: string): Locale | null {
  for (const part of cookies.split(';')) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const name = trimmed.slice(0, eq);
    const value = trimmed.slice(eq + 1);
    if (name === LOCALE_COOKIE && isLocale(value)) return value;
  }
  return null;
}

/**
 * After a successful sign-in, sign up or accepted invite: load who is signed
 * in (so the app shell has it at once) and, if the account has a language of
 * its own that differs from this browser's, switch to it. A person who picked
 * Vietnamese on another device sees Vietnamese here too. Failing to load is
 * not worth blocking the sign-in for: the app loads it again.
 */
export async function finishSignIn(client: AuthClient, queryClient: QueryClient): Promise<void> {
  try {
    const me = await client.request('/auth/me', { schema: meResponseSchema });
    queryClient.setQueryData(ME_QUERY_KEY, me);
    const wanted = me.user.locale;
    // The cookie is read by the server on the next page load; the sign-in page's own
    // navigation (router.replace) renders the next page with it (covered by the
    // "account language wins" render check).
    if (wanted && readLocaleCookie(document.cookie) !== wanted) saveLocale(wanted);
  } catch {
    // The app shell fetches it again.
  }
}
