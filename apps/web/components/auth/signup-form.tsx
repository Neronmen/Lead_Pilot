'use client';

import {
  ErrorCode,
  signupRequestSchema,
  toValidationIssues,
  type Currency,
} from '@leadpilot/shared';
import { useQueryClient } from '@tanstack/react-query';
import { LoaderCircle } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api';
import { useAuthClient } from '@/lib/auth/auth-provider';
import { safeNext } from '@/lib/auth/safe-next';
import { finishSignIn, whileSigningIn } from '@/lib/auth/sign-in-flow';
import { applySuggestion, suggestEmailDomain } from '@/lib/email/suggest-domain';
import { formErrors, issuesToFormErrors, type FormErrors } from '@/lib/i18n/errors';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/lib/i18n/locales';
import { useMessage } from '@/lib/i18n/use-message';
import { FormAlert, PasswordField, SelectField, TextField } from './form-parts';

const COUNTRIES = [
  ['US', 1],
  ['GB', 44],
  ['AU', 61],
  ['DE', 49],
  ['VN', 84],
] as const;
const CURRENCIES: Currency[] = ['USD', 'VND'];
const LANGUAGES: Locale[] = ['en', 'vi'];

/** 12 is the rule (`newPasswordSchema`); the bars only show how far along it is. */
const MIN_PASSWORD = 12;
const MAX_PASSWORD = 128;
/** Characters as the schema counts them (an emoji is one, not two). */
const countChars = (text: string) => Array.from(text).length;
function strength(length: number): number {
  if (length === 0) return 0;
  if (length < MIN_PASSWORD || length > MAX_PASSWORD) return 1;
  if (length < 16) return 2;
  if (length < 20) return 3;
  return 4;
}

/**
 * Create a workspace. `next` is where to go afterwards (checked with safeNext);
 * `loginHref` keeps it when moving to Sign in.
 */
export function SignupForm({ next, loginHref }: { next: string | null; loginHref: string }) {
  const t = useTranslations('auth.signup');
  const tHint = useTranslations('emailHint');
  const rawLocale = useLocale();
  const locale: Locale = isLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE;
  const message = useMessage();
  const client = useAuthClient();
  const queryClient = useQueryClient();
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);

  const [name, setName] = useState('');
  const [workspaceName, setWorkspaceName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  // Start from the language the page is in; Vietnam gets its own currency and country.
  const [workspaceLocale, setWorkspaceLocale] = useState<Locale>(locale);
  const [currency, setCurrency] = useState<Currency>(locale === 'vi' ? 'VND' : 'USD');
  const [country, setCountry] = useState<string>(locale === 'vi' ? 'VN' : 'US');
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [errors, setErrors] = useState<FormErrors | null>(null);
  const [busy, setBusy] = useState(false);
  // `busy` is state, so two submit events in the same tick would both see false.
  const sending = useRef(false);

  const countryNames = useMemo(() => new Intl.DisplayNames([locale], { type: 'region' }), [locale]);

  useEffect(() => {
    formRef.current?.querySelector<HTMLElement>('input[name="name"]')?.focus();
  }, []);

  useEffect(() => {
    if (!errors) return;
    const target =
      formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]') ??
      formRef.current?.querySelector<HTMLElement>('[data-form-alert]');
    target?.focus();
  }, [errors]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (sending.current) return;
    const parsed = signupRequestSchema.safeParse({
      name,
      workspaceName,
      email,
      password,
      locale: workspaceLocale,
      currency,
      defaultCountry: country,
    });
    if (!parsed.success) {
      setErrors(issuesToFormErrors(toValidationIssues(parsed.error.issues)));
      return;
    }
    sending.current = true;
    setBusy(true);
    setErrors(null);
    try {
      await whileSigningIn(async () => {
        await client.signup(parsed.data);
        await finishSignIn(client, queryClient, { followWorkspace: true });
      });
      router.replace(safeNext(next));
    } catch (error) {
      if (error instanceof ApiError && error.code === ErrorCode.EMAIL_TAKEN) {
        // The message belongs under the email box, with a way to sign in.
        setErrors({ form: null, fields: { email: { key: 'errors.EMAIL_TAKEN' } } });
      } else {
        setErrors(formErrors(error));
      }
      sending.current = false;
      setBusy(false);
    }
  }

  const field = (key: string) => {
    const ref = errors?.fields[key];
    return ref ? message(ref) : undefined;
  };
  const emailTaken = errors?.fields.email?.key === 'errors.EMAIL_TAKEN';
  const passwordLength = countChars(password);
  const strong = passwordLength >= MIN_PASSWORD && passwordLength <= MAX_PASSWORD;

  return (
    <form
      ref={formRef}
      onSubmit={onSubmit}
      noValidate
      // Never GET: before JavaScript runs, a native submit must not put the password in the URL.
      method="post"
      aria-busy={busy}
      className="mx-auto flex w-full max-w-[400px] flex-col gap-[18px]"
    >
      <div className="flex flex-col gap-1.5">
        <h1 className="text-[26px] leading-8 font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('sub')}</p>
      </div>

      {errors?.form ? <FormAlert>{message(errors.form)}</FormAlert> : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <TextField
          label={t('name')}
          name="name"
          autoComplete="name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          error={field('name')}
        />
        <TextField
          label={t('workspace')}
          name="workspaceName"
          autoComplete="organization"
          value={workspaceName}
          onChange={(event) => setWorkspaceName(event.target.value)}
          error={field('workspaceName')}
        />
      </div>

      <TextField
        label={t('email')}
        name="email"
        type="email"
        autoComplete="username"
        inputMode="email"
        value={email}
        onChange={(event) => {
          setEmail(event.target.value);
          // A suggestion belongs to the address it was made for, and "already has an
          // account" to the address that was sent.
          setSuggestion(null);
          setErrors((current) =>
            current?.fields.email?.key === 'errors.EMAIL_TAKEN' ? null : current,
          );
        }}
        // When they leave the box: a likely typo of a common provider gets a one-click fix.
        onBlur={() => setSuggestion(suggestEmailDomain(email))}
        error={field('email')}
        // Room for the hint is always kept, so showing it never moves the button under the mouse.
        hintSpace
        hint={
          suggestion || emailTaken ? (
            <span className="flex flex-wrap items-center gap-x-3">
              {suggestion ? (
                <span role="status" className="flex flex-wrap items-center gap-x-2">
                  <span>{tHint('didYouMean', { suggestion })}</span>
                  <button
                    type="button"
                    className="font-medium text-accent-text hover:underline"
                    onClick={() => {
                      setEmail(applySuggestion(email, suggestion));
                      setSuggestion(null);
                      // The button disappears: keep the cursor in the form.
                      formRef.current?.querySelector<HTMLElement>('input[name="email"]')?.focus();
                    }}
                  >
                    {tHint('apply', { suggestion })}
                  </button>
                </span>
              ) : null}
              {emailTaken ? (
                <Link href={loginHref} className="font-medium text-accent-text hover:underline">
                  {t('signInInstead')}
                </Link>
              ) : null}
            </span>
          ) : undefined
        }
      />

      <div className="flex flex-col gap-2">
        <PasswordField
          label={t('password')}
          name="password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          error={field('password')}
          hint={
            passwordLength > MAX_PASSWORD
              ? t('passwordTooLong')
              : strong
                ? t('passwordGood')
                : t('passwordHint')
          }
        />
        <div aria-hidden className="flex gap-1">
          {[1, 2, 3, 4].map((bar) => (
            <span
              key={bar}
              className={
                bar <= strength(passwordLength)
                  ? 'h-[3px] flex-1 rounded-full bg-primary'
                  : 'h-[3px] flex-1 rounded-full bg-track'
              }
            />
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <SelectField
          label={t('language')}
          name="locale"
          value={workspaceLocale}
          onChange={(event) => setWorkspaceLocale(event.target.value as Locale)}
          error={field('locale')}
        >
          {LANGUAGES.map((code) => (
            <option key={code} value={code} lang={code}>
              {t(`languages.${code}`)}
            </option>
          ))}
        </SelectField>
        <SelectField
          label={t('currency')}
          name="currency"
          value={currency}
          onChange={(event) => setCurrency(event.target.value as Currency)}
          error={field('currency')}
        >
          {CURRENCIES.map((code) => (
            <option key={code} value={code}>
              {t(`currencies.${code}`)}
            </option>
          ))}
        </SelectField>
      </div>

      <SelectField
        label={t('country')}
        name="defaultCountry"
        value={country}
        onChange={(event) => setCountry(event.target.value)}
        error={field('defaultCountry')}
      >
        {COUNTRIES.map(([code, dial]) => (
          <option key={code} value={code}>
            {`${countryNames.of(code) ?? code} (+${dial})`}
          </option>
        ))}
      </SelectField>

      <Button type="submit" size="lg" disabled={busy}>
        {busy ? (
          <>
            <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden />
            {t('submitting')}
          </>
        ) : (
          t('submit')
        )}
      </Button>
      <p className="text-xs leading-4 text-muted-foreground">{t('agree')}</p>
      <p className="text-center text-sm text-muted-foreground">
        {t('have')}{' '}
        <Link href={loginHref} className="text-accent-text underline underline-offset-4">
          {t('signIn')}
        </Link>
      </p>
    </form>
  );
}
