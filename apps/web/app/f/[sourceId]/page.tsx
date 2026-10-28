import { getTranslations } from 'next-intl/server';
import { PublicForm } from '@/components/forms/public-form';

export async function generateMetadata() {
  const t = await getTranslations('publicForm');
  // A form page is for the visitors of one company's website, not for search engines.
  return { title: t('metaTitle'), robots: { index: false, follow: false } };
}

export default async function PublicFormPage({
  params,
}: {
  params: Promise<{ sourceId: string }>;
}) {
  const { sourceId } = await params;
  return (
    <main id="main" className="min-h-screen bg-background text-foreground">
      <PublicForm sourceId={sourceId} />
    </main>
  );
}
