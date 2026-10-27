'use client';

import { useTranslations } from 'next-intl';

/** "How duplicates are handled": the three rules in plain words. */
export function DuplicatesHelp() {
  const t = useTranslations('sources.help');
  return (
    <details className="rounded-xl border border-border bg-card px-[18px] py-3 text-[13px]">
      <summary className="cursor-pointer font-medium">{t('title')}</summary>
      <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-muted-foreground">
        <li>{t('email')}</li>
        <li>{t('phone')}</li>
        <li>{t('separate')}</li>
      </ul>
    </details>
  );
}
