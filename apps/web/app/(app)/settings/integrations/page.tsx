import { getTranslations } from 'next-intl/server';
import { IntegrationsView } from '@/components/integrations/integrations-view';

export async function generateMetadata() {
  const t = await getTranslations('settingsIntegrations');
  return { title: `${t('title')} · LeadPilot` };
}

export default async function IntegrationsPage() {
  const t = await getTranslations('settingsIntegrations');
  return (
    <>
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('sub')}</p>
      </header>
      <IntegrationsView />
    </>
  );
}
