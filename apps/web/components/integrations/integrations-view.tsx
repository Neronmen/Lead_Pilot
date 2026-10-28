'use client';

import type { CreateIntegrationRequest, Integration } from '@leadpilot/shared';
import { CircleAlert, CircleCheck, Mail, PauseCircle } from 'lucide-react';
import { useFormatter, useNow, useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { TextField } from '@/components/auth/form-parts';
import { CopyBox } from '@/components/sources/copy-box';
import { SourcesNotice, useFailureNotice, type Notice } from '@/components/sources/sources-notice';
import { ErrorState } from '@/components/state-views';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useIntegrationActions, useIntegrations } from '@/lib/routing/use-routing';
import { cn } from '@/lib/utils';

/** The tools a rule can send to. Email is built in and has no card of its own to connect. */
const TYPES = ['SLACK', 'TELEGRAM', 'WEBHOOK', 'HUBSPOT'] as const;
type Connectable = (typeof TYPES)[number];

/** A short code from the API, as a reason a person can act on. */
export type ProblemKey =
  | 'refused'
  | 'notFound'
  | 'server'
  | 'timeout'
  | 'network'
  | 'redirect'
  | 'address'
  | 'config'
  | 'recipient'
  | 'emailFailed'
  | 'off'
  | 'memberGone'
  | 'other';

export function errorCodeKey(code: string): ProblemKey {
  if (code === 'http_401' || code === 'http_403') return 'refused';
  if (code === 'http_404') return 'notFound';
  if (code.startsWith('http_5')) return 'server';
  if (code === 'timeout' || code === 'network' || code === 'redirect') return code;
  if (code === 'url_not_allowed') return 'address';
  if (code === 'bad_config') return 'config';
  if (code === 'no_recipient') return 'recipient';
  if (code === 'email_failed') return 'emailFailed';
  if (code === 'integration_disabled') return 'off';
  if (code === 'member_gone') return 'memberGone';
  return 'other';
}

/** Settings > Integrations (Owner and Admin only: the Settings frame keeps everyone else out). */
export function IntegrationsView() {
  const t = useTranslations('integrations');
  const integrations = useIntegrations();
  const [notice, setNotice] = useState<Notice | null>(null);

  if (integrations.isPending) return <IntegrationsSkeleton />;
  if (integrations.isError) {
    return (
      <section className="rounded-xl border border-border bg-card">
        <ErrorState title={t('loadTitle')} body={t('loadBody')}>
          <Button variant="outline" onClick={() => void integrations.refetch()}>
            {t('retry')}
          </Button>
        </ErrorState>
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {notice ? (
        <SourcesNotice
          notice={notice}
          onReload={() => {
            setNotice(null);
            void integrations.refetch();
          }}
          onDismiss={() => setNotice(null)}
        />
      ) : null}
      <section className="flex items-start gap-3 rounded-xl border border-border bg-card px-[18px] py-4">
        <Mail className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] leading-[22px] font-semibold">{t('email.title')}</h2>
          <p className="text-[13px] text-muted-foreground">{t('email.body')}</p>
        </div>
        <Badge variant="outline">{t('email.always')}</Badge>
      </section>
      {TYPES.map((type) => (
        <TypeSection
          key={type}
          type={type}
          rows={integrations.data.filter((row) => row.type === type)}
          onNotice={setNotice}
        />
      ))}
    </div>
  );
}

function TypeSection({
  type,
  rows,
  onNotice,
}: {
  type: Connectable;
  rows: Integration[];
  onNotice: (notice: Notice | null) => void;
}) {
  const t = useTranslations('integrations');
  const [connecting, setConnecting] = useState(false);
  return (
    <section
      aria-labelledby={`int-${type}`}
      className="flex flex-col gap-3 rounded-xl border border-border bg-card px-[18px] py-4"
    >
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <h2 id={`int-${type}`} className="text-[15px] leading-[22px] font-semibold">
            {t(`type.${type}.title`)}
          </h2>
          <p className="text-[13px] text-muted-foreground">{t(`type.${type}.body`)}</p>
        </div>
        {connecting ? null : (
          <Button size="sm" variant="outline" onClick={() => setConnecting(true)}>
            {t('connect')}
          </Button>
        )}
      </div>
      {connecting ? (
        <ConnectForm type={type} onClose={() => setConnecting(false)} onNotice={onNotice} />
      ) : null}
      {rows.length === 0 && !connecting ? (
        <p className="text-[13px] text-muted-foreground">{t('none')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => (
            <IntegrationRow key={row.id} row={row} onNotice={onNotice} />
          ))}
        </ul>
      )}
    </section>
  );
}

function StatusBadge({ row }: { row: Integration }) {
  const t = useTranslations('integrations');
  if (row.status === 'needs_attention') {
    return (
      <Badge variant="destructive">
        <CircleAlert aria-hidden />
        {t('status.needs_attention')}
      </Badge>
    );
  }
  if (row.status === 'paused') {
    return (
      <Badge variant="outline">
        <PauseCircle aria-hidden />
        {t('status.paused')}
      </Badge>
    );
  }
  return (
    <Badge variant="secondary">
      <CircleCheck aria-hidden />
      {t('status.connected')}
    </Badge>
  );
}

function IntegrationRow({
  row,
  onNotice,
}: {
  row: Integration;
  onNotice: (notice: Notice | null) => void;
}) {
  const t = useTranslations('integrations');
  const format = useFormatter();
  const now = useNow();
  const failure = useFailureNotice();
  const { update, remove, test } = useIntegrationActions();
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; error: string | null } | null>(null);
  const busy = update.isPending || remove.isPending || test.isPending;
  const testReason = errorCodeKey(result?.error ?? '');
  const lastReason = errorCodeKey(row.lastError ?? '');

  async function run(action: () => Promise<unknown>) {
    onNotice(null);
    try {
      await action();
      setConfirming(false);
    } catch (error) {
      onNotice(failure(error));
    }
  }

  async function sendTest() {
    setResult(null);
    await run(async () => setResult(await test.mutateAsync(row.id)));
  }

  return (
    <li className="flex flex-col gap-2 rounded-lg border border-border bg-raised px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{row.name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {[
              row.summary,
              row.lastTestedAt
                ? t('testedAt', {
                    when: format.relativeTime(new Date(row.lastTestedAt), now),
                  })
                : t('neverTested'),
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        <StatusBadge row={row} />
        {confirming ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px]">{t('disconnectAsk', { name: row.name })}</span>
            <Button
              size="sm"
              variant="destructive"
              disabled={busy}
              onClick={() => void run(() => remove.mutateAsync(row.id))}
            >
              {t('disconnectYes')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
              {t('cancel')}
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void sendTest()}>
              {t('sendTest')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() =>
                void run(() => update.mutateAsync({ id: row.id, enabled: !row.enabled }))
              }
            >
              {row.enabled ? t('switchOff') : t('switchOn')}
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirming(true)}>
              {t('disconnect')}
            </Button>
          </div>
        )}
      </div>
      {result ? (
        <p
          role="status"
          className={cn('text-[13px]', result.ok ? 'text-accent-text' : 'text-danger-text')}
        >
          {result.ok ? t('testOk') : t(`problem.${testReason}`)}
        </p>
      ) : row.status === 'needs_attention' && row.lastError ? (
        <p className="text-[13px] text-danger-text">{t(`problem.${lastReason}`)}</p>
      ) : null}
    </li>
  );
}

/** The fields to fill in, per tool. Secrets are password fields and never shown again. */
function ConnectForm({
  type,
  onClose,
  onNotice,
}: {
  type: Connectable;
  onClose: () => void;
  onNotice: (notice: Notice | null) => void;
}) {
  const t = useTranslations('integrations');
  const failure = useFailureNotice();
  const { create } = useIntegrationActions();
  const [name, setName] = useState('');
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [missing, setMissing] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);

  function request(): CreateIntegrationRequest | null {
    const label = name.trim();
    if (!label) return null;
    switch (type) {
      case 'SLACK':
        return a.trim() ? { type, name: label, config: { webhookUrl: a.trim() } } : null;
      case 'TELEGRAM':
        return a.trim() && b.trim()
          ? { type, name: label, config: { botToken: a.trim(), chatId: b.trim() } }
          : null;
      case 'WEBHOOK':
        return a.trim() ? { type, name: label, config: { url: a.trim() } } : null;
      case 'HUBSPOT':
        return a.trim() ? { type, name: label, config: { token: a.trim() } } : null;
    }
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (create.isPending) return;
    onNotice(null);
    const body = request();
    if (!body) return setMissing(true);
    setMissing(false);
    try {
      const made = await create.mutateAsync(body);
      if (made.signingSecret) setSecret(made.signingSecret);
      else onClose();
    } catch (error) {
      onNotice(failure(error));
    }
  }

  if (secret) {
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-accent-line bg-raised p-3">
        <p className="text-sm font-medium">{t('secret.title')}</p>
        <p className="text-[13px] text-muted-foreground">{t('secret.body')}</p>
        <CopyBox value={secret} label={t('secret.label')} />
        <div>
          <Button size="sm" onClick={onClose}>
            {t('secret.done')}
          </Button>
        </div>
      </div>
    );
  }

  const firstLabel =
    type === 'SLACK'
      ? t('field.slackUrl')
      : type === 'TELEGRAM'
        ? t('field.botToken')
        : type === 'WEBHOOK'
          ? t('field.webhookUrl')
          : t('field.hubspotToken');

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className="flex flex-col gap-3 rounded-lg border border-accent-line bg-raised p-3"
    >
      <TextField
        label={t('field.name')}
        value={name}
        maxLength={100}
        autoComplete="off"
        autoFocus
        onChange={(event) => setName(event.target.value)}
      />
      <TextField
        label={firstLabel}
        value={a}
        // The address of a Slack or webhook is a secret too (it carries a token): mask all of them.
        type="password"
        autoComplete="new-password"
        hint={t(`hint.${type}`)}
        onChange={(event) => setA(event.target.value)}
      />
      {type === 'TELEGRAM' ? (
        <TextField
          label={t('field.chatId')}
          value={b}
          autoComplete="off"
          onChange={(event) => setB(event.target.value)}
        />
      ) : null}
      {missing ? (
        <p role="alert" className="text-[13px] text-danger-text">
          {t('missing')}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={create.isPending}>
          {t('connectSubmit')}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onClose}>
          {t('cancel')}
        </Button>
      </div>
    </form>
  );
}

function IntegrationsSkeleton() {
  const t = useTranslations('integrations');
  return (
    <div className="flex flex-col gap-4" role="status" aria-label={t('loading')}>
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-24 w-full rounded-xl" />
      ))}
    </div>
  );
}
