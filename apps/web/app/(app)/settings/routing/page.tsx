import { getTranslations } from 'next-intl/server';
import { RoutingView } from '@/components/routing/routing-view';

export async function generateMetadata() {
  const t = await getTranslations('settingsRouting');
  return { title: `${t('title')} · LeadPilot` };
}

export default async function RoutingPage() {
  const t = await getTranslations('settingsRouting');
  return (
    <>
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('sub')}</p>
      </header>
      <RoutingView />
    </>
  );
}
