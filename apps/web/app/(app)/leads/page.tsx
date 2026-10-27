import { getTranslations } from 'next-intl/server';
import { LeadsView } from '@/components/leads/leads-view';

export async function generateMetadata() {
  const t = await getTranslations('leads');
  return { title: `${t('title')} · LeadPilot` };
}

export default function LeadsPage() {
  return <LeadsView />;
}
