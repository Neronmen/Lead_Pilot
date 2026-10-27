/** Where to go after sign-in when nothing else was asked. */
export const DEFAULT_LANDING = '/leads';

/**
 * Validates the `?next=` address a sign-in page redirects to. Only a path on
 * this same site is allowed; anything else (another host, `//evil.com`,
 * `/\evil.com`, `javascript:`) falls back to the default. Otherwise a link like
 * /login?next=https://evil.com would make the real login page an open redirect.
 */
export function safeNext(raw: string | null | undefined): string {
  if (!raw || raw.length > 2048) return DEFAULT_LANDING;
  // Must be one slash then a normal character: not "//", not "/\", not "/%2F".
  if (!/^\/(?![/\\])/.test(raw)) return DEFAULT_LANDING;
  // No control characters or backslashes anywhere (browsers treat "\" like "/").
  if (/[\p{Cc}\\]/u.test(raw)) return DEFAULT_LANDING;
  try {
    const url = new URL(raw, 'http://placeholder.invalid');
    if (url.origin !== 'http://placeholder.invalid') return DEFAULT_LANDING;
    // Do not bounce between the sign-in pages themselves.
    if (/^\/(login|signup|invite)(\/|$)/.test(url.pathname)) return DEFAULT_LANDING;
    const normalized = `${url.pathname}${url.search}${url.hash}`;
    // Dot-segments can collapse into a leading "//" ("/x/..//evil.com"): check again.
    return /^\/(?![/\\])/.test(normalized) ? normalized : DEFAULT_LANDING;
  } catch {
    return DEFAULT_LANDING;
  }
}

/**
 * `path` (such as "/signup") carrying the checked `next` along, so moving
 * between the sign-in pages does not lose where the person was going.
 */
export function pathWithNext(path: string, next: string | null | undefined): string {
  const safe = safeNext(next);
  return safe === DEFAULT_LANDING ? path : `${path}?next=${encodeURIComponent(safe)}`;
}

/** The sign-in address that comes back to `path` afterwards. */
export function loginUrl(path: string): string {
  const next = safeNext(path);
  return next === DEFAULT_LANDING ? '/login' : `/login?next=${encodeURIComponent(next)}`;
}
