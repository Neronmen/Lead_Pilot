# LeadPilot

AI lead qualification and routing for B2B teams. Leads arrive from forms, webhooks and CSV files; LeadPilot deduplicates them, enriches the company, scores them against your ideal customer profile with an LLM, and routes them to the right rep, with Slack, email, HubSpot or n8n actions. Multi-tenant from day one.

> **Status:** milestone M0 (foundation) is done: monorepo, local infrastructure, API and web skeletons, database schema v1, health checks and CI. Product features arrive from M1 on. See [SPEC.md](SPEC.md) for the full roadmap.

[![CI](https://github.com/Neronmen/Lead_Pilot/actions/workflows/ci.yml/badge.svg)](https://github.com/Neronmen/Lead_Pilot/actions/workflows/ci.yml)

## Stack

| Area | Choice |
|---|---|
| Monorepo | pnpm workspaces + Turborepo |
| API (`apps/api`) | NestJS 12, Prisma 7 + PostgreSQL 18, Redis 8 (BullMQ from M3), zod, pino, Swagger |
| Web (`apps/web`) | Next.js 16 (App Router), Tailwind CSS 4, shadcn/ui, TanStack Query |
| Shared (`packages/shared`) | zod schemas and types used by both apps |
| Tests | Jest + Supertest (unit and e2e against real Postgres/Redis), Node test runner for `shared` |
| CI | GitHub Actions: format, lint, typecheck, unit, e2e, build |

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

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Run api (:3001) and web (:3000) in watch mode |
| `pnpm build` | Build every package |
| `pnpm lint` / `pnpm typecheck` | ESLint / TypeScript across the repo |
| `pnpm format` / `pnpm format:check` | Prettier write / check |
| `pnpm test` | All unit tests |
| `pnpm test:e2e` | API e2e tests against the `leadpilot_test` database (Docker must be up) |
| `pnpm --filter api db:migrate --name <name>` | Create and apply a migration after editing `schema.prisma` |
| `pnpm --filter api db:deploy` | Apply pending migrations (CI, production) |
| `pnpm --filter api db:generate` | Regenerate the Prisma client (Turbo runs it automatically) |

## Project layout

```
apps/
  api/                 NestJS API
    prisma/            schema.prisma + migrations
    src/
      common/          error filter, DomainError, logging config
      config/          zod-validated environment
      health/          /health/live and /health/ready
      prisma/          PrismaService (driver adapter)
      redis/           shared Redis client
    test/              e2e tests (Jest + Supertest)
  web/                 Next.js app
    app/status/        internal status page
    components/ui/     shadcn/ui components
    lib/api.ts         typed API client
packages/
  shared/              zod schemas: error envelope, health response
infra/postgres/init/   creates leadpilot_test on first start
docker-compose.yml     local infrastructure
```

## Conventions worth knowing

- **One error shape.** Every API error is `{ "error": { "code", "message", "details"? } }`, built in a single global filter. Unexpected errors never leak internals.
- **Request ids.** Each response carries `x-request-id`, and every log line includes it.
- **Live vs ready.** `/health/live` only says the process is up; `/health/ready` checks Postgres and Redis and answers 503 when one is down. Orchestrators restart on the first and stop routing traffic on the second.
- **Tenancy.** Every tenant table has `workspaceId`; from M1 all queries go through a workspace-scoped helper.
- **Safe tests.** e2e tests refuse to run unless the target database name ends in `_test`.

- **Local only.** Docker services listen on `127.0.0.1` only, because they use development credentials.

Project rules for contributors (and Claude Code) live in [CLAUDE.md](CLAUDE.md). Decisions deferred to later milestones are tracked in [docs/backlog.md](docs/backlog.md).
