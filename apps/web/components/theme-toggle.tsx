'use client';

import { Moon, Sun } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useTheme } from 'next-themes';
import { useSyncExternalStore } from 'react';
import { cn } from '@/lib/utils';

const subscribe = () => () => {};

/** Dark is the default; this switches to light and back, and remembers it. */
export function ThemeToggle({ className }: { className?: string }) {
  const t = useTranslations('theme');
  const { resolvedTheme, setTheme } = useTheme();
  // The stored theme is only known in the browser: render a neutral state on
  // the server so the HTML matches, then the real one.
  const mounted = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  const dark = !mounted || resolvedTheme !== 'light';

  return (
    <button
      type="button"
      aria-label={dark ? t('toLight') : t('toDark')}
      onClick={() => setTheme(dark ? 'light' : 'dark')}
      className={cn(
        'inline-flex size-10 items-center justify-center rounded-[9px] border border-border bg-card text-foreground transition-colors hover:bg-hover',
        className,
      )}
    >
      {dark ? <Sun className="size-4" aria-hidden /> : <Moon className="size-4" aria-hidden />}
    </button>
  );
}
