'use client';

import { meResponseSchema } from '@leadpilot/shared';
import { useQueryClient } from '@tanstack/react-query';
import { LogOut, MoreHorizontal, SlidersHorizontal, Users, type LucideIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { Logo } from '@/components/brand/logo';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { ThemeToggle } from '@/components/theme-toggle';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ME_QUERY_KEY, useAuthClient } from '@/lib/auth/auth-provider';
import type { Locale } from '@/lib/i18n/locales';
import { initials, isActive } from '@/lib/shell';
import { cn } from '@/lib/utils';
import { canManage, useCurrentMe } from './me-context';

interface NavItem {
  id: 'leads' | 'settings';
  href: string;
  /** Pages under this path keep the item highlighted. */
  match: string;
  icon: LucideIcon;
  adminOnly: boolean;
}

// Only the pages that exist. Overview, Review queue and Routing rules join the
// list in the milestone that builds them (SPEC §7).
const NAV: NavItem[] = [
  { id: 'leads', href: '/leads', match: '/leads', icon: Users, adminOnly: false },
  {
    id: 'settings',
    href: '/settings/team',
    match: '/settings',
    icon: SlidersHorizontal,
    adminOnly: true,
  },
];

/** The 248px column of the design: brand, workspace, pages, language and theme, the person. */
export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const t = useTranslations('shell');
  const me = useCurrentMe();
  const pathname = usePathname();
  const client = useAuthClient();
  const queryClient = useQueryClient();
  const [signOutFailed, setSignOutFailed] = useState(false);

  // A failed sign-out message is about that moment: drop it once they go elsewhere.
  const [failedAt, setFailedAt] = useState(pathname);
  if (pathname !== failedAt) {
    setFailedAt(pathname);
    setSignOutFailed(false);
  }

  const items = NAV.filter((item) => !item.adminOnly || canManage(me.role));
  const person = me.user.name || me.user.email;

  async function signOut() {
    setSignOutFailed(false);
    try {
      await client.logout();
    } catch {
      // The API could not be reached, so the sign-in is still live: say so.
      setSignOutFailed(true);
    }
  }

  // Saves the language on the account too. The cookie already switched the page,
  // so a failure here is not worth interrupting anyone for.
  function saveLocale(locale: Locale) {
    client
      .request('/auth/me', { method: 'PATCH', body: { locale }, schema: meResponseSchema })
      // Refetch rather than store the answer: if the person signed out meanwhile, a late
      // answer must not put their data back into the cleared cache.
      .then(() => queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY }))
      .catch(() => undefined);
  }

  return (
    <nav
      aria-label={t('navLabel')}
      className="flex h-full w-[248px] flex-col gap-[18px] overflow-y-auto border-r border-border bg-sidebar px-3 py-4 text-foreground"
    >
      <div className="flex items-center gap-2.5 px-2 py-1">
        <Logo size={28} />
        <span className="text-base font-semibold tracking-tight">{t('brand')}</span>
      </div>

      <div className="flex min-h-11 items-center gap-2.5 rounded-[10px] border border-border bg-card px-2 py-1.5">
        <span
          aria-hidden
          className="inline-flex size-[26px] shrink-0 items-center justify-center rounded-[7px] border border-border-strong bg-raised font-mono text-[11px] font-semibold"
        >
          {initials(me.workspace.name)}
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-[13px] font-semibold">{me.workspace.name}</span>
        </span>
      </div>

      <ul className="flex flex-col gap-0.5">
        {items.map(({ id, href, match, icon: Icon }) => {
          const current = isActive(pathname, match);
          return (
            <li key={id}>
              <Link
                href={href}
                onClick={onNavigate}
                aria-current={current ? 'page' : undefined}
                className={cn(
                  'flex min-h-[38px] items-center gap-2.5 rounded-lg px-2.5 text-sm font-medium transition-colors',
                  current
                    ? 'bg-accent-soft text-active-fg shadow-[inset_2px_0_0_var(--accent)]'
                    : 'hover:bg-hover',
                )}
              >
                <Icon className="size-[18px]" strokeWidth={1.75} aria-hidden />
                {t(`nav.${id}`)}
              </Link>
            </li>
          );
        })}
      </ul>

      <div className="mt-auto flex flex-col gap-3">
        <div className="flex items-center gap-2 px-1">
          <LocaleSwitcher onChange={saveLocale} />
          <ThemeToggle className="ml-auto size-[38px]" />
        </div>

        <div className="flex flex-col gap-1.5 border-t border-border pt-3">
          <div className="flex items-center gap-2.5 px-2">
            <span
              aria-hidden
              className="inline-flex size-8 shrink-0 items-center justify-center rounded-full border border-border-strong bg-raised text-xs font-semibold"
            >
              {initials(person)}
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-[13px] font-medium">{person}</span>
              <span className="text-[11px] text-muted-foreground">{t(`roles.${me.role}`)}</span>
            </span>
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label={t('account')}
                className="inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
              >
                <MoreHorizontal className="size-4" aria-hidden />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" side="top" className="min-w-52">
                <DropdownMenuLabel className="truncate font-normal text-muted-foreground">
                  {me.user.email}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => void signOut()}>
                  <LogOut aria-hidden />
                  {t('signOut')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          {signOutFailed ? (
            <p role="alert" className="px-2 text-xs text-danger-text">
              {t('signOutFailed')}
            </p>
          ) : null}
        </div>
      </div>
    </nav>
  );
}
