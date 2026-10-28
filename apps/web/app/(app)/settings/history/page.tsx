import { getTranslations } from 'next-intl/server';
import { HistoryView } from '@/components/history/history-view';

export async function generateMetadata() {
  const t = await getTranslations('settingsHistory');
  return { title: `${t('title')} · LeadPilot` };
}

export default async function HistoryPage() {
  const t = await getTranslations('settingsHistory');
  return (
    <>
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('sub')}</p>
      </header>
      <HistoryView />
    </>
  );
}
