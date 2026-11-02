import { getTranslations } from 'next-intl/server';
import { LegalPage } from '@/components/legal/legal-page';

export async function generateMetadata() {
  const t = await getTranslations('legal.privacy');
  return { title: `${t('title')} · LeadPilot` };
}

export default function PrivacyPage() {
  return <LegalPage kind="privacy" />;
}
