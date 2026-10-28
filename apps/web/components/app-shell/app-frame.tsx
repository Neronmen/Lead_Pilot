'use client';

import type { ReactNode } from 'react';
import { RequireSession } from '@/components/auth-gate';
import { SessionLoading, SessionUnavailable } from '@/components/session-screens';
import { useMe } from '@/lib/auth/auth-provider';
import { AppShell } from './app-shell';
import { VerifyBanner } from './verify-banner';
import { MeProvider } from './me-context';

/**
 * Everything behind sign-in: waits for the session, then for "who am I", then
 * shows the shell. Children can rely on the person and role being loaded.
 */
export function AppFrame({ children }: { children: ReactNode }) {
  return (
    <RequireSession>
      <LoadMe>{children}</LoadMe>
    </RequireSession>
  );
}

function LoadMe({ children }: { children: ReactNode }) {
  const me = useMe();
  if (me.data) {
    return (
      <MeProvider value={me.data}>
        <AppShell>
          <VerifyBanner />
          {children}
        </AppShell>
      </MeProvider>
    );
  }
  if (me.isError) return <SessionUnavailable onRetry={() => void me.refetch()} />;
  return <SessionLoading />;
}
