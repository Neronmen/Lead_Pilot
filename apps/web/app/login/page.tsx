import { getTranslations } from 'next-intl/server';
import { AuthShell } from '@/components/auth/auth-shell';
import { LoginAside } from '@/components/auth/login-aside';
import { LoginForm } from '@/components/auth/login-form';
import { RedirectIfSignedIn } from '@/components/auth-gate';
import { pathWithNext } from '@/lib/auth/safe-next';

export async function generateMetadata() {
  const t = await getTranslations('auth.login');
  return { title: `${t('title')}` };
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const { next } = await searchParams;
  // Only a single, plain `?next=` is used; the form checks it again (safeNext)
  // before going anywhere.
  const raw = (Array.isArray(next) ? next[0] : next) ?? null;
  return (
    <RedirectIfSignedIn>
      <AuthShell aside={<LoginAside />}>
        <LoginForm next={raw} signupHref={pathWithNext('/signup', raw)} />
      </AuthShell>
    </RedirectIfSignedIn>
  );
}
