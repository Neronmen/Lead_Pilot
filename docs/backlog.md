# Backlog: decided, not done yet

Items raised in reviews that belong to a later milestone. Each milestone plan starts by pulling its items from here. Remove an item when it ships.

## M1 – Auth & tenancy (do first)

- Web API client: `credentials: 'include'` for the refresh-token cookie.
- Web auth client (step 8): refresh under a cross-tab lock (`navigator.locks.request('lp-refresh', ...)`). Reuse detection revokes the whole sign-in when two tabs refresh with the same token at once, so per-tab single-flight is not enough. A 429 on refresh means "retry later", not "signed out".
- Logger tests: header and query-string stripping, `/health` excluded from access logs (more valuable once auth headers exist).
- `DomainError` with a 5xx status passes its message to the client. Fine for deliberate messages, but document it in the error-handling guide so no one puts internals there.

## M2 – Ingestion

- The embeddable form posts from customer origins, so the ingest route needs its own CORS policy. Do not widen the global single-origin `credentials: true` CORS.
- `countrySchema` accepts any two letters (`ZZ` passes). Check it against libphonenumber-js `getCountries()` when that dependency arrives.
- Normalise lead emails to lowercase before insert. The database rejects mixed-case emails (`Lead_email_lowercase_check`).

## D – UI design

- Moved to the "Schema gaps" section of [design-notes.md](design-notes.md), which now holds all schema proposals from the design work. Apply them in the milestone that first needs each one (M1: locale fields, M2: email/status, saved views, search indexes).

## M3 – Pipeline

- The auth rate limiter (`@nestjs/throttler`) keeps its counters in memory, so each API instance counts on its own. Move its storage to Redis when the Redis-backed queues arrive.

- Real SMTP: `SmtpEmailProvider` has no authentication or TLS (Mailpit only). Add `SMTP_USER`/`SMTP_PASS` and required TLS (or a free-tier provider such as Resend behind the same `EmailProvider` interface) before sending real mail. Invites are sent inside the request until the M3 job queue exists; move them to a BullMQ job then.
- Demo mode with no `SMTP_HOST` keeps invite emails only in memory (last 100), so the invite flow cannot be completed there. Either default `SMTP_HOST` to Mailpit in the demo setup (docker compose runs it) or show the invite link in the Team page when no mail server is configured (M6 seed and demo).
- Delete spent refresh tokens: a daily job removing rows revoked or expired more than a day ago.

## M2 – Ingestion (timeline)

- Removing a member unassigns every lead they own, closed (won, lost) ones too: the owner reference has no ON DELETE action. Closed leads lose their owner attribution, which reporting may want. Keep it when the lead timeline exists (a LeadEvent per lead on removal, or a `closedBy` field).

## M4 – Routing & actions

- Assignment vs removal: `remove` unassigns a person's leads and then deletes the membership at READ COMMITTED. A routing job assigning a lead to that person in between would make the delete fail with an FK error (409). Assignment must take the membership row lock, or removal must retry.
- Change history page: entries written in one request can share a `createdAt`, and Prisma generates UUIDv7 ids client-side without a monotonic guarantee within a millisecond, so `id` is not a reliable tie-break. Add a `seq` column (or set `createdAt` once per request) when this page needs a stable order.
- Removing a member leaves their leads unassigned (M1). The Team design says those leads "go back through your routing rules": reroute them through the rules engine once it exists.

## M6 – Polish & deploy

- "Explore the demo workspace" login on the Login design.
- Set Express `trust proxy` to the exact number of proxy hops of the host. Without it, behind a proxy every user shares one rate-limit bucket (one attacker locks out login for all); with `true`, `X-Forwarded-For` can be spoofed.
- Refresh cookie and cross-site deploys: the cookie is `SameSite=Lax`, `Path=/auth`, which works while web and API share a site (localhost, or `app.example.com` + `api.example.com`). If they end up on different sites, either put the API behind the web domain (preferred: the cookie stays first-party) or switch to `SameSite=None; Secure`. Record the choice in the README. Caveat: the cookie has `Path=/auth`, so serving the API under a prefix (`/api/auth/...`) needs the path changed too, or the browser never sends it.
- Decide whether `/docs` (Swagger) stays public in the deployed demo, or sits behind `NODE_ENV !== 'production'` or a flag.
- Pin GitHub Actions to commit SHAs (at least the third-party `pnpm/action-setup`).
- Consider pinning `runs-on: ubuntu-24.04`: `ubuntu-latest` is moving to Ubuntu 26.
- Web tests (Playwright): `/status` loading, error and API-down states; `lib/api.ts` error handling.

## Later (no milestone yet)

- Ownership transfer: Owner hands the workspace to an Admin. Until then, nobody can grant, change or remove the OWNER role.
- Password reset by email ("Forgot password?" on the Login design). Works in dev through Mailpit; production needs a free-tier email provider. **Required before any production use:** signup has no email verification, so someone can register `victim@example.com` first, and when the victim is invited they would have to know that account's password. Reset (or letting an invite link, which proves control of the mailbox, take over an account that never signed in) closes this.
- Rate limit login per email as well as per IP (an attack spread over many IPs against one account), and consider an absolute session lifetime: each refresh renews the 14-day expiry, so an active session never ends on its own.
- Refresh-token reuse detection is strict (decided in M1). If users report random sign-outs (two tabs refreshing together, or a refresh response lost on reload), add a short reuse interval: a replaced token presented again within ~10 s gets a sibling token in the same family instead of revoking the family. Trade-off: a thief using a copied token inside that window is not detected.
- Bind access tokens to their sign-in (`sid` = familyId, checked in the guard) if 15 minutes of access after logout or reuse detection ever matters.
- The change history (AuditLog) keeps `before`/`after` values, which include email addresses, for ever, also after a person is removed or their account deleted. Reasonable for an audit log; decide on redaction together with account deletion.
- Account deletion: deleting a User cascades to their memberships, and `Lead.owner` (NoAction) blocks that while they own leads. Unassign their leads in every workspace first, and block it for workspace owners until ownership transfer exists.
