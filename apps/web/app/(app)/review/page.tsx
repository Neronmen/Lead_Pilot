import { getTranslations } from 'next-intl/server';
import { ReviewQueueView } from '@/components/leads/review-queue-view';

export async function generateMetadata() {
  const t = await getTranslations('review');
  return { title: `${t('title')} · LeadPilot` };
}

// The heading is rendered on the server so it follows the sign-in language at once.
export default async function ReviewPage() {
  const t = await getTranslations('review');
  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('sub')}</p>
      </header>
      <ReviewQueueView />
    </div>
  );
}
