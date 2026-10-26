import type { ReactNode } from 'react';
import { AppFrame } from '@/components/app-shell/app-frame';

// Every page in this folder needs a signed-in person; the shell wraps them.
export default function AppLayout({ children }: { children: ReactNode }) {
  return <AppFrame>{children}</AppFrame>;
}
