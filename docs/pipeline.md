# What happens to a lead after it arrives

```
ingest (API key, HMAC, dedup)  ->  queue  ->  enrich  ->  score  ->  SCORED or NEEDS_REVIEW
                                                                      (routing: M4)
```

The ingest endpoint saves the lead, puts a job on the queue and answers. A worker does the slow
part later and retries it if it fails, so a slow website or a busy AI never slows down a sender.

## The queue

- BullMQ on the Redis the app already uses. One job per lead; the job id is `<leadId>-score`, so
  queueing the same lead twice while a job waits does nothing (a burst of merges is rated once) and a
  retry never duplicates work.
- 5 tries with growing waits (5 s, 10 s, 20 s, 40 s). When every try failed, the lead is rated by simple
  rules and sent to review: it is never lost and never left half-processed.
- A lead whose job was lost (Redis was down) is queued again by a sweep every 5 minutes.
- Every night: raw payloads older than 90 days are blanked (lead and timeline), old `IngestAttempt`,
  expired idempotency keys and spent refresh tokens are deleted.
- `QUEUE_WORKERS=off` only queues (used by the tests); a second process can run the workers.

## Company info (enrichment)

- `EnrichmentProvider`: `mock` (default: made-up text, no network) or `website`.
- `website` reads the homepage of the lead's company domain (free-mail leads have none). Because the
  address came from a stranger's form it is locked down against SSRF: only http(s) on ports 80/443,
  never an IP-address host, the host is resolved by us and **every** address must be public (loopback,
  private, link-local and the cloud metadata address are refused, IPv4-in-IPv6 included), the connection
  goes to exactly that checked address (no DNS rebinding), at most 3 redirects each checked again,
  8 seconds, 256 KB, HTML only, no compression.
- Results are cached per domain for 7 days (1 day when the page could not be read).

## AI rating

- The workspace's **ideal customer** (Settings) is the yardstick. The AI must answer with JSON that
  passes a schema (score 0-100, tier, isSpam, confidence, reasons). An invalid answer is asked again
  once; if it is still invalid the rules rate the lead and it goes to review.
- Text from the lead and from the website is **untrusted**: it is JSON-encoded with `<` escaped inside
  fenced blocks, so it cannot close a block or give the AI orders, and the prompt says so.
- Every score records the prompt version, model, tokens, cost and time. Prompts are versioned in the
  database (`PromptVersion`); to change the wording add version 2, never edit version 1.
- **Cost limit:** over the workspace's monthly AI limit, leads are rated by the rules ("rated without
  AI") and still saved. They can be looked at again later (`POST /leads/rescore`).
- No API key means the free built-in mock. Anthropic and OpenAI adapters use plain `fetch`; the key
  travels in a header only and is never in an error or a log.
- Confidence under the workspace threshold (0.6), or any rule-based rating, sends the lead to the
  **Review queue**.

## Review

A person can approve the rating or override the tier (with an optional note). Both are kept as
`Feedback` (who, what it was, what it became): the labels `pnpm eval` is meant to use. **A person's
override is final**: later automatic scoring is recorded but never changes that lead's rating.

## Evals

`pnpm eval` rates 50 hand-labelled leads (`evals/leads.jsonl`, against `evals/rubric.json`) and prints
accuracy, a confusion matrix by tier, average cost and latency. `pnpm eval --candidate prompt.txt`
runs a second prompt and shows the difference. With no key it measures the free mock (the rule
baseline), which proves the plumbing, not a real model; the labels are a small demo set.

### Information level, outcomes, overview (M3.5)

- Every score has an **information level**: `limited` (at most 1 of company, message, budget, timeline, job title, readable website), `enough` (2-3), `rich` (4+). A `limited` lead is never Hot (capped to Warm, score at most 74) and goes to the Review queue with a plain reason (`limited_info`).
- Ingest accepts and stores `message`, `budget`, `timeline`, `jobTitle`, `interest`. `GET /sources` shows per source which useful fields arrived in the last 30 days.
- `POST /leads/:id/outcome` marks a lead Won / Lost / Bad lead (bad = junk), with who and when. These are the real labels for later evals.
- `GET /overview` returns % junk filtered, median time from received to first rating, and leads by tier and by information level. UI comes later.
- Prompt **v2** (calibrated tiers, reads the new fields) is the default. Protocol: `pnpm eval --split dev --show-errors` to tune (30 leads), `pnpm eval --split held` once to measure (20 leads, never tuned on). Gemini 3.5 Flash Lite: dev v1 60% -> v2 83%; held-out v1 55% -> v2 65%. Weak spot: limited-info cold leads rated junk.

## Routing and actions (M4a)

After a lead is rated, `RoutingRunner` (step 3 of the pipeline) evaluates the workspace's rules.

- **Rules** (`/routing/rules`, Admin/Owner): ordered, first matching rule wins; an "always run" rule runs too and never stops the others. Conditions are AND/OR groups over `score`, `tier`, `country`, `source`, `industry` (the lead's own `industry` custom field), `isFreeMail` and custom fields. `POST /routing/test` is a dry run: it says which rule decides and shows every comparison, and sends nothing.
- **Actions**: assign (a person, or the next member of a team: round-robin by `lastAssignedAt`; a lead that already has an owner is never taken away), tag, "New Hot lead" email (React Email, EN/VI), Slack, Telegram, outgoing webhook (signed: `X-LeadPilot-Signature` = HMAC-SHA256 of `<timestamp>.<body>`) and HubSpot contact.
- **Not acted on while it waits for a person**: a lead in the Review queue is routed after it is approved or corrected.
- **Runs** (`ActionRun`): assign and tag run at once; the rest are queued (BullMQ queue `actions`, 5 tries, 10 s doubling). A run is unique per lead + rule + position, so routing twice sends nothing twice. A temporary failure is retried; the last try, or a failure no retry can fix (bad config, integration off, 401/403/404), leaves it `DEAD`. `GET /actions` lists runs; `POST /actions/:id/retry` queues a failed one again.
- **Integrations** (`/integrations`): the token or address is encrypted (AES-256-GCM, bound to its row) and never returned; an outgoing webhook's signing secret is shown once. "Send test message" stores the result and shows `needs_attention` with a short code (`http_401`, `timeout`...) when it fails.
- **`ACTIONS_MODE=mock`** (default): nothing leaves the machine; the call is recorded in memory and the run succeeds. `live` makes real calls. Outgoing addresses must be public https: private, loopback and link-local addresses are refused when an integration is saved and again, with a DNS check, before each call; redirects are not followed. Slack addresses must be on `hooks.slack.com`.
- Known limit: the DNS check and the call resolve the name separately, so a hostile DNS server could answer differently the second time (DNS rebinding). Fine for a portfolio; connect to the checked address (pin it) before real use. Answers from the other service are read up to 64 KB only, and Slack text has `&`, `<`, `>` escaped so a lead cannot ping a channel.
