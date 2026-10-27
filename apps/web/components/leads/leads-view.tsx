'use client';

import type { LeadListItem, LeadStatus, LeadTier } from '@leadpilot/shared';
import { LoaderCircle, Plug, Search, SearchX, Users } from 'lucide-react';
import { useFormatter, useNow, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { canManage, useCurrentMe } from '@/components/app-shell/me-context';
import { ErrorState, StateView } from '@/components/state-views';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';
import { TierBadge } from './tier-badge';
import { hasFilters, NO_FILTERS, useLeads, type LeadFilters } from '@/lib/leads/use-leads';
import { useSources } from '@/lib/sources/use-sources';
import { cn } from '@/lib/utils';

const STATUSES: LeadStatus[] = ['NEW', 'PROCESSING', 'NEEDS_REVIEW', 'SCORED', 'ROUTED', 'FAILED'];
const SEARCH_DELAY_MS = 300;
const TIERS: LeadTier[] = ['HOT', 'WARM', 'COLD', 'JUNK'];

/**
 * The Leads list: newest first, 56 px rows, filters and search. Tier and score
 * columns arrive with scoring (M3); until then they are not shown at all.
 */
export function LeadsView() {
  const t = useTranslations('leads');
  const tiers = useTranslations('tiers');
  const me = useCurrentMe();
  const admin = canManage(me.role);
  const [filters, setFilters] = useState<LeadFilters>(NO_FILTERS);
  // The search box updates at once; the request waits until typing pauses.
  const [typed, setTyped] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setFilters((f) => ({ ...f, q: typed })), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [typed]);

  // Members cannot read the sources list, so the source filter is for Owner and Admin.
  const sources = useSources(admin);
  const leads = useLeads(filters);
  // One clock for every row, passed explicitly: without it next-intl falls back to the
  // environment's time and logs ENVIRONMENT_FALLBACK (server and client could disagree).
  const now = useNow({ updateInterval: 60_000 });
  const items = leads.data?.pages.flatMap((page) => page.items) ?? [];
  const filtered = hasFilters(filters);

  function clear() {
    setTyped('');
    setFilters(NO_FILTERS);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="relative min-w-[240px] flex-1">
          <Label htmlFor="lead-search" className="sr-only">
            {t('search')}
          </Label>
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            id="lead-search"
            type="search"
            autoComplete="off"
            maxLength={100}
            placeholder={t('searchPlaceholder')}
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            className="pl-9"
          />
        </div>
        <Filter label={t('status')}>
          <NativeSelect
            value={filters.status}
            onChange={(event) =>
              setFilters({ ...filters, status: event.target.value as LeadFilters['status'] })
            }
          >
            <option value="">{t('allStatuses')}</option>
            {STATUSES.map((status) => (
              <option key={status} value={status}>
                {t(`statusName.${status}`)}
              </option>
            ))}
          </NativeSelect>
        </Filter>
        <Filter label={t('tier')}>
          <NativeSelect
            value={filters.tier}
            onChange={(event) =>
              setFilters({ ...filters, tier: event.target.value as LeadFilters['tier'] })
            }
          >
            <option value="">{t('allTiers')}</option>
            {TIERS.map((tier) => (
              <option key={tier} value={tier}>
                {tiers(tier)}
              </option>
            ))}
          </NativeSelect>
        </Filter>
        {admin && sources.data && sources.data.length > 0 ? (
          <Filter label={t('source')}>
            <NativeSelect
              value={filters.sourceId}
              onChange={(event) => setFilters({ ...filters, sourceId: event.target.value })}
            >
              <option value="">{t('allSources')}</option>
              {sources.data.map((source) => (
                <option key={source.id} value={source.id}>
                  {source.name}
                </option>
              ))}
            </NativeSelect>
          </Filter>
        ) : null}
        <Filter label={t('email')}>
          <NativeSelect
            value={filters.freeMail}
            onChange={(event) =>
              setFilters({ ...filters, freeMail: event.target.value as LeadFilters['freeMail'] })
            }
          >
            <option value="">{t('anyEmail')}</option>
            <option value="false">{t('companyEmail')}</option>
            <option value="true">{t('freeEmail')}</option>
          </NativeSelect>
        </Filter>
        {filtered ? (
          <Button variant="ghost" onClick={clear}>
            {t('clear')}
          </Button>
        ) : null}
      </div>

      {leads.isPending ? (
        <LeadsSkeleton />
      ) : leads.isError ? (
        <section className="rounded-xl border border-border bg-card">
          <ErrorState title={t('loadTitle')} body={t('loadBody')}>
            <Button variant="outline" onClick={() => void leads.refetch()}>
              {t('retry')}
            </Button>
          </ErrorState>
        </section>
      ) : items.length === 0 ? (
        <section className="rounded-xl border border-border bg-card">
          {filtered ? (
            <StateView
              icon={SearchX}
              title={t('noMatchTitle')}
              body={t('noMatchBody')}
              className="min-h-80"
            >
              <Button variant="outline" onClick={clear}>
                {t('clear')}
              </Button>
            </StateView>
          ) : (
            <StateView
              icon={Users}
              tone="accent"
              title={t('emptyTitle')}
              body={admin ? t('emptyAdminBody') : t('emptyBody')}
              className="min-h-80"
            >
              {admin ? (
                <Link href="/settings/sources" className={cn(buttonVariants())}>
                  <Plug aria-hidden />
                  {t('connect')}
                </Link>
              ) : null}
            </StateView>
          )}
        </section>
      ) : (
        <>
          <section
            aria-label={t('title')}
            className="overflow-x-auto rounded-xl border border-border bg-card"
          >
            <table className="w-full min-w-[860px] border-collapse text-[13px]">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <Th first>{t('colLead')}</Th>
                  <Th>{t('colRating')}</Th>
                  <Th>{t('colCompany')}</Th>
                  <Th>{t('colSource')}</Th>
                  <Th>{t('colStatus')}</Th>
                  <Th>{t('colAdded')}</Th>
                </tr>
              </thead>
              <tbody>
                {items.map((lead) => (
                  <LeadRow key={lead.id} lead={lead} now={now} />
                ))}
              </tbody>
            </table>
          </section>
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-[13px] text-muted-foreground" role="status">
              {t('count', { count: items.length })}
            </span>
            {leads.hasNextPage ? (
              <Button
                variant="outline"
                disabled={leads.isFetchingNextPage}
                onClick={() => void leads.fetchNextPage()}
              >
                {leads.isFetchingNextPage ? (
                  <>
                    <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden />
                    {t('loadingMore')}
                  </>
                ) : (
                  t('loadMore')
                )}
              </Button>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}

function Filter({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex min-w-[150px] flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function Th({ children, first }: { children: React.ReactNode; first?: boolean }) {
  return (
    <th
      scope="col"
      className={cn(
        'border-b border-border py-2 font-medium whitespace-nowrap',
        first ? 'px-[18px]' : 'px-3',
      )}
    >
      {children}
    </th>
  );
}

function LeadRow({ lead, now }: { lead: LeadListItem; now: Date }) {
  const t = useTranslations('leads');
  const format = useFormatter();
  const added = new Date(lead.createdAt);
  return (
    <tr className="h-14 border-b border-border last:border-b-0 hover:bg-hover">
      <td className="max-w-[260px] px-[18px]">
        <Link
          href={`/leads/${lead.id}`}
          className="block truncate font-medium hover:underline focus-visible:underline"
          title={lead.name ?? undefined}
        >
          {lead.name ?? <span className="text-muted-foreground">{t('unnamed')}</span>}
          <span className="sr-only"> {lead.email ?? lead.phone}</span>
        </Link>
        <div
          className="truncate text-muted-foreground"
          title={lead.email ?? lead.phone ?? undefined}
        >
          {lead.email ?? lead.phone}
        </div>
      </td>
      <td className="px-3 whitespace-nowrap">
        {lead.tier ? (
          <span className="flex items-center gap-2">
            <TierBadge tier={lead.tier} />
            <span className="text-muted-foreground tabular-nums">{lead.score}</span>
          </span>
        ) : (
          <span className="text-muted-foreground">{'–'}</span>
        )}
      </td>
      <td className="max-w-[220px] px-3">
        <div className="flex items-center gap-2">
          <span className="truncate" title={lead.company ?? undefined}>
            {lead.company ?? '–'}
          </span>
          {lead.isFreeMail ? (
            <Badge variant="outline" className="shrink-0">
              {t('freeBadge')}
            </Badge>
          ) : null}
          {lead.submissions > 1 ? (
            <Badge variant="secondary" className="shrink-0">
              {t('submitted', { count: lead.submissions })}
            </Badge>
          ) : null}
          {lead.possibleDuplicateOf ? (
            <Badge
              variant="outline"
              className="shrink-0 border-warm text-warm"
              title={t('possibleDuplicateOf', {
                who:
                  lead.possibleDuplicateOf.name ??
                  lead.possibleDuplicateOf.email ??
                  t('unknownLead'),
              })}
            >
              {t('possibleDuplicate')}
            </Badge>
          ) : null}
        </div>
      </td>
      <td className="max-w-[180px] px-3">
        <span className="flex items-center gap-1.5" title={lead.source.name}>
          <Plug className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <span className="truncate">{lead.source.name}</span>
        </span>
      </td>
      <td className="px-3 whitespace-nowrap">{t(`statusName.${lead.status}`)}</td>
      <td className="px-3 whitespace-nowrap text-muted-foreground">
        <time dateTime={lead.createdAt} title={added.toLocaleString()}>
          {format.relativeTime(added, now)}
        </time>
      </td>
    </tr>
  );
}

function LeadsSkeleton() {
  return (
    <section className="rounded-xl border border-border bg-card" aria-hidden>
      {[0, 1, 2, 3, 4].map((n) => (
        <div
          key={n}
          className="flex h-14 items-center gap-4 border-b border-border px-[18px] last:border-b-0"
        >
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-24" />
        </div>
      ))}
    </section>
  );
}
