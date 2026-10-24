import Link from 'next/link';

// Placeholder until the product UI is designed (milestone D) and built (M5).
export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-3 px-4">
      <h1 className="text-2xl font-semibold tracking-tight">LeadPilot</h1>
      <p className="text-sm text-muted-foreground">
        The app UI arrives after the design milestone. For now, see the{' '}
        <Link href="/status" className="underline underline-offset-4">
          system status
        </Link>
        .
      </p>
    </main>
  );
}
