'use client';

import type { MeResponse } from '@leadpilot/shared';
import { createContext, useContext } from 'react';

const MeContext = createContext<MeResponse | null>(null);

export const MeProvider = MeContext.Provider;

/** The signed-in person, their workspace and role. Only inside the app shell, where they are loaded. */
export function useCurrentMe(): MeResponse {
  const me = useContext(MeContext);
  if (!me) throw new Error('useCurrentMe must be used inside the app shell');
  return me;
}

/** Owners and admins manage the workspace; members only work their leads. */
export function canManage(role: MeResponse['role']): boolean {
  return role === 'OWNER' || role === 'ADMIN';
}
