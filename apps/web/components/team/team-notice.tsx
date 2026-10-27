'use client';

import { ErrorCode } from '@leadpilot/shared';
import { CircleAlert, Info } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api';
import { formErrors } from '@/lib/i18n/errors';
import { useMessage } from '@/lib/i18n/use-message';

/** What the page tells the person after an action: it worked, it failed, or the data moved under them. */
export type Notice =
  { kind: 'info'; text: string } | { kind: 'error'; text: string } | { kind: 'conflict' };

/** Turns whatever an action threw into a notice (409 is its own kind: it asks for a reload). */
export function useFailureNotice(): (error: unknown) => Notice {
  const message = useMessage();
  return (error) => {
    // "Changed while you were looking": a role set meanwhile (409) or the person already gone (404).
    if (
      error instanceof ApiError &&
      (error.code === ErrorCode.CONFLICT || error.code === ErrorCode.NOT_FOUND)
    ) {
      return { kind: 'conflict' };
    }
    return { kind: 'error', text: message(formErrors(error).form ?? { key: 'errors.UNKNOWN' }) };
  };
}

export function TeamNotice({
  notice,
  onReload,
  onDismiss,
}: {
  notice: Notice;
  onReload: () => void;
  onDismiss: () => void;
}) {
  const t = useTranslations('team.problem');
  const problem = notice.kind !== 'info';
  return (
    <div
      role={problem ? 'alert' : 'status'}
      className={
        problem
          ? 'flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-danger-line bg-danger-bg p-3 text-[13px] text-danger-text'
          : 'flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-border bg-raised p-3 text-[13px]'
      }
    >
      {problem ? (
        <CircleAlert className="size-4 shrink-0" aria-hidden />
      ) : (
        <Info className="size-4 shrink-0 text-accent-text" aria-hidden />
      )}
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
