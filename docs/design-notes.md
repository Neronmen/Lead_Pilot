# LeadPilot design notes

**Design canvas:** https://claude.ai/artifact/VjAxmCrJVRUxSPxGzwAT5f (private until shared from the page's Share menu)

**Status:** milestone D in progress. Batch 1 (foundations, landing, auth, overview, leads list): direction approved, and the six feedback fixes are applied on the canvas. Batch 2 (lead detail, review queue): approved, with the audience rule and chart fix applied. Batch 3 (routing rules, sources and API keys, ICP rubric) is on the canvas and awaits feedback. Batch 4 (integrations, members and roles, prompt versions, audit log) waits for that feedback. Per-screen field, filter and metric lists are added here as each batch is approved; M5 implements the screens to match.

## Visual direction: refined cyber

- **Dark is the default theme, light is the alternate.** Both are complete; neither is an automatic inversion.
- **Surfaces:** near-black blue-violet, layered by lightness: background → card → raised → hover. Layers are separated by lightness and 1px borders, not shadows.
- **One neon accent**, used only for primary actions, focus rings, the Hot tier and key highlights. **Approved: accent A, electric cyan.** (Acid lime, accent B, was the rejected alternative.)
- **Cyan and teal are reserved** for the accent and the Hot tier, and amber for the Warm tier. Charts and other categorical colors never use them.

## Audience rule

- **Daily-work screens** (Overview, Leads, Lead detail, Review queue) speak plain language to sales reps: what happened, what it means, what to do next.
- **Technical detail** (prompt version, tokens, latency, cost, HTTP codes, idempotency keys, the dead-letter queue, signatures, error codes) sits behind a "Technical details" disclosure that only Admin and Owner see. Members never see the control.
- **Landing** leads with outcomes. "Under the hood" sits lower down for technical buyers.
- **Settings** may be technical: it is where admins configure sources, keys, rubric and rules.
- Example: a failed action reads "Couldn't send to n8n after 5 tries. Paused." with a Retry button. `502 Bad Gateway`, the attempt count and the job id are in the disclosure.
- Still to align with this rule: the Overview "LLM cost this month" KPI and the sidebar spend meter become Admin/Owner only.
- **Glow only on accent elements:** focused controls, the primary button, Hot badges. Never on body text or numbers.
- **Texture:** a subtle grid with fine noise, limited to the app background and the landing hero.
- **Type:** Geist for UI and Geist Mono for numbers, IDs and eyebrow labels. Both ship a Vietnamese subset.
- **Avoided on purpose:** purple gradient washes, glassmorphism, emoji icons, glowing text.

## Tokens

| Token | Dark (default) | Light |
|---|---|---|
| background | `#0A0A12` | `#F6F6FA` |
| card | `#10111C` | `#FFFFFF` |
| raised | `#171827` | `#F0F0F6` |
| hover | `#1F2133` | `#E9E9F2` |
| border | `#24263A` | `#E2E3EC` |
| foreground | `#ECEDF5` (16.1:1 on card) | `#0D0E1A` (19.2:1) |
| muted text | `#9A9DB8` (7.1:1 on card) | `#565A73` (6.3:1 on bg) |
| accent (cyan, approved) | `#22E1F0`; text on it `#031417` (11.7:1) | `#0A7D8C`; white text 4.9:1 |
| tier Hot | the accent | the accent |
| tier Warm | `#D8B26A` (9.4:1) | `#8A5A0B` (5.9:1) |
| tier Cold | `#B4A6E0` (8.5:1) | `#5B4BA8` (7.0:1) |
| tier Junk | `#8B8EA8`, struck through (5.8:1) | `#6B6F86`, struck through |
| danger | `#F87171` (6.8:1) | `#B91C1C` |

Every tier badge always shows its text label, so color is never the only signal.

Chart series by source contain no cyan or teal. They were run through the dataviz palette validator against each card surface: lightness band, chroma floor, colorblind and normal-vision separation of stacked neighbours, and 3:1 contrast all pass. Other is a deliberate neutral, so it is the one slot below the chroma floor.

| Series | Dark | Light |
|---|---|---|
| 1 · Website form (blue) | `#3987E5` | `#2A78D6` |
| 2 · LinkedIn Ads (magenta) | `#D55181` | `#B8407F` |
| 3 · Partner webhook (violet) | `#9085E9` | `#6250D6` |
| 4 · CSV import (orange) | `#D95926` | `#EB6834` |
| Other (folded, neutral) | `#6F7290` | `#8A8DA3` |

Blue and violet are never neighbours in the stack order, and magenta never sits next to the grey Other: either pair fails colorblind separation side by side.

## Batch 1 decisions (direction approved)

- **Overview:** KPI row, then Needs attention (the most actionable panel) as a full-width row, then the leads-per-day chart at full width, then source revenue beside Tier distribution. Tier distribution sizes to its content; its "Open leads list" link sits in the card header.
- **Leads list:** every row is 56 px. Name, email, company and meta stay on one line each and truncate with a tooltip. Source shows an icon and a short name (Web form, Zapier, LinkedIn, CSV, Widget) with the full source name in the tooltip. The Free email flag sits inline after the company name.
- **Hero pipeline (landing and login):** denser and brighter particles that bunch up on the Sources side (3,200 points on landing, 1,800 on login). Login's right panel holds a framed pipeline stage with source, gate and tier labels above the pitch and the sample lead card.
- **Landing:** Pricing is replaced by "Under the hood": ingest → queue → enrich → score → route → actions inside a tenant boundary, with notes for signed requests (HMAC), idempotency, the evaluation set and the dead-letter queue. The page ends at the footer, with no empty space below it.

## Batch 2 decisions (approved)

- **Lead detail:** header with score, tier, status, owner and the next action; "Why it's Hot" (signed reasons in plain words, suggested reply in the lead's language); a filterable activity list, newest first, in plain language; contact, about the company, follow-ups sent (with Retry when paused), and "Disagree with the AI?" to change the rating. Score metadata and raw event lines are behind Technical details (Admin/Owner). The canvas has a sales-rep view without them.
- **Review queue:** oldest-first list plus one focused lead; the AI suggestion with a confidence meter against the threshold; the signals it weighed; the lead's own words and website. Approve (A), set a tier (1–4) or skip (S), with undo, an optional note for evals and session progress.
- **States:** lead loading, lead not found (also what another workspace's lead returns), empty queue and queue load error.

## Batch 3 (awaiting feedback)

- **Routing rules:** ordered table (drag to reorder, on/off switch, matches in the last 30 days, an "Always" tag), the selected rule's editor (when: AND conditions plus "or" groups; then: ordered actions; "Always run this rule"), and "Test with a sample lead": a dry run that walks every rule in order and says which one decides, which were skipped and why, and what would happen. Nothing is sent.
- **Settings › Sources & API keys:** settings sub-navigation; a "copy it now" banner that shows a new key exactly once; a sources table (type, key prefix, signature, leads in 30 days, last lead, with silent sources flagged); the selected source's endpoint, keys with revoke, the HMAC switch with secret rotation, and embed or curl snippets that mention Idempotency-Key.
- **Settings › ICP rubric:** removable chips for target industries, countries, buying signals and disqualifiers; company size range; free-text notes for the AI; tier bands; the review threshold with a live "how many leads would go to review" estimate; save, with an optional re-score of open leads and its estimated AI cost.
- **States:** no rules yet, first-run sources, revoke-key confirmation in the page (never a browser dialog), and a rubric validation error.
- Settings is technical by design (see Audience rule) and is Admin/Owner only.

## Motion

- **In-app motion is micro-interaction only, 150–400 ms.** It never blocks input, and nothing waits for an animation to finish.
- **Landing page** (and a lighter version on login): a WebGL particle hero plus GSAP ScrollTrigger reveals.
- **`prefers-reduced-motion: reduce`:** every animation renders its final state immediately, and the WebGL hero shows a static frame.
- **Where the specs live:** each motion is annotated next to its board on the canvas (trigger · duration · easing). The motion tokens are on the Foundations board.

## i18n

- English and Vietnamese, as specified in SPEC §4.9.
- The canvas shows Overview and the Leads list in Vietnamese, to prove the layouts hold with longer text, VND currency and `vi-VN` number and date formats.
- **Money:** deal values and revenue are shown in the workspace currency (USD or VND). LLM cost is always shown in USD, because providers bill in USD, formatted with the active locale (`4,18 US$` in Vietnamese).
- **Country names and relative times** come from `Intl.DisplayNames` and `Intl.RelativeTimeFormat`, so they are never written into message files.

## Schema gaps (proposed, not applied)

From the backlog:
1. `Workspace.currency` (`USD` | `VND`). `Lead.dealValue` is "in the workspace's currency", but nothing stores which currency that is.
2. A saved-views model, e.g. `SavedView(workspaceId, userId?, name, filters Json, sort Json, isShared)`.
3. `pg_trgm` GIN indexes on `Lead` email, first and last name, and company, for search.
4. A partial unique index: only one active `PromptVersion` per name.
5. CHECK constraints: `score` 0–100, `confidence` and `reviewThreshold` 0–1.

Found in batch 1:

6. A junk/filtered lead status. `LeadStatus` has no value for leads the pipeline filtered out (shown as "Filtered").
7. `Workspace.llmMonthlyCapUsd`, for the LLM spend meter and cap in the sidebar.
8. `Lead.firstActionAt`, so "median time to first action" doesn't need a scan over `ActionRun`.

Found in the i18n work:

9. `User.locale` (`en` | `vi`, nullable: null means use the workspace default).
10. `Workspace.defaultLocale` (`en` | `vi`).
11. `Lead.locale`, or a detected language, so email templates and `suggestedReply` follow the lead's language.

Found in batch 2:

12. `Feedback.kind` (`approve` | `override` | `skip`) and `Feedback.note`, so approvals and the reviewer's note also become eval data, not only overrides.
13. `Lead.jobTitle` and a company size (on `Lead` or `Enrichment`). Lead detail and the review queue show both, and the data model has neither outside `customFields`.

Found in batch 3:

14. `RoutingRule.name` and `RoutingRule.alwaysRun`. SPEC §4.5 has the "always run" flag, but the data model doesn't.
15. An `ApiKey` model (`sourceId`, `name`, `prefix`, `hash`, `createdAt`, `lastUsedAt`, `revokedAt`) in place of the single `Source.apiKeyHash`, so a source can rotate keys without downtime.
16. Tier bands (`hotMin`, `warmMin`) on `IcpRubric` or `Workspace`. Today the 80 and 55 cut-offs exist only in the UI.
17. `Source.lastLeadAt`, or an index that makes it cheap, for the "silent for 14 days" flag.
