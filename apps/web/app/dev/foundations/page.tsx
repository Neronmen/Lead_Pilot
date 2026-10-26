import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

// Internal dev page: exempt from the design rule (CLAUDE.md). It mirrors the
// Foundations board so theme, language and tokens can be checked in a browser.
export const metadata: Metadata = {
  title: 'Foundations · LeadPilot',
  robots: { index: false, follow: false },
};

// Whole class names, so Tailwind can see them.
const SWATCHES: Record<string, string> = {
  background: 'bg-background',
  card: 'bg-card',
  raised: 'bg-raised',
  hover: 'bg-hover',
  border: 'bg-border',
  'border-strong': 'bg-border-strong',
  muted: 'bg-muted',
  primary: 'bg-primary',
  'accent-soft': 'bg-accent-soft',
  warm: 'bg-warm',
  cold: 'bg-cold',
  junk: 'bg-junk',
  danger: 'bg-danger',
};

export default function FoundationsPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8 px-4 py-10">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Foundations</h1>
        <div className="flex gap-2">
          <LocaleSwitcher />
          <ThemeToggle />
        </div>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-muted-foreground">Colour tokens</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Object.entries(SWATCHES).map(([name, swatch]) => (
            <div key={name} className="flex flex-col gap-1.5">
              <div className={`h-12 rounded-lg border border-border ${swatch}`} />
              <code className="text-xs text-muted-foreground">{name}</code>
            </div>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-muted-foreground">Buttons</h2>
        <div className="flex flex-wrap items-center gap-2">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="destructive">Destructive</Button>
          <Button disabled>Disabled</Button>
        </div>
      </section>

      <section className="flex max-w-sm flex-col gap-3">
        <h2 className="text-sm font-semibold text-muted-foreground">Fields</h2>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="demo">Email</Label>
          <Input id="demo" placeholder="you@company.com" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="demo-bad">With a problem</Label>
          <Input id="demo-bad" aria-invalid defaultValue="an@gmial" />
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-muted-foreground">Type</h2>
        <p className="text-3xl font-semibold tracking-tight">
          Tiếng Việt: Đăng nhập, Quản trị viên
        </p>
        <p className="font-mono text-sm">Mono: 0123456789 · lead_7f3a</p>
      </section>
    </main>
  );
}
