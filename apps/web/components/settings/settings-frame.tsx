'use client';

import { Lock } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { canManage, useCurrentMe } from '@/components/app-shell/me-context';
import { StateView } from '@/components/state-views';
import { buttonVariants } from '@/components/ui/button';
import { isActive } from '@/lib/shell';
import { cn } from '@/lib/utils';

// Only the Settings pages that exist. The rest of the design's list (Get
// started, General, Lead sources...) joins in the milestone that builds each.
const SECTIONS = [{ id: 'team', href: '/settings/team' }] as const;

/**
 * Settings layout: section list on the left, page on the right. A Member who
 * opens any Settings address sees the "only admins" page instead.
 */
export function SettingsFrame({ children }: { children: ReactNode }) {
  const t = useTranslations();
  const pathname = usePathname();
  const { role } = useCurrentMe();

  if (!canManage(role)) {
    return (
      <section className="mx-auto max-w-xl rounded-xl border border-border bg-card">
        <StateView icon={Lock} heading="h1" title={t('noAccess.title')} body={t('noAccess.body')}>
          <Link href="/leads" className={cn(buttonVariants({ variant: 'outline' }), 'mt-1')}>
            {t('noAccess.back')}
          </Link>
        </StateView>
      </section>
    );
  }

  return (
    <div className="flex flex-wrap items-start gap-6">
      <nav
        aria-label={t('settings.navLabel')}
        className="flex w-full flex-col gap-0.5 sm:w-[200px]"
      >
        <span className="px-2.5 pb-2 text-[13px] font-semibold text-muted-foreground">
          {t('settings.title')}
        </span>
        {SECTIONS.map(({ id, href }) => {
          const current = isActive(pathname, href);
          return (
            <Link
              key={id}
              href={href}
              aria-current={current ? 'page' : undefined}
              className={cn(
                'flex min-h-9 items-center rounded-lg px-2.5 text-sm transition-colors',
                current
                  ? 'bg-accent-soft font-medium text-active-fg shadow-[inset_2px_0_0_var(--accent)]'
                  : 'hover:bg-hover',
              )}
            >
              {t(`settings.nav.${id}`)}
            </Link>
          );
        })}
      </nav>
      <div className="flex min-w-0 flex-1 basis-[420px] flex-col gap-4">{children}</div>
    </div>
  );
}
