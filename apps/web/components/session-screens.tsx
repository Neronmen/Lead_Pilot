'use client';

import { CloudOff, LoaderCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';

/** Full-page waiting state while the session is being checked. */
export function SessionLoading() {
  const t = useTranslations('session');
  return (
    <div
      role="status"
      className="flex min-h-dvh flex-col items-center justify-center gap-3 text-muted-foreground"
    >
      <LoaderCircle className="size-6 animate-spin motion-reduce:animate-none" aria-hidden />
      <p className="text-sm">{t('loading')}</p>
    </div>
  );
}

/** The API could not be reached: the person may still be signed in. */
export function SessionUnavailable({ onRetry }: { onRetry: () => void }) {
  const t = useTranslations();
  return (
    <div
      role="alert"
      className="mx-auto flex min-h-dvh max-w-sm flex-col items-center justify-center gap-4 px-4 text-center"
    >
      <CloudOff className="size-8 text-muted-foreground" aria-hidden />
      <div className="flex flex-col gap-1.5">
        <h1 className="text-lg font-semibold">{t('session.unavailableTitle')}</h1>
        <p className="text-sm text-muted-foreground">{t('session.unavailableBody')}</p>
      </div>
      <Button onClick={onRetry}>{t('common.tryAgain')}</Button>
    </div>
  );
}
