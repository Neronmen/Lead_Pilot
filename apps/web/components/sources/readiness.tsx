'use client';

import { USEFUL_FIELDS, type Source } from '@leadpilot/shared';
import { useFormatter, useTranslations } from 'next-intl';

/** The fields most worth adding first. */
const PRIORITY = ['company', 'message', 'budget', 'timeline', 'jobTitle', 'phone'] as const;

/**
 * "This source sends: name, email, phone (3 of 8 useful fields). Add company, message, budget,
 * timeline to improve ratings." from the last 30 days of accepted submissions.
 */
export function Readiness({ source }: { source: Source }) {
  const t = useTranslations('sources.readiness');
  const format = useFormatter();
  const { accepted, sends, missing } = source.last30Days.readiness;
  if (accepted === 0) return <p className="text-xs text-muted-foreground">{t('none')}</p>;
  const list = (fields: readonly (typeof USEFUL_FIELDS)[number][]) =>
    format.list(
      fields.map((field) => t(`fields.${field}`)),
      { type: 'conjunction' },
    );
  const next = PRIORITY.filter((field) => missing.includes(field)).slice(0, 4);
  return (
    <p className="text-xs text-muted-foreground">
      {sends.length === 0 ? t('noneSent') : t('sends', { sends: list(sends), count: sends.length })}{' '}
      {next.length > 0
        ? t('add', { missing: list(next) })
        : sends.length === USEFUL_FIELDS.length
          ? t('all')
          : ''}
    </p>
  );
}
