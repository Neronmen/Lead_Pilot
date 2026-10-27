'use client';

import { loginRequestSchema, toValidationIssues } from '@leadpilot/shared';
import { useQueryClient } from '@tanstack/react-query';
import { LoaderCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { useAuthClient } from '@/lib/auth/auth-provider';
import { safeNext } from '@/lib/auth/safe-next';
import { finishSignIn, whileSigningIn } from '@/lib/auth/sign-in-flow';
import { formErrors, issuesToFormErrors, type FormErrors } from '@/lib/i18n/errors';
import { useMessage } from '@/lib/i18n/use-message';
import { FormAlert, PasswordField, TextField } from './form-parts';

/**
 * The sign-in form. `next` is where to go afterwards (checked with safeNext,
 * so a crafted link cannot send anyone to another site); `signupHref` keeps it
 * when moving to Create a workspace.
 */
export function LoginForm({ next, signupHref }: { next: string | null; signupHref: string }) {
  const t = useTranslations('auth.login');
  const message = useMessage();
  const client = useAuthClient();
  const queryClient = useQueryClient();
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<FormErrors | null>(null);
  const [busy, setBusy] = useState(false);

  // The cursor starts in the email box. (`autoFocus` is lost here: the page renders
  // the form twice while it checks the session, and the first copy is thrown away.)
  useEffect(() => {
    formRef.current?.querySelector<HTMLElement>('input[name="email"]')?.focus();
  }, []);

  // After a failed attempt, put the cursor on the first field with a problem, or on
  // the message about the whole form.
  useEffect(() => {
    if (!errors) return;
    const target =
      formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]') ??
      formRef.current?.querySelector<HTMLElement>('[data-form-alert]');
    target?.focus();
  }, [errors]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    // The same rules as the API, so an empty field is explained at once.
    const parsed = loginRequestSchema.safeParse({ email, password });
    if (!parsed.success) {
      setErrors(issuesToFormErrors(toValidationIssues(parsed.error.issues)));
      return;
    }
    setBusy(true);
    setErrors(null);
    try {
      await whileSigningIn(async () => {
        await client.login(parsed.data);
        await finishSignIn(client, queryClient);
      });
      router.replace(safeNext(next));
    } catch (error) {
      setErrors(formErrors(error));
      setBusy(false);
    }
  }

  const field = (name: string) => {
    const ref = errors?.fields[name];
    return ref ? message(ref) : undefined;
  };

  return (
    <form
      ref={formRef}
      onSubmit={onSubmit}
      noValidate
      // Never GET: before JavaScript runs, a native submit must not put the password in the URL.
      method="post"
      aria-busy={busy}
      className="mx-auto flex w-full max-w-[380px] flex-col gap-5"
    >
      <div className="flex flex-col gap-1.5">
        <h1 className="text-[26px] leading-8 font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('sub')}</p>
      </div>

      {errors?.form ? <FormAlert>{message(errors.form)}</FormAlert> : null}

      <TextField
        label={t('email')}
        name="email"
        type="email"
        autoComplete="username"
        inputMode="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        error={field('email')}
      />
      <PasswordField
        label={t('password')}
        name="password"
        autoComplete="current-password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        error={field('password')}
      />

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

      <p className="text-center text-sm text-muted-foreground">
        {t('newHere')}{' '}
        <Link href={signupHref} className="text-accent-text hover:underline">
          {t('create')}
        </Link>
      </p>
    </form>
  );
}
