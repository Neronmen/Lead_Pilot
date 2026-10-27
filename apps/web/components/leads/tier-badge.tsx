'use client';

import type { LeadTier } from '@leadpilot/shared';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

const STYLE: Record<LeadTier, string> = {
  HOT: 'bg-accent-soft text-accent-text border-accent-line',
  WARM: 'bg-warm-bg text-warm border-warm/30',
  COLD: 'bg-cold-bg text-cold border-cold/30',
  JUNK: 'bg-junk-bg text-junk border-junk/30 line-through',
};

/** The tier as a pill. The text is always there: colour is never the only signal. */
export function TierBadge({ tier, className }: { tier: LeadTier; className?: string }) {
  const t = useTranslations('tiers');
  return (
    <span
      className={cn(
        'inline-flex h-5 shrink-0 items-center rounded-full border px-2 text-xs font-medium whitespace-nowrap',
        STYLE[tier],
        className,
      )}
    >
      {t(tier)}
    </span>
  );
}
