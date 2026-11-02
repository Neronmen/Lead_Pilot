import { getTranslations } from 'next-intl/server';
import { GeneralView } from '@/components/general/general-view';

export async function generateMetadata() {
  const t = await getTranslations('settingsGeneral');
  return { title: `${t('title')} · LeadPilot` };
}

export default async function GeneralPage() {
  const t = await getTranslations('settingsGeneral');
  return (
    <>
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('sub')}</p>
      </header>
      <GeneralView />
    </>
  );
}
