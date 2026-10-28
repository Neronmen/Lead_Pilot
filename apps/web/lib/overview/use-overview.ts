'use client';

import { overviewSchema, type Overview } from '@leadpilot/shared';
import { useQuery } from '@tanstack/react-query';
import { useAuthClient } from '@/lib/auth/auth-provider';

/** The last 30 days in numbers (every member can read it). */
export function useOverview() {
  const client = useAuthClient();
  return useQuery<Overview>({
    queryKey: ['overview'],
    queryFn: () => client.request('/overview', { schema: overviewSchema }),
  });
}

export type Duration = { unit: 'seconds' | 'minutes' | 'hours' | 'days'; n: number };

/** A length of time in the largest unit that keeps the number readable ("3 minutes", not "180 seconds"). */
export function toDuration(seconds: number): Duration {
  if (seconds < 90) return { unit: 'seconds', n: Math.max(1, Math.round(seconds)) };
  if (seconds < 90 * 60) return { unit: 'minutes', n: Math.round(seconds / 60) };
  if (seconds < 36 * 3600) return { unit: 'hours', n: Math.round(seconds / 3600) };
  return { unit: 'days', n: Math.round(seconds / 86400) };
}
