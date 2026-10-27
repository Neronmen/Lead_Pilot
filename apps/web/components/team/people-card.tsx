'use client';

import type { AssignableRole, Member, Role } from '@leadpilot/shared';
import { UserPlus } from 'lucide-react';
import { useFormatter, useNow, useTranslations } from 'next-intl';
import { Fragment, useState } from 'react';
import { StateView } from '@/components/state-views';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';
import { initials } from '@/lib/shell';
import { ACTIVE_NOW_MS, assignableRoles, canManageMember } from '@/lib/team/rules';
import { useTeamActions } from '@/lib/team/use-team';
import { type Notice, useFailureNotice } from './team-notice';

/** The table of people. Only controls the person may use are drawn (see lib/team/rules.ts). */
export function PeopleCard({
  members,
  viewer,
  viewerUserId,
  workspaceName,
  onNotice,
  onInvite,
}: {
  members: Member[];
  viewer: Role;
  viewerUserId: string;
  workspaceName: string;
  onNotice: (notice: Notice | null) => void;
  onInvite: () => void;
}) {
  const t = useTranslations('team');
  const alone = members.every((member) => member.userId === viewerUserId);
  if (alone) {
    return (
      <section className="rounded-xl border border-border bg-card">
        <StateView icon={UserPlus} tone="accent" title={t('empty.title')} body={t('empty.body')}>
          <Button onClick={onInvite}>{t('empty.cta')}</Button>
        </StateView>
      </section>
    );
  }
  return (
    <section
      aria-labelledby="team-people"
      className="overflow-x-auto rounded-xl border border-border bg-card"
    >
      <h2
        id="team-people"
        tabIndex={-1}
        className="px-[18px] pt-4 pb-2 text-[15px] leading-[22px] font-semibold"
      >
        {t('people.title', { count: members.length })}
      </h2>
      <table className="w-full min-w-[640px] border-collapse text-[13px]">
        <thead>
          <tr className="text-left text-xs text-muted-foreground">
            <th
              scope="col"
              className="border-b border-border px-[18px] py-2 font-medium whitespace-nowrap"
            >
              {t('people.colPerson')}
            </th>
            <th
              scope="col"
              className="border-b border-border px-3 py-2 font-medium whitespace-nowrap"
            >
              {t('people.colRole')}
            </th>
            <th
              scope="col"
              className="border-b border-border px-3 py-2 font-medium whitespace-nowrap"
            >
              {t('people.colActive')}
            </th>
            <th scope="col" className="border-b border-border py-2 pr-[18px] pl-3">
              <span className="sr-only">{t('people.colActions')}</span>
            </th>
          </tr>
        </thead>
        <PeopleRows
          members={members}
          viewer={viewer}
          viewerUserId={viewerUserId}
          workspaceName={workspaceName}
          onNotice={onNotice}
        />
      </table>
    </section>
  );
}

function PeopleRows({
  members,
  viewer,
  viewerUserId,
  workspaceName,
  onNotice,
}: {
  members: Member[];
  viewer: Role;
  viewerUserId: string;
  workspaceName: string;
  onNotice: (notice: Notice | null) => void;
}) {
  const t = useTranslations('team');
  const roles = useTranslations('shell.roles');
  const format = useFormatter();
  const failure = useFailureNotice();
  const { changeRole, removeMember } = useTeamActions();
  const [confirming, setConfirming] = useState<string | null>(null);
  // A minute-by-minute clock, so "Active now" and "2 hours ago" stay right on a page left open.
  const now = useNow({ updateInterval: 60_000 });
  // The role being saved, shown in the select until the list is refetched.
  const [saving, setSaving] = useState<Record<string, AssignableRole>>({});
  const choices = assignableRoles(viewer);

  async function setRole(member: Member, role: AssignableRole) {
    onNotice(null);
    setSaving((current) => ({ ...current, [member.id]: role }));
    try {
      await changeRole.mutateAsync({ id: member.id, role });
    } catch (error) {
      onNotice(failure(error));
    } finally {
      setSaving((current) => {
        const { [member.id]: _done, ...rest } = current;
        return rest;
      });
    }
  }

  async function remove(member: Member) {
    onNotice(null);
    try {
      await removeMember.mutateAsync(member.id);
      setConfirming(null);
      // The row is gone: put the cursor on the list's heading, not nowhere.
      document.getElementById('team-people')?.focus();
    } catch (error) {
      setConfirming(null);
      document.getElementById(`remove-${member.id}`)?.focus();
      onNotice(failure(error));
    }
  }

  function closeConfirm(member: Member) {
    setConfirming(null);
    document.getElementById(`remove-${member.id}`)?.focus();
  }

  function lastActive(member: Member): string {
    if (!member.lastActiveAt) return t('people.never');
    const at = new Date(member.lastActiveAt);
    if (now.getTime() - at.getTime() < ACTIVE_NOW_MS) return t('people.activeNow');
    return format.relativeTime(at, now);
  }

  return (
    <tbody>
      {members.map((member) => {
        const self = member.userId === viewerUserId;
        const manage = canManageMember(viewer, member.role, self);
        const display = member.name ?? member.email;
        const editable = manage && choices.length > 1;
        return (
          <Fragment key={member.id}>
            <tr>
              <td className="h-[60px] border-b border-border px-[18px]">
                <span className="flex items-center gap-2.5">
                  <span
                    aria-hidden
                    className="inline-flex size-8 shrink-0 items-center justify-center rounded-full border border-border-strong bg-raised text-xs font-semibold"
                  >
                    {initials(display)}
                  </span>
                  <span className="flex min-w-0 flex-col gap-px">
                    <span className="font-medium whitespace-nowrap">{display}</span>
                    {member.name ? (
                      <span className="text-xs whitespace-nowrap text-muted-foreground">
                        {member.email}
                      </span>
                    ) : null}
                  </span>
                </span>
              </td>
              <td className="border-b border-border px-3">
                {editable ? (
                  <NativeSelect
                    aria-label={t('people.roleOf', { name: display })}
                    className="h-8 w-auto rounded-[7px] px-2 text-[13px]"
                    value={saving[member.id] ?? (member.role === 'ADMIN' ? 'ADMIN' : 'MEMBER')}
                    disabled={member.id in saving}
                    onChange={(event) => void setRole(member, event.target.value as AssignableRole)}
                  >
                    {choices.map((value) => (
                      <option key={value} value={value}>
                        {roles(value)}
                      </option>
                    ))}
                  </NativeSelect>
                ) : (
                  <span
                    className={
                      member.role === 'OWNER'
                        ? 'rounded-md bg-accent-soft px-2 py-0.5 text-xs font-medium whitespace-nowrap text-accent-text'
                        : 'rounded-md bg-raised px-2 py-0.5 text-xs font-medium whitespace-nowrap'
                    }
                  >
                    {roles(member.role)}
                  </span>
                )}
              </td>
              <td className="border-b border-border px-3 whitespace-nowrap text-muted-foreground">
                {lastActive(member)}
              </td>
              <td className="border-b border-border py-0 pr-[18px] pl-3 text-right">
                {manage ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-danger-text"
                    id={`remove-${member.id}`}
                    aria-expanded={confirming === member.id}
                    onClick={() => setConfirming(member.id)}
                  >
                    {t('people.remove')}
                    <span className="sr-only">{display}</span>
                  </Button>
                ) : null}
                {self ? (
                  <span className="text-xs text-muted-foreground">{t('people.you')}</span>
                ) : null}
              </td>
            </tr>
            {confirming === member.id ? (
              <tr>
                <ConfirmRemove
                  name={display}
                  workspace={workspaceName}
                  busy={removeMember.isPending}
                  onCancel={() => closeConfirm(member)}
                  onConfirm={() => void remove(member)}
                />
              </tr>
            ) : null}
          </Fragment>
        );
      })}
    </tbody>
  );
}

function ConfirmRemove({
  name,
  workspace,
  busy,
  onCancel,
  onConfirm,
}: {
  name: string;
  workspace: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const t = useTranslations('team');
  return (
    <td colSpan={4} className="border-b border-border px-[18px] pb-3.5">
      <div
        role="alertdialog"
        aria-labelledby="team-confirm-title"
        aria-describedby="team-confirm-body"
        onKeyDown={(event) => {
          if (event.key === 'Escape') onCancel();
        }}
        className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-[10px] border border-danger-line bg-danger-bg px-4 py-3.5"
      >
        <span className="flex min-w-[260px] flex-1 flex-col gap-0.5">
          <span id="team-confirm-title" className="text-sm font-semibold">
            {t('confirm.title', { name, workspace })}
          </span>
          <span id="team-confirm-body" className="text-[13px] leading-[19px] text-muted-foreground">
            {t('confirm.body', { name })}
          </span>
        </span>
        <span className="flex gap-2">
          <Button variant="outline" size="sm" className="h-9" onClick={onCancel} autoFocus>
            {t('confirm.cancel')}
          </Button>
          <Button
            variant="destructive"
            size="sm"
            className="h-9 bg-danger text-on-danger"
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? t('confirm.removing') : t('confirm.confirm', { name })}
          </Button>
        </span>
      </div>
    </td>
  );
}

/** Loading rows with the table's height, so nothing jumps when the data arrives. */
export function PeopleSkeleton() {
  return (
    <section
      role="status"
      aria-busy="true"
      className="flex flex-col gap-3 rounded-xl border border-border bg-card px-[18px] py-4"
    >
      <Skeleton className="h-5 w-24" />
      {[0, 1, 2].map((row) => (
        <div key={row} className="flex items-center gap-3 border-t border-border py-3">
          <Skeleton className="size-8 rounded-full" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-3 w-40" />
            <Skeleton className="h-3 w-56" />
          </div>
          <Skeleton className="h-8 w-24" />
        </div>
      ))}
    </section>
  );
}
