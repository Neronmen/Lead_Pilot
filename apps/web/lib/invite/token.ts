import { inviteTokenSchema } from '@leadpilot/shared';

/**
 * The invite token comes in the address as `#t=<token>`. A fragment is never
 * sent to a server, so it stays out of logs and proxies. This module reads it,
 * then removes it from the address bar and the history entry, and keeps the
 * token in a module variable (memory only: not localStorage, not a cookie, not
 * the URL, not React Query's cache key).
 *
 * Why a module variable and not component state or a ref: React's StrictMode
 * (development) mounts every component twice. Each mount would read the
 * address, and the second would find the fragment already gone and decide the
 * link is empty. State created by the first mount is thrown away between the
 * two; a module variable survives, so every mount (and every re-render) gets
 * the same answer and the address is cleaned exactly once.
 *
 * Rules:
 * - A non-empty fragment is always a NEW link: it replaces whatever token was
 *   held, whether it is usable or not, and is cleaned away at once. (Pasting a
 *   second invite link into a tab that is already on this page only changes the
 *   fragment: no reload, so the old token must not outlive it.)
 * - An empty fragment keeps the answer already known.
 * - `generation` counts links seen. It is not secret and is what the page puts
 *   in its query key, so a new link never shows the previous link's preview.
 * - `forgetInviteToken()` drops the token once it has been used or has failed.
 *
 * `token`: a usable token, or `null` (no usable token). Before the first read
 * there is no state at all.
 */
interface State {
  token: string | null;
  generation: number;
}
let state: State | undefined;
const listeners = new Set<() => void>();

function parseHash(hash: string): string | null {
  const match = /^#(?:.*&)?t=([^&]*)$/.exec(hash);
  if (!match) return null;
  const parsed = inviteTokenSchema.safeParse(decodeURIComponentSafe(match[1]!));
  return parsed.success ? parsed.data : null;
}

function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * The token of the current link, or `null`. Reads the fragment when there is
 * one (and removes it); otherwise answers from memory. Safe to call from
 * `useSyncExternalStore`: it is cheap, and repeated calls give the same answer.
 *
 * It does change the address (`history.replaceState`) when it finds a fragment.
 * That is idempotent, and React calls `getSnapshot` after hydration, never
 * during it, so the framework's own history patch is not triggered mid-render
 * of another component.
 */
export function readInviteToken(): string | null {
  const hash = window.location.hash;
  if (hash) {
    state = { token: parseHash(hash), generation: (state?.generation ?? 0) + 1 };
    // Whatever it held, the fragment goes: a bad one is no more useful in the address.
    window.history.replaceState(
      window.history.state,
      '',
      window.location.pathname + window.location.search,
    );
  } else if (state === undefined) {
    state = { token: null, generation: 0 };
  }
  return state.token;
}

/** A number that changes with every link seen (not secret). */
export function inviteGeneration(): number {
  return state?.generation ?? 0;
}

/** Subscribe to link changes: a new fragment pasted into the tab, or the token being forgotten. */
export function subscribeInviteToken(onChange: () => void): () => void {
  listeners.add(onChange);
  window.addEventListener('hashchange', onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener('hashchange', onChange);
  };
}

/** Drop the token: it has been used, or the server said it is no good. */
export function forgetInviteToken(options: { quiet?: boolean } = {}): void {
  state = { token: null, generation: (state?.generation ?? 0) + 1 };
  if (!options.quiet) listeners.forEach((listener) => listener());
}

/** The server snapshot: nothing is known before the browser has run this. */
export const serverInviteToken = (): undefined => undefined;

/** For tests: forget everything, as a fresh page load would. */
export function resetInviteTokenForTests(): void {
  state = undefined;
}
