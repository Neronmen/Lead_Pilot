'use client';

import { historyPageSchema, type AuditArea, type HistoryPage } from '@leadpilot/shared';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useAuthClient } from '@/lib/auth/auth-provider';

export interface HistoryFilters {
  area: AuditArea | '';
  actor: string;
  days: '' | '7' | '30' | '90';
}

/** The change history, newest first, 50 at a time (Owner and Admin only). */
export function useHistory(filters: HistoryFilters) {
  const client = useAuthClient();
  return useInfiniteQuery<HistoryPage, unknown, { pages: HistoryPage[] }, unknown[], string>({
    queryKey: ['history', filters],
    initialPageParam: '',
    queryFn: ({ pageParam }) => {
      const query = new URLSearchParams();
      if (filters.area) query.set('area', filters.area);
      if (filters.actor) query.set('actor', filters.actor);
      if (filters.days) query.set('days', filters.days);
      if (pageParam) query.set('before', pageParam);
      const text = query.toString();
      return client.request(`/history${text ? `?${text}` : ''}`, { schema: historyPageSchema });
    },
    getNextPageParam: (last) => last.next ?? undefined,
  });
}

/** `rule.created` as a message key (`rule_created`): the keys of the sentences cannot hold a dot. */
export const actionKey = (action: string) => action.replace(/\./g, '_');

/** The sentences the page knows. Any other action is shown with a plain "changed something" line. */
export const KNOWN_ACTIONS = [
  'invite_created',
  'invite_reissued',
  'invite_resent',
  'invite_cancelled',
  'member_joined',
  'member_role_changed',
  'member_removed',
  'source_created',
  'source_updated',
  'source_deleted',
  'source_key_rotated',
  'source_hmac_enabled',
  'source_hmac_disabled',
  'ideal_customer_updated',
  'rule_created',
  'rule_updated',
  'rule_deleted',
  'rule_reordered',
  'integration_connected',
  'integration_updated',
  'integration_deleted',
] as const;
