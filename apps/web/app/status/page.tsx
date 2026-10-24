import type { Metadata } from 'next';
import { StatusView } from './status-view';

// Internal dev/diagnostic page: exempt from the design rule (see CLAUDE.md).
export const metadata: Metadata = {
  title: 'Status · LeadPilot',
  robots: { index: false, follow: false },
};

export default function StatusPage() {
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-10">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">System status</h1>
        <p className="text-sm text-muted-foreground">
          Internal page: live and readiness probes of the API, refreshed every 10 seconds.
        </p>
      </header>
      <StatusView />
    </main>
  );
}
