'use client';

import {
  leadDetailSchema,
  leadListSchema,
  rescoreResponseSchema,
  type LeadDetail,
  type LeadList,
  type LeadStatus,
  type LeadTier,
  type RescoreRequest,
  type ReviewLeadRequest,
  type SetOutcomeRequest,
} from '@leadpilot/shared';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthClient } from '@/lib/auth/auth-provider';

export interface LeadFilters {
  q: string;
  status: LeadStatus | '';
  tier: LeadTier | '';
  sourceId: string;
  freeMail: 'true' | 'false' | '';
}

export const NO_FILTERS: LeadFilters = { q: '', status: '', tier: '', sourceId: '', freeMail: '' };

export function hasFilters(filters: LeadFilters): boolean {
  return Object.values(filters).some((value) => value !== '');
}

/** The query string for `GET /leads`: only the filters that are set. */
export function leadsQuery(
  filters: LeadFilters,
  cursor?: string,
  order: 'newest' | 'oldest' = 'newest',
): string {
  const params = new URLSearchParams();
  if (filters.q.trim()) params.set('q', filters.q.trim());
  if (filters.status) params.set('status', filters.status);
  if (filters.tier) params.set('tier', filters.tier);
  if (filters.sourceId) params.set('sourceId', filters.sourceId);
  if (filters.freeMail) params.set('freeMail', filters.freeMail);
  if (order === 'oldest') params.set('order', 'oldest');
  if (cursor) params.set('cursor', cursor);
  const text = params.toString();
  return text ? `?${text}` : '';
}

/** Leads, a page at a time ("Show more" asks for the next one). Newest first unless `order` says otherwise. */
export function useLeads(filters: LeadFilters, order: 'newest' | 'oldest' = 'newest') {
  const client = useAuthClient();
  return useInfiniteQuery<LeadList, Error, { pages: LeadList[] }, unknown[], string | undefined>({
    queryKey: ['leads', filters, order],
    initialPageParam: undefined,
    queryFn: ({ pageParam }) =>
      client.request(`/leads${leadsQuery(filters, pageParam, order)}`, { schema: leadListSchema }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

/** One lead with its timeline and the AI's reasons. */
export function useLead(id: string | null) {
  const client = useAuthClient();
  return useQuery<LeadDetail>({
    queryKey: ['lead', id],
    queryFn: () => client.request(`/leads/${id}`, { schema: leadDetailSchema }),
    enabled: id !== null,
  });
}

/** Approve or override the AI's rating. Refetches every lead view, worked or not. */
export function useReviewLead() {
  const client = useAuthClient();
  const queryClient = useQueryClient();
  return useMutation<void, unknown, { id: string } & ReviewLeadRequest>({
    mutationFn: ({ id, ...body }) =>
      client.request(`/leads/${id}/review`, { method: 'POST', body }),
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ['leads'] }),
        queryClient.invalidateQueries({ queryKey: ['lead'] }),
      ]),
  });
}

/** Ask the AI to rate leads again (Owner and Admin). */
export function useRescore() {
  const client = useAuthClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: RescoreRequest) =>
      client.request('/leads/rescore', { method: 'POST', body, schema: rescoreResponseSchema }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['leads'] }),
  });
}

/** A rep records how a lead ended (Won, Lost, Bad lead, or clears it). */
export function useSetOutcome() {
  const client = useAuthClient();
  const queryClient = useQueryClient();
  return useMutation<void, unknown, { id: string } & SetOutcomeRequest>({
    mutationFn: ({ id, ...body }) =>
      client.request(`/leads/${id}/outcome`, { method: 'POST', body }),
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ['leads'] }),
        queryClient.invalidateQueries({ queryKey: ['lead'] }),
      ]),
  });
}
