import type en from './messages/en.json';
import type { Locale } from './lib/i18n/locales';

// Typed message keys: `t('errors.NOT_FOUND')` is checked against en.json, so a
// typo or a deleted key fails `pnpm typecheck`. vi.json must match en.json (a
// test checks it).
declare module 'next-intl' {
  interface AppConfig {
    Locale: Locale;
    Messages: typeof en;
  }
}
