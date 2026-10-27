import { getTranslations } from 'next-intl/server';
import { LeadDetailView } from '@/components/leads/lead-detail-view';

export async function generateMetadata() {
  const t = await getTranslations('leads');
  return { title: `${t('title')} · LeadPilot` };
}

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <LeadDetailView id={id} />;
}
