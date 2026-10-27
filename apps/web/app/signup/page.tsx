import { getTranslations } from 'next-intl/server';
import { AuthShell } from '@/components/auth/auth-shell';
import { SignupAside } from '@/components/auth/signup-aside';
import { SignupForm } from '@/components/auth/signup-form';
import { RedirectIfSignedIn } from '@/components/auth-gate';
import { pathWithNext } from '@/lib/auth/safe-next';

export async function generateMetadata() {
  const t = await getTranslations('auth.signup');
  return { title: t('title') };
}

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const { next } = await searchParams;
  // The first plain `?next=`; the form checks it again (safeNext) before going anywhere.
  const raw = (Array.isArray(next) ? next[0] : next) ?? null;
  return (
    <RedirectIfSignedIn>
      <AuthShell aside={<SignupAside />} asideClassName="bg-grid">
        <SignupForm next={raw} loginHref={pathWithNext('/login', raw)} />
      </AuthShell>
    </RedirectIfSignedIn>
  );
}
