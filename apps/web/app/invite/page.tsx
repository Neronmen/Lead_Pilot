import { getTranslations } from 'next-intl/server';
import { AcceptInvite } from '@/components/auth/accept-invite';
import { AuthShell } from '@/components/auth/auth-shell';

export async function generateMetadata() {
  const t = await getTranslations('auth.invite');
  return {
    title: t('invitation'),
    // An invite link is private: keep it out of search results.
    robots: { index: false, follow: false },
  };
}

// No RedirectIfSignedIn here: someone who is signed in as another person may
// still open an invite for a new workspace, and bouncing them away would lose
// the link. Accepting signs them in to the new workspace.
export default function AcceptInvitePage() {
  return (
    <AuthShell>
      <div className="flex w-full justify-center">
        <AcceptInvite />
      </div>
    </AuthShell>
  );
}
