import { Users } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { StateView } from '@/components/state-views';

export async function generateMetadata() {
  const t = await getTranslations('leads');
  return { title: `${t('title')} · LeadPilot` };
}

// The leads list arrives in the lead milestone; until then a workspace has no
// leads, which is the "new workspace" empty state of the design (without the
// "connect a source" buttons, as sources do not exist yet).
export default async function LeadsPage() {
  const t = await getTranslations('leads');
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
      <section className="rounded-xl border border-border bg-card">
        <StateView
          icon={Users}
          tone="accent"
          title={t('emptyTitle')}
          body={t('emptyBody')}
          className="min-h-80"
        />
      </section>
    </div>
  );
}
