# Backlog: decided, not done yet

Items raised in reviews that belong to a later milestone. Each milestone plan starts by pulling its items from here. Remove an item when it ships.

## M1 – Auth & tenancy (do first)

- Signup `EMAIL_TAKEN` (409) tells a visitor which email addresses already have an account (user enumeration). Accepted trade-off for M1, limited by the signup rate limit (10/min per IP); revisit it (for example answer the same for any address and email the real owner) before production.
- Terms and Privacy Policy pages: the Sign up page says "you agree to the Terms and Privacy Policy" as plain text because the documents do not exist yet. Write them (and link them from Sign up, Login and the footers) before production.
- Team page, small follow-ups: (1) `GET /members` and `GET /invites` are not paginated; add paging before a workspace has hundreds of people. (2) The page keeps the viewer's role from `/auth/me` until reload: refetch `me` when a 403 `FORBIDDEN` comes back after an action. (3) An admin re-inviting an address that holds an expired Admin invite is told `already_invited`; a clearer answer ("only the owner can renew this") needs a new result status in the shared schema.
- Team page: the "open leads" column returns in M2 (the API already counts them); the remove confirmation then says how many leads become unassigned.
- (M1 shipped; nothing else left here.)

## M2 – Ingestion

- The embeddable form posts from customer origins, so the ingest route needs its own CORS policy. Do not widen the global single-origin `credentials: true` CORS.
- `countrySchema` accepts any two letters (`ZZ` passes). Check it against libphonenumber-js `getCountries()` when that dependency arrives.
- Normalise lead emails to lowercase before insert. The database rejects mixed-case emails (`Lead_email_lowercase_check`).

## D – UI design

- Moved to the "Schema gaps" section of [design-notes.md](design-notes.md), which now holds all schema proposals from the design work. Apply them in the milestone that first needs each one (M1: locale fields, M2: email/status, saved views, search indexes).

## M3 – Pipeline


- Real SMTP: `SmtpEmailProvider` has no authentication or TLS (Mailpit only). Add `SMTP_USER`/`SMTP_PASS` and required TLS (or a free-tier provider such as Resend behind the same `EmailProvider` interface) before sending real mail. Invites are still sent inside the request, on purpose: the Team page reports `email_failed` at once so an admin can Resend. Move them to a BullMQ job only together with a way to show a failed send later.
- Demo mode with no `SMTP_HOST` keeps invite emails only in memory (last 100), so the invite flow cannot be completed there. Either default `SMTP_HOST` to Mailpit in the demo setup (docker compose runs it) or show the invite link in the Team page when no mail server is configured (M6 seed and demo).
- The top-level domain list (`packages/shared/src/tlds.ts`) is a snapshot: a brand-new ending would be refused on sign-up and invites until `tlds` is bumped and the list regenerated. Bump it with the other dependencies (Renovate or a periodic task) and run `pnpm --filter @leadpilot/shared tlds`.
- A domain label longer than 63 characters passes the email check (it cannot be delivered). Add a length rule to `emailSchema` if it ever matters.

## M2 – Ingestion (timeline)

- Removing a member unassigns every lead they own, closed (won, lost) ones too: the owner reference has no ON DELETE action. Closed leads lose their owner attribution, which reporting may want. Keep it when the lead timeline exists (a LeadEvent per lead on removal, or a `closedBy` field).

## M2 – Ingest & sources (found while building)

- Fuzzy dedup ("same company domain + similar name") was dropped from M2: it risks merging different people. Revisit with AI in M3.
- Saved views on the Leads list, and rotating an HMAC secret without switching signing off first (today: off, then on).
- `list` sources runs a second `groupBy` over all of a workspace's leads for `lastLeadAt`; fold it into one query or store `lastLeadAt` on the source if it gets slow.
- No cap on sources per workspace and no rate limit on create/rotate: add a cap (about 50) and a throttle.
- Ingest looks a key up by its globally unique prefix: that is an unscoped query, so it needs an allowlist entry in `eslint.config.mjs` with a stated reason. Compare against a dummy hash when the prefix is unknown so both failures take the same time.
- `SourcesService.update` reads then writes without a lock: two PATCHes at once can write an audit `before` that is not the true previous state (data is correct).
- Reject an all-zero `ENCRYPTION_KEY` in production, and log a warning at boot when the public dev key is in use outside tests.
- Lead emails: lowercase before insert; validate country codes (step 3).

- Ingest answers 201/200 after the work is done. When enrichment and scoring arrive (M3), the lead is queued and the endpoint stays fast.

- Ingest signatures cover the timestamp and body but not the Idempotency-Key or source id: a captured signed request can be replayed for 5 minutes (duplicate events without a key). Consider signing `<timestamp>.<idempotency-key>.<body>` or a nonce store.
- Set explicit `requestTimeout`/`headersTimeout` in `main.ts` (slow senders hold up to 256 KB per connection before auth). Key the failed-auth limiter on the IPv6 /64, and set `trust proxy` before deploy (see M6).
- Country codes come from libphonenumber (includes non-ISO `AC`, `TA`, lacks `AQ`, `BV`); switch to an ISO 3166 list. Decide whether an invalid phone should reject the whole lead or only be flagged (today: rejected).
- Merging by phone keeps the stored email and records the other one in the `merged` event (`otherEmail`); decide whether leads should hold several emails.

- Website form and spreadsheet upload are hidden in Lead sources until M6. M6 needs a separate public form key limited to one source (with CORS and its own rate limit): the secret API key must never go into a page or snippet. "Email it to your developer" must never include a secret API key or signing secret.
- Leads list: Tier and Score columns, saved views and a source filter for Members come with scoring (M3) and later; search is `contains` on email, name, company and phone (add `pg_trgm` indexes if it gets slow).

- Two phone-only submissions at the same instant can still create two leads, and two concurrent merges into one lead can lose a custom field (read-modify-write). Fix with an advisory lock per (workspace, phone) or `SELECT ... FOR UPDATE`.
- `CryptoService` has only a `v1:` prefix and no key id: rotating `ENCRYPTION_KEY` needs a re-encrypt migration. Add `v2:<kid>:` before more secrets are stored (M5 integrations).
- Leads list: a `cursor` from another workspace gives an empty page instead of 400. Failed-auth limiter map has no hard size cap (add one). With `trust proxy` off, behind a proxy every caller shares one IP for the failed-auth limit (see M6).
- Env: the missing-`ENCRYPTION_KEY` error should print the generate command.

## M3 – Pipeline (found while building)

- Rating is by the workspace's `reviewThreshold` (default 0.6), but there is no screen to change it and the Review queue cannot show where the threshold sits on the confidence meter (`/auth/me` does not return it). Add both with Settings > General. The design's score cut-offs (when a lead is Hot, Warm or Cold) are not configurable yet: the tier comes from the AI (or the rules' fixed cut-offs 75 / 50 / 25).
- Review queue: no Undo after Approve or a rating (design), and "Skip" only moves a lead to the end for this session.
- The AI cost limit is enforced (over it, leads are "rated without AI"), but the 80% / 100% warning emails and a "Rated without AI" filter are not built. Prices per model are a hand-kept table in `llm.provider.ts`: update them when providers change prices.
- Leads stuck in `PROCESSING` (a worker killed mid-job) are re-run by BullMQ's stalled-job handling, but the recovery sweep only looks at `NEW`. Add `PROCESSING` older than ~15 minutes.
- Real Anthropic / OpenAI adapters are tested with a fake `fetch` only (no key was used). Run `pnpm eval` with a key before relying on them, and check the model names and prices.
- `pnpm eval` uses a hand-made set of 50 labelled leads and a rule-based baseline (mock). Replace the labels with exported Review-queue corrections (`Feedback` rows) once there are enough.
- The website fetch (`ENRICHMENT_PROVIDER=website`) reads only the homepage. Add a short robots.txt check and a per-host politeness delay before enabling it in production.
- Approve is not tied to the rating the person saw: if a re-score lands between opening the Review queue and clicking Approve, the new rating is the one marked approved. Send the score id with the review and require it to match. Spend is also recorded only when a score is saved: the tokens of a call whose retry fails are lost, and concurrent workers can overshoot the budget by about one call each. Record usage per call.
- A lead merged while its job is still running is not re-rated (same job id). A prompt-injected lead can still be rated Hot with high confidence and skip review: before M4 routing acts on Hot leads, consider forcing review when the text carries injection markers. Never auto-send `suggestedReply`.
- Re-scoring after the ideal customer changes is a button ("also look again") on the Ideal customer form; a rubric version number on each score would show which leads were rated by an older rubric.

## M4 – Routing & actions

- Build the "New Hot lead" alert email from the approved design (docs/design-notes.md, Emails; the plain-text version is on the canvas). The invite email's `EmailLayout` and copy pattern in `apps/api/src/email` are the model.

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
- Password reset by email ("Forgot password?" on the Login design; the link is hidden in M1 because the feature does not exist, so users who forget a password cannot recover the account yet). Works in dev through Mailpit; production needs a free-tier email provider. **Required before any production use:** signup has no email verification, so someone can register `victim@example.com` first, and when the victim is invited they would have to know that account's password. Reset (or letting an invite link, which proves control of the mailbox, take over an account that never signed in) closes this.
- Rate limit login per email as well as per IP (an attack spread over many IPs against one account), and consider an absolute session lifetime: each refresh renews the 14-day expiry, so an active session never ends on its own.
- Refresh-token reuse detection is strict (decided in M1). If users report random sign-outs (two tabs refreshing together, or a refresh response lost on reload), add a short reuse interval: a replaced token presented again within ~10 s gets a sibling token in the same family instead of revoking the family. Trade-off: a thief using a copied token inside that window is not detected.
- Bind access tokens to their sign-in (`sid` = familyId, checked in the guard) if 15 minutes of access after logout or reuse detection ever matters.
- The change history (AuditLog) keeps `before`/`after` values, which include email addresses, for ever, also after a person is removed or their account deleted. Reasonable for an audit log; decide on redaction together with account deletion.
- Account deletion: deleting a User cascades to their memberships, and `Lead.owner` (NoAction) blocks that while they own leads. Unassign their leads in every workspace first, and block it for workspace owners until ownership transfer exists.
- Overview page (UI) for `GET /overview` is not built yet. Prompt v2 under-rates limited-info cold leads as junk (held-out limited accuracy 17%): consider a prompt v3 once more labelled leads (Outcomes) exist. The dev/held-out split is only 30/20 leads, so differences of a few leads are noise.
