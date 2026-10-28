# Deploying LeadPilot

LeadPilot is two Node processes (API and web), PostgreSQL and Redis. It was built to run for free on a
small host; nothing here needs a paid service.

## Layout

| Part | What | Notes |
|---|---|---|
| `apps/api` | NestJS API + the queue workers (`QUEUE_WORKERS=on`) | `pnpm --filter api build`, then `node apps/api/dist/main`. Run `pnpm --filter api db:deploy` once per release. |
| `apps/web` | Next.js app | `pnpm --filter web build` then `pnpm --filter web start`. `NEXT_PUBLIC_API_URL` is baked in at build time. |
| PostgreSQL 18 | data | any managed free tier works (Neon, Supabase, Render). |
| Redis 8 | queues and rate limits | a free Upstash or Redis Cloud database works; set `REDIS_URL`. |

## Before real use (checklist)

- [ ] HTTPS everywhere. The API and web should share a site (`app.example.com` + `api.example.com`): the refresh cookie is `SameSite=Lax`. On different sites, put the API behind the web domain.
- [ ] `NODE_ENV=production`, a real `JWT_ACCESS_SECRET` and a real `ENCRYPTION_KEY` (32 random bytes in base64; changing it makes stored secrets unreadable). The API refuses the development keys in production.
- [ ] `TRUST_PROXY=<number of proxies in front of the API>` so rate limits see each visitor. Never "true".
- [ ] `API_DOCS=off` unless you want Swagger public.
- [ ] `WEB_ORIGIN` is the web app's exact address (CORS and email links).
- [ ] A real mail server (`SMTP_HOST`...) for invites and alerts, or accept that mock mode logs only.
- [ ] Leave `NEXT_PUBLIC_DEMO_LOGIN` off, and do not run the seed against real data (it only touches its own demo account).
- [ ] Real AI and real sends are optional and off by default: `LLM_PROVIDER` with a key (Gemini has a free tier, see the README), `ACTIONS_MODE=live`. Keep the monthly AI limit (`AI_DEFAULT_MONTHLY_LIMIT_USD`) low.
- [ ] Password reset and email verification do not exist yet (see the backlog): do not open sign-up to strangers before they do.

## Known limits

- Outgoing addresses are checked, then resolved again by the HTTP client: a hostile DNS server could answer differently the second time. Pin the resolved address before turning `ACTIONS_MODE=live` on for untrusted customers.
- One API process runs the workers; to scale, run a second process with `QUEUE_WORKERS=on` (jobs are safe to run twice) and keep the web tier separate.
