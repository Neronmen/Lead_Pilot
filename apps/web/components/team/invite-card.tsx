'use client';

import {
  emailSchema,
  type AssignableRole,
  type InviteResultStatus,
  type Role,
} from '@leadpilot/shared';
import { LoaderCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent, type Ref } from 'react';
import { FormAlert, SelectField, TextField } from '@/components/auth/form-parts';
import { Button } from '@/components/ui/button';
import { applySuggestion, suggestEmailDomain } from '@/lib/email/suggest-domain';
import { useTeamActions } from '@/lib/team/use-team';
import { assignableRoles, parseEmails } from '@/lib/team/rules';
import { type Notice, useFailureNotice } from './team-notice';

const MAX_AT_ONCE = 20;
const ROLE_HELP = ['OWNER', 'ADMIN', 'MEMBER'] as const;

/**
 * "Invite people": addresses, a role, Send. The checks are the ones the API
 * applies (the shared email rules, 20 at a time), so a typo is pointed out
 * before anything is sent; a typo of a common provider also gets a one-click fix.
 */
export function InviteCard({
  viewer,
  inputRef,
  onNotice,
}: {
  viewer: Role;
  inputRef: Ref<HTMLInputElement>;
  onNotice: (notice: Notice | null) => void;
}) {
  const t = useTranslations('team');
  const tHint = useTranslations('emailHint');
  const tRoles = useTranslations('shell.roles');
  const failure = useFailureNotice();
  const { invite } = useTeamActions();
  const roles = assignableRoles(viewer);
  const [text, setText] = useState('');
  const [role, setRole] = useState<AssignableRole>('MEMBER');
  const [problem, setProblem] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<{ address: string; suggestion: string }[]>([]);
  const [results, setResults] = useState<{ email: string; status: InviteResultStatus }[]>([]);

  function findTypos(value: string) {
    setSuggestions(
      parseEmails(value).flatMap((address) => {
        const suggestion = suggestEmailDomain(address);
        return suggestion ? [{ address, suggestion }] : [];
      }),
    );
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (invite.isPending) return;
    onNotice(null);
    setResults([]);
    const addresses = parseEmails(text);
    if (addresses.length === 0) return setProblem(t('invite.none'));
    if (addresses.length > MAX_AT_ONCE)
      return setProblem(t('invite.tooMany', { max: MAX_AT_ONCE }));
    const bad = addresses.filter((address) => !emailSchema.safeParse(address).success);
    if (bad.length > 0) return setProblem(t('invite.invalid', { list: bad.join(', ') }));
    setProblem(null);
    try {
      const done = await invite.mutateAsync({ emails: addresses, role });
      setResults(done.results);
      setText('');
      setSuggestions([]);
    } catch (error) {
      onNotice(failure(error));
    }
  }

  return (
    <section
      aria-labelledby="team-invite"
      className="flex flex-col gap-2.5 rounded-xl border border-border bg-card px-[18px] py-4"
    >
      <h2 id="team-invite" className="text-[15px] leading-[22px] font-semibold">
        {t('invite.title')}
      </h2>
      <form onSubmit={onSubmit} noValidate className="flex flex-wrap items-start gap-2">
        <div className="min-w-[260px] flex-1">
          <TextField
            ref={inputRef}
            label={t('invite.emails')}
            name="emails"
            autoComplete="off"
            placeholder={t('invite.placeholder')}
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              setSuggestions([]);
              setProblem(null);
            }}
            onBlur={() => findTypos(text)}
            error={problem ?? undefined}
          />
        </div>
        <div className="w-[160px]">
          <SelectField
            label={t('invite.as')}
            name="role"
            value={role}
            onChange={(event) => setRole(event.target.value as AssignableRole)}
          >
            {roles.map((value) => (
              <option key={value} value={value}>
                {tRoles(value)}
              </option>
            ))}
          </SelectField>
        </div>
        <Button type="submit" className="mt-[26px] h-11" disabled={invite.isPending}>
          {invite.isPending ? (
            <>
              <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden />
              {t('invite.sending')}
            </>
          ) : (
            t('invite.send')
          )}
        </Button>
      </form>

      {suggestions.length > 0 ? (
        <ul className="flex flex-col gap-1 text-xs text-muted-foreground" role="status">
          {suggestions.map(({ address, suggestion }) => (
            <li key={address} className="flex flex-wrap items-center gap-x-2">
              <span>{tHint('didYouMean', { suggestion })}</span>
              <button
                type="button"
                className="font-medium text-accent-text underline underline-offset-4"
                onClick={() => {
                  // The typed text may use capitals ("Bob@Gmial.com"): match without case.
                  setText((current) => {
                    const at = current.toLowerCase().indexOf(address);
                    return at < 0
                      ? current
                      : current.slice(0, at) +
                          applySuggestion(address, suggestion) +
                          current.slice(at + address.length);
                  });
                  setSuggestions((current) => current.filter((item) => item.address !== address));
                }}
              >
                {tHint('apply', { suggestion })}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {results.length > 0 ? (
        <ul role="status" className="flex flex-col gap-1 text-[13px]">
          {results.map(({ email, status }) =>
            status === 'email_failed' ? (
              <li key={email}>
                <FormAlert>{t(`results.${status}`, { email })}</FormAlert>
              </li>
            ) : (
              <li key={email} className="text-muted-foreground">
                {t(`results.${status}`, { email })}
              </li>
            ),
          )}
        </ul>
      ) : null}

      <ul className="mt-1 grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-2">
        {ROLE_HELP.map((value) => (
          <li key={value} className="flex flex-col gap-0.5 rounded-[9px] bg-raised px-3 py-2.5">
            <span className="text-[13px] font-semibold">{tRoles(value)}</span>
            <span className="text-xs leading-[17px] text-muted-foreground">
              {t(`roleHelp.${value}`)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
