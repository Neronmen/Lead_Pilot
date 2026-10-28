'use client';

import type { AuditArea, HistoryEntry } from '@leadpilot/shared';
import { History as HistoryIcon } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { ErrorState, StateView } from '@/components/state-views';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  actionKey,
  type HistoryFilters,
  KNOWN_ACTIONS,
  useHistory,
} from '@/lib/history/use-history';
import { useMembers } from '@/lib/team/use-team';

const AREAS: AuditArea[] = [
  'rules',
  'sources',
  'ideal_customer',
  'integrations',
  'team',
  'general',
];

/** Settings > Change history: plain sentences grouped by day, with an optional before / after view. */
export function HistoryView() {
  const t = useTranslations('history');
  const format = useFormatter();
  const members = useMembers();
  const [filters, setFilters] = useState<HistoryFilters>({ area: '', actor: '', days: '' });
  const history = useHistory(filters);
  const entries = useMemo(
    () => history.data?.pages.flatMap((page) => page.entries) ?? [],
    [history.data],
  );
  const set = (changes: Partial<HistoryFilters>) => setFilters((f) => ({ ...f, ...changes }));

  // Grouped by the day it happened, in the viewer's own time zone.
  const groups = useMemo(() => {
    const out: { day: string; items: HistoryEntry[] }[] = [];
    for (const entry of entries) {
      const day = format.dateTime(new Date(entry.createdAt), { dateStyle: 'full' });
      const last = out.at(-1);
      if (last?.day === day) last.items.push(entry);
      else out.push({ day, items: [entry] });
    }
    return out;
  }, [entries, format]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="h-area">{t('filter.area')}</Label>
          <NativeSelect
            id="h-area"
            className="w-auto"
            value={filters.area}
            onChange={(event) => set({ area: event.target.value as AuditArea | '' })}
          >
            <option value="">{t('filter.anyArea')}</option>
            {AREAS.map((area) => (
              <option key={area} value={area}>
                {t(`area.${area}`)}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="h-actor">{t('filter.person')}</Label>
          <NativeSelect
            id="h-actor"
            className="w-auto"
            value={filters.actor}
            onChange={(event) => set({ actor: event.target.value })}
          >
            <option value="">{t('filter.anyone')}</option>
            {(members.data ?? []).map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.name || m.email}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="h-days">{t('filter.time')}</Label>
          <NativeSelect
            id="h-days"
            className="w-auto"
            value={filters.days}
            onChange={(event) => set({ days: event.target.value as HistoryFilters['days'] })}
          >
            <option value="">{t('filter.anyTime')}</option>
            <option value="7">{t('filter.days7')}</option>
            <option value="30">{t('filter.days30')}</option>
            <option value="90">{t('filter.days90')}</option>
          </NativeSelect>
        </div>
      </div>

      {history.isPending ? (
        <div className="flex flex-col gap-2" role="status" aria-label={t('loading')}>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-12 w-full rounded-lg" />
          ))}
        </div>
      ) : history.isError ? (
        <section className="rounded-xl border border-border bg-card">
          <ErrorState title={t('loadTitle')} body={t('loadBody')}>
            <Button variant="outline" onClick={() => void history.refetch()}>
              {t('retry')}
            </Button>
          </ErrorState>
        </section>
      ) : entries.length === 0 ? (
        <section className="rounded-xl border border-border bg-card">
          <StateView
            icon={HistoryIcon}
            tone="accent"
            title={t('empty.title')}
            body={t('empty.body')}
          />
        </section>
      ) : (
        <>
          {groups.map(({ day, items }) => (
            <section key={day} aria-label={day} className="flex flex-col gap-2">
              <h2 className="text-[13px] font-semibold text-muted-foreground">{day}</h2>
              <ul className="flex flex-col gap-2">
                {items.map((entry) => (
                  <Entry key={entry.id} entry={entry} />
                ))}
              </ul>
            </section>
          ))}
          {history.hasNextPage ? (
            <div>
              <Button
                variant="outline"
                disabled={history.isFetchingNextPage}
                onClick={() => void history.fetchNextPage()}
              >
                {t('more')}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function Entry({ entry }: { entry: HistoryEntry }) {
  const t = useTranslations('history');
  const sentences = useTranslations('history.action');
  const format = useFormatter();
  const key = actionKey(entry.action);
  const known = (KNOWN_ACTIONS as readonly string[]).includes(key);
  const subject =
    entry.after?.name ?? entry.before?.name ?? entry.after?.email ?? entry.before?.email ?? '';
  const actor = entry.actor ? (entry.actor.name ?? entry.actor.email ?? t('someone')) : t('system');
  const text = known
    ? sentences(key as 'rule_created', { actor: String(actor), name: String(subject) })
    : t('other', { actor: String(actor), area: t(`area.${entry.area}`) });
  const detail = [...Object.entries(entry.before ?? {}), ...Object.entries(entry.after ?? {})];

  return (
    <li className="flex flex-col gap-1 rounded-xl border border-border bg-card px-[18px] py-3">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <p className="min-w-0 flex-1 text-sm">{text}</p>
        <time dateTime={entry.createdAt} className="text-xs text-muted-foreground tabular-nums">
          {format.dateTime(new Date(entry.createdAt), { timeStyle: 'short' })}
        </time>
      </div>
      {detail.length > 0 ? (
        <details className="text-[13px]">
          <summary className="cursor-pointer text-muted-foreground">{t('details')}</summary>
          <div className="mt-1.5 grid gap-x-6 gap-y-1 sm:grid-cols-2">
            {entry.before ? <Values title={t('before')} values={entry.before} /> : null}
            {entry.after ? <Values title={t('after')} values={entry.after} /> : null}
          </div>
        </details>
      ) : null}
    </li>
  );
}

function Values({
  title,
  values,
}: {
  title: string;
  values: Record<string, string | number | boolean | null>;
}) {
  return (
    <dl className="flex flex-col gap-0.5">
      <dt className="font-medium">{title}</dt>
      {Object.entries(values).map(([name, value]) => (
        <dd key={name} className="text-muted-foreground">
          {`${name}: ${String(value)}`}
        </dd>
      ))}
    </dl>
  );
}
