// A public demo account with made-up leads (made by `pnpm --filter api seed`). The button on the sign-in
// page appears only when NEXT_PUBLIC_DEMO_LOGIN=on, so a real deployment does not show it by accident.
export const DEMO_LOGIN = process.env.NEXT_PUBLIC_DEMO_LOGIN === 'on';
export const DEMO_EMAIL = 'demo@leadpilot-demo.com';
export const DEMO_PASSWORD = 'demo-leadpilot-2026';
