import { getTranslations } from 'next-intl/server';
import { LeadsView } from '@/components/leads/leads-view';

export async function generateMetadata() {
  const t = await getTranslations('leads');
  return { title: `${t('title')} · LeadPilot` };
}

// The heading is rendered here, on the server, so it follows the language chosen
// at sign-in at once; the list below is client-side.
export default async function LeadsPage() {
  const t = await getTranslations('leads');
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
      <LeadsView />
    </div>
  );
}
