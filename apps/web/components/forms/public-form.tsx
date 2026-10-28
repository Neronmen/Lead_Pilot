'use client';

import { ErrorCode, publicFormInfoSchema, type PublicFormInfo } from '@leadpilot/shared';
import { useQuery } from '@tanstack/react-query';
import { CircleCheck, LoaderCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { FormAlert, TextField } from '@/components/auth/form-parts';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { ApiError } from '@/lib/api';
import { useAuthClient } from '@/lib/auth/auth-provider';

const CARD = 'mx-auto flex w-full max-w-[480px] flex-col gap-4 p-4';

/**
 * The page a customer's visitors see (`/f/<source id>`), on its own or inside an iframe on their website.
 * No sign-in. It shows the company's name, takes a few details and sends them to the source. People never
 * see the `website` box: it is a trap for scripts that fill every field.
 */
export function PublicForm({ sourceId }: { sourceId: string }) {
  const t = useTranslations('publicForm');
  const client = useAuthClient();
  const info = useQuery<PublicFormInfo>({
    queryKey: ['public-form', sourceId],
    queryFn: () =>
      client.request(`/v1/forms/${sourceId}`, { schema: publicFormInfoSchema, anonymous: true }),
    retry: false,
  });
  const [values, setValues] = useState({
    name: '',
    email: '',
    phone: '',
    company: '',
    message: '',
  });
  const [trap, setTrap] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<'invalid' | 'slow' | 'failed' | null>(null);
  const [sent, setSent] = useState(false);
  const set = (key: keyof typeof values) => (value: string) =>
    setValues((previous) => ({ ...previous, [key]: value }));

  if (info.isPending) {
    return (
      <p role="status" className={CARD}>
        {t('loading')}
      </p>
    );
  }
  if (info.isError) {
    const gone = info.error instanceof ApiError && info.error.code === ErrorCode.NOT_FOUND;
    return (
      <section className={CARD} aria-label={t('unavailable.title')}>
        <h1 className="text-xl font-semibold">
          {gone ? t('unavailable.title') : t('error.title')}
        </h1>
        <p className="text-sm text-muted-foreground">
          {gone ? t('unavailable.body') : t('error.body')}
        </p>
      </section>
    );
  }
  if (sent) {
    return (
      <section className={CARD} aria-label={t('thanks.title')}>
        <CircleCheck className="size-8 text-accent-text" aria-hidden />
        <h1 className="text-xl font-semibold">{t('thanks.title')}</h1>
        <p className="text-sm text-muted-foreground">
          {t('thanks.body', { company: info.data.workspaceName })}
        </p>
      </section>
    );
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (values.email.trim() === '' && values.phone.trim() === '') return setProblem('invalid');
    setBusy(true);
    setProblem(null);
    try {
      await client.request(`/v1/forms/${sourceId}`, {
        method: 'POST',
        body: { ...values, website: trap },
        anonymous: true,
      });
      setSent(true);
    } catch (error) {
      if (error instanceof ApiError && error.status === 400) setProblem('invalid');
      else if (error instanceof ApiError && error.code === ErrorCode.RATE_LIMITED)
        setProblem('slow');
      else setProblem('failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate aria-busy={busy} className={CARD}>
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">
          {t('title', { company: info.data.workspaceName })}
        </h1>
        <p className="text-sm text-muted-foreground">{t('sub')}</p>
      </div>
      {problem ? <FormAlert>{t(`problem.${problem}`)}</FormAlert> : null}
      <TextField
        label={t('name')}
        name="name"
        autoComplete="name"
        value={values.name}
        onChange={(event) => set('name')(event.target.value)}
      />
      <TextField
        label={t('email')}
        name="email"
        type="email"
        autoComplete="email"
        inputMode="email"
        value={values.email}
        onChange={(event) => set('email')(event.target.value)}
      />
      <TextField
        label={t('phone')}
        name="phone"
        type="tel"
        autoComplete="tel"
        value={values.phone}
        onChange={(event) => set('phone')(event.target.value)}
      />
      <TextField
        label={t('company')}
        name="company"
        autoComplete="organization"
        value={values.company}
        onChange={(event) => set('company')(event.target.value)}
      />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="pf-message">{t('message')}</Label>
        <textarea
          id="pf-message"
          name="message"
          rows={4}
          maxLength={2000}
          value={values.message}
          onChange={(event) => set('message')(event.target.value)}
          className="min-h-24 w-full rounded-[9px] border border-border bg-card px-2.5 py-2 text-[15px] outline-none focus-visible:border-primary focus-visible:shadow-[0_0_0_3px_var(--accent-soft)]"
        />
      </div>
      {/* The trap: out of sight and out of the tab order. A person never fills it; a script does. */}
      <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>
          {t('trap')}
          <input
            name="website"
            tabIndex={-1}
            autoComplete="off"
            value={trap}
            onChange={(event) => setTrap(event.target.value)}
          />
        </label>
      </div>
      <p className="text-xs text-muted-foreground">{t('contactHint')}</p>
      <Button type="submit" size="lg" disabled={busy}>
        {busy ? (
          <>
            <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden />
            {t('sending')}
          </>
        ) : (
          t('submit')
        )}
      </Button>
    </form>
  );
}
