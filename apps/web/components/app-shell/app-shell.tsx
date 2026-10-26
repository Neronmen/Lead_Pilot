'use client';

import { Menu, X } from 'lucide-react';
import { Dialog } from 'radix-ui';
import { useTranslations } from 'next-intl';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { Logo } from '@/components/brand/logo';
import { Sidebar } from './sidebar';

/**
 * The signed-in layout. From 1024px the sidebar is a fixed column. Below, it
 * lives in a drawer opened from the top bar (the mobile board has a menu
 * button, and the same pages).
 */
export function AppShell({ children }: { children: ReactNode }) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // The drawer is for small screens. Close it when the page changes (back/forward
  // too) and when the window grows past the breakpoint, or a hidden open dialog
  // would keep trapping focus and locking scroll.
  const [openedAt, setOpenedAt] = useState(pathname);
  if (pathname !== openedAt) {
    setOpenedAt(pathname);
    setOpen(false);
  }
  useEffect(() => {
    const wide = window.matchMedia('(min-width: 1024px)');
    const close = () => wide.matches && setOpen(false);
    wide.addEventListener('change', close);
    return () => wide.removeEventListener('change', close);
  }, []);

  return (
    <div className="flex min-h-dvh flex-col lg:flex-row">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground"
      >
        {t('common.skipToContent')}
      </a>

      <div className="sticky top-0 hidden h-dvh shrink-0 lg:block">
        <Sidebar />
      </div>

      <Dialog.Root open={open} onOpenChange={setOpen}>
        <header className="flex items-center gap-2 border-b border-border bg-sidebar px-4 py-2 lg:hidden">
          <Dialog.Trigger
            aria-label={t('shell.menu')}
            className="-ml-2.5 inline-flex size-11 items-center justify-center rounded-[10px] hover:bg-hover"
          >
            <Menu className="size-5" aria-hidden />
          </Dialog.Trigger>
          <Logo size={24} />
          <span className="text-base font-semibold tracking-tight">{t('shell.brand')}</span>
        </header>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50 lg:hidden" />
          <Dialog.Content
            aria-describedby={undefined}
            className="fixed inset-y-0 left-0 z-50 max-h-dvh shadow-overlay outline-none lg:hidden"
          >
            <Dialog.Title className="sr-only">{t('shell.menuTitle')}</Dialog.Title>
            <Sidebar onNavigate={() => setOpen(false)} />
            <Dialog.Close
              aria-label={t('shell.closeMenu')}
              className="absolute top-3 right-[-52px] inline-flex size-11 items-center justify-center rounded-[10px] border border-border bg-sidebar text-foreground hover:bg-hover"
            >
              <X className="size-5" aria-hidden />
            </Dialog.Close>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <main id="main" tabIndex={-1} className="bg-grid min-w-0 flex-1 px-4 py-6 sm:px-8 sm:py-7">
        {children}
      </main>
    </div>
  );
}
