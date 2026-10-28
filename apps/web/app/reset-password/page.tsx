import { getTranslations } from 'next-intl/server';
import { ResetPasswordForm } from '@/components/auth/account-pages';
import { AuthShell } from '@/components/auth/auth-shell';

export async function generateMetadata() {
  const t = await getTranslations('auth.account');
  return {
    title: t('reset.title'),
    // These links are private: keep them out of search results.
    robots: { index: false, follow: false },
  };
}

export default function Page() {
  return (
    <AuthShell>
      <div className="flex w-full justify-center">
        <ResetPasswordForm />
      </div>
    </AuthShell>
  );
}
