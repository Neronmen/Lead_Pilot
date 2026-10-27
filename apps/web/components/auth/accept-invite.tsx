'use client';

import {
  ErrorCode,
  invitePreviewResponseSchema,
  newAccountSchema,
  passwordSchema,
  toValidationIssues,
  type InvitePreviewResponse,
} from '@leadpilot/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleAlert, LoaderCircle } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api';
import { useAuthClient } from '@/lib/auth/auth-provider';
import { finishSignIn, whileSigningIn } from '@/lib/auth/sign-in-flow';
import { formErrors, issuesToFormErrors, type FormErrors } from '@/lib/i18n/errors';
import { useMessage } from '@/lib/i18n/use-message';
import {
  forgetInviteToken,
  inviteGeneration,
  readInviteToken,
  serverInviteToken,
  subscribeInviteToken,
} from '@/lib/invite/token';
import { initials } from '@/lib/shell';
import { cn } from '@/lib/utils';
import { FormAlert, PasswordField, TextField } from './form-parts';

const previewKey = (generation: number) => ['invite-preview', generation] as const;
const CARD =
  'flex w-full max-w-[440px] flex-col gap-5 rounded-2xl border border-border bg-card p-8';

/**
 * The Accept invite page. The token is read from the address fragment once
 * (lib/invite/token.ts), which also removes it from the address bar. Until the
 * browser has read it we know nothing (`undefined`: the same loading card the
 * server renders); `null` means the link carried no usable token.
 */
export function AcceptInvite() {
  const token = useSyncExternalStore(subscribeInviteToken, readInviteToken, serverInviteToken);
  // Which link this is (not secret): a new link pasted into the tab starts afresh.
  const generation = useSyncExternalStore(subscribeInviteToken, inviteGeneration, () => 0);
  // Accepted: the app is about to open. Hold a calm card instead of flashing "no longer works".
  const [accepted, setAccepted] = useState(false);
  if (accepted || token === undefined) return <LoadingCard />;
  if (token === null) return <InvalidCard />;
  return (
    <InviteFlow
      key={generation}
      token={token}
      generation={generation}
      onAccepted={() => {
        setAccepted(true);
        forgetInviteToken();
      }}
    />
  );
}

function InviteFlow({
  token,
  generation,
  onAccepted,
}: {
  token: string;
  generation: number;
  onAccepted: () => void;
}) {
  const client = useAuthClient();
  const message = useMessage();
  const tCommon = useTranslations('common');
  const queryClient = useQueryClient();
  const [invalid, setInvalid] = useState<{ tooMany: boolean } | null>(null);
  const [appeared, setAppeared] = useState(false);

  const preview = useQuery<InvitePreviewResponse>({
    queryKey: previewKey(generation),
    // The token travels in the body of this one request, never in the key or the address.
    queryFn: () =>
      client.request('/auth/invites/preview', {
        method: 'POST',
        body: { token },
        schema: invitePreviewResponseSchema,
        anonymous: true,
      }),
    staleTime: Infinity,
    // Fail at once and offer "Try again", rather than leave a loading card up while retrying.
    retry: false,
  });

  if (invalid) return <InvalidCard tooMany={invalid.tooMany} />;
  if (preview.isPending) return <LoadingCard />;
  if (preview.isError) {
    if (preview.error instanceof ApiError && preview.error.code === ErrorCode.INVITE_INVALID) {
      return <InvalidCard />;
    }
    return (
      <div className={CARD}>
        <h1 className="text-xl font-semibold tracking-tight">{tCommon('errorTitle')}</h1>
        <FormAlert>
          {message(formErrors(preview.error).form ?? { key: 'errors.UNKNOWN' })}
        </FormAlert>
        <Button variant="outline" onClick={() => void preview.refetch()}>
          {tCommon('tryAgain')}
        </Button>
      </div>
    );
  }
  return (
    <InviteForm
      key={preview.data.accountExists ? 'existing' : 'new'}
      token={token}
      preview={preview.data}
      appeared={appeared}
      onInvalid={(state) => {
        // The server will not take this token again: do not keep it. (Quietly: this card
        // stays up and knows why, so nothing needs to re-render.)
        forgetInviteToken({ quiet: true });
        setInvalid(state);
      }}
      onAccepted={onAccepted}
      onAccountAppeared={() => {
        setAppeared(true);
        void queryClient.invalidateQueries({ queryKey: previewKey(generation) });
      }}
    />
  );
}

function InviteForm({
  token,
  preview,
  appeared,
  onInvalid,
  onAccepted,
  onAccountAppeared,
}: {
  token: string;
  preview: InvitePreviewResponse;
  appeared: boolean;
  onInvalid: (state: { tooMany: boolean }) => void;
  onAccepted: () => void;
  onAccountAppeared: () => void;
}) {
  const t = useTranslations('auth.invite');
  const roles = useTranslations('shell.roles');
  const format = useFormatter();
  const message = useMessage();
  const client = useAuthClient();
  const queryClient = useQueryClient();
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const sending = useRef(false);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<FormErrors | null>(null);
  const [wrongPassword, setWrongPassword] = useState(0);
  const [busy, setBusy] = useState(false);
  const existing = preview.accountExists;

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
    // The same rules the API applies once it knows which case this is.
    const parsed = existing
      ? passwordSchema.safeParse(password)
      : newAccountSchema.safeParse({ name, password });
    if (!parsed.success) {
      const issues = toValidationIssues(parsed.error.issues).map((issue) => ({
        ...issue,
        path: existing ? 'password' : issue.path,
      }));
      setErrors(issuesToFormErrors(issues));
      return;
    }
    sending.current = true;
    setBusy(true);
    setErrors(null);
    try {
      await whileSigningIn(async () => {
        await client.acceptInvite(existing ? { token, password } : { token, name, password });
        // Someone may already be signed in here (as another person, or in another
        // workspace): none of what was cached for them may show for the new session.
        queryClient.clear();
        await finishSignIn(client, queryClient);
      });
      onAccepted();
      router.replace('/leads');
    } catch (error) {
      sending.current = false;
      setBusy(false);
      if (error instanceof ApiError && error.code === ErrorCode.INVITE_INVALID) {
        // An approximation: after a wrong password the likely reason is the 5-try limit.
        onInvalid({ tooMany: wrongPassword > 0 });
      } else if (error instanceof ApiError && error.code === ErrorCode.EMAIL_TAKEN) {
        // An account was created for this address after the page loaded: ask again,
        // and the form turns into "enter your password".
        setPassword('');
        onAccountAppeared();
      } else if (error instanceof ApiError && error.code === ErrorCode.AUTH_INVALID_CREDENTIALS) {
        setWrongPassword((count) => count + 1);
        setErrors({ form: null, fields: { password: { key: 'auth.invite.wrongPassword' } } });
      } else {
        setErrors(formErrors(error));
      }
    }
  }

  const field = (key: string) => {
    const ref = errors?.fields[key];
    return ref ? message(ref) : undefined;
  };
  const role = preview.role;

  return (
    <form
      ref={formRef}
      onSubmit={onSubmit}
      noValidate
      // Not GET: a native submit before JavaScript runs must not put the password in the
      // URL. (It is POSTed to this page instead, which has no handler and just shows the
      // page again: the form is only usable once the page has loaded.)
      method="post"
      aria-busy={busy}
      className={CARD}
    >
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className="inline-flex size-11 items-center justify-center rounded-[10px] border border-border-strong bg-raised font-mono text-sm font-semibold"
        >
          {initials(preview.workspaceName)}
        </span>
        <span className="flex flex-col gap-0.5">
          <span className="text-[13px] font-semibold text-accent-text">{t('invitation')}</span>
          {preview.inviterName ? (
            <span className="text-[13px] text-muted-foreground">
              {t('from', { name: preview.inviterName })}
            </span>
          ) : null}
        </span>
      </div>

      <div className="flex flex-col gap-1.5">
        <h1 className="text-2xl leading-[30px] font-semibold tracking-tight">
          {t('title', { workspace: preview.workspaceName })}
        </h1>
        <p className="text-sm leading-5 text-muted-foreground">
          {t('joiningAs')}{' '}
          <span className="rounded-md border border-border-strong bg-raised px-2 py-px text-xs font-medium text-foreground">
            {roles(role)}
          </span>
          {'. '}
          {t(`roleHelp.${role}`)}
        </p>
      </div>

      {appeared ? <FormAlert>{t('accountAppeared')}</FormAlert> : null}
      {errors?.form ? <FormAlert>{message(errors.form)}</FormAlert> : null}

      <TextField
        label={t('email')}
        name="email"
        type="email"
        value={preview.email}
        readOnly
        autoComplete="username"
        hint={t('emailHint')}
        className="bg-raised text-muted-foreground"
      />
      {existing ? null : (
        <TextField
          label={t('name')}
          name="name"
          autoComplete="name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          error={field('name')}
        />
      )}
      <PasswordField
        label={existing ? t('existingPassword') : t('newPassword')}
        name="password"
        autoComplete={existing ? 'current-password' : 'new-password'}
        placeholder={existing ? undefined : t('newPasswordPlaceholder')}
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        error={field('password')}
        hint={existing ? (wrongPassword > 0 ? t('attemptsNote') : t('existingNote')) : undefined}
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

      <div className="flex flex-wrap justify-between gap-x-3 gap-y-2 text-[13px] text-muted-foreground">
        <span>
          {t('expires', { when: format.relativeTime(new Date(preview.expiresAt), new Date()) })}
        </span>
        <span>
          {t('have')}{' '}
          <Link href="/login" className="text-accent-text underline underline-offset-4">
            {t('signIn')}
          </Link>
        </span>
      </div>
    </form>
  );
}

function LoadingCard() {
  const t = useTranslations('auth.invite');
  return (
    <div role="status" className={cn(CARD, 'animate-pulse motion-reduce:animate-none')}>
      <span className="sr-only">{t('loading')}</span>
      <div className="flex items-center gap-3">
        <span className="size-11 rounded-[10px] bg-skeleton" />
        <span className="flex flex-col gap-2">
          <span className="h-3 w-24 rounded bg-skeleton" />
          <span className="h-3 w-32 rounded bg-skeleton" />
        </span>
      </div>
      <span className="h-7 w-3/4 rounded bg-skeleton" />
      <span className="h-16 rounded bg-skeleton" />
      <span className="h-11 rounded-[9px] bg-skeleton" />
      <span className="h-11 rounded-[9px] bg-skeleton" />
    </div>
  );
}

/** The link is no good (expired, cancelled, used, too many wrong passwords, or no token at all). */
function InvalidCard({ tooMany = false }: { tooMany?: boolean }) {
  const t = useTranslations('auth.invite');
  return (
    <section
      role="alert"
      className="flex w-full max-w-[440px] gap-3 rounded-xl border border-danger-line bg-danger-bg p-4"
    >
      <CircleAlert className="mt-px size-[18px] shrink-0 text-danger" aria-hidden />
      <div className="flex flex-col gap-1.5">
        <h1 className="text-sm font-semibold text-danger-text">{t('invalidTitle')}</h1>
        <p className="text-[13px] leading-[18px] text-muted-foreground">{t('invalidBody')}</p>
        {tooMany ? (
          <p className="text-[13px] leading-[18px] text-muted-foreground">{t('invalidTooMany')}</p>
        ) : null}
        <Link href="/login" className="text-[13px] text-accent-text underline underline-offset-4">
          {t('invalidSignIn')}
        </Link>
      </div>
    </section>
  );
}
