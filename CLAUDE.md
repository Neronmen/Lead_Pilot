# LeadPilot — project rules for Claude Code

Read `SPEC.md` for the product. This file is how we build it.

## Hard constraints
- Zero-cost project: never add a paid service, paid API, or anything requiring a credit card. Mock providers are the default. Real services must have a free tier and stay optional.

## Working style
- Always plan before coding a milestone or any change touching more than 3 files. Show the plan, wait for approval. Every milestone plan first pulls its items from `docs/backlog.md`.
- Work in small steps: one feature → tests → review → commit. Never leave the repo in a broken state.
- Review depth depends on the work: see "Working efficiency" below. Whatever review runs, fix what it reports before committing.
- If something in SPEC.md is ambiguous, ask instead of guessing. If you deviate from SPEC.md, say so and why.
- Prefer boring, well-known solutions. No new dependency without stating why.
- The developer is learning: when you introduce a non-obvious pattern (queues, idempotency, HMAC, RBAC guards), add a 2–3 line explanation in the PR/commit summary.

## Working efficiency
- **Security-critical work gets the full treatment**: auth, sessions and tokens, tenancy and every permission rule, secrets and crypto, input that reaches a database or another system. Tests, then the `tester` subagent, then the `code-reviewer` subagent, then commit.
- **Ordinary UI and docs get lint + typecheck + unit tests only**, with one combined `code-reviewer` pass over the whole milestone diff at its end (fix the blockers, then tag).
- **Run only the Playwright specs you changed** while working (`pnpm exec playwright test <file>` in `apps/web`); CI runs the full suite.
- **One screenshot per screen** (per state that matters) when showing the user your work, not a full matrix.
- **Plans are 20 lines at most.** Say the endpoints or files, the gaps, and the states; skip the rest.

## Stack & layout
- pnpm workspaces + Turborepo. `apps/api` (NestJS), `apps/web` (Next.js App Router), `packages/shared` (zod schemas/types).
- Database: PostgreSQL via Prisma. Queues: BullMQ + Redis. Validation: zod (shared), DTOs in Nest.
- Local infra: `docker compose up -d` (postgres, redis, mailpit, optional n8n).

## Commands (keep this section up to date as scripts are added)
- Requirements: Node 24 (`.nvmrc`), pnpm 12 (`packageManager` in package.json), Docker Desktop running.
- Setup: `cp .env.example .env`, `docker compose up -d`, `pnpm install`, `pnpm --filter api db:migrate`. Docker runs postgres, redis and mailpit; invites go to Mailpit (http://localhost:8025).
- Dev all: `pnpm dev` (api :3001, web :3000, Swagger :3001/docs, status page :3000/status). If the developer already runs it, reuse it; never start a second copy.
- Test: `pnpm test` (all unit) · api unit `pnpm --filter api test` · api e2e `pnpm --filter api test:e2e` (uses `leadpilot_test`, needs docker up: postgres, redis and mailpit) · shared `pnpm --filter @leadpilot/shared test`. The `--filter api` commands skip Turbo, so they test the last built `packages/shared/dist`: after changing a shared schema, run `pnpm --filter @leadpilot/shared build` first (root `pnpm test` / `pnpm test:e2e` rebuild it).
- Render checks: `pnpm test:render` (Playwright + axe, real Chromium, mocked API, no Docker; builds into `apps/web/.next-e2e`, serves on :3100; first run `pnpm --filter web exec playwright install chromium`). Writes screenshots to `apps/web/e2e/screenshots` and a pass/fail table to `apps/web/e2e/results.md`. It needs port 3100 free. After it runs, `next-env.d.ts` may point at `.next-e2e`: `pnpm dev` restores it.
- Lint + typecheck + format: `pnpm lint && pnpm typecheck && pnpm format:check` (fix formatting: `pnpm format`)
- Build: `pnpm build` (`nest build` wipes `apps/api/dist`, which a running `pnpm dev` uses)
- DB: new migration `pnpm --filter api db:migrate --name <name>` · apply `pnpm --filter api db:deploy` · regenerate client `pnpm --filter api db:generate` (Turbo also runs it before build/lint/typecheck/test)
- Email list: `pnpm --filter @leadpilot/shared tlds` regenerates `packages/shared/src/tlds.ts` (real top-level domains) from the `tlds` package; a test fails if they disagree.
- Seed: `pnpm --filter api seed` (not yet: arrives in M6)
- CI: `.github/workflows/ci.yml` runs format, lint, typecheck, unit, e2e, build on push to main and on PRs.

## Code conventions
- TypeScript strict. No `any` unless commented.
- NestJS: one module per domain (`auth`, `workspaces`, `sources`, `ingest`, `leads`, `pipeline`, `scoring`, `routing`, `integrations`, `dashboard`, `audit`).
- Business logic lives in services; controllers stay thin. External systems behind interfaces (`LlmProvider`, `EnrichmentProvider`, `EmailProvider`, `CrmProvider`) with a mock implementation for tests and demo mode.
- **Tenancy**: every query on tenant data must be scoped by `workspaceId`. Use `TenantPrisma.for(workspaceId)` (`apps/api/src/prisma/workspace-scope.ts`); never hand-write unscoped queries on tenant tables. The raw `PrismaService` and raw SQL are lint errors outside the allowlist in `eslint.config.mjs`: adding a file there needs a stated reason. Every new endpoint needs a cross-workspace access test.
- Errors: throw domain errors, map them in one global filter to `{ error: { code, message, details? } }`. The guide is `docs/error-handling.md` (never put internals in the message of a 5xx `DomainError`).
- Email: build every email with a React Email template under `apps/api/src/email/templates` and a plain-text part with the same words; write the copy once in a `*-copy.ts` and render both from it. Follow the approved design (docs/design-notes.md, Emails).
- Logging: pino, include `requestId` and `workspaceId`. Never log secrets, tokens, or full lead PII at info level.
- Secrets in DB encrypted with the crypto helper (AES-256-GCM). API keys stored hashed, shown once.
- Jobs must be idempotent and safe to retry. Use job ids derived from lead id + step.
- Web: server components by default, client components only when needed. Data fetching via TanStack Query on the client. UI from shadcn/ui. Every page has loading, empty, and error states.
- No web page is implemented without an approved design. The design link and notes live in `docs/design-notes.md`. Milestones are vertical slices (SPEC §7): each one builds its own pages to match the design, using the frontend-design skill, with i18n, both themes and every state from the start. Internal dev/diagnostic pages (like /status) are exempt; every user-facing page needs an approved design.
- No hard-coded user-facing strings; every string goes through i18n (EN + VI message files, see SPEC §4.9). The API returns error codes, never translated text.

## Git
- Conventional commits (`feat(ingest): add HMAC verification`).
- Commit at the end of each green step. Do not commit `.env`.

## Demo mode
- With no API keys set, the app must still run end to end using mock providers and seed data. This is required for the portfolio.
