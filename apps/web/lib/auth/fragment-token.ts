/**
 * The token of an emailed link sits in the address fragment (`#t=...`), which browsers never send to a
 * server (so it stays out of access logs and the Referer header). Read it once, then take it out of
 * the address bar so it is not left in history, screenshots or a shared tab. Null: no usable token.
 */
export function readFragmentToken(): string | null {
  const match = /^#t=([A-Za-z0-9_-]{20,200})$/.exec(window.location.hash);
  if (window.location.hash) {
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }
  return match?.[1] ?? null;
}

const noop = () => () => undefined;
const seen = new Map<string, string | null>();

/** For `useSyncExternalStore`: the token of this page, read (and removed from the address) once. */
export function fragmentTokenSnapshot(): string | null {
  const key = window.location.pathname;
  if (!seen.has(key)) seen.set(key, readFragmentToken());
  return seen.get(key) ?? null;
}
export const subscribeFragmentToken = noop;
