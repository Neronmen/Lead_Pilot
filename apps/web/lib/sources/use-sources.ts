'use client';

import {
  hmacSecretResponseSchema,
  sourceSchema,
  sourceWithKeySchema,
  type CreateSourceRequest,
  type HmacSecretResponse,
  type Source,
  type SourceWithKey,
  type UpdateSourceRequest,
} from '@leadpilot/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { useAuthClient } from '@/lib/auth/auth-provider';

export const SOURCES_KEY = ['sources'] as const;

/** Lead sources (Owner and Admin only: the API answers 403 to a Member). */
export function useSources(enabled = true) {
  const client = useAuthClient();
  return useQuery<Source[]>({
    queryKey: SOURCES_KEY,
    queryFn: () => client.request('/sources', { schema: z.array(sourceSchema) }),
    enabled,
  });
}

/**
 * The change actions. Each refetches the list when it settles, worked or not
 * (it may have half-worked). A key or secret comes back in the mutation result
 * only: it is shown once by the caller and never put in the query cache.
 */
export function useSourceActions() {
  const client = useAuthClient();
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: SOURCES_KEY });

  // gcTime 0: a key or secret in a result is dropped from the mutation cache at once.
  const create = useMutation<SourceWithKey, unknown, CreateSourceRequest>({
    gcTime: 0,
    mutationFn: (body) =>
      client.request('/sources', { method: 'POST', body, schema: sourceWithKeySchema }),
    onSettled: refresh,
  });
  const update = useMutation<Source, unknown, { id: string } & UpdateSourceRequest>({
    mutationFn: ({ id, ...body }) =>
      client.request(`/sources/${id}`, { method: 'PATCH', body, schema: sourceSchema }),
    onSettled: refresh,
  });
  const remove = useMutation({
    mutationFn: (id: string) => client.request(`/sources/${id}`, { method: 'DELETE' }),
    onSettled: refresh,
  });
  const rotateKey = useMutation<SourceWithKey, unknown, string>({
    gcTime: 0,
    mutationFn: (id) =>
      client.request(`/sources/${id}/api-key`, { method: 'POST', schema: sourceWithKeySchema }),
    onSettled: refresh,
  });
  const enableSigning = useMutation<HmacSecretResponse, unknown, string>({
    gcTime: 0,
    mutationFn: (id) =>
      client.request(`/sources/${id}/hmac-secret`, {
        method: 'POST',
        schema: hmacSecretResponseSchema,
      }),
    onSettled: refresh,
  });
  const disableSigning = useMutation({
    mutationFn: (id: string) => client.request(`/sources/${id}/hmac-secret`, { method: 'DELETE' }),
    onSettled: refresh,
  });
  return { create, update, remove, rotateKey, enableSigning, disableSigning };
}
