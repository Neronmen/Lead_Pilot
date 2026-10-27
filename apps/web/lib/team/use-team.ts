'use client';

import {
  createInvitesResponseSchema,
  memberSchema,
  pendingInviteSchema,
  resendInviteResponseSchema,
  type AssignableRole,
  type CreateInvitesResponse,
  type Member,
  type PendingInvite,
  type ResendInviteResponse,
} from '@leadpilot/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { useAuthClient } from '@/lib/auth/auth-provider';

const MEMBERS_KEY = ['team', 'members'] as const;
const INVITES_KEY = ['team', 'invites'] as const;

/** The people in the workspace (Owner and Admin only: the API answers 403 to a Member). */
export function useMembers() {
  const client = useAuthClient();
  return useQuery<Member[]>({
    queryKey: MEMBERS_KEY,
    queryFn: () => client.request('/members', { schema: z.array(memberSchema) }),
  });
}

/** Pending invites, newest first (expired ones included). */
export function useInvites() {
  const client = useAuthClient();
  return useQuery<PendingInvite[]>({
    queryKey: INVITES_KEY,
    queryFn: () => client.request('/invites', { schema: z.array(pendingInviteSchema) }),
  });
}

/** The change actions. Each refetches what it changed, whether it worked or not (it may have half-worked). */
export function useTeamActions() {
  const client = useAuthClient();
  const queryClient = useQueryClient();
  const refresh = (key: readonly string[]) => queryClient.invalidateQueries({ queryKey: key });

  const changeRole = useMutation({
    mutationFn: ({ id, role }: { id: string; role: AssignableRole }) =>
      client.request(`/members/${id}`, { method: 'PATCH', body: { role }, schema: memberSchema }),
    onSettled: () => refresh(MEMBERS_KEY),
  });
  const removeMember = useMutation({
    mutationFn: (id: string) => client.request(`/members/${id}`, { method: 'DELETE' }),
    onSettled: () => refresh(MEMBERS_KEY),
  });
  const invite = useMutation<
    CreateInvitesResponse,
    unknown,
    { emails: string[]; role: AssignableRole }
  >({
    mutationFn: (body) =>
      client.request('/invites', {
        method: 'POST',
        body,
        schema: createInvitesResponseSchema,
      }),
    onSettled: () => refresh(INVITES_KEY),
  });
  const resend = useMutation<ResendInviteResponse, unknown, string>({
    mutationFn: (id) =>
      client.request(`/invites/${id}/resend`, {
        method: 'POST',
        schema: resendInviteResponseSchema,
      }),
    onSettled: () => refresh(INVITES_KEY),
  });
  const cancelInvite = useMutation({
    mutationFn: (id: string) => client.request(`/invites/${id}`, { method: 'DELETE' }),
    onSettled: () => refresh(INVITES_KEY),
  });
  return { changeRole, removeMember, invite, resend, cancelInvite };
}

/** Reload both lists (after "this changed while you were looking"). */
export function useReloadTeam() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ['team'] });
}
