import { authSessionSchema, ErrorCode, type AuthSession } from '@leadpilot/shared';
import type { ZodType } from 'zod';
import { ApiError, NetworkError, toApiError } from '@/lib/api';

/**
 * The browser side of sign-in. Three ideas, each guarding against a real bug:
 *
 * 1. The access token lives in memory only. A page reload loses it, and the
 *    page gets a new one from the httpOnly refresh cookie ("bootstrap"). Nothing
 *    a script can read from disk (localStorage) can be stolen by an XSS bug.
 * 2. Single flight: while one refresh request is running, every caller waits
 *    for that same request instead of starting its own.
 * 3. Cross-tab lock: the refresh cookie is shared by all tabs and each use
 *    swaps it for a new one. If two tabs sent the old cookie at the same moment,
 *    the server would see a token used twice ("reuse") and sign the person out
 *    everywhere. `navigator.locks` lets only one tab refresh at a time; the next
 *    tab then sends the NEW cookie, which is a normal refresh.
 *
 * Everything the browser provides is injected (`deps`), so tests can run two
 * "tabs" in one process.
 */

export type SessionStatus =
  /** Asking the API whether the cookie still works. */
  | 'loading'
  | 'authenticated'
  | 'unauthenticated'
  /** The API could not be reached; the person may still be signed in. */
  | 'unavailable';

export interface SessionState {
  status: SessionStatus;
  /** Why the person is signed out, when it was not their own choice. */
  reason?: 'expired' | 'reused';
}

/** The slice of the Web Locks API the client needs. */
export interface LockManagerLike {
  request<T>(name: string, callback: () => Promise<T>): Promise<T>;
}

/** The slice of BroadcastChannel the client needs. */
export interface ChannelLike {
  postMessage(message: unknown): void;
  onmessage: ((event: { data: unknown }) => void) | null;
}

export interface AuthClientDeps {
  apiUrl: string;
  fetch: typeof fetch;
  /** Absent in old browsers: single flight still works within the tab. */
  locks?: LockManagerLike | null;
  channel?: ChannelLike | null;
  now?: () => number;
}

/** A request that takes longer than this is treated as a lost connection. */
const REFRESH_TIMEOUT_MS = 10_000;
const REQUEST_TIMEOUT_MS = 30_000;

/** Thrown when a refresh is dropped because the person signed out meanwhile. */
class SignedOutError extends ApiError {
  constructor() {
    super(401, ErrorCode.AUTH_SESSION_EXPIRED, 'Signed out');
    this.name = 'SignedOutError';
  }
}

/** A token with less than this left is refreshed before use. */
const EXPIRY_MARGIN_MS = 30_000;
const LOCK_NAME = 'lp-refresh';

type Message =
  | { type: 'token'; accessToken: string; expiresAt: number }
  | { type: 'logout'; reason?: 'expired' | 'reused' };

export interface RequestOptions<T> {
  method?: string;
  body?: unknown;
  schema?: ZodType<T>;
  /** Skip the Authorization header and the 401 retry (login, signup...). */
  anonymous?: boolean;
}

export function createAuthClient(deps: AuthClientDeps) {
  const now = deps.now ?? Date.now;
  let token: { value: string; expiresAt: number } | null = null;
  let state: SessionState = { status: 'loading' };
  let inFlight: Promise<AuthSession> | null = null;
  /** Counts sign-outs: a refresh that started before one must not undo it. */
  let epoch = 0;
  const listeners = new Set<() => void>();

  function setState(next: SessionState) {
    if (next.status === state.status && next.reason === state.reason) return;
    state = next;
    for (const listener of [...listeners]) {
      // One broken listener must not fail a refresh that worked, or hide the change from the rest.
      try {
        listener();
      } catch (error) {
        console.error('Auth listener failed', error);
      }
    }
  }

  function storeToken(session: AuthSession, share: boolean) {
    token = { value: session.accessToken, expiresAt: now() + session.expiresIn * 1000 };
    setState({ status: 'authenticated' });
    if (share) {
      // Other tabs that are waiting for the lock can use this instead of
      // refreshing again. A BroadcastChannel never touches disk or the network.
      post({ type: 'token', accessToken: token.value, expiresAt: token.expiresAt });
    }
  }

  function signedOut(reason?: 'expired' | 'reused') {
    epoch++;
    token = null;
    setState({ status: 'unauthenticated', reason });
  }

  function post(message: Message) {
    deps.channel?.postMessage(message);
  }

  if (deps.channel) {
    deps.channel.onmessage = (event) => {
      const message = event.data as Message | null;
      // Anything can be posted on the channel: accept only what is well formed.
      if (
        message?.type === 'token' &&
        typeof message.accessToken === 'string' &&
        Number.isFinite(message.expiresAt) &&
        state.status !== 'unauthenticated'
      ) {
        // Sharing the token is safe enough: the channel is same-origin, in
        // memory only, and the token lives 15 minutes. Never log these messages.
        token = { value: message.accessToken, expiresAt: message.expiresAt };
        setState({ status: 'authenticated' });
      } else if (message?.type === 'logout') {
        signedOut(message.reason);
      }
    };
  }

  const fresh = () => token !== null && token.expiresAt - now() > EXPIRY_MARGIN_MS;

  async function callRefresh(): Promise<AuthSession> {
    let res: Response;
    try {
      res = await deps.fetch(`${deps.apiUrl}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { accept: 'application/json' },
        // This runs while holding the cross-tab lock: a hung request must not block every tab.
        signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS),
      });
    } catch (cause) {
      throw new NetworkError(cause);
    }
    if (!res.ok) throw await toApiError(res);
    const parsed = authSessionSchema.safeParse(await res.json().catch(() => null));
    if (!parsed.success) throw new ApiError(res.status, 'UNKNOWN', 'Unexpected refresh response');
    return parsed.data;
  }

  /**
   * Gets a new access token. `force` is for a 401: the token we hold was
   * refused, so a "fresh" one in memory must not short-circuit the refresh.
   */
  function refresh(force = false, rejected = token?.value): Promise<AuthSession> {
    if (inFlight) return inFlight;
    const startedAt = epoch;
    const run = async (): Promise<AuthSession> => {
      // Signed out while this waited for the lock: do not send a dead cookie.
      if (epoch !== startedAt) throw new SignedOutError();
      // Another tab may have refreshed while this one waited for the lock.
      if (token && fresh() && (!force || token.value !== rejected)) {
        return {
          accessToken: token.value,
          expiresIn: Math.round((token.expiresAt - now()) / 1000),
        };
      }
      const session = await callRefresh();
      // Signed out while the request was on its way: keep it that way.
      if (epoch !== startedAt) throw new SignedOutError();
      storeToken(session, true);
      return session;
    };
    const locked = deps.locks ? deps.locks.request(LOCK_NAME, run) : run();
    inFlight = locked
      .catch((error: unknown) => {
        if (error instanceof SignedOutError) throw error;
        if (error instanceof ApiError && error.status === 401) {
          const reused = error.code === ErrorCode.AUTH_REFRESH_REUSED;
          signedOut(reused ? 'reused' : 'expired');
          post({ type: 'logout', reason: reused ? 'reused' : 'expired' });
        }
        throw error;
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  }

  /** Page load: turn the cookie into an access token, or learn there is none. */
  async function bootstrap(): Promise<void> {
    // A retry from the "cannot connect" screen shows the waiting state again.
    if (state.status === 'unavailable') setState({ status: 'loading' });
    try {
      await refresh();
    } catch (error) {
      // A 401 already set "unauthenticated". Anything else (API down) leaves
      // the person's state unknown: do not sign them out for a network blip.
      if (!(error instanceof ApiError && error.status === 401)) {
        setState({ status: 'unavailable' });
      }
    }
  }

  async function validToken(): Promise<string | null> {
    if (fresh()) return token!.value;
    if (state.status === 'unauthenticated') return null;
    return (await refresh()).accessToken;
  }

  /** A JSON request to the API. Sends the token; on a 401 refreshes once and retries once. */
  async function request<T = void>(path: string, options: RequestOptions<T> = {}): Promise<T> {
    let sentToken: string | undefined;
    const send = async (): Promise<Response> => {
      const headers: Record<string, string> = { accept: 'application/json' };
      if (options.body !== undefined) headers['content-type'] = 'application/json';
      if (!options.anonymous) {
        const access = await validToken();
        sentToken = access ?? undefined;
        if (access) headers.authorization = `Bearer ${access}`;
      }
      try {
        return await deps.fetch(`${deps.apiUrl}${path}`, {
          method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
          credentials: 'include',
          headers,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          body: options.body === undefined ? undefined : JSON.stringify(options.body),
        });
      } catch (cause) {
        throw new NetworkError(cause);
      }
    };

    let res = await send();
    if (res.status === 401 && !options.anonymous) {
      await refresh(true, sentToken); // throws, and signs the person out, when the cookie is dead
      res = await send();
    }
    if (!res.ok) throw await toApiError(res);
    if (res.status === 204 || !options.schema) return undefined as T;
    const parsed = options.schema.safeParse(await res.json().catch(() => null));
    if (!parsed.success)
      throw new ApiError(res.status, 'UNKNOWN', `Unexpected ${res.status} response`);
    return parsed.data;
  }

  /** login / signup / accept invite: the API answers with a session. */
  async function startSession(path: string, body: unknown): Promise<void> {
    const session = await request(path, { body, schema: authSessionSchema, anonymous: true });
    storeToken(session, true);
  }

  /**
   * Signs out here and in every tab. If the API cannot be reached the sign-in
   * is still valid (the cookie is not revoked), so this browser stays signed in
   * and the error is thrown for the page to show: "could not sign out, try again".
   */
  async function logout(): Promise<void> {
    try {
      // The cookie, not the token, identifies the sign-in to revoke.
      await request('/auth/logout', { method: 'POST', anonymous: true });
    } catch (error) {
      // 401 means there was no sign-in left to revoke: that is signed out too.
      if (!(error instanceof ApiError && error.status === 401)) throw error;
    }
    signedOut();
    post({ type: 'logout' });
  }

  return {
    bootstrap,
    refresh: () => refresh(),
    request,
    login: (body: unknown) => startSession('/auth/login', body),
    signup: (body: unknown) => startSession('/auth/signup', body),
    acceptInvite: (body: unknown) => startSession('/auth/invites/accept', body),
    logout,
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export type AuthClient = ReturnType<typeof createAuthClient>;
