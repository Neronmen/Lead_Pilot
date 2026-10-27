# LeadPilot

AI lead qualification and routing for B2B teams. Leads arrive from forms, webhooks and CSV files; LeadPilot deduplicates them, enriches the company, scores them against your ideal customer profile with an LLM, and routes them to the right rep, with Slack, email, HubSpot or n8n actions. Multi-tenant from day one.

> **Status:** M0 (foundation) and M1 (auth and tenancy) are done (tag `v0.1-m1`): sign-up, sign-in with rotating refresh tokens, workspaces and roles, email invites, the Team page (the owner manages admins, admins manage members), the app shell, and isolation tests for every endpoint. All pages come in English and Vietnamese, dark and light. M2 (lead ingestion) is next. See [SPEC.md](SPEC.md) for the roadmap.

[![CI](https://github.com/Neronmen/Lead_Pilot/actions/workflows/ci.yml/badge.svg)](https://github.com/Neronmen/Lead_Pilot/actions/workflows/ci.yml)

## Stack

| Area | Choice |
|---|---|
| Monorepo | pnpm workspaces + Turborepo |
| API (`apps/api`) | NestJS 12, Prisma 7 + PostgreSQL 18, Redis 8 (BullMQ from M3), zod, pino, Swagger |
| Web (`apps/web`) | Next.js 16 (App Router), Tailwind CSS 4, shadcn/ui, TanStack Query, next-intl (EN/VI), next-themes (dark/light) |
| Shared (`packages/shared`) | zod schemas and types used by both apps |
| Tests | Jest + Supertest (unit and e2e against real Postgres/Redis), Vitest (web unit), Playwright + axe (web render and accessibility checks), Node test runner for `shared` |
| CI | GitHub Actions: format, lint, typecheck, unit, e2e, build, browser render checks (Playwright + axe) |

## Getting started

Requirements: **Node 24** (see `.nvmrc`), **pnpm 12** (`corepack enable` or install it globally) and **Docker Desktop**.

```bash
cp .env.example .env          # defaults match docker-compose.yml
docker compose up -d          # postgres, redis, mailpit
pnpm install
pnpm --filter api db:migrate  # create the database schema
pnpm dev                      # api + web in watch mode
```

| URL | What |
|---|---|
| http://localhost:3000 | Web app |
| http://localhost:3000/status | Internal status page (API liveness and readiness) |
| http://localhost:3001/docs | API docs (Swagger UI); JSON at `/docs-json` |
| http://localhost:3001/health/ready | Readiness probe (Postgres + Redis) |
| http://localhost:8025 | Mailpit, catches all outgoing email locally |

Optional: `docker compose --profile n8n up -d` also starts n8n on http://localhost:5678 for testing outgoing webhooks.

No API keys are needed: without them the app runs in demo mode with mock providers (required by the spec from M3 on).

Invite emails go to Mailpit (http://localhost:8025) because `.env.example` sets `SMTP_HOST=localhost`. With `SMTP_HOST` empty the app keeps them in memory only (demo mode), so you could not open the invite link: keep it set while developing.

### Environment

`.env.example` documents every variable. The ones you may want to change:

| Variable | Default | Notes |
|---|---|---|
| `JWT_ACCESS_SECRET` | dev value | Required in production (32+ characters). The dev value is refused when `NODE_ENV=production`. |
| `ENCRYPTION_KEY` | dev value | Required in production: 32 random bytes in base64 (generate: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`). Encrypts signing secrets in the database. The dev value is public: it is refused in production, so never run a shared or staging server with `NODE_ENV=development`. Losing or changing the key makes stored signing secrets unreadable (switch signing off and on again). |
| `QUEUE_WORKERS` | `on` | `on` runs the background workers (scoring, clean-up) inside the API; `off` only queues jobs. |
| `ENRICHMENT_PROVIDER` | `mock` | `mock` (made-up company info, no network) or `website` (reads the company homepage; public addresses only). |
| `LLM_PROVIDER`, `LLM_MODEL`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` | `auto`, mock | With no key the free built-in mock rates the leads. Set a key to use a real model; the key is never logged or returned. |
| `AUTH_RATE_LIMIT_PER_MINUTE` | 10 | Sign-up, sign-in and accept-invite requests per IP |
| `AUTH_REFRESH_RATE_LIMIT_PER_MINUTE` | 60 | Token refresh runs on every page load, so it has its own budget |
| `INVITE_RATE_LIMIT_PER_MINUTE` / `_PER_DAY` | 5 / 30 | Invite and resend requests per workspace (each sends email) |
| `SMTP_HOST`, `SMTP_PORT`, `EMAIL_FROM` | Mailpit | The SMTP provider has no authentication or TLS yet: Mailpit only |

The rate limiter counts in memory, per API instance; it moves to Redis in M3.

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Run api (:3001) and web (:3000) in watch mode |
| `pnpm build` | Build every package |
| `pnpm lint` / `pnpm typecheck` | ESLint / TypeScript across the repo |
| `pnpm format` / `pnpm format:check` | Prettier write / check |
| `pnpm test` | All unit tests |
| `pnpm test:e2e` | API e2e tests against the `leadpilot_test` database (Docker must be up: they also use Redis and Mailpit) |
| `pnpm test:render` | Web render checks in a real browser with a mocked API (no Docker): dark/light × EN/VI, accessibility rules, every page state. First run: `pnpm --filter web exec playwright install chromium`. Writes screenshots and `apps/web/e2e/results.md` |
| `pnpm --filter web icons` | Re-render the PNGs and app icons from the logo SVGs in `design/brand/` |
| `pnpm --filter @leadpilot/shared tlds` | Regenerate the list of real top-level domains used to check email addresses (after upgrading the `tlds` package) |
| `pnpm --filter api db:migrate --name <name>` | Create and apply a migration after editing `schema.prisma` |
| `pnpm --filter api db:deploy` | Apply pending migrations (CI, production) |
| `pnpm --filter api db:generate` | Regenerate the Prisma client (Turbo runs it automatically) |

## Project layout

```
apps/
  api/                 NestJS API
    prisma/            schema.prisma + migrations
    src/
      common/          error filter, DomainError, logging config, zod validation pipe
      config/          zod-validated environment
      health/          /health/live and /health/ready
      auth/            sign-up, sign-in, refresh tokens, guards (JWT, roles), rate limits
      invites/         invite people by email, accept an invite
      members/         the team: list, change role, remove
      audit/           change history (who changed what, before and after)
      email/           EmailProvider (SMTP, mock) and the React Email templates
      prisma/          PrismaService (driver adapter) and the workspace-scoped client
      redis/           shared Redis client
    test/              e2e tests (Jest + Supertest)
  web/                 Next.js app
    app/               pages: login, signup, invite, (app)/leads, (app)/settings/team, status
    components/        auth forms, app shell, team page, shadcn/ui components (ui/)
    lib/               auth client (token in memory, cross-tab refresh lock), i18n, team rules
    messages/          English and Vietnamese texts (every string goes through them)
    e2e/               Playwright render checks and the mocked API
packages/
  shared/              zod schemas and error codes shared by api and web (auth, team, errors)
design/brand/          logo SVGs and the PNGs generated from them
infra/postgres/init/   creates leadpilot_test on first start
docker-compose.yml     local infrastructure
docs/                  design notes, backlog, error-handling guide
```

- How errors look and how to add one: [docs/error-handling.md](docs/error-handling.md).
- What happens to a lead after it arrives (queue, company info, AI rating, review, evals): [docs/pipeline.md](docs/pipeline.md).
- Sending leads in (`POST /v1/ingest/:sourceId`: API key, optional HMAC signature, Idempotency-Key) and how duplicates are handled: [docs/dedup.md](docs/dedup.md). Lead sources and the API key / signing secret live in Settings > Lead sources and Advanced / Developer.
- Multi-tenancy: every tenant query goes through `TenantPrisma.for(workspaceId)`, composite foreign keys keep related rows in one workspace, and `apps/api/test/isolation.e2e-spec.ts` fails if an endpoint is not classified and tested across workspaces.

## Using a real AI model

With no key the app rates leads with a free built-in mock, so the demo, the tests and CI cost nothing. To
use a real model, put ONE key in `.env` (never commit it; the app never logs or returns it):

| Variable | Effect |
| --- | --- |
| `ANTHROPIC_API_KEY` | `LLM_PROVIDER=auto` then uses Anthropic (default model `claude-haiku-5-5`). |
| `OPENAI_API_KEY` | Used if no Anthropic key is set (default model `gpt-4o-mini`). |
| `LLM_PROVIDER` | `auto` (default), `mock`, `anthropic` or `openai`. `mock` forces the free mock even if a key is set. |
| `LLM_MODEL` | Optional. Use a model that is in the price table in `apps/api/src/scoring/llm.provider.ts`, or its cost is estimated high. |
| `AI_DEFAULT_MONTHLY_LIMIT_USD` | Monthly spend allowed for a workspace that set no limit (default 5; `0` = none). Over it, leads are rated by simple rules and still saved. |

**What it costs.** One lead is about 700 tokens in and 120 out. `pnpm eval` rates 50 leads, so one run is about
**$0.07** with `claude-haiku-5-5` and about **$0.01** with `gpt-4o-mini` (twice that with `--candidate`, which runs a
second prompt). These are estimates from the price table in the code, not a bill: check the provider's prices.

**About the 94%.** `pnpm eval` prints 94% with no key. That is the **rules baseline** (the mock answers with the
rule-based score) on a small hand-labelled demo set, **not an AI result**. The Anthropic and OpenAI adapters have
only been tested with a fake `fetch`: run `pnpm eval` with your own key to get a real number, and replace the demo
labels with the corrections people make in the Review queue when you have enough.

## Conventions worth knowing

- **One error shape.** Every API error is `{ "error": { "code", "message", "details"? } }`, built in a single global filter. Unexpected errors never leak internals.
- **Request ids.** Each response carries `x-request-id`, and every log line includes it.
- **Live vs ready.** `/health/live` only says the process is up; `/health/ready` checks Postgres and Redis and answers 503 when one is down. Orchestrators restart on the first and stop routing traffic on the second.
- **Tenancy.** Every tenant table has `workspaceId`; from M1 all queries go through a workspace-scoped helper.
- **Safe tests.** e2e tests refuse to run unless the target database name ends in `_test`.

- **Local only.** Docker services listen on `127.0.0.1` only, because they use development credentials.

Project rules for contributors (and Claude Code) live in [CLAUDE.md](CLAUDE.md). Decisions deferred to later milestones are tracked in [docs/backlog.md](docs/backlog.md).
