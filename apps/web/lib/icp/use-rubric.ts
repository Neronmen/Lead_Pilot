'use client';

import { icpRubricResponseSchema, type IcpRubric, type IcpRubricResponse } from '@leadpilot/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthClient } from '@/lib/auth/auth-provider';

const KEY = ['icp-rubric'] as const;

/** The ideal customer (Owner and Admin only: the API answers 403 to a Member). */
export function useRubric() {
  const client = useAuthClient();
  return useQuery<IcpRubricResponse>({
    queryKey: KEY,
    queryFn: () => client.request('/icp-rubric', { schema: icpRubricResponseSchema }),
  });
}

export function useSaveRubric() {
  const client = useAuthClient();
  const queryClient = useQueryClient();
  return useMutation<IcpRubricResponse, unknown, IcpRubric>({
    mutationFn: (body) =>
      client.request('/icp-rubric', { method: 'PUT', body, schema: icpRubricResponseSchema }),
    onSuccess: (saved) => queryClient.setQueryData(KEY, saved),
  });
}
