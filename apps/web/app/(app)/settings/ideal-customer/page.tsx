import { getTranslations } from 'next-intl/server';
import { IdealCustomerView } from '@/components/icp/ideal-customer-view';

export async function generateMetadata() {
  const t = await getTranslations('settingsIdeal');
  return { title: `${t('title')} · LeadPilot` };
}

export default async function IdealCustomerPage() {
  const t = await getTranslations('settingsIdeal');
  return (
    <>
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('sub')}</p>
      </header>
      <IdealCustomerView />
    </>
  );
}
