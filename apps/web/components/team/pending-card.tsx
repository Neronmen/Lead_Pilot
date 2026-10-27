'use client';

import type { PendingInvite, Role } from '@leadpilot/shared';
import { useFormatter, useNow, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { canManageInvite } from '@/lib/team/rules';
import { useTeamActions } from '@/lib/team/use-team';
import { type Notice, useFailureNotice } from './team-notice';

/** Invites that were sent and not yet accepted: resend (new link, old one dies) or cancel. */
export function PendingCard({
  invites,
  viewer,
  onNotice,
}: {
  invites: PendingInvite[];
  viewer: Role;
  onNotice: (notice: Notice | null) => void;
}) {
  const t = useTranslations('team');
  const roles = useTranslations('team.invite.roles');
  const format = useFormatter();
  const failure = useFailureNotice();
  const { resend, cancelInvite } = useTeamActions();
  // A minute-by-minute clock, so "2 minutes ago" stays right on a page left open.
  const now = useNow({ updateInterval: 60_000 });

  async function sendAgain(invite: PendingInvite) {
    onNotice(null);
    try {
      const { status } = await resend.mutateAsync(invite.id);
      onNotice(
        status === 'invited'
          ? { kind: 'info', text: t('results.resent', { email: invite.email }) }
          : { kind: 'error', text: t('results.email_failed', { email: invite.email }) },
      );
    } catch (error) {
      onNotice(failure(error));
    }
  }

  async function cancel(invite: PendingInvite) {
    onNotice(null);
    try {
      await cancelInvite.mutateAsync(invite.id);
    } catch (error) {
      onNotice(failure(error));
    }
  }

  const meta = (invite: PendingInvite) => {
    const expiresAt = new Date(invite.expiresAt);
    const values = {
      role: roles(invite.role),
      by: invite.invitedBy?.name ?? '',
      // Never later than "now": an invite sent a second ago must not read "in 1 second".
      ago: format.relativeTime(
        new Date(Math.min(new Date(invite.createdAt).getTime(), now.getTime())),
        now,
      ),
      expires: format.relativeTime(expiresAt, now),
    };
    if (expiresAt <= now) return t('pending.metaExpired', values);
    return invite.invitedBy?.name ? t('pending.meta', values) : t('pending.metaNoInviter', values);
  };

  return (
    <section
      aria-labelledby="team-pending"
      className="flex flex-col gap-1 rounded-xl border border-border bg-card px-[18px] pt-4 pb-2"
    >
      <h2 id="team-pending" className="mb-1.5 text-[15px] leading-[22px] font-semibold">
        {t('pending.title', { count: invites.length })}
      </h2>
      <ul>
        {invites.map((invite) => {
          const manage = canManageInvite(viewer, invite.role);
          return (
            <li
              key={invite.id}
              className="flex flex-wrap items-center gap-x-4 gap-y-2.5 border-t border-border py-2.5"
            >
              <span className="flex min-w-[260px] flex-1 flex-col gap-px">
                <span className="text-[13px] font-medium">{invite.email}</span>
                <span className="text-xs text-muted-foreground">{meta(invite)}</span>
              </span>
              {manage ? (
                <span className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={resend.isPending && resend.variables === invite.id}
                    onClick={() => void sendAgain(invite)}
                  >
                    {t('pending.resend')}
                    <span className="sr-only">{invite.email}</span>
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-muted-foreground"
                    disabled={cancelInvite.isPending && cancelInvite.variables === invite.id}
                    onClick={() => void cancel(invite)}
                  >
                    {t('pending.cancelInvite')}
                    <span className="sr-only">{invite.email}</span>
                  </Button>
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">{t('pending.ownerOnly')}</span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function PendingSkeleton() {
  return (
    <section
      role="status"
      aria-busy="true"
      className="flex flex-col gap-3 rounded-xl border border-border bg-card px-[18px] py-4"
    >
      <Skeleton className="h-5 w-36" />
      {[0, 1].map((row) => (
        <div key={row} className="flex items-center gap-3 border-t border-border py-2.5">
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-3 w-48" />
            <Skeleton className="h-3 w-64" />
          </div>
          <Skeleton className="h-8 w-20" />
        </div>
      ))}
    </section>
  );
}
