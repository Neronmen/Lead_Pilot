'use client';

import { leadListSchema, type LeadList, type LeadStatus } from '@leadpilot/shared';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useAuthClient } from '@/lib/auth/auth-provider';

export interface LeadFilters {
  q: string;
  status: LeadStatus | '';
  sourceId: string;
  freeMail: 'true' | 'false' | '';
}

export const NO_FILTERS: LeadFilters = { q: '', status: '', sourceId: '', freeMail: '' };

export function hasFilters(filters: LeadFilters): boolean {
  return Object.values(filters).some((value) => value !== '');
}

/** The query string for `GET /leads`: only the filters that are set. */
export function leadsQuery(filters: LeadFilters, cursor?: string): string {
  const params = new URLSearchParams();
  if (filters.q.trim()) params.set('q', filters.q.trim());
  if (filters.status) params.set('status', filters.status);
  if (filters.sourceId) params.set('sourceId', filters.sourceId);
  if (filters.freeMail) params.set('freeMail', filters.freeMail);
  if (cursor) params.set('cursor', cursor);
  const text = params.toString();
  return text ? `?${text}` : '';
}

/** Leads, newest first, a page at a time ("Show more" asks for the next one). */
export function useLeads(filters: LeadFilters) {
  const client = useAuthClient();
  return useInfiniteQuery<LeadList, Error, { pages: LeadList[] }, unknown[], string | undefined>({
    queryKey: ['leads', filters],
    initialPageParam: undefined,
    queryFn: ({ pageParam }) =>
      client.request(`/leads${leadsQuery(filters, pageParam)}`, { schema: leadListSchema }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}
