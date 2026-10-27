'use client';

import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { useCurrentMe } from '@/components/app-shell/me-context';
import { ErrorState } from '@/components/state-views';
import { Button } from '@/components/ui/button';
import { useInvites, useMembers, useReloadTeam } from '@/lib/team/use-team';
import { InviteCard } from './invite-card';
import { PendingCard, PendingSkeleton } from './pending-card';
import { PeopleCard, PeopleSkeleton } from './people-card';
import { type Notice, TeamNotice } from './team-notice';

/**
 * Settings > Team. Only Owner and Admin get here (the Settings frame shows
 * everyone else the no-access page, so none of these requests is made for them).
 */
export function TeamView() {
  const t = useTranslations('team.problem');
  const me = useCurrentMe();
  const members = useMembers();
  const invites = useInvites();
  const reload = useReloadTeam();
  const [notice, setNotice] = useState<Notice | null>(null);
  const emailBox = useRef<HTMLInputElement>(null);

  return (
    <div className="flex flex-col gap-4">
      <InviteCard viewer={me.role} inputRef={emailBox} onNotice={setNotice} />

      {notice ? (
        <TeamNotice
          notice={notice}
          onReload={() => {
            setNotice(null);
            void reload();
          }}
          onDismiss={() => setNotice(null)}
        />
      ) : null}

      {members.isPending ? (
        <PeopleSkeleton />
      ) : members.isError ? (
        <section className="rounded-xl border border-border bg-card">
          <ErrorState title={t('loadTitle')} body={t('loadBody')}>
            <Button variant="outline" onClick={() => void members.refetch()}>
              {t('retry')}
            </Button>
          </ErrorState>
        </section>
      ) : (
        <PeopleCard
          members={members.data}
          viewer={me.role}
          viewerUserId={me.user.id}
          workspaceName={me.workspace.name}
          onNotice={setNotice}
          onInvite={() => emailBox.current?.focus()}
        />
      )}

      {invites.isPending ? (
        <PendingSkeleton />
      ) : invites.isError ? (
        <section
          role="alert"
          className="flex flex-wrap items-center gap-3 rounded-xl border border-danger-line bg-danger-bg p-3 text-[13px] text-danger-text"
        >
          <span className="flex-1">{t('pendingFailed')}</span>
          <Button size="sm" variant="outline" onClick={() => void invites.refetch()}>
            {t('retry')}
          </Button>
        </section>
      ) : invites.data.length > 0 ? (
        <PendingCard invites={invites.data} viewer={me.role} onNotice={setNotice} />
      ) : null}
    </div>
  );
}
