# Backlog: decided, not done yet

Items raised in reviews that belong to a later milestone. Each milestone plan starts by pulling its items from here. Remove an item when it ships.

## M1 – Auth & tenancy (do first)

- Web API client: `credentials: 'include'` for the refresh-token cookie.
- Add `workspaceId` to the log context (pino `assign`) once requests are authenticated.
- Logger tests: header and query-string stripping, `/health` excluded from access logs (more valuable once auth headers exist).
- `DomainError` with a 5xx status passes its message to the client. Fine for deliberate messages, but document it in the error-handling guide so no one puts internals there.

## M2 – Ingestion

- The embeddable form posts from customer origins, so the ingest route needs its own CORS policy. Do not widen the global single-origin `credentials: true` CORS.
- Normalise lead emails to lowercase before insert. The database rejects mixed-case emails (`Lead_email_lowercase_check`).

## D – UI design

- Moved to the "Schema gaps" section of [design-notes.md](design-notes.md), which now holds all schema proposals from the design work. Apply them in the milestone that first needs each one (M1: locale fields, M2: email/status, M5: saved views, search indexes).

## M3 – Pipeline

- The auth rate limiter (`@nestjs/throttler`) keeps its counters in memory, so each API instance counts on its own. Move its storage to Redis when the Redis-backed queues arrive.

## M4 – Routing & actions

- Removing a member leaves their leads unassigned (M1). The Team design says those leads "go back through your routing rules": reroute them through the rules engine once it exists.

## M6 – Polish & deploy

- "Explore the demo workspace" login on the Login design.
- Refresh cookie and cross-site deploys: the cookie is `SameSite=Lax`, `Path=/auth`, which works while web and API share a site (localhost, or `app.example.com` + `api.example.com`). If they end up on different sites, either put the API behind the web domain (preferred: the cookie stays first-party) or switch to `SameSite=None; Secure`. Record the choice in the README.
- Decide whether `/docs` (Swagger) stays public in the deployed demo, or sits behind `NODE_ENV !== 'production'` or a flag.
- Pin GitHub Actions to commit SHAs (at least the third-party `pnpm/action-setup`).
- Consider pinning `runs-on: ubuntu-24.04`: `ubuntu-latest` is moving to Ubuntu 26.
- Web tests (Playwright): `/status` loading, error and API-down states; `lib/api.ts` error handling.

## Later (no milestone yet)

- Ownership transfer: Owner hands the workspace to an Admin. Until then, nobody can grant, change or remove the OWNER role.
- Password reset by email ("Forgot password?" on the Login design). Works in dev through Mailpit; production needs a free-tier email provider.
- Account deletion: deleting a User cascades to their memberships, and `Lead.owner` (NoAction) blocks that while they own leads. Unassign their leads in every workspace first, and block it for workspace owners until ownership transfer exists.
