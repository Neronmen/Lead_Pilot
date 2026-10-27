'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, type ReactNode } from 'react';
import { useSession } from '@/lib/auth/auth-provider';
import { loginUrl, safeNext } from '@/lib/auth/safe-next';
import { isSigningIn } from '@/lib/auth/sign-in-flow';
import { SessionLoading, SessionUnavailable } from './session-screens';

/**
 * Wraps the pages that need a signed-in person. While the session is checked
 * it shows a waiting state, never the page (no flash of private content, and
 * no request fired without a token). Signed out: go to /login and come back.
 */
export function RequireSession({ children }: { children: ReactNode }) {
  // useSearchParams needs a Suspense boundary on statically built pages.
  return (
    <Suspense fallback={<SessionLoading />}>
      <RequireSessionInner>{children}</RequireSessionInner>
    </Suspense>
  );
}

function RequireSessionInner({ children }: { children: ReactNode }) {
  const { status, client } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams().toString();

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace(loginUrl(search ? `${pathname}?${search}` : pathname));
    }
  }, [status, router, pathname, search]);

  if (status === 'authenticated') return children;
  if (status === 'unavailable')
    return <SessionUnavailable onRetry={() => void client.bootstrap()} />;
  return <SessionLoading />;
}

/**
 * Wraps login, signup and accept-invite. Someone already signed in has no
 * business there: send them on to `?next=` (checked) or the leads page.
 */
export function RedirectIfSignedIn({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={children}>
      <RedirectIfSignedInInner>{children}</RedirectIfSignedInInner>
    </Suspense>
  );
}

function RedirectIfSignedInInner({ children }: { children: ReactNode }) {
  const { status } = useSession();
  const router = useRouter();
  const next = useSearchParams().get('next');

  useEffect(() => {
    // While a form on this page is signing someone in, it navigates by itself
    // when it has finished (see lib/auth/sign-in-flow.ts).
    if (status === 'authenticated' && !isSigningIn()) router.replace(safeNext(next));
  }, [status, router, next]);

  // Loading is not blocked: the form can show at once, and a signed-in person
  // is moved on as soon as the check finishes.
  // (The form on screen keeps showing while it is the one signing in.)
  return status === 'authenticated' && !isSigningIn() ? <SessionLoading /> : children;
}
