'use client';

import { useTranslations } from 'next-intl';
import { ErrorState } from '@/components/state-views';
import { Button } from '@/components/ui/button';

// Catches a page that throws while rendering, inside the shell (the sidebar stays).
export default function AppError({ reset }: { error: Error; reset: () => void }) {
  const t = useTranslations('common');
  return (
    <ErrorState title={t('errorTitle')} body={t('errorBody')}>
      <Button onClick={reset}>{t('tryAgain')}</Button>
    </ErrorState>
  );
}
