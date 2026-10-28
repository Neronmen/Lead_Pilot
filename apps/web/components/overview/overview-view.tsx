'use client';

import type { Overview } from '@leadpilot/shared';
import { BarChart3 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { canManage, useCurrentMe } from '@/components/app-shell/me-context';
import { ErrorState, StateView } from '@/components/state-views';
import { Button, buttonVariants } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { toDuration, useOverview } from '@/lib/overview/use-overview';
import { cn } from '@/lib/utils';
import { GetStarted } from './get-started';

const TIERS = ['HOT', 'WARM', 'COLD', 'JUNK'] as const;
const LEVELS = ['rich', 'enough', 'limited'] as const;

const TIER_BAR: Record<(typeof TIERS)[number], string> = {
  HOT: 'bg-accent-text',
  WARM: 'bg-warm',
  COLD: 'bg-muted-foreground',
  JUNK: 'bg-border-strong',
};

/** Overview: what LeadPilot did for you in the last 30 days (the proof of value). */
export function OverviewView() {
  const t = useTranslations('overview');
  const tiers = useTranslations('tiers');
  const me = useCurrentMe();
  const overview = useOverview();

  return (
    <div className="flex flex-col gap-4">
      {canManage(me.role) ? <GetStarted /> : null}
      {overview.isPending ? (
        <div className="grid gap-3 sm:grid-cols-3" role="status" aria-label={t('loading')}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
      ) : overview.isError ? (
        <section className="rounded-xl border border-border bg-card">
          <ErrorState title={t('loadTitle')} body={t('loadBody')}>
            <Button variant="outline" onClick={() => void overview.refetch()}>
              {t('retry')}
            </Button>
          </ErrorState>
        </section>
      ) : overview.data.leads === 0 ? (
        <section className="rounded-xl border border-border bg-card">
          <StateView icon={BarChart3} tone="accent" title={t('empty.title')} body={t('empty.body')}>
            {canManage(me.role) ? (
              <Link href="/settings/sources" className={cn(buttonVariants(), 'mt-1')}>
                {t('empty.cta')}
              </Link>
            ) : null}
          </StateView>
        </section>
      ) : (
        <Numbers data={overview.data} tierLabel={(tier) => tiers(tier)} />
      )}
    </div>
  );
}

function Numbers({
  data,
  tierLabel,
}: {
  data: Overview;
  tierLabel: (tier: 'HOT' | 'WARM' | 'COLD' | 'JUNK') => string;
}) {
  const t = useTranslations('overview');
  const time = useTranslations('overview.time');
  const levels = useTranslations('leadDetail.infoLevel');
  const duration =
    data.medianSecondsToFirstRating === null ? null : toDuration(data.medianSecondsToFirstRating);
  const totalTier = TIERS.reduce((sum, tier) => sum + data.byTier[tier], 0);
  const totalLevel = LEVELS.reduce((sum, level) => sum + data.byInfoLevel[level], 0);

  return (
    <>
      <section aria-label={t('kpiLabel')} className="grid gap-3 sm:grid-cols-3">
        <Kpi
          label={t('kpi.leads')}
          value={String(data.leads)}
          help={t('kpi.leadsHelp', { rated: data.rated })}
        />
        <Kpi
          label={t('kpi.junk')}
          value={data.junkPercent === null ? '–' : `${Math.round(data.junkPercent)}%`}
          help={t('kpi.junkHelp')}
        />
        <Kpi
          label={t('kpi.time')}
          value={duration === null ? '–' : time(duration.unit, { n: duration.n })}
          help={t('kpi.timeHelp')}
        />
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <section
          aria-labelledby="ov-tiers"
          className="rounded-xl border border-border bg-card px-[18px] py-4"
        >
          <h2 id="ov-tiers" className="text-[15px] leading-[22px] font-semibold">
            {t('tiers')}
          </h2>
          <ul className="mt-3 flex flex-col gap-2.5">
            {TIERS.map((tier) => (
              <Bar
                key={tier}
                label={tierLabel(tier)}
                count={data.byTier[tier]}
                total={totalTier}
                color={TIER_BAR[tier]}
              />
            ))}
          </ul>
          <Link
            href="/leads"
            className="mt-3 inline-block text-[13px] text-accent-text underline underline-offset-2"
          >
            {t('openLeads')}
          </Link>
        </section>

        <section
          aria-labelledby="ov-info"
          className="rounded-xl border border-border bg-card px-[18px] py-4"
        >
          <h2 id="ov-info" className="text-[15px] leading-[22px] font-semibold">
            {t('info')}
          </h2>
          <p className="text-[13px] text-muted-foreground">{t('infoHelp')}</p>
          <ul className="mt-3 flex flex-col gap-2.5">
            {LEVELS.map((level) => (
              <Bar
                key={level}
                label={levels(level)}
                count={data.byInfoLevel[level]}
                total={totalLevel}
                color="bg-accent-text"
              />
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}

function Kpi({ label, value, help }: { label: string; value: string; help: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-border bg-card px-[18px] py-4">
      <span className="text-[13px] text-muted-foreground">{label}</span>
      <span className="text-3xl font-semibold tracking-tight tabular-nums">{value}</span>
      <span className="text-xs text-muted-foreground">{help}</span>
    </div>
  );
}

function Bar({
  label,
  count,
  total,
  color,
}: {
  label: string;
  count: number;
  total: number;
  color: string;
}) {
  const percent = total === 0 ? 0 : Math.round((count / total) * 100);
  return (
    <li className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between text-[13px]">
        <span>{label}</span>
        <span className="tabular-nums text-muted-foreground">{`${count} · ${percent}%`}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-raised" aria-hidden>
        <div className={cn('h-full rounded-full', color)} style={{ width: `${percent}%` }} />
      </div>
    </li>
  );
}
