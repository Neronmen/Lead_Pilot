'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { LOCALES, saveLocale, type Locale } from '@/lib/i18n/locales';
import { cn } from '@/lib/utils';

/**
 * EN | VI. Saves the choice in a cookie (so the server renders the page in
 * that language) and refreshes. `onChange` lets the signed-in shell also save
 * it on the person's account.
 */
export function LocaleSwitcher({
  onChange,
  className,
}: {
  onChange?: (locale: Locale) => void;
  className?: string;
}) {
  const t = useTranslations('language');
  const current = useLocale();
  const router = useRouter();

  function choose(locale: Locale) {
    if (locale === current) return;
    saveLocale(locale);
    onChange?.(locale);
    router.refresh();
  }

  return (
    <div
      role="group"
      aria-label={t('label')}
      className={cn(
        'inline-flex gap-0.5 rounded-[9px] border border-border bg-card p-[3px]',
        className,
      )}
    >
      {LOCALES.map((locale) => (
        <button
          key={locale}
          type="button"
          lang={locale}
          aria-label={t(locale)}
          aria-pressed={locale === current}
          onClick={() => choose(locale)}
          className={cn(
            'h-8 min-w-10 rounded-[7px] px-2 font-mono text-xs font-semibold transition-colors',
            locale === current
              ? 'bg-raised text-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {locale.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
