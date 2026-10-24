# LeadPilot — AI Lead Qualification & Routing Platform

## 1. Problem

B2B companies and agencies receive leads from many places (website forms, landing pages, CSV lists, ads, partner webhooks). In practice:

- 30–60% of inbound leads are junk (spam, students, competitors, fake emails), and sales reps waste hours on them.
- Hot leads wait hours for a reply, because nobody is alerted and routing is manual.
- The same person arrives 3 times from 3 sources and gets 3 different reps.
- Data lives in spreadsheets; the CRM is incomplete; nobody can answer "which source brings revenue?"

Freelance marketplaces are full of jobs asking for exactly this: "filter junk leads", "score leads with AI", "push to HubSpot", "notify Slack", "replace our spreadsheet". LeadPilot is a production-grade, multi-tenant version of that system. It is both a portfolio piece and a product that could be sold as SaaS.

## 2. Users & roles

- **Owner**: creates the workspace, billing (later), manages members and API keys.
- **Admin**: configures sources, ICP rubric, routing rules, integrations.
- **Member (sales rep)**: sees assigned leads, reviews low-confidence leads, marks outcomes.

Multi-tenant: every record belongs to a `workspace`. No query may cross workspaces.

## 3. Core flow

```
Source (webhook / embed form / CSV)
  → Ingest API (auth by source API key + optional HMAC signature, idempotency key)
  → Normalize (trim, lowercase email, E.164 phone, extract domain)
  → Deduplicate (email, phone, domain+name) → merge into existing contact or create new
  → Queue: enrich  → fetch company website metadata (title, description, text snippet), detect free-mail domains
  → Queue: score   → LLM scores against workspace ICP rubric, returns validated JSON
  → Queue: route   → rules engine decides owner + actions
  → Queue: actions → email / Slack / Telegram / CRM push / outgoing webhook (n8n), each with retries
  → Timeline event written for every step
```

Every step is a background job (BullMQ + Redis) with retries, exponential backoff, and a dead-letter queue. A failed integration must never lose a lead.

## 4. Feature requirements

### 4.1 Ingestion
- `POST /v1/ingest/:sourceId` — API key in header; optional HMAC-SHA256 signature of the body (`X-Signature`), timestamp header with 5-minute replay window.
- `Idempotency-Key` header: same key within 24h returns the original result and does not create a duplicate.
- Embeddable form: a small script tag / iframe served by the web app that posts to the ingest API (with honeypot field + rate limiting).
- CSV import: upload → column mapping UI → preview first 20 rows → import as a background job with progress and per-row error report.
- Payload stored raw (`rawPayload` JSON) for debugging and re-processing.

### 4.2 Normalization & dedup
- Email validation (syntax + disposable-domain list + free-mail flag).
- Phone normalized to E.164 (libphonenumber-js), default country per workspace.
- Dedup priority: exact email → exact phone → (domain + similar full name). Merge keeps the newest non-empty values and records a `merged` timeline event.

### 4.3 Enrichment
- Pluggable `EnrichmentProvider` interface. Implement: `WebsiteMetaProvider` (fetch homepage, extract title/description/first ~2k chars of text, with timeout and size limit) and `MockProvider` for tests/demo.
- Enrichment results cached per domain for 7 days.

### 4.4 AI scoring
- Workspace defines an **ICP rubric**: target industries, company size, countries, budget signals, disqualifiers, plus free-text notes.
- `LlmProvider` interface with adapters: Anthropic, OpenAI, and `MockLlmProvider` (deterministic, used when no API key — the demo must run with zero keys).
- Output validated with zod. Schema:
  ```json
  {
    "score": 0-100,
    "tier": "hot|warm|cold|junk",
    "isSpam": boolean,
    "confidence": 0-1,
    "reasons": ["short reason", "..."],
    "suggestedReply": "string (optional)"
  }
  ```
- Invalid output → one repair retry → else fallback to rule-based score and flag `needsReview`.
- **Prompt versioning**: prompts stored in DB with version number; every score records `promptVersion`, `model`, `inputTokens`, `outputTokens`, `costUsd`, `latencyMs`.
- Confidence < workspace threshold (default 0.6) → lead goes to **Review Queue**.
- Human override of tier/score is stored as `feedback` (used by evals).

### 4.5 Routing rules engine
- Ordered rules per workspace; first match wins (plus an optional "always run" flag).
- Conditions (AND/OR groups): `score`, `tier`, `country`, `source`, `industry`, `isFreeMail`, custom field equals/contains.
- Actions: assign owner (specific user or round-robin within a team), set tags, send email template, notify Slack/Telegram, push to CRM, call outgoing webhook.
- Rule editor UI with a **"Test rule against a sample lead"** button showing which rule matched and why.

### 4.6 Integrations (actions)
- **Email**: provider interface (SMTP via nodemailer; Resend adapter optional). Templates with variables `{{lead.firstName}}`.
- **Slack**: incoming webhook URL. **Telegram**: bot token + chat id.
- **HubSpot**: create/update contact via private app token (free developer account). Store external id on the lead.
- **Outgoing webhook**: signed with HMAC so n8n/Make/Zapier can verify; includes the full lead + score.
- Every action logs status, attempts, last error. Admin can **retry** a failed action from the UI.
- Secrets (tokens) encrypted at rest (AES-256-GCM with key from env).

### 4.7 Dashboard (web)
- **Overview**: leads per day (by source), tier distribution, median time-to-first-action, junk rate, LLM cost this month.
- **Leads list**: server-side pagination, filters (tier, source, owner, date, status), search, saved views.
- **Lead detail**: contact info, enrichment, AI reasons, **timeline** of every event, actions with status, override form.
- **Review Queue**: low-confidence leads, approve/override in one click, keyboard shortcuts.
- **Settings**: sources & API keys (show once, store hashed), ICP rubric, routing rules, integrations, members & roles, prompt versions.

### 4.8 Platform / non-functional
- Auth: email + password (argon2), JWT access token (15 min) + rotating refresh token (httpOnly cookie). Invite members by email link.
- RBAC guard in NestJS; workspace scoping enforced in one place (repository layer / Prisma middleware), with tests proving isolation.
- Rate limiting on ingest and auth endpoints.
- Structured logging (pino) with request id; health endpoints `/health/live`, `/health/ready`.
- OpenAPI (Swagger) docs at `/docs`.
- Audit log for settings changes (who changed what, before/after).
- Seed script creating a demo workspace with ~200 realistic fake leads across sources and tiers.
- **Eval script**: `pnpm eval` runs the scorer on a labeled set of 50 leads (`evals/leads.jsonl`) and prints accuracy, confusion matrix by tier, avg cost, avg latency. Compares two prompt versions.

## 5. Tech stack

- Monorepo: pnpm workspaces + Turborepo
  - `apps/api` — NestJS, Prisma, PostgreSQL, BullMQ, Redis, zod, pino
  - `apps/web` — Next.js (App Router), TypeScript, Tailwind, shadcn/ui, TanStack Query, Recharts
  - `packages/shared` — zod schemas & types shared by api and web
- Tests: Jest + Supertest (api unit/e2e against a real Postgres from docker-compose), Playwright smoke tests (web)
- Dev: `docker-compose.yml` with postgres + redis (+ optional n8n and Mailpit for local email)
- CI: GitHub Actions — lint, typecheck, test, build
- Use the latest stable versions; check docs when unsure about an API.

## 6. Data model (starting point)

`Workspace, User, Membership(role), Team, Source(apiKeyHash, hmacSecretEnc), Lead(workspaceId, sourceId, email, phone, firstName, lastName, company, domain, country, customFields JSON, rawPayload JSON, status, tier, score, ownerId, externalIds JSON), LeadEvent(type, data JSON, createdAt), Enrichment(domain, data, expiresAt), Score(leadId, promptVersionId, model, output JSON, tokens, costUsd, latencyMs), PromptVersion, IcpRubric, RoutingRule(order, conditions JSON, actions JSON, enabled), Integration(type, configEnc), ActionRun(leadId, type, status, attempts, lastError), Feedback, AuditLog, IdempotencyKey, RefreshToken, Invite`

## 7. Milestones (each ends with passing tests + a commit)

- **M0 – Foundation**: monorepo, docker-compose, NestJS + Next.js skeletons, Prisma schema v1, CI, health checks, Swagger, logging.
- **M1 – Auth & tenancy**: signup/login/refresh, workspaces, roles, invites, workspace isolation tests.
- **M2 – Ingestion**: sources, API keys, HMAC, idempotency, normalization, dedup, timeline events, rate limit.
- **M3 – Pipeline**: BullMQ queues, enrichment, LLM scoring with mock + real adapters, prompt versions, cost tracking, review queue.
- **M4 – Routing & actions**: rules engine + tester, email/Slack/Telegram/webhook/HubSpot actions, retries, DLQ, retry-from-UI.
- **M5 – Dashboard**: overview charts, leads list, lead detail timeline, review queue UI, settings pages.
- **M6 – Polish & proof**: seed data, eval script, embed form, CSV import, Playwright smoke, README with architecture diagram + GIFs, deploy.

**Must-have for portfolio demo**: M0–M5 + seed data + README. CSV import, HubSpot, and eval script are high-value stretch items (do them — clients love them).

## 8. Definition of done (per feature)

- Types strict, no `any` without a comment explaining why.
- Input validated at the edge (zod / class-validator).
- Unit tests for logic, e2e test for each endpoint (happy path + auth failure + cross-workspace access denied).
- Errors return consistent JSON shape `{ error: { code, message, details? } }`.
- No secrets in code or logs.
- Docs updated (README / Swagger descriptions).
