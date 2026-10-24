# LeadPilot — project rules for Claude Code

Read `SPEC.md` for the product. This file is how we build it.

## Working style
- Always plan before coding a milestone or any change touching more than 3 files. Show the plan, wait for approval. Every milestone plan first pulls its items from `docs/backlog.md`.
- Work in small steps: one feature → tests → review → commit. Never leave the repo in a broken state.
- After finishing a feature, delegate to the `tester` subagent, then the `code-reviewer` subagent. Fix what they report before committing.
- If something in SPEC.md is ambiguous, ask instead of guessing. If you deviate from SPEC.md, say so and why.
- Prefer boring, well-known solutions. No new dependency without stating why.
- The developer is learning: when you introduce a non-obvious pattern (queues, idempotency, HMAC, RBAC guards), add a 2–3 line explanation in the PR/commit summary.

## Stack & layout
- pnpm workspaces + Turborepo. `apps/api` (NestJS), `apps/web` (Next.js App Router), `packages/shared` (zod schemas/types).
- Database: PostgreSQL via Prisma. Queues: BullMQ + Redis. Validation: zod (shared), DTOs in Nest.
- Local infra: `docker compose up -d` (postgres, redis, mailpit, optional n8n).

## Commands (keep this section up to date as scripts are added)
- Requirements: Node 24 (`.nvmrc`), pnpm 12 (`packageManager` in package.json), Docker Desktop running.
- Setup: `cp .env.example .env`, `docker compose up -d`, `pnpm install`, `pnpm --filter api db:migrate`
- Dev all: `pnpm dev` (api :3001, web :3000, Swagger :3001/docs, status page :3000/status). If the developer already runs it, reuse it; never start a second copy.
- Test: `pnpm test` (all unit) · api unit `pnpm --filter api test` · api e2e `pnpm --filter api test:e2e` (uses `leadpilot_test`, needs docker up) · shared `pnpm --filter @leadpilot/shared test`
- Lint + typecheck + format: `pnpm lint && pnpm typecheck && pnpm format:check` (fix formatting: `pnpm format`)
- Build: `pnpm build` (`nest build` wipes `apps/api/dist`, which a running `pnpm dev` uses)
- DB: new migration `pnpm --filter api db:migrate --name <name>` · apply `pnpm --filter api db:deploy` · regenerate client `pnpm --filter api db:generate` (Turbo also runs it before build/lint/typecheck/test)
- Seed: `pnpm --filter api seed` (not yet: arrives in M6)
- CI: `.github/workflows/ci.yml` runs format, lint, typecheck, unit, e2e, build on push to main and on PRs.

## Code conventions
- TypeScript strict. No `any` unless commented.
- NestJS: one module per domain (`auth`, `workspaces`, `sources`, `ingest`, `leads`, `pipeline`, `scoring`, `routing`, `integrations`, `dashboard`, `audit`).
- Business logic lives in services; controllers stay thin. External systems behind interfaces (`LlmProvider`, `EnrichmentProvider`, `EmailProvider`, `CrmProvider`) with a mock implementation for tests and demo mode.
- **Tenancy**: every query on tenant data must be scoped by `workspaceId`. Use the shared scoping helper; never hand-write unscoped queries on tenant tables. Every new endpoint needs a cross-workspace access test.
- Errors: throw domain errors, map them in one global filter to `{ error: { code, message, details? } }`.
- Logging: pino, include `requestId` and `workspaceId`. Never log secrets, tokens, or full lead PII at info level.
- Secrets in DB encrypted with the crypto helper (AES-256-GCM). API keys stored hashed, shown once.
- Jobs must be idempotent and safe to retry. Use job ids derived from lead id + step.
- Web: server components by default, client components only when needed. Data fetching via TanStack Query on the client. UI from shadcn/ui. Every page has loading, empty, and error states.
- No web page is implemented without an approved design. The design link and notes live in `docs/design-notes.md`; implement M5 to match them. Internal dev/diagnostic pages (like /status) are exempt; every user-facing page needs an approved design.

## Git
- Conventional commits (`feat(ingest): add HMAC verification`).
- Commit at the end of each green step. Do not commit `.env`.

## Demo mode
- With no API keys set, the app must still run end to end using mock providers and seed data. This is required for the portfolio.
