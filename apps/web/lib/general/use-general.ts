'use client';

import {
  meResponseSchema,
  type DeleteWorkspaceRequest,
  type UpdateWorkspaceRequest,
} from '@leadpilot/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthClient, ME_QUERY_KEY } from '@/lib/auth/auth-provider';

/** Settings > General: the workspace's name, language, currency and time zone. */
export function useUpdateWorkspace() {
  const client = useAuthClient();
  const queryClient = useQueryClient();
  return useMutation<unknown, unknown, UpdateWorkspaceRequest>({
    mutationFn: (body) =>
      client.request('/workspace', {
        method: 'PATCH',
        body,
        schema: meResponseSchema.shape.workspace,
      }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY }),
  });
}

export function useChangePassword() {
  const client = useAuthClient();
  return useMutation<void, unknown, { currentPassword: string; newPassword: string }>({
    mutationFn: (body) => client.changePassword(body),
  });
}

/** Deletes the workspace for good, then signs this browser out. */
export function useDeleteWorkspace() {
  const client = useAuthClient();
  return useMutation<void, unknown, DeleteWorkspaceRequest>({
    mutationFn: async (body) => {
      await client.request('/workspace', { method: 'DELETE', body });
      await client.logout().catch(() => undefined);
    },
  });
}

/** Downloads the leads as a CSV file in the browser. */
export function useExportLeads() {
  const client = useAuthClient();
  return useMutation<void, unknown, void>({
    mutationFn: async () => {
      const blob = await client.request<Blob>('/leads/export', { asBlob: true });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `leadpilot-leads-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    },
  });
}
