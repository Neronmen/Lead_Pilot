'use client';

import {
  actionRunSchema,
  integrationSchema,
  integrationWithSecretSchema,
  routingRuleSchema,
  testRoutingResponseSchema,
  type ActionRun,
  type CreateIntegrationRequest,
  type CreateRoutingRuleRequest,
  type Integration,
  type IntegrationWithSecret,
  type RoutingRule,
  type TestRoutingRequest,
  type TestRoutingResponse,
  type UpdateIntegrationRequest,
  type UpdateRoutingRuleRequest,
} from '@leadpilot/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { useAuthClient } from '@/lib/auth/auth-provider';

export const RULES_KEY = ['routing', 'rules'] as const;
export const INTEGRATIONS_KEY = ['integrations'] as const;
const ACTIONS_KEY = ['actions'] as const;

/** Routing rules in the order they are checked (Owner and Admin only). */
export function useRules() {
  const client = useAuthClient();
  return useQuery<RoutingRule[]>({
    queryKey: RULES_KEY,
    queryFn: () => client.request('/routing/rules', { schema: z.array(routingRuleSchema) }),
  });
}

/** Each change refetches the list when it settles, worked or not (it may have half-worked). */
export function useRuleActions() {
  const client = useAuthClient();
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: RULES_KEY });
  const create = useMutation<RoutingRule, unknown, CreateRoutingRuleRequest>({
    mutationFn: (body) =>
      client.request('/routing/rules', { method: 'POST', body, schema: routingRuleSchema }),
    onSettled: refresh,
  });
  const update = useMutation<RoutingRule, unknown, { id: string } & UpdateRoutingRuleRequest>({
    mutationFn: ({ id, ...body }) =>
      client.request(`/routing/rules/${id}`, { method: 'PATCH', body, schema: routingRuleSchema }),
    onSettled: refresh,
  });
  const remove = useMutation({
    mutationFn: (id: string) => client.request(`/routing/rules/${id}`, { method: 'DELETE' }),
    onSettled: refresh,
  });
  const reorder = useMutation<RoutingRule[], unknown, string[]>({
    mutationFn: (ids) =>
      client.request('/routing/rules/order', {
        method: 'PUT',
        body: { ids },
        schema: z.array(routingRuleSchema),
      }),
    onSettled: refresh,
  });
  return { create, update, remove, reorder };
}

/** "Test with a sample lead": a dry run, nothing is sent or saved. */
export function useTestRouting() {
  const client = useAuthClient();
  return useMutation<TestRoutingResponse, unknown, TestRoutingRequest>({
    mutationFn: (body) =>
      client.request('/routing/test', { method: 'POST', body, schema: testRoutingResponseSchema }),
  });
}

/** Connected tools (Owner and Admin only). Secrets never come back from the API. */
export function useIntegrations() {
  const client = useAuthClient();
  return useQuery<Integration[]>({
    queryKey: INTEGRATIONS_KEY,
    queryFn: () => client.request('/integrations', { schema: z.array(integrationSchema) }),
  });
}

export function useIntegrationActions() {
  const client = useAuthClient();
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: INTEGRATIONS_KEY });
  // gcTime 0: a signing secret in a result is dropped from the mutation cache at once.
  const create = useMutation<IntegrationWithSecret, unknown, CreateIntegrationRequest>({
    gcTime: 0,
    mutationFn: (body) =>
      client.request('/integrations', {
        method: 'POST',
        body,
        schema: integrationWithSecretSchema,
      }),
    onSettled: refresh,
  });
  const update = useMutation<Integration, unknown, { id: string } & UpdateIntegrationRequest>({
    mutationFn: ({ id, ...body }) =>
      client.request(`/integrations/${id}`, { method: 'PATCH', body, schema: integrationSchema }),
    onSettled: refresh,
  });
  const remove = useMutation({
    mutationFn: (id: string) => client.request(`/integrations/${id}`, { method: 'DELETE' }),
    onSettled: refresh,
  });
  const test = useMutation<{ ok: boolean; error: string | null }, unknown, string>({
    mutationFn: (id) =>
      client.request(`/integrations/${id}/test`, {
        method: 'POST',
        schema: z.object({ ok: z.boolean(), error: z.string().nullable() }),
      }),
    onSettled: refresh,
  });
  return { create, update, remove, test };
}

/** What happened after a lead was rated (Owner and Admin only). */
export function useActionRuns(leadId: string, enabled: boolean) {
  const client = useAuthClient();
  return useQuery<ActionRun[]>({
    queryKey: [...ACTIONS_KEY, leadId],
    queryFn: () =>
      client.request(`/actions?leadId=${encodeURIComponent(leadId)}`, {
        schema: z.array(actionRunSchema),
      }),
    enabled,
  });
}

export function useRetryAction(leadId: string) {
  const client = useAuthClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => client.request(`/actions/${id}/retry`, { method: 'POST' }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: [...ACTIONS_KEY, leadId] }),
  });
}
