# Backlog: decided, not done yet

Items raised in reviews that belong to a later milestone. Each milestone plan starts by pulling its items from here. Remove an item when it ships.

## M1 – Auth & tenancy (do first)

- **Same-workspace foreign keys.** Child rows carry `workspaceId`, but each FK points only at the parent's `id`, so Postgres does not stop a lead in workspace A from referencing a source, owner or team member in workspace B. The scoping helper only filters the table being queried, so it cannot catch this alone.
  - Add `@@unique([id, workspaceId])` on Team, Membership, Source, Lead, RoutingRule and Integration.
  - Make the relations composite (`fields: [sourceId, workspaceId], references: [id, workspaceId]`). This covers TeamMember→Team/Membership, Lead→Source, IdempotencyKey→Source, LeadEvent/Score/Feedback/ActionRun→Lead.
  - Owner: `Lead.owner → Membership(workspaceId, userId)` instead of the global User.
  - Caveat: `onDelete: SetNull` on a composite FK would also null `workspaceId`. For Lead.owner, ActionRun.rule/integration and Feedback.score, use `NoAction` and clear the reference in the service that deletes the parent.
  - One e2e test per composite FK proving a cross-workspace insert is rejected.
  - Raised by code review on M0; deferred to M1 in the approved M0 plan (Q13), when the tenancy helper is built.
- Map Prisma errors in the global filter: `P2002` → `CONFLICT`, `P2025` → `NOT_FOUND`.
- Web API client: `credentials: 'include'` for the refresh-token cookie.
- Add `workspaceId` to the log context (pino `assign`) once requests are authenticated.
- Logger tests: header and query-string stripping, `/health` excluded from access logs (more valuable once auth headers exist).
- `DomainError` with a 5xx status passes its message to the client. Fine for deliberate messages, but document it in the error-handling guide so no one puts internals there.

## M2 – Ingestion

- The embeddable form posts from customer origins, so the ingest route needs its own CORS policy. Do not widen the global single-origin `credentials: true` CORS.
- Normalise lead emails to lowercase before insert. The database rejects mixed-case emails (`Lead_email_lowercase_check`).

## D – UI design (raise in docs/design-notes.md)

- `Lead.dealValue` is "in the workspace's currency", but Workspace has no `currency` column.
- SPEC §4.7 "saved views" has no model yet.
- Leads search (email, name, company) will need `pg_trgm` GIN indexes.
- PromptVersion allows several active versions per name. Add a partial unique index `ON "PromptVersion"(name) WHERE "isActive"`.
- CHECK constraints: `score` 0–100, `confidence` and `reviewThreshold` 0–1.

## M6 – Polish & deploy

- Decide whether `/docs` (Swagger) stays public in the deployed demo, or sits behind `NODE_ENV !== 'production'` or a flag.
- Pin GitHub Actions to commit SHAs (at least the third-party `pnpm/action-setup`).
- Consider pinning `runs-on: ubuntu-24.04`: `ubuntu-latest` is moving to Ubuntu 26.
- Web tests (Playwright): `/status` loading, error and API-down states; `lib/api.ts` error handling.
