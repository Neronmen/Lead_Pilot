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
