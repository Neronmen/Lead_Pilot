import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

// Next.js only reads .env files from apps/web; the repo keeps a single .env at
// the root. Load it here (never overrides variables already set, e.g. in CI).
const rootEnv = resolve(__dirname, '../../.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const withNextIntl = createNextIntlPlugin('./i18n/request.ts');

const nextConfig: NextConfig = {
  // The render checks (`pnpm test:render`) build into their own folder, so they
  // never touch the `.next` that a running `pnpm dev` uses.
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [
      {
        // The invite page is private: a browser never puts a fragment in a Referer, but
        // belt and braces, send none, and keep the page out of caches.
        source: '/invite',
        headers: [
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'Cache-Control', value: 'no-store' },
        ],
      },
    ];
  },
};

export default withNextIntl(nextConfig);
