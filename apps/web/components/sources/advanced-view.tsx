'use client';

import type { Source } from '@leadpilot/shared';
import { LoaderCircle, TerminalSquare } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState } from 'react';
import { ErrorState, StateView } from '@/components/state-views';
import { Button, buttonVariants } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { API_URL } from '@/lib/api';
import { ingestUrl } from '@/lib/sources/status';
import { useSourceActions, useSources } from '@/lib/sources/use-sources';
import { cn } from '@/lib/utils';
import { CodeBlock, CopyBox } from './copy-box';
import { SourcesNotice, useFailureNotice, type Notice } from './sources-notice';

/** Settings > Advanced / Developer: addresses, API keys and request signing, per source. */
export function AdvancedView() {
  const t = useTranslations('advanced');
  const sources = useSources();
  const [notice, setNotice] = useState<Notice | null>(null);

  if (sources.isPending) return <AdvancedSkeleton />;
  if (sources.isError) {
    return (
      <section className="rounded-xl border border-border bg-card">
        <ErrorState title={t('loadTitle')} body={t('loadBody')}>
          <Button variant="outline" onClick={() => void sources.refetch()}>
            {t('retry')}
          </Button>
        </ErrorState>
      </section>
    );
  }
  if (sources.data.length === 0) {
    return (
      <section className="rounded-xl border border-border bg-card">
        <StateView
          icon={TerminalSquare}
          tone="accent"
          title={t('empty.title')}
          body={t('empty.body')}
        >
          <Link href="/settings/sources" className={cn(buttonVariants())}>
            {t('empty.cta')}
          </Link>
        </StateView>
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
            void sources.refetch();
          }}
          onDismiss={() => setNotice(null)}
        />
      ) : null}
      {sources.data.map((source) => (
        <SourceDeveloperCard key={source.id} source={source} onNotice={setNotice} />
      ))}
    </div>
  );
}

type Confirm = 'key' | 'signing-off' | null;

function SourceDeveloperCard({
  source,
  onNotice,
}: {
  source: Source;
  onNotice: (notice: Notice | null) => void;
}) {
  const t = useTranslations('advanced');
  const failure = useFailureNotice();
  const { rotateKey, enableSigning, disableSigning } = useSourceActions();
  const [confirm, setConfirm] = useState<Confirm>(null);
  // Shown once, held only here: gone when the page is left or the person moves on.
  const [freshKey, setFreshKey] = useState<string | null>(null);
  const [freshSecret, setFreshSecret] = useState<string | null>(null);
  const busy = rotateKey.isPending || enableSigning.isPending || disableSigning.isPending;
  const url = ingestUrl(API_URL, source.id);

  async function run(action: () => Promise<void>) {
    onNotice(null);
    try {
      await action();
      setConfirm(null);
    } catch (error) {
      setConfirm(null);
      onNotice(failure(error));
    }
  }

  const curl = [
    `curl -X POST ${url} \\`,
    `  -H "Authorization: Bearer ${t('placeholderKey')}" \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -d '{"email":"ann@example.com","name":"Ann Lee","company":"Acme"}'`,
  ].join('\n');
  const signed = [
    `import { createHmac } from 'node:crypto';`,
    ``,
    `const body = JSON.stringify({ email: 'ann@example.com', name: 'Ann Lee' });`,
    `const timestamp = Math.floor(Date.now() / 1000);`,
    `const signature = createHmac('sha256', '${t('placeholderSecret')}')`,
    `  .update(\`\${timestamp}.\${body}\`)`,
    `  .digest('hex');`,
    ``,
    `await fetch('${url}', {`,
    `  method: 'POST',`,
    `  headers: {`,
    `    Authorization: 'Bearer ${t('placeholderKey')}',`,
    `    'Content-Type': 'application/json',`,
    `    'X-Timestamp': String(timestamp),`,
    `    'X-Signature': \`sha256=\${signature}\`,`,
    `  },`,
    `  body,`,
    `});`,
  ].join('\n');

  return (
    <section
      aria-labelledby={`dev-${source.id}`}
      className="flex flex-col gap-4 rounded-xl border border-border bg-card px-[18px] py-4"
    >
      <h2 id={`dev-${source.id}`} className="text-[15px] leading-[22px] font-semibold">
        {source.name}
      </h2>

      <div className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium">{t('url')}</span>
        <CopyBox value={url} label={t('url')} />
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-[13px] font-medium">{t('key')}</span>
        <p className="text-[13px] text-muted-foreground">
          {t('keyBody', { prefix: `lp_${source.apiKeyPrefix}` })}
        </p>
        {freshKey ? (
          <>
            <p className="text-[13px]">{t('newKeyShown')}</p>
            <CopyBox value={freshKey} label={t('key')} />
          </>
        ) : null}
        {confirm === 'key' ? (
          <Confirmation
            text={t('newKeyWarn', { name: source.name })}
            yes={t('newKeyYes')}
            no={t('cancel')}
            busy={busy}
            onYes={() =>
              void run(async () => {
                setFreshKey((await rotateKey.mutateAsync(source.id)).apiKey);
              })
            }
            onNo={() => setConfirm(null)}
          />
        ) : (
          <div>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => setConfirm('key')}>
              {t('newKey')}
            </Button>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-[13px] font-medium">{t('signing')}</span>
        <p className="text-[13px] text-muted-foreground">
          {source.hmacEnabled ? t('signingOn') : t('signingOff')}
        </p>
        {freshSecret ? (
          <>
            <p className="text-[13px]">{t('signingSecret')}</p>
            <CopyBox value={freshSecret} label={t('signing')} />
          </>
        ) : null}
        {confirm === 'signing-off' ? (
          <Confirmation
            text={t('signingDisableWarn')}
            yes={t('signingDisableYes')}
            no={t('cancel')}
            busy={busy}
            onYes={() =>
              void run(async () => {
                await disableSigning.mutateAsync(source.id);
                setFreshSecret(null);
              })
            }
            onNo={() => setConfirm(null)}
          />
        ) : source.hmacEnabled ? (
          <div>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => setConfirm('signing-off')}
            >
              {t('signingDisable')}
            </Button>
          </div>
        ) : (
          <div>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  setFreshSecret((await enableSigning.mutateAsync(source.id)).secret);
                })
              }
            >
              {busy ? (
                <>
                  <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden />
                  {t('working')}
                </>
              ) : (
                t('signingEnable')
              )}
            </Button>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-[13px] font-medium">{t('examples')}</span>
        <CodeBlock code={curl} label={t('exampleBasic')} />
        {source.hmacEnabled ? <CodeBlock code={signed} label={t('exampleSigned')} /> : null}
      </div>
    </section>
  );
}

function Confirmation({
  text,
  yes,
  no,
  busy,
  onYes,
  onNo,
}: {
  text: string;
  yes: string;
  no: string;
  busy: boolean;
  onYes: () => void;
  onNo: () => void;
}) {
  return (
    <div
      role="alertdialog"
      aria-label={text}
      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-danger-line bg-danger-bg p-3 text-[13px] text-danger-text"
    >
      <span className="min-w-0 flex-1">{text}</span>
      <Button size="sm" variant="destructive" disabled={busy} onClick={onYes}>
        {yes}
      </Button>
      <Button size="sm" variant="ghost" onClick={onNo}>
        {no}
      </Button>
    </div>
  );
}

function AdvancedSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-hidden>
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-8 w-32" />
      </div>
    </div>
  );
}
