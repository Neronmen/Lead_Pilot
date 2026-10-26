import { API_URL } from '@/lib/api';
import { createAuthClient, type AuthClient, type ChannelLike } from './auth-client';

function openChannel(): ChannelLike | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  const channel = new BroadcastChannel('lp-auth');
  let handler: ChannelLike['onmessage'] = null;
  return {
    postMessage: (message) => channel.postMessage(message),
    get onmessage() {
      return handler;
    },
    set onmessage(next) {
      handler = next;
      channel.onmessage = next ? (event: MessageEvent) => next({ data: event.data }) : null;
    },
  };
}

let client: AuthClient | null = null;

/**
 * The one auth client of this browser tab, wired to the real browser:
 * `fetch`, the Web Locks API (shared by every tab of this site) and a
 * BroadcastChannel (same). Created on first use, in the browser only.
 */
export function getAuthClient(): AuthClient {
  // On the server (pre-rendering) make a throwaway client with no channel or
  // lock: nothing may be shared between requests there, and a BroadcastChannel
  // would keep the Node process alive.
  if (typeof window === 'undefined') {
    return createAuthClient({
      apiUrl: API_URL,
      fetch: (...args) => globalThis.fetch(...args),
    });
  }
  client ??= createAuthClient({
    apiUrl: API_URL,
    fetch: (...args) => globalThis.fetch(...args),
    locks: 'locks' in navigator ? navigator.locks : null,
    channel: openChannel(),
  });
  return client;
}
