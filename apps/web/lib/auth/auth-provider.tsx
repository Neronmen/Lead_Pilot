'use client';

import { meResponseSchema, type MeResponse } from '@leadpilot/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import type { AuthClient, SessionState } from './auth-client';
import { getAuthClient } from './browser';

const LOADING: SessionState = { status: 'loading' };

const AuthContext = createContext<AuthClient | null>(null);

/**
 * Starts the session on page load (asks the API to swap the refresh cookie
 * for an access token) and shares the auth client with the page.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const client = useMemo(() => getAuthClient(), []);
  const queryClient = useQueryClient();

  useEffect(() => {
    // Bootstrap is single-flight, so React's double effect run in development
    // still makes one request.
    void client.bootstrap();
  }, [client]);

  // When the person is signed out (here or in another tab), forget their data.
  useEffect(
    () =>
      client.subscribe(() => {
        if (client.getState().status === 'unauthenticated') queryClient.clear();
      }),
    [client, queryClient],
  );

  return <AuthContext.Provider value={client}>{children}</AuthContext.Provider>;
}

export function useAuthClient(): AuthClient {
  const client = useContext(AuthContext);
  if (!client) throw new Error('useAuthClient must be used inside <AuthProvider>');
  return client;
}

/** The session state: loading, signed in, signed out, or API unreachable. */
export function useSession(): SessionState & { client: AuthClient } {
  const client = useAuthClient();
  const state = useSyncExternalStore(client.subscribe, client.getState, () => LOADING);
  return { ...state, client };
}

export const ME_QUERY_KEY = ['me'] as const;

/** Who is signed in, their workspace and role. Only asked once signed in. */
export function useMe() {
  const { client, status } = useSession();
  return useQuery<MeResponse>({
    queryKey: ME_QUERY_KEY,
    queryFn: () => client.request('/auth/me', { schema: meResponseSchema }),
    enabled: status === 'authenticated',
    staleTime: 60_000,
  });
}
