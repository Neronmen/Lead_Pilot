'use client';

import type { IcpRubric, IcpRubricResponse } from '@leadpilot/shared';
import { LoaderCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { ErrorState } from '@/components/state-views';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useRubric, useSaveRubric } from '@/lib/icp/use-rubric';
import { formErrors } from '@/lib/i18n/errors';
import { useMessage } from '@/lib/i18n/use-message';
import { useRescore } from '@/lib/leads/use-leads';
import { ListField } from './list-field';

const country = (value: string) => (/^[A-Za-z]{2}$/.test(value) ? value.toUpperCase() : null);

/** Settings > Ideal customer (Owner and Admin): the yardstick the AI rates every new lead against. */
export function IdealCustomerView() {
  const t = useTranslations('ideal');
  const rubric = useRubric();
  if (rubric.isPending) return <FormSkeleton />;
  if (rubric.isError) {
    return (
      <section className="rounded-xl border border-border bg-card">
        <ErrorState title={t('loadTitle')} body={t('loadBody')}>
          <Button variant="outline" onClick={() => void rubric.refetch()}>
            {t('retry')}
          </Button>
        </ErrorState>
      </section>
    );
  }
  return <Form saved={rubric.data} />;
}

function Form({ saved }: { saved: IcpRubricResponse }) {
  const t = useTranslations('ideal');
  const message = useMessage();
  const save = useSaveRubric();
  const rescore = useRescore();
  const [draft, setDraft] = useState<IcpRubric>({
    industries: saved.industries,
    companySizes: saved.companySizes,
    countries: saved.countries,
    budgetSignals: saved.budgetSignals,
    disqualifiers: saved.disqualifiers,
    notes: saved.notes,
  });
  const [lookAgain, setLookAgain] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const set = <K extends keyof IcpRubric>(key: K, value: IcpRubric[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (save.isPending) return;
    setResult(null);
    try {
      await save.mutateAsync({ ...draft, notes: draft.notes?.trim() ? draft.notes.trim() : null });
    } catch (error) {
      setResult({ ok: false, text: message(formErrors(error).form ?? { key: 'errors.UNKNOWN' }) });
      return;
    }
    if (!lookAgain) return setResult({ ok: true, text: t('saved') });
    try {
      const { queued } = await rescore.mutateAsync({ scope: 'open' });
      setResult({
        ok: true,
        text: `${t('saved')} ${queued > 0 ? t('rescored', { count: queued }) : t('nothingToRescore')}`,
      });
    } catch {
      setResult({ ok: true, text: `${t('saved')} ${t('saveFailed')}` });
    }
  }

  const busy = save.isPending || rescore.isPending;
  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className="flex flex-col gap-5 rounded-xl border border-border bg-card px-[18px] py-5"
    >
      <ListField
        label={t('industries')}
        hint={t('industriesHint')}
        error=""
        values={draft.industries}
        onChange={(values) => set('industries', values)}
      />
      <ListField
        label={t('sizes')}
        hint={t('sizesHint')}
        error=""
        values={draft.companySizes}
        onChange={(values) => set('companySizes', values)}
      />
      <ListField
        label={t('countries')}
        hint={t('countriesHint')}
        error={t('badCountry')}
        normalize={country}
        max={60}
        values={draft.countries}
        onChange={(values) => set('countries', values)}
      />
      <ListField
        label={t('signals')}
        hint={t('signalsHint')}
        error=""
        values={draft.budgetSignals}
        onChange={(values) => set('budgetSignals', values)}
      />
      <ListField
        label={t('deal')}
        hint={t('dealHint')}
        error=""
        values={draft.disqualifiers}
        onChange={(values) => set('disqualifiers', values)}
      />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="icp-notes">{t('notes')}</Label>
        <textarea
          id="icp-notes"
          rows={4}
          maxLength={2000}
          value={draft.notes ?? ''}
          onChange={(event) => set('notes', event.target.value)}
          className="rounded-lg border border-border-strong bg-transparent p-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
      </div>
      <label className="flex items-start gap-2 text-[13px]">
        <input
          type="checkbox"
          checked={lookAgain}
          onChange={(event) => setLookAgain(event.target.checked)}
          className="mt-0.5 accent-[var(--primary)]"
        />
        {t('rescore')}
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={busy}>
          {busy ? (
            <>
              <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden />
              {t('saving')}
            </>
          ) : (
            t('save')
          )}
        </Button>
        {result ? (
          <span
            role={result.ok ? 'status' : 'alert'}
            className={result.ok ? 'text-[13px] text-accent-text' : 'text-[13px] text-danger-text'}
          >
            {result.text}
          </span>
        ) : null}
      </div>
    </form>
  );
}

function FormSkeleton() {
  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5" aria-hidden>
      {[0, 1, 2].map((n) => (
        <div key={n} className="flex flex-col gap-2">
          <Skeleton className="h-4 w-56" />
          <Skeleton className="h-10 w-full" />
        </div>
      ))}
    </div>
  );
}
