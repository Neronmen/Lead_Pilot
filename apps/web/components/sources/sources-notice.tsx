'use client';

import { ErrorCode } from '@leadpilot/shared';
import { CircleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api';
import { formErrors } from '@/lib/i18n/errors';
import { useMessage } from '@/lib/i18n/use-message';

/** What the page tells the person after an action failed, or when the data moved under them. */
export type Notice = { kind: 'error'; text: string } | { kind: 'conflict' };

/** Turns whatever an action threw into a notice (404 and 409 mean "it changed meanwhile"). */
export function useFailureNotice(): (error: unknown) => Notice {
  const message = useMessage();
  return (error) => {
    if (
      error instanceof ApiError &&
      (error.code === ErrorCode.NOT_FOUND || error.code === ErrorCode.CONFLICT)
    ) {
      return { kind: 'conflict' };
    }
    return { kind: 'error', text: message(formErrors(error).form ?? { key: 'errors.UNKNOWN' }) };
  };
}

export function SourcesNotice({
  notice,
  onReload,
  onDismiss,
}: {
  notice: Notice;
  onReload: () => void;
  onDismiss: () => void;
}) {
  const t = useTranslations('sources.problem');
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-danger-line bg-danger-bg p-3 text-[13px] text-danger-text"
    >
      <CircleAlert className="size-4 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1">
        {notice.kind === 'conflict' ? t('changed') : notice.text}
      </span>
      {notice.kind === 'conflict' ? (
        <Button size="sm" variant="outline" onClick={onReload}>
          {t('reload')}
        </Button>
      ) : null}
      <Button size="sm" variant="ghost" onClick={onDismiss}>
        {t('dismiss')}
      </Button>
    </div>
  );
}
