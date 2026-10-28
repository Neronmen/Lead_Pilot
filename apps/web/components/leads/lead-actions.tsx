'use client';

import type { ActionRun } from '@leadpilot/shared';
import { useFormatter, useNow, useTranslations } from 'next-intl';
import { useState } from 'react';
import { errorCodeKey } from '@/components/integrations/integrations-view';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useActionRuns, useRetryAction } from '@/lib/routing/use-routing';

/** The action types the API can record (the others do not exist yet). */
const kind = (run: ActionRun) => run.type as 'assign';

/**
 * What the routing rules did with this lead: assigned, tagged, emailed, sent to Slack... with the
 * status of each and a Retry for the ones that failed. Owner and Admin only (the API says 403 to a
 * Member, so the page does not ask).
 */
export function LeadActions({ leadId }: { leadId: string }) {
  const t = useTranslations('leadActions');
  const problem = useTranslations('integrations.problem');
  const format = useFormatter();
  const now = useNow();
  const runs = useActionRuns(leadId, true);
  const retry = useRetryAction(leadId);
  const [retryFailed, setRetryFailed] = useState(false);

  async function onRetry(id: string) {
    setRetryFailed(false);
    try {
      await retry.mutateAsync(id);
    } catch {
      setRetryFailed(true);
    }
  }

  if (runs.isPending || (runs.isSuccess && runs.data.length === 0)) return null;
  return (
    <section
      aria-labelledby="lead-actions"
      className="flex flex-col gap-2 rounded-xl border border-border bg-card px-[18px] py-4"
    >
      <h2 id="lead-actions" className="text-[15px] leading-[22px] font-semibold">
        {t('title')}
      </h2>
      {retryFailed ? (
        <p role="alert" className="text-[13px] text-danger-text">
          {t('retryFailed')}
        </p>
      ) : null}
      {runs.isError ? (
        <p className="text-[13px] text-danger-text">{t('loadError')}</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {runs.data?.map((run: ActionRun) => (
            <li key={run.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span className="min-w-0 flex-1">
                {t(`type.${kind(run)}`)}
                <span className="text-xs text-muted-foreground">
                  {' · '}
                  {format.relativeTime(new Date(run.createdAt), now)}
                </span>
                {run.lastError ? (
                  <span className="block text-[13px] text-danger-text">
                    {problem(errorCodeKey(run.lastError))}
                  </span>
                ) : null}
              </span>
              <Badge
                variant={
                  run.status === 'DEAD' || run.status === 'FAILED' ? 'destructive' : 'secondary'
                }
              >
                {t(`status.${run.status}`)}
              </Badge>
              {run.status === 'DEAD' || run.status === 'FAILED' ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={retry.isPending}
                  onClick={() => void onRetry(run.id)}
                >
                  {t('retry')}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
