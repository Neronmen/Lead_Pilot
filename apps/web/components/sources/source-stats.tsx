'use client';

import { INGEST_REJECTION_REASONS, type Source } from '@leadpilot/shared';
import { useTranslations } from 'next-intl';

const KNOWN = new Set<string>(INGEST_REJECTION_REASONS);

/**
 * What happened to the submissions of the last 30 days. The first line always
 * adds up (received = new + merged + rejected); repeated sends answered from
 * the stored first result are labelled and kept out of that sum.
 */
export function SourceStats({ source }: { source: Source }) {
  const t = useTranslations('sources.stats');
  const stats = source.last30Days;
  if (stats.received === 0 && stats.replayed === 0) {
    return <p className="text-xs text-muted-foreground">{t('noneYet')}</p>;
  }
  const reasons = stats.topRejections
    .map(({ reason, count }) => {
      const key = KNOWN.has(reason) ? reason : 'other';
      return `${t(`reasons.${key}` as 'reasons.other')} (${count})`;
    })
    .join(', ');
  return (
    <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
      <p>
        {t('line', {
          received: stats.received,
          created: stats.created,
          merged: stats.merged,
          rejected: stats.rejected,
        })}
      </p>
      {stats.rejected > 0 && reasons ? <p>{t('topReasons', { list: reasons })}</p> : null}
      {stats.replayed > 0 ? <p>{t('replayed', { replayed: stats.replayed })}</p> : null}
    </div>
  );
}
