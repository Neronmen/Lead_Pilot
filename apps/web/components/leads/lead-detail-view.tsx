'use client';

import type { LeadDetail, LeadEvent, LeadTier } from '@leadpilot/shared';
import { ArrowLeft, Check, LoaderCircle, SearchX } from 'lucide-react';
import { useFormatter, useNow, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { canManage, useCurrentMe } from '@/components/app-shell/me-context';
import { LeadActions } from './lead-actions';
import { ErrorState, StateView } from '@/components/state-views';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/api';
import { formErrors } from '@/lib/i18n/errors';
import { useMessage } from '@/lib/i18n/use-message';
import { useLead, useReviewLead } from '@/lib/leads/use-leads';
import { InfoBadge, OutcomeCard, ReasonNote, SaidCard } from './lead-extras';
import { TierBadge } from './tier-badge';

const TIERS: LeadTier[] = ['HOT', 'WARM', 'COLD', 'JUNK'];

/** A lead's page: who it is, why the AI rated it so, what happened, and a way to disagree. */
export function LeadDetailView({ id }: { id: string }) {
  const t = useTranslations('leadDetail');
  const lead = useLead(id);

  if (lead.isPending) return <DetailSkeleton />;
  if (lead.isError) {
    const missing = lead.error instanceof ApiError && lead.error.status === 404;
    return (
      <section className="rounded-xl border border-border bg-card">
        {missing ? (
          <StateView icon={SearchX} title={t('notFoundTitle')} body={t('notFoundBody')}>
            <Link href="/leads" className="text-[13px] font-medium text-accent-text underline">
              {t('back')}
            </Link>
          </StateView>
        ) : (
          <ErrorState title={t('loadTitle')} body={t('loadBody')}>
            <Button variant="outline" onClick={() => void lead.refetch()}>
              {t('retry')}
            </Button>
          </ErrorState>
        )}
      </section>
    );
  }
  return <Detail lead={lead.data} />;
}

function Detail({ lead }: { lead: LeadDetail }) {
  const t = useTranslations('leadDetail');
  const status = useTranslations('leads.statusName');
  const tiers = useTranslations('tiers');
  const me = useCurrentMe();
  const title = lead.name ?? lead.email ?? lead.phone ?? t('unnamed');
  const score = lead.latestScore;

  return (
    <div className="flex flex-col gap-4">
      <Link
        href="/leads"
        className="inline-flex w-fit items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" aria-hidden />
        {t('back')}
      </Link>

      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <div className="flex flex-wrap items-center gap-2 text-[13px]">
          {lead.tier ? <TierBadge tier={lead.tier} /> : null}
          {lead.score !== null ? (
            <span className="tabular-nums">{t('score', { score: lead.score })}</span>
          ) : null}
          <Badge variant="outline">{status(lead.status)}</Badge>
          {lead.infoLevel ? <InfoBadge level={lead.infoLevel} /> : null}
          {lead.owner ? (
            <span className="text-muted-foreground">
              {t('ownerIs', { name: lead.owner.name ?? t('unknownOwner') })}
            </span>
          ) : null}
        </div>
      </header>

      {lead.reviewReason ? <ReasonNote reason={lead.reviewReason} /> : null}

      <section
        aria-labelledby="why"
        className="rounded-xl border border-border bg-card px-[18px] py-4"
      >
        <h2 id="why" className="text-[15px] leading-[22px] font-semibold">
          {lead.tier ? t('why', { tier: tiers(lead.tier) }) : t('unrated')}
        </h2>
        {score ? (
          <div className="mt-2 flex flex-col gap-3 text-[13px]">
            <ul className="flex list-disc flex-col gap-1 pl-5">
              {score.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
            {lead.confidence !== null ? (
              <p className="text-muted-foreground">
                {t('confidence', { percent: Math.round(lead.confidence * 100) })}
              </p>
            ) : null}
            {score.ratedWithoutAi ? (
              <p className="rounded-lg border border-border bg-raised p-3 text-muted-foreground">
                {t('ratedWithoutAi')}
              </p>
            ) : null}
            {score.suggestedReply ? (
              <div className="flex flex-col gap-1">
                <span className="font-medium">{t('suggestedReply')}</span>
                <blockquote className="rounded-lg border border-border bg-raised p-3 whitespace-pre-wrap">
                  {score.suggestedReply}
                </blockquote>
              </div>
            ) : null}
          </div>
        ) : (
          <p className="mt-2 text-[13px] text-muted-foreground">{t('unratedBody')}</p>
        )}
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <Contact lead={lead} />
        <About lead={lead} />
      </div>

      <SaidCard lead={lead} />

      <Disagree lead={lead} />
      <OutcomeCard lead={lead} />
      {canManage(me.role) ? <LeadActions leadId={lead.id} /> : null}
      <Activity events={lead.events} />

      {canManage(me.role) && score ? (
        <details className="rounded-xl border border-border bg-card px-[18px] py-3 text-[13px]">
          <summary className="cursor-pointer font-medium">{t('technical')}</summary>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-muted-foreground">
            <dt>{t('provider')}</dt>
            <dd>{score.provider}</dd>
            <dt>{t('model')}</dt>
            <dd>{score.model}</dd>
            <dt>{t('cost')}</dt>
            <dd className="tabular-nums">{`$${score.costUsd.toFixed(4)}`}</dd>
          </dl>
        </details>
      ) : null}
    </div>
  );
}

function Contact({ lead }: { lead: LeadDetail }) {
  const t = useTranslations('leadDetail');
  const rows: [string, string | null][] = [
    [t('email'), lead.email],
    [t('phone'), lead.phone],
    [t('company'), lead.company],
    [t('country'), lead.country],
    [t('website'), lead.domain],
  ];
  return (
    <section
      aria-labelledby="contact"
      className="rounded-xl border border-border bg-card px-[18px] py-4"
    >
      <h2 id="contact" className="text-[15px] leading-[22px] font-semibold">
        {t('contact')}
      </h2>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px]">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="min-w-0 break-words">{value ?? t('none')}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function About({ lead }: { lead: LeadDetail }) {
  const t = useTranslations('leadDetail');
  return (
    <section
      aria-labelledby="about"
      className="rounded-xl border border-border bg-card px-[18px] py-4"
    >
      <h2 id="about" className="text-[15px] leading-[22px] font-semibold">
        {t('about')}
      </h2>
      <div className="mt-2 text-[13px]">
        {!lead.domain ? (
          <p className="text-muted-foreground">{t('noWebsite')}</p>
        ) : !lead.companyInfo ? (
          <p className="text-muted-foreground">{t('notLookedUp')}</p>
        ) : lead.companyInfo.status === 'unreachable' ? (
          <p className="text-muted-foreground">{t('unreachable')}</p>
        ) : (
          <div className="flex flex-col gap-1">
            <span className="font-medium">{lead.companyInfo.title}</span>
            <span className="text-muted-foreground">{lead.companyInfo.description}</span>
          </div>
        )}
      </div>
    </section>
  );
}

/** "Disagree with the AI?": set another tier (kept as a correction), or agree when it is waiting for review. */
function Disagree({ lead }: { lead: LeadDetail }) {
  const t = useTranslations('leadDetail');
  const tiers = useTranslations('tiers');
  const message = useMessage();
  const review = useReviewLead();
  const [tier, setTier] = useState<LeadTier>(lead.tier ?? 'COLD');
  const [note, setNote] = useState('');
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  async function run(body: Parameters<typeof review.mutateAsync>[0], ok: string) {
    setResult(null);
    try {
      await review.mutateAsync(body);
      setResult({ ok: true, text: ok });
      setNote('');
    } catch (error) {
      const conflict = error instanceof ApiError && error.status === 409;
      setResult({
        ok: false,
        text: conflict
          ? t('alreadyReviewed')
          : (message(formErrors(error).form ?? { key: 'errors.UNKNOWN' }) ?? t('saveFailed')),
      });
    }
  }

  function save(event: FormEvent) {
    event.preventDefault();
    void run(
      { id: lead.id, action: 'override', tier, ...(note.trim() ? { note: note.trim() } : {}) },
      t('saved'),
    );
  }

  return (
    <section
      aria-labelledby="disagree"
      className="rounded-xl border border-border bg-card px-[18px] py-4"
    >
      <h2 id="disagree" className="text-[15px] leading-[22px] font-semibold">
        {t('disagree')}
      </h2>
      <p className="mt-1 text-[13px] text-muted-foreground">{t('disagreeBody')}</p>
      <form onSubmit={save} className="mt-3 flex flex-col gap-3">
        <fieldset className="flex flex-wrap items-center gap-2">
          <legend className="pb-1 text-[13px] font-medium">{t('setRating')}</legend>
          {TIERS.map((value) => (
            <label
              key={value}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-[13px] has-checked:border-accent-line has-checked:bg-accent-soft has-focus-visible:ring-3 has-focus-visible:ring-ring/50"
            >
              <input
                type="radio"
                name="tier"
                value={value}
                checked={tier === value}
                onChange={() => setTier(value)}
                className="accent-[var(--primary)]"
              />
              {tiers(value)}
            </label>
          ))}
        </fieldset>
        <label className="flex flex-col gap-1.5 text-[13px]">
          <span className="font-medium">{t('note')}</span>
          <textarea
            value={note}
            maxLength={500}
            onChange={(event) => setNote(event.target.value)}
            rows={2}
            className="rounded-lg border border-border-strong bg-transparent p-2 text-[13px] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={review.isPending}>
            {review.isPending ? (
              <>
                <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden />
                {t('saving')}
              </>
            ) : (
              t('saveRating')
            )}
          </Button>
          {lead.status === 'NEEDS_REVIEW' ? (
            <Button
              type="button"
              variant="outline"
              disabled={review.isPending}
              onClick={() => void run({ id: lead.id, action: 'approve' }, t('approved'))}
            >
              <Check aria-hidden />
              {t('approve')}
            </Button>
          ) : null}
          {result ? (
            <span
              role={result.ok ? 'status' : 'alert'}
              className={
                result.ok ? 'text-[13px] text-accent-text' : 'text-[13px] text-danger-text'
              }
            >
              {result.text}
            </span>
          ) : null}
        </div>
      </form>
    </section>
  );
}

const ACTIVITY_SHOWN = 8;

function Activity({ events }: { events: LeadEvent[] }) {
  const t = useTranslations('leadDetail');
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  const line = useEventLine();
  // A busy lead can have hundreds of entries: the newest few first, the rest one click away.
  const [all, setAll] = useState(false);
  const shown = all ? events : events.slice(0, ACTIVITY_SHOWN);
  return (
    <section
      aria-labelledby="activity"
      className="rounded-xl border border-border bg-card px-[18px] py-4"
    >
      <h2 id="activity" className="text-[15px] leading-[22px] font-semibold">
        {t('activity')}
      </h2>
      {events.length === 0 ? (
        <p className="mt-2 text-[13px] text-muted-foreground">{t('noActivity')}</p>
      ) : (
        <ol className="mt-2 flex flex-col divide-y divide-border text-[13px]">
          {shown.map((event) => (
            <li key={event.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
              <span>{line(event)}</span>
              <time
                dateTime={event.createdAt}
                title={new Date(event.createdAt).toLocaleString()}
                className="text-muted-foreground"
              >
                {format.relativeTime(new Date(event.createdAt), now)}
              </time>
            </li>
          ))}
        </ol>
      )}
      {events.length > ACTIVITY_SHOWN ? (
        <Button variant="ghost" size="sm" className="mt-1" onClick={() => setAll((v) => !v)}>
          {all ? t('activityLess') : t('activityMore', { count: events.length - ACTIVITY_SHOWN })}
        </Button>
      ) : null}
    </section>
  );
}

/** One timeline entry in plain words. A type we do not know yet reads "Update". */
function useEventLine(): (event: LeadEvent) => string {
  const ev = useTranslations('leadDetail.events');
  const tiers = useTranslations('tiers');
  const tier = (value: unknown) =>
    typeof value === 'string' && value.toUpperCase() in { HOT: 1, WARM: 1, COLD: 1, JUNK: 1 }
      ? tiers(value.toUpperCase() as LeadTier)
      : '';
  return ({ type, payload }) => {
    switch (type) {
      case 'ingested':
        return ev('ingested');
      case 'merged':
        return payload.matchedBy === 'phone' ? ev('mergedPhone') : ev('mergedEmail');
      case 'possible_duplicate':
        return ev('possible_duplicate');
      case 'enriched':
        return payload.status === 'unreachable'
          ? ev('enrichedFailed', { domain: String(payload.domain ?? '') })
          : ev('enriched', { domain: String(payload.domain ?? '') });
      case 'scored':
        return ev(payload.ratedWithoutAi ? 'scoredRules' : 'scoredAi', {
          tier: tier(payload.tier),
          score: Number(payload.score ?? 0),
        });
      case 'reviewed':
        return payload.action === 'approve'
          ? ev('reviewedApprove')
          : ev('reviewedOverride', { tier: tier(payload.tier) });
      default:
        return ev('other');
    }
  };
}

function DetailSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-hidden>
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-8 w-64" />
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
      </div>
    </div>
  );
}
