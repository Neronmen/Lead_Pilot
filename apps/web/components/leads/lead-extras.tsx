'use client';

import type { InfoLevel, LeadDetail, ReviewReason } from '@leadpilot/shared';
import { Info } from 'lucide-react';
import { useFormatter, useNow, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formErrors } from '@/lib/i18n/errors';
import { useMessage } from '@/lib/i18n/use-message';
import { useSetOutcome } from '@/lib/leads/use-leads';
import { cn } from '@/lib/utils';

/** How much the lead told us, with a one-line explanation in the tooltip. */
export function InfoBadge({ level }: { level: InfoLevel }) {
  const t = useTranslations('leadDetail');
  return (
    <Badge variant="outline" title={t('infoHelp')} className="gap-1">
      <Info className="size-3" aria-hidden />
      {t(`infoLevel.${level}`)}
    </Badge>
  );
}

/** Why a lead waits for a person, in plain words. */
export function ReasonNote({ reason, className }: { reason: ReviewReason; className?: string }) {
  const t = useTranslations('leadDetail');
  return (
    <p
      className={cn(
        'rounded-lg border border-warm/30 bg-warm-bg p-3 text-[13px] text-foreground',
        className,
      )}
    >
      {t(`reviewReasons.${reason}`)}
    </p>
  );
}

/** What the person wrote and said about the deal: the best signals for rating. */
export function SaidCard({ lead }: { lead: LeadDetail }) {
  const t = useTranslations('leadDetail');
  const rows: [string, string | null][] = [
    [t('jobTitle'), lead.jobTitle],
    [t('interest'), lead.interest],
    [t('budget'), lead.budget],
    [t('timeline'), lead.timeline],
  ];
  const shown = rows.filter(([, value]) => value);
  if (!lead.message && shown.length === 0) return null;
  return (
    <section
      aria-labelledby="said"
      className="rounded-xl border border-border bg-card px-[18px] py-4"
    >
      <h2 id="said" className="text-[15px] leading-[22px] font-semibold">
        {t('said')}
      </h2>
      {lead.message ? (
        <blockquote className="mt-2 rounded-lg border border-border bg-raised p-3 text-[13px] whitespace-pre-wrap">
          {lead.message}
        </blockquote>
      ) : null}
      {shown.length > 0 ? (
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px]">
          {shown.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="min-w-0 break-words">{value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </section>
  );
}

const OUTCOMES = ['WON', 'LOST', 'BAD'] as const;

/** Reps record how the lead ended. Bad lead means "not real": it becomes Junk. */
export function OutcomeCard({ lead }: { lead: LeadDetail }) {
  const t = useTranslations('leadDetail');
  const message = useMessage();
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  const setOutcome = useSetOutcome();
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const label = { WON: t('outcome.won'), LOST: t('outcome.lost'), BAD: t('outcome.bad') } as const;
  const current =
    lead.outcome === 'WON' || lead.outcome === 'LOST' || lead.outcome === 'BAD'
      ? lead.outcome
      : null;

  async function choose(outcome: 'NONE' | (typeof OUTCOMES)[number]) {
    setResult(null);
    try {
      await setOutcome.mutateAsync({ id: lead.id, outcome });
      setResult({ ok: true, text: t('outcome.saved') });
    } catch (error) {
      setResult({ ok: false, text: message(formErrors(error).form ?? { key: 'errors.UNKNOWN' }) });
    }
  }

  return (
    <section
      aria-labelledby="outcome"
      className="rounded-xl border border-border bg-card px-[18px] py-4"
    >
      <h2 id="outcome" className="text-[15px] leading-[22px] font-semibold">
        {t('outcome.title')}
      </h2>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {OUTCOMES.map((value) => (
          <Button
            key={value}
            type="button"
            size="sm"
            variant={current === value ? 'default' : 'outline'}
            aria-pressed={current === value}
            disabled={setOutcome.isPending}
            onClick={() => void choose(value)}
          >
            {label[value]}
          </Button>
        ))}
        {current ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={setOutcome.isPending}
            onClick={() => void choose('NONE')}
          >
            {t('outcome.clear')}
          </Button>
        ) : null}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{t('outcome.badHelp')}</p>
      {current && lead.outcomeSetAt ? (
        <p className="mt-1 text-[13px] text-muted-foreground">
          {lead.outcomeSetBy?.name
            ? t('outcome.setBy', {
                name: lead.outcomeSetBy.name,
                when: format.relativeTime(new Date(lead.outcomeSetAt), now),
              })
            : t('outcome.setByUnknown', {
                when: format.relativeTime(new Date(lead.outcomeSetAt), now),
              })}
        </p>
      ) : null}
      {result ? (
        <p
          role={result.ok ? 'status' : 'alert'}
          className={
            result.ok ? 'mt-1 text-[13px] text-accent-text' : 'mt-1 text-[13px] text-danger-text'
          }
        >
          {result.text}
        </p>
      ) : null}
    </section>
  );
}
