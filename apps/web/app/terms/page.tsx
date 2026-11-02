import { getTranslations } from 'next-intl/server';
import { LegalPage } from '@/components/legal/legal-page';

export async function generateMetadata() {
  const t = await getTranslations('legal.terms');
  return { title: `${t('title')} · LeadPilot` };
}

export default function TermsPage() {
  return <LegalPage kind="terms" />;
}
