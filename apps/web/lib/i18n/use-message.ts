'use client';

import { useTranslations } from 'next-intl';
import type { MessageRef } from './errors';

type Lookup = (key: string, values?: Record<string, string | number>) => string;

/**
 * Looks a `MessageRef` up in the current language. Keys that are known when
 * the code is written use the typed `useTranslations()` directly; this is for
 * the ones chosen at run time (an API error code, a validation issue). The one
 * cast lives here, and tests check that every reachable key exists in both
 * languages.
 */
export function useMessage(): (ref: MessageRef) => string {
  const t = useTranslations() as unknown as Lookup;
  return (ref) => t(ref.key, ref.values);
}
