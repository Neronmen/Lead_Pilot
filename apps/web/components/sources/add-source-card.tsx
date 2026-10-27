'use client';

import type { SourceWithKey } from '@leadpilot/shared';
import { LoaderCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { TextField } from '@/components/auth/form-parts';
import { Button, buttonVariants } from '@/components/ui/button';
import { API_URL } from '@/lib/api';
import { ingestUrl } from '@/lib/sources/status';
import { useSourceActions } from '@/lib/sources/use-sources';
import { cn } from '@/lib/utils';
import { CopyBox } from './copy-box';
import { type Notice, useFailureNotice } from './sources-notice';

type Tool = 'zapier' | 'other';

/**
 * "Add a source": pick the tool, name it, create it. The next screen shows the
 * address and the API key. The key lives only in this component's state: it is
 * shown once and gone when the person presses Done.
 */
export function AddSourceCard({
  onClose,
  onNotice,
}: {
  onClose: () => void;
  onNotice: (notice: Notice | null) => void;
}) {
  const t = useTranslations('sources');
  const failure = useFailureNotice();
  const { create } = useSourceActions();
  const [tool, setTool] = useState<Tool>('zapier');
  const [name, setName] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [made, setMade] = useState<{ result: SourceWithKey; tool: Tool } | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (create.isPending) return;
    onNotice(null);
    const trimmed = name.trim();
    if (!trimmed) return setProblem(t('form.empty'));
    setProblem(null);
    try {
      setMade({ result: await create.mutateAsync({ name: trimmed, type: 'WEBHOOK' }), tool });
    } catch (error) {
      onNotice(failure(error));
    }
  }

  if (made) {
    const { source, apiKey } = made.result;
    return (
      <section
        aria-labelledby="source-ready"
        className="flex flex-col gap-3 rounded-xl border border-accent-line bg-card px-[18px] py-4"
      >
        <h2 id="source-ready" tabIndex={-1} className="text-[15px] leading-[22px] font-semibold">
          {t('ready.title', { name: source.name })}
        </h2>
        <p className="text-[13px] text-muted-foreground">{t('ready.body')}</p>
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium">{t('ready.urlLabel')}</span>
          <CopyBox value={ingestUrl(API_URL, source.id)} label={t('ready.urlLabel')} />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium">{t('ready.keyLabel')}</span>
          <CopyBox value={apiKey} label={t('ready.keyLabel')} tag={t('ready.shown')} />
        </div>
        <p className="text-[13px]">{t(`ready.steps.${made.tool}`)}</p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={onClose}>{t('ready.done')}</Button>
          {made.tool === 'other' ? (
            <Link href="/settings/advanced" className={cn(buttonVariants({ variant: 'outline' }))}>
              {t('ready.advanced')}
            </Link>
          ) : null}
        </div>
      </section>
    );
  }

  return (
    <section
      aria-labelledby="source-add"
      className="flex flex-col gap-3 rounded-xl border border-border bg-card px-[18px] py-4"
    >
      <h2 id="source-add" className="text-[15px] leading-[22px] font-semibold">
        {t('form.title')}
      </h2>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3">
        <fieldset className="flex flex-col gap-2">
          <legend className="pb-1 text-[13px] font-medium">{t('form.tool')}</legend>
          {(['zapier', 'other'] as const).map((value) => (
            <label
              key={value}
              className={cn(
                'flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-[13px] has-focus-visible:ring-3 has-focus-visible:ring-ring/50',
                tool === value
                  ? 'border-accent-line bg-accent-soft'
                  : 'border-border hover:bg-hover',
              )}
            >
              <input
                type="radio"
                name="tool"
                value={value}
                checked={tool === value}
                onChange={() => setTool(value)}
                className="mt-0.5 accent-[var(--primary)]"
              />
              <span className="flex flex-col gap-0.5">
                <span className="font-medium">{t(`form.${value}`)}</span>
                <span className="text-muted-foreground">{t(`form.${value}Hint`)}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <TextField
          label={t('form.name')}
          name="name"
          autoComplete="off"
          maxLength={100}
          placeholder={t('form.namePlaceholder')}
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            setProblem(null);
          }}
          error={problem ?? undefined}
        />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? (
              <>
                <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden />
                {t('form.creating')}
              </>
            ) : (
              t('form.create')
            )}
          </Button>
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('cancel')}
          </Button>
        </div>
      </form>
    </section>
  );
}
