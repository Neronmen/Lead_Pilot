import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { Logo } from '@/components/brand/logo';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { ThemeToggle } from '@/components/theme-toggle';
import { cn } from '@/lib/utils';

/**
 * The frame of the sign-in pages (Login, Sign up, Accept invite): brand and
 * language on top, the form in the middle, a short footer. With `aside`, the
 * page is two columns from 1024px (Login's right column); without, one
 * centred column on the grid background (Accept invite).
 */
export async function AuthShell({
  children,
  aside,
  className,
}: {
  children: ReactNode;
  aside?: ReactNode;
  className?: string;
}) {
  const t = await getTranslations();
  return (
    <div className={cn('flex min-h-dvh flex-wrap bg-background text-foreground', className)}>
      <div
        className={cn(
          'flex min-w-0 flex-1 basis-[480px] flex-col px-6 py-7 sm:px-10',
          !aside && 'bg-grid',
        )}
      >
        <header className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-2.5">
            <Logo size={28} />
            <span className="text-base font-semibold">{t('shell.brand')}</span>
          </span>
          <div className="flex items-center gap-2">
            <LocaleSwitcher />
            <ThemeToggle className="size-[38px]" />
          </div>
        </header>
        <main className="mx-auto flex w-full flex-1 flex-col justify-center py-10">{children}</main>
        <footer className="text-xs text-muted-foreground">
          {t('auth.footer', { year: new Date().getFullYear() })}
        </footer>
      </div>
      {aside ? (
        <aside className="hidden min-w-0 flex-1 basis-[480px] flex-col justify-center gap-6 border-l border-border bg-card px-11 py-12 lg:flex">
          {aside}
        </aside>
      ) : null}
    </div>
  );
}
