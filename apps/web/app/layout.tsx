import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getTranslations } from 'next-intl/server';
import { ThemeProvider } from 'next-themes';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Providers } from './providers';
import './globals.css';

// Both families ship a Vietnamese subset (docs/design-notes.md, "Tokens").
const geist = Geist({ subsets: ['latin', 'vietnamese'], variable: '--font-geist-sans' });
const geistMono = Geist_Mono({ subsets: ['latin', 'vietnamese'], variable: '--font-geist-mono' });

// Runs in <head>, before the body is parsed and before anything is painted: a
// person who chose light gets light from the first frame. next-themes has its
// own script (in the body) for everything else; this one only covers the
// moment before it. Keep the storage key in sync with ThemeProvider below.
const EARLY_THEME_SCRIPT = `try{if(localStorage.getItem('lp-theme')==='light'){var h=document.documentElement;h.classList.remove('dark');h.style.colorScheme='light'}}catch(e){}`;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('meta');
  return { title: 'LeadPilot', description: t('description') };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  return (
    // `dark` is on the server-rendered <html> (dark is the default theme), and
    // next-themes' inline script swaps it before the first paint when the
    // person chose light: no flash either way.
    <html
      lang={locale}
      className={cn('dark font-sans', geist.variable, geistMono.variable)}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: EARLY_THEME_SCRIPT }} />
      </head>
      <body>
        <NextIntlClientProvider>
          <ThemeProvider
            attribute="class"
            defaultTheme="dark"
            enableSystem={false}
            storageKey="lp-theme"
            disableTransitionOnChange
          >
            <Providers>{children}</Providers>
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
