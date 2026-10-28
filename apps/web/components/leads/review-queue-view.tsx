'use client';

import type { LeadListItem, LeadTier } from '@leadpilot/shared';
import { Check, CheckCheck, SkipForward } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ErrorState, StateView } from '@/components/state-views';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/api';
import { formErrors } from '@/lib/i18n/errors';
import { useMessage } from '@/lib/i18n/use-message';
import { NO_FILTERS, useLead, useLeads, useReviewLead } from '@/lib/leads/use-leads';
import { cn } from '@/lib/utils';
import { ReasonNote } from './lead-extras';
import { TierBadge } from './tier-badge';

const WAITING = { ...NO_FILTERS, status: 'NEEDS_REVIEW' as const };
const TIERS: LeadTier[] = ['HOT', 'WARM', 'COLD', 'JUNK'];

/**
 * The Review queue: leads the AI was not sure about, oldest first, one focused at a
 * time. Approve (A), set the rating (1-4) or skip (S). A skipped lead stays in the
 * queue (it is only moved out of the way for this session).
 */
export function ReviewQueueView() {
  const t = useTranslations('review');
  const message = useMessage();
  const queue = useLeads(WAITING, 'oldest');
  const review = useReviewLead();
  const [skipped, setSkipped] = useState<string[]>([]);
  /** Who was skipped last, so the page can say what happened (the next lead takes their place). */
  const [skipNote, setSkipNote] = useState<string | null>(null);
  const [done, setDone] = useState(0);
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  const waiting = useMemo(
    () => queue.data?.pages.flatMap((page) => page.items) ?? [],
    [queue.data],
  );
  // Skipped leads go to the end of this session's order.
  const ordered = useMemo(
    () => [
      ...waiting.filter((l) => !skipped.includes(l.id)),
      ...waiting.filter((l) => skipped.includes(l.id)),
    ],
    [waiting, skipped],
  );
  const current = ordered[0] ?? null;
  const detail = useLead(current?.id ?? null);

  const act = useCallback(
    async (body: { action: 'approve' } | { action: 'override'; tier: LeadTier }) => {
      if (!current || review.isPending) return;
      setProblem(null);
      try {
        await review.mutateAsync({
          id: current.id,
          ...(body.action === 'override' && note.trim() ? { ...body, note: note.trim() } : body),
        });
        setDone((count) => count + 1);
        setNote('');
      } catch (error) {
        const conflict = error instanceof ApiError && error.status === 409;
        setProblem(
          conflict ? t('conflict') : message(formErrors(error).form ?? { key: 'errors.UNKNOWN' }),
        );
      }
    },
    [current, review, note, message, t],
  );
  const skip = useCallback(() => {
    if (!current) return;
    setSkipped((list) => [...list.filter((id) => id !== current.id), current.id]);
    setSkipNote(current.name ?? current.email ?? current.phone ?? '');
  }, [current]);

  // Keyboard: A approve, 1-4 set the rating, S skip. Never while typing in a field.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      const key = event.key.toLowerCase();
      if (key === 'a') void act({ action: 'approve' });
      else if (key === 's') skip();
      else if (['1', '2', '3', '4'].includes(key)) {
        void act({ action: 'override', tier: TIERS[Number(key) - 1]! });
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [act, skip]);

  if (queue.isPending) return <QueueSkeleton />;
  if (queue.isError) {
    return (
      <section className="rounded-xl border border-border bg-card">
        <ErrorState title={t('loadTitle')} body={t('loadBody')}>
          <Button variant="outline" onClick={() => void queue.refetch()}>
            {t('retry')}
          </Button>
        </ErrorState>
      </section>
    );
  }
  if (!current) {
    return (
      <section className="rounded-xl border border-border bg-card">
        <StateView icon={CheckCheck} tone="accent" title={t('emptyTitle')} body={t('emptyBody')} />
        {done > 0 ? (
          <p className="pb-6 text-center text-[13px] text-muted-foreground" role="status">
            {t('reviewedCount', { count: done })}
          </p>
        ) : null}
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <details className="rounded-xl border border-border bg-card px-[18px] py-3 text-[13px]">
        <summary className="cursor-pointer font-medium">{t('help.title')}</summary>
        <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-muted-foreground">
          <li>{t('help.why')}</li>
          <li>{t('help.approve')}</li>
          <li>{t('help.rating')}</li>
          <li>{t('help.skip')}</li>
        </ul>
      </details>
      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <nav aria-label={t('waiting')} className="flex flex-col gap-2">
          <h2 className="text-[13px] font-semibold text-muted-foreground">
            {`${t('waiting')} (${ordered.length}${queue.hasNextPage ? '+' : ''})`}
          </h2>
          <ol className="flex max-h-[60vh] flex-col gap-1 overflow-y-auto">
            {ordered.map((lead, index) => (
              <li key={lead.id}>
                <QueueItem lead={lead} active={index === 0} />
              </li>
            ))}
          </ol>
          {done > 0 ? (
            <p className="text-[13px] text-muted-foreground" role="status">
              {t('reviewedCount', { count: done })}
            </p>
          ) : null}
        </nav>

        <section
          aria-labelledby="focus"
          className="flex flex-col gap-4 rounded-xl border border-border bg-card px-[18px] py-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="focus" className="text-[17px] font-semibold">
              {current.name ?? current.email ?? current.phone}
            </h2>
            <Link href={`/leads/${current.id}`} className="text-[13px] text-accent-text underline">
              {t('open')}
            </Link>
          </div>

          {current.reviewReason ? <ReasonNote reason={current.reviewReason} /> : null}

          <div className="flex flex-col gap-2">
            <span className="text-[13px] font-medium">{t('suggestion')}</span>
            <div className="flex items-center gap-2">
              {current.tier ? <TierBadge tier={current.tier} /> : null}
              {current.score !== null ? (
                <span className="tabular-nums">{`${current.score} / 100`}</span>
              ) : null}
            </div>
            {current.confidence !== null ? <ConfidenceMeter value={current.confidence} /> : null}
          </div>

          <div className="flex flex-col gap-1.5 text-[13px]">
            <span className="font-medium">{t('signals')}</span>
            {detail.isPending ? (
              <Skeleton className="h-4 w-3/4" />
            ) : (
              <ul className="flex list-disc flex-col gap-1 pl-5">
                {(detail.data?.latestScore?.reasons ?? []).map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex flex-col gap-1 text-[13px]">
            <span className="font-medium">{t('details')}</span>
            <span className="text-muted-foreground">
              {[current.email, current.phone, current.company, current.country]
                .filter(Boolean)
                .join(' · ')}
            </span>
            {detail.data?.companyInfo?.status === 'ok' ? (
              <span className="text-muted-foreground">
                <span className="font-medium text-foreground">{`${t('website')}: `}</span>
                {detail.data.companyInfo.description ?? detail.data.companyInfo.title}
              </span>
            ) : null}
          </div>

          <label className="flex flex-col gap-1.5 text-[13px]">
            <span className="font-medium">{t('note')}</span>
            <input
              value={note}
              maxLength={500}
              onChange={(event) => setNote(event.target.value)}
              className="h-10 rounded-lg border border-border-strong bg-transparent px-3 outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          </label>

          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => void act({ action: 'approve' })} disabled={review.isPending}>
              <Check aria-hidden />
              {t('approve')}
              <kbd className="ml-1 rounded border border-current/30 px-1 text-[11px]">{'A'}</kbd>
            </Button>
            <Button
              variant="outline"
              onClick={skip}
              disabled={review.isPending || ordered.length <= 1}
            >
              <SkipForward aria-hidden />
              {t('skip')}
              <kbd className="ml-1 rounded border border-border-strong px-1 text-[11px]">{'S'}</kbd>
            </Button>
          </div>
          {ordered.length <= 1 ? (
            <p className="text-xs text-muted-foreground">{t('skipOnly')}</p>
          ) : skipNote ? (
            <p role="status" className="text-xs text-muted-foreground">
              {t('skippedNote', { name: skipNote })}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2 text-[13px]">
            <span className="text-muted-foreground">{t('setTier')}</span>
            {TIERS.map((tier, index) => (
              <TierButton
                key={tier}
                tier={tier}
                shortcut={index + 1}
                disabled={review.isPending}
                onClick={() => void act({ action: 'override', tier })}
              />
            ))}
          </div>
          <p className="text-xs text-muted-foreground">{t('keys')}</p>
          {problem ? (
            <p role="alert" className="text-[13px] text-danger-text">
              {problem}
            </p>
          ) : null}
        </section>
      </div>
    </div>
  );
}

function TierButton({
  tier,
  shortcut,
  disabled,
  onClick,
}: {
  tier: LeadTier;
  shortcut: number;
  disabled: boolean;
  onClick: () => void;
}) {
  const tiers = useTranslations('tiers');
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2 py-1 hover:bg-hover focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
    >
      <kbd className="text-[11px] text-muted-foreground">{shortcut}</kbd>
      {tiers(tier)}
    </button>
  );
}

function QueueItem({ lead, active }: { lead: LeadListItem; active: boolean }) {
  return (
    <div
      aria-current={active ? 'true' : undefined}
      className={cn(
        'flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-[13px]',
        active ? 'border-accent-line bg-accent-soft' : 'border-border',
      )}
    >
      <span className="min-w-0 truncate">{lead.name ?? lead.email ?? lead.phone}</span>
      {lead.tier ? <TierBadge tier={lead.tier} /> : null}
    </div>
  );
}

/** How sure the AI is, as a bar with the percentage in words (the bar alone would be colour only). */
function ConfidenceMeter({ value }: { value: number }) {
  const t = useTranslations('review');
  const percent = Math.round(value * 100);
  return (
    <div className="flex flex-col gap-1">
      <div
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-label={t('confidence', { percent })}
        className="h-2 w-full max-w-xs overflow-hidden rounded-full bg-track"
      >
        <div className="h-full bg-accent-text" style={{ width: `${percent}%` }} />
      </div>
      <span className="text-[13px] text-muted-foreground">{t('confidence', { percent })}</span>
    </div>
  );
}

function QueueSkeleton() {
  return (
    <div className="grid gap-4 lg:grid-cols-[280px_1fr]" aria-hidden>
      <div className="flex flex-col gap-2">
        {[0, 1, 2].map((n) => (
          <Skeleton key={n} className="h-10 w-full" />
        ))}
      </div>
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    </div>
  );
}
