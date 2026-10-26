import { defineConfig } from '@playwright/test';

const PORT = 3100;

/**
 * Render checks: the real web app in a real browser, the API replaced by a
 * mock (e2e/mock-api.ts), so no database or Docker is needed. The app is built
 * into `.next-e2e` and talks to http://localhost:3999, an address nothing
 * listens on, so a test can never reach a real API by accident.
 */
export default defineConfig({
  testDir: './e2e',
  outputDir: './e2e/test-results',
  fullyParallel: true,
  workers: process.env.CI ? 2 : undefined,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['./e2e/table-reporter.ts']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `pnpm exec next build && pnpm exec next start --port ${PORT}`,
    url: `http://localhost:${PORT}/status`,
    // A leftover server could be an old build that talks to a real API: fail on a busy port.
    reuseExistingServer: false,
    timeout: 240_000,
    env: {
      NEXT_DIST_DIR: '.next-e2e',
      NEXT_PUBLIC_API_URL: 'http://localhost:3999',
    },
  },
});
