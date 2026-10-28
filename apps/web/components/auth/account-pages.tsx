'use client';

import { ErrorCode, forgotPasswordRequestSchema, newPasswordSchema } from '@leadpilot/shared';
import { CircleAlert, CircleCheck, LoaderCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type ReactNode,
} from 'react';
import { Button, buttonVariants } from '@/components/ui/button';
import { ApiError } from '@/lib/api';
import { useAuthClient } from '@/lib/auth/auth-provider';
import { fragmentTokenSnapshot, subscribeFragmentToken } from '@/lib/auth/fragment-token';
import { formErrors } from '@/lib/i18n/errors';
import { useMessage } from '@/lib/i18n/use-message';
import { cn } from '@/lib/utils';
import { FormAlert, PasswordField, TextField } from './form-parts';

const CARD =
  'flex w-full max-w-[420px] flex-col gap-5 rounded-2xl border border-border bg-card p-8';

function Card({ children, label }: { children: ReactNode; label: string }) {
  return (
    <section aria-label={label} className={CARD}>
      {children}
    </section>
  );
}

/** "Forgot your password?": the answer is the same whether or not the address has an account. */
export function ForgotPasswordForm() {
  const t = useTranslations('auth.account');
  const message = useMessage();
  const client = useAuthClient();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const parsed = forgotPasswordRequestSchema.safeParse({ email });
    if (!parsed.success) return setError(t('forgot.emailInvalid'));
    setBusy(true);
    setError(null);
    try {
      await client.request('/auth/forgot-password', {
        method: 'POST',
        body: parsed.data,
        anonymous: true,
      });
      setSentTo(parsed.data.email);
    } catch (caught) {
      const form = formErrors(caught).form;
      setError(form ? message(form) : t('forgot.failed'));
    } finally {
      setBusy(false);
    }
  }

  if (sentTo) {
    return (
      <Card label={t('forgot.title')}>
        <h1 className="text-[22px] leading-7 font-semibold tracking-tight">
          {t('forgot.sentTitle')}
        </h1>
        <p className="text-sm text-muted-foreground">{t('forgot.sentBody', { email: sentTo })}</p>
        <Link href="/login" className={buttonVariants({ variant: 'outline' })}>
          {t('backToLogin')}
        </Link>
      </Card>
    );
  }
  return (
    <form onSubmit={onSubmit} noValidate className={CARD} aria-busy={busy}>
      <div className="flex flex-col gap-1.5">
        <h1 className="text-[22px] leading-7 font-semibold tracking-tight">{t('forgot.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('forgot.sub')}</p>
      </div>
      {error ? <FormAlert>{error}</FormAlert> : null}
      <TextField
        label={t('forgot.email')}
        name="email"
        type="email"
        autoComplete="email"
        inputMode="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
      />
      <Button type="submit" size="lg" disabled={busy}>
        {busy ? (
          <>
            <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden />
            {t('forgot.sending')}
          </>
        ) : (
          t('forgot.submit')
        )}
      </Button>
      <Link
        href="/login"
        className="text-center text-sm text-accent-text underline underline-offset-4"
      >
        {t('backToLogin')}
      </Link>
    </form>
  );
}

/** The token from the email link, read once from the address fragment (undefined: not read yet). */
function useFragmentToken(): string | null | undefined {
  return useSyncExternalStore(subscribeFragmentToken, fragmentTokenSnapshot, () => undefined);
}

function InvalidLink({
  title,
  body,
  children,
}: {
  title: string;
  body: string;
  children: ReactNode;
}) {
  return (
    <Card label={title}>
      <CircleAlert className="size-8 text-danger-text" aria-hidden />
      <h1 className="text-[22px] leading-7 font-semibold tracking-tight">{title}</h1>
      <p className="text-sm text-muted-foreground">{body}</p>
      {children}
    </Card>
  );
}

/** "Choose a new password", from the link in the reset email. */
export function ResetPasswordForm() {
  const t = useTranslations('auth.account');
  const message = useMessage();
  const client = useAuthClient();
  const token = useFragmentToken();
  const [password, setPassword] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<'form' | 'done' | 'invalid'>('form');
  const sending = useRef(false);

  if (token === undefined) {
    return (
      <Card label={t('loading')}>
        <p role="status" className="text-sm text-muted-foreground">
          {t('loading')}
        </p>
      </Card>
    );
  }
  if (token === null || state === 'invalid') {
    return (
      <InvalidLink title={t('invalid.title')} body={t('invalid.resetBody')}>
        <Link href="/forgot-password" className={buttonVariants()}>
          {t('invalid.requestNew')}
        </Link>
      </InvalidLink>
    );
  }
  if (state === 'done') {
    return (
      <Card label={t('reset.doneTitle')}>
        <CircleCheck className="size-8 text-accent-text" aria-hidden />
        <h1 className="text-[22px] leading-7 font-semibold tracking-tight">
          {t('reset.doneTitle')}
        </h1>
        <p className="text-sm text-muted-foreground">{t('reset.doneBody')}</p>
        <Link href="/login" className={buttonVariants()}>
          {t('reset.signIn')}
        </Link>
      </Card>
    );
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (sending.current) return;
    if (!newPasswordSchema.safeParse(password).success) return setProblem(t('reset.tooShort'));
    sending.current = true;
    setBusy(true);
    setProblem(null);
    try {
      await client.request('/auth/reset-password', {
        method: 'POST',
        body: { token, password },
        anonymous: true,
      });
      setState('done');
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === ErrorCode.AUTH_TOKEN_INVALID) {
        setState('invalid');
      } else {
        const form = formErrors(caught).form;
        setProblem(form ? message(form) : t('reset.failed'));
      }
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className={CARD} aria-busy={busy}>
      <div className="flex flex-col gap-1.5">
        <h1 className="text-[22px] leading-7 font-semibold tracking-tight">{t('reset.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('reset.sub')}</p>
      </div>
      {problem ? <FormAlert>{problem}</FormAlert> : null}
      <PasswordField
        label={t('reset.password')}
        name="password"
        autoComplete="new-password"
        value={password}
        hint={t('reset.hint')}
        onChange={(event) => setPassword(event.target.value)}
      />
      <Button type="submit" size="lg" disabled={busy}>
        {busy ? (
          <>
            <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden />
            {t('reset.saving')}
          </>
        ) : (
          t('reset.submit')
        )}
      </Button>
    </form>
  );
}

/** The page the verification link opens: it confirms the address as soon as it loads. */
export function VerifyEmail() {
  const t = useTranslations('auth.account');
  const client = useAuthClient();
  const token = useFragmentToken();
  const [state, setState] = useState<'working' | 'done' | 'invalid' | 'failed'>('working');
  const started = useRef(false);

  useEffect(() => {
    if (!token || started.current) return;
    started.current = true;
    client
      .request('/auth/verify-email', { method: 'POST', body: { token }, anonymous: true })
      .then(() => setState('done'))
      .catch((caught: unknown) =>
        setState(
          caught instanceof ApiError && caught.code === ErrorCode.AUTH_TOKEN_INVALID
            ? 'invalid'
            : 'failed',
        ),
      );
  }, [client, token]);

  if (token === null || state === 'invalid') {
    return (
      <InvalidLink title={t('invalid.title')} body={t('invalid.verifyBody')}>
        <Link href="/login" className={buttonVariants()}>
          {t('backToLogin')}
        </Link>
      </InvalidLink>
    );
  }
  if (state === 'failed') {
    return (
      <InvalidLink title={t('verify.failedTitle')} body={t('verify.failedBody')}>
        <Link href="/login" className={buttonVariants({ variant: 'outline' })}>
          {t('backToLogin')}
        </Link>
      </InvalidLink>
    );
  }
  if (state === 'done') {
    return (
      <Card label={t('verify.doneTitle')}>
        <CircleCheck className="size-8 text-accent-text" aria-hidden />
        <h1 className="text-[22px] leading-7 font-semibold tracking-tight">
          {t('verify.doneTitle')}
        </h1>
        <p className="text-sm text-muted-foreground">{t('verify.doneBody')}</p>
        <Link href="/overview" className={cn(buttonVariants())}>
          {t('verify.open')}
        </Link>
      </Card>
    );
  }
  return (
    <Card label={t('verify.working')}>
      <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
        <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
        {t('verify.working')}
      </p>
    </Card>
  );
}
