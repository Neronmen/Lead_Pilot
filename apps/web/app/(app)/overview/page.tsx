import { getTranslations } from 'next-intl/server';
import { OverviewView } from '@/components/overview/overview-view';

export async function generateMetadata() {
  const t = await getTranslations('overview');
  return { title: `${t('title')} · LeadPilot` };
}

export default async function OverviewPage() {
  const t = await getTranslations('overview');
  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('sub')}</p>
      </header>
      <OverviewView />
    </div>
  );
}
