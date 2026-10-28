'use client';

import type { Source } from '@leadpilot/shared';
import { Plug, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { StateView, ErrorState } from '@/components/state-views';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { sourceStatus } from '@/lib/sources/status';
import { useSourceActions, useSources } from '@/lib/sources/use-sources';
import { cn } from '@/lib/utils';
import { AddSourceCard } from './add-source-card';
import { DuplicatesHelp } from './duplicates-help';
import { Readiness } from './readiness';
import { SourceStats } from './source-stats';
import { SourcesNotice, useFailureNotice, type Notice } from './sources-notice';

/** Settings > Lead sources (Owner and Admin only: the Settings frame keeps everyone else out). */
export function SourcesView() {
  const t = useTranslations('sources');
  const sources = useSources();
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  return (
    <div className="flex flex-col gap-4">
      {notice ? (
        <SourcesNotice
          notice={notice}
          onReload={() => {
            setNotice(null);
            void sources.refetch();
          }}
          onDismiss={() => setNotice(null)}
        />
      ) : null}

      {adding ? <AddSourceCard onClose={() => setAdding(false)} onNotice={setNotice} /> : null}

      {sources.isPending ? (
        <SourcesSkeleton />
      ) : sources.isError ? (
        <section className="rounded-xl border border-border bg-card">
          <ErrorState title={t('loadTitle')} body={t('loadBody')}>
            <Button variant="outline" onClick={() => void sources.refetch()}>
              {t('retry')}
            </Button>
          </ErrorState>
        </section>
      ) : sources.data.length === 0 ? (
        adding ? null : (
          <section className="rounded-xl border border-border bg-card">
            <StateView icon={Plug} tone="accent" title={t('empty.title')} body={t('empty.body')}>
              <Button onClick={() => setAdding(true)}>{t('empty.cta')}</Button>
            </StateView>
          </section>
        )
      ) : (
        <>
          {adding ? null : (
            <div>
              <Button onClick={() => setAdding(true)}>
                <Plus aria-hidden />
                {t('add')}
              </Button>
            </div>
          )}
          <p className="text-[13px] text-muted-foreground">
            {t('keysHint')}{' '}
            <Link
              href="/settings/advanced"
              className="text-accent-text underline underline-offset-2"
            >
              {t('keysLink')}
            </Link>
          </p>
          <DuplicatesHelp />
          <ul className="flex flex-col gap-3">
            {sources.data.map((source) => (
              <SourceRow key={source.id} source={source} onNotice={setNotice} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function SourceRow({
  source,
  onNotice,
}: {
  source: Source;
  onNotice: (notice: Notice | null) => void;
}) {
  const t = useTranslations('sources');
  const failure = useFailureNotice();
  const { update, remove, sendSample } = useSourceActions();
  const [sampleSent, setSampleSent] = useState(false);
  const [mode, setMode] = useState<'view' | 'rename' | 'delete'>('view');
  const [name, setName] = useState(source.name);
  const busy = update.isPending || remove.isPending || sendSample.isPending;
  const status = sourceStatus(source);

  async function run(action: () => Promise<unknown>) {
    onNotice(null);
    try {
      await action();
      setMode('view');
    } catch (error) {
      onNotice(failure(error));
    }
  }

  function onRename(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || trimmed === source.name) return setMode('view');
    void run(() => update.mutateAsync({ id: source.id, name: trimmed }));
  }

  return (
    <li className="flex flex-col gap-3 rounded-xl border border-border bg-card px-[18px] py-4">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          {mode === 'rename' ? (
            <form onSubmit={onRename} className="flex flex-wrap items-center gap-2">
              <Input
                autoFocus
                aria-label={t('renameLabel', { name: source.name })}
                maxLength={100}
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="max-w-sm"
              />
              <Button type="submit" size="sm" disabled={busy}>
                {t('actions.save')}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setMode('view')}>
                {t('cancel')}
              </Button>
            </form>
          ) : (
            <h2 className="truncate text-[15px] leading-[22px] font-semibold">{source.name}</h2>
          )}
          <p className="text-xs text-muted-foreground">{t(`kind.${source.type}`)}</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {source.enabled ? (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await sendSample.mutateAsync(source.id);
                  setSampleSent(true);
                })
              }
            >
              {t('sample.button')}
            </Button>
          ) : null}
          <Button size="sm" variant="outline" disabled={busy} onClick={() => setMode('rename')}>
            {t('actions.rename')}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() =>
              void run(() => update.mutateAsync({ id: source.id, enabled: !source.enabled }))
            }
          >
            {source.enabled ? t('actions.switchOff') : t('actions.switchOn')}
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => setMode('delete')}>
            {t('actions.delete')}
          </Button>
        </div>
      </div>

      <p className="flex items-start gap-2 text-[13px]">
        <span
          aria-hidden
          className={cn(
            'mt-1.5 size-2 shrink-0 rounded-full',
            status.kind === 'working' && 'bg-accent-text',
            status.kind === 'quiet' && 'bg-warm',
            (status.kind === 'waiting' || status.kind === 'off') && 'bg-muted-foreground',
          )}
        />
        <span>
          {status.kind === 'working'
            ? t('status.working', { count: status.count })
            : status.kind === 'quiet'
              ? t('status.quiet', { days: status.days, name: source.name })
              : status.kind === 'waiting'
                ? t('status.waiting')
                : t('status.off')}
        </span>
      </p>

      {sampleSent ? (
        <p role="status" className="text-[13px] text-accent-text">
          {t('sample.sent')}{' '}
          <Link href="/leads" className="underline underline-offset-2">
            {t('sample.open')}
          </Link>
        </p>
      ) : null}
      <SourceStats source={source} />
      <Readiness source={source} />

      {mode === 'delete' ? (
        <div
          role="alertdialog"
          aria-label={t('actions.confirmDelete', { name: source.name })}
          className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-danger-line bg-danger-bg p-3 text-[13px] text-danger-text"
        >
          <span className="min-w-0 flex-1">
            {t('actions.confirmDelete', { name: source.name })}
          </span>
          <Button
            size="sm"
            variant="destructive"
            disabled={busy}
            onClick={() => void run(() => remove.mutateAsync(source.id))}
          >
            {t('actions.confirmYes')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setMode('view')}>
            {t('actions.keep')}
          </Button>
        </div>
      ) : null}
    </li>
  );
}

function SourcesSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-hidden>
      {[0, 1].map((n) => (
        <div key={n} className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-4 w-72" />
        </div>
      ))}
    </div>
  );
}
