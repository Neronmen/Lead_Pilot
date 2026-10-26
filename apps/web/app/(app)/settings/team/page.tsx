import { getTranslations } from 'next-intl/server';

export async function generateMetadata() {
  const t = await getTranslations('settingsTeam');
  return { title: `${t('title')} · LeadPilot` };
}

// The people list, invites and role changes are built in step 10; this is
// the page header of the design.
export default async function TeamPage() {
  const t = await getTranslations('settingsTeam');
  return (
    <header className="flex flex-col gap-1">
      <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
      <p className="text-sm text-muted-foreground">{t('sub')}</p>
    </header>
  );
}
