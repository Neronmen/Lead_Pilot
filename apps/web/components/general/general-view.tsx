'use client';

import { ErrorCode, newPasswordSchema, type Currency } from '@leadpilot/shared';
import { CircleCheck, Download, LoaderCircle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { canManage, useCurrentMe } from '@/components/app-shell/me-context';
import { FormAlert, PasswordField, SelectField, TextField } from '@/components/auth/form-parts';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api';
import {
  useChangePassword,
  useDeleteWorkspace,
  useExportLeads,
  useUpdateWorkspace,
} from '@/lib/general/use-general';
import { formErrors } from '@/lib/i18n/errors';
import type { Locale } from '@/lib/i18n/locales';
import { useMessage } from '@/lib/i18n/use-message';

const COUNTRIES = ['US', 'GB', 'AU', 'DE', 'VN'] as const;
const CURRENCIES: Currency[] = ['USD', 'VND'];
const LANGUAGES: Locale[] = ['en', 'vi'];

function Section({
  title,
  body,
  children,
  tone,
}: {
  title: string;
  body: string;
  children: ReactNode;
  tone?: 'danger';
}) {
  return (
    <section
      aria-label={title}
      className={
        tone === 'danger'
          ? 'flex flex-col gap-4 rounded-xl border border-danger-line bg-card p-[18px]'
          : 'flex flex-col gap-4 rounded-xl border border-border bg-card p-[18px]'
      }
    >
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="text-[13px] text-muted-foreground">{body}</p>
      </div>
      {children}
    </section>
  );
}

function Saved({ children }: { children: ReactNode }) {
  return (
    <p role="status" className="flex items-center gap-1.5 text-[13px] text-success-text">
      <CircleCheck className="size-4" aria-hidden />
      {children}
    </p>
  );
}

/** Settings > General: the workspace, your password, the leads file, and deleting everything. */
export function GeneralView() {
  const me = useCurrentMe();
  return (
    <div className="flex flex-col gap-4">
      <WorkspaceForm />
      <PasswordForm />
      <ExportCard />
      {me.role === 'OWNER' ? <DeleteCard /> : null}
    </div>
  );
}

function WorkspaceForm() {
  const t = useTranslations('general.workspace');
  const message = useMessage();
  const { workspace } = useCurrentMe();
  const update = useUpdateWorkspace();
  const [name, setName] = useState(workspace.name);
  const [locale, setLocale] = useState(workspace.defaultLocale);
  const [currency, setCurrency] = useState(workspace.currency);
  const [timezone, setTimezone] = useState(workspace.timezone);
  const [country, setCountry] = useState(workspace.defaultCountry ?? '');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const countryNames = useMemo(() => new Intl.DisplayNames([locale], { type: 'region' }), [locale]);
  const zones = useMemo(() => {
    const all = Intl.supportedValuesOf('timeZone');
    return all.includes(timezone) ? all : [timezone, ...all];
  }, [timezone]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (update.isPending) return;
    setSaved(false);
    setError(null);
    try {
      await update.mutateAsync({
        name: name.trim(),
        defaultLocale: locale,
        currency,
        timezone,
        defaultCountry: country || null,
      });
      setSaved(true);
    } catch (caught) {
      const form = formErrors(caught);
      const first = form.form ?? Object.values(form.fields)[0];
      setError(first ? message(first) : t('failed'));
    }
  }

  return (
    <Section title={t('title')} body={t('body')}>
      <form
        onSubmit={onSubmit}
        noValidate
        className="flex flex-col gap-3"
        aria-busy={update.isPending}
      >
        {error ? <FormAlert>{error}</FormAlert> : null}
        <TextField
          label={t('name')}
          name="name"
          value={name}
          maxLength={100}
          onChange={(event) => setName(event.target.value)}
        />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <SelectField
            label={t('language')}
            value={locale}
            onChange={(event) => setLocale(event.target.value as Locale)}
          >
            {LANGUAGES.map((code) => (
              <option key={code} value={code} lang={code}>
                {t(`languages.${code}`)}
              </option>
            ))}
          </SelectField>
          <SelectField
            label={t('currency')}
            value={currency}
            onChange={(event) => setCurrency(event.target.value as Currency)}
          >
            {CURRENCIES.map((code) => (
              <option key={code} value={code}>
                {t(`currencies.${code}`)}
              </option>
            ))}
          </SelectField>
          <SelectField
            label={t('timezone')}
            value={timezone}
            onChange={(event) => setTimezone(event.target.value)}
          >
            {zones.map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </SelectField>
          <SelectField
            label={t('country')}
            value={country}
            onChange={(event) => setCountry(event.target.value)}
          >
            <option value="">{t('noCountry')}</option>
            {COUNTRIES.map((code) => (
              <option key={code} value={code}>
                {countryNames.of(code) ?? code}
              </option>
            ))}
          </SelectField>
        </div>
        <p className="text-xs text-muted-foreground">{t('languageHint')}</p>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={update.isPending}>
            {update.isPending ? (
              <>
                <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden />
                {t('saving')}
              </>
            ) : (
              t('save')
            )}
          </Button>
          {saved ? <Saved>{t('saved')}</Saved> : null}
        </div>
      </form>
    </Section>
  );
}

function PasswordForm() {
  const t = useTranslations('general.password');
  const message = useMessage();
  const change = useChangePassword();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (change.isPending) return;
    setSaved(false);
    setError(null);
    if (!current) return setError(t('currentMissing'));
    if (!newPasswordSchema.safeParse(next).success) return setError(t('tooShort'));
    try {
      await change.mutateAsync({ currentPassword: current, newPassword: next });
      setCurrent('');
      setNext('');
      setSaved(true);
    } catch (caught) {
      // A wrong current password comes back as "email and password don't match": say what is meant.
      if (caught instanceof ApiError && caught.code === ErrorCode.AUTH_INVALID_CREDENTIALS) {
        return setError(t('wrongCurrent'));
      }
      const form = formErrors(caught).form;
      setError(form ? message(form) : t('failed'));
    }
  }

  return (
    <Section title={t('title')} body={t('body')}>
      <form onSubmit={onSubmit} noValidate className="flex max-w-[420px] flex-col gap-3">
        {error ? <FormAlert>{error}</FormAlert> : null}
        <PasswordField
          label={t('current')}
          name="currentPassword"
          autoComplete="current-password"
          value={current}
          onChange={(event) => setCurrent(event.target.value)}
        />
        <PasswordField
          label={t('new')}
          name="newPassword"
          autoComplete="new-password"
          hint={t('newHint')}
          value={next}
          onChange={(event) => setNext(event.target.value)}
        />
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={change.isPending}>
            {change.isPending ? (
              <>
                <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden />
                {t('saving')}
              </>
            ) : (
              t('save')
            )}
          </Button>
          {saved ? <Saved>{t('saved')}</Saved> : null}
        </div>
      </form>
    </Section>
  );
}

function ExportCard() {
  const t = useTranslations('general.export');
  const message = useMessage();
  const { role } = useCurrentMe();
  const download = useExportLeads();
  if (!canManage(role)) return null;
  const failure = download.isError ? formErrors(download.error).form : null;
  return (
    <Section title={t('title')} body={t('body')}>
      {download.isError ? <FormAlert>{failure ? message(failure) : t('failed')}</FormAlert> : null}
      <div>
        <Button variant="outline" disabled={download.isPending} onClick={() => download.mutate()}>
          {download.isPending ? (
            <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden />
          ) : (
            <Download aria-hidden />
          )}
          {t('button')}
        </Button>
      </div>
    </Section>
  );
}

function DeleteCard() {
  const t = useTranslations('general.delete');
  const message = useMessage();
  const router = useRouter();
  const { workspace } = useCurrentMe();
  const remove = useDeleteWorkspace();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (remove.isPending || typed.trim() !== workspace.name) return;
    setError(null);
    try {
      await remove.mutateAsync({ confirm: typed });
      router.replace('/login');
    } catch (caught) {
      const form = formErrors(caught).form;
      setError(form ? message(form) : t('failed'));
    }
  }

  return (
    <Section tone="danger" title={t('title')} body={t('body')}>
      {open ? (
        <form onSubmit={onSubmit} noValidate className="flex max-w-[420px] flex-col gap-3">
          {error ? <FormAlert>{error}</FormAlert> : null}
          <TextField
            label={t('confirmLabel', { name: workspace.name })}
            name="confirm"
            autoComplete="off"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="submit"
              variant="destructive"
              disabled={remove.isPending || typed.trim() !== workspace.name}
            >
              {remove.isPending ? t('deleting') : t('confirm')}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setOpen(false);
                setTyped('');
                setError(null);
              }}
            >
              {t('cancel')}
            </Button>
          </div>
        </form>
      ) : (
        <div>
          <Button variant="destructive" onClick={() => setOpen(true)}>
            {t('open')}
          </Button>
        </div>
      )}
    </Section>
  );
}
