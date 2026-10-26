# LeadPilot design notes

**Design canvas:** https://claude.ai/artifact/VjAxmCrJVRUxSPxGzwAT5f (private until shared from the page's Share menu)

**Status:** milestone D done: all four batches approved and the milestone closed on 2026-10-26. Batch 1 covers foundations, landing, auth, overview and the leads list; batch 2 lead detail and the review queue; batches 3 and 4 the setup checklist, general, lead sources, ideal customer, routing rules, integrations, team, change history and Advanced / Developer. Every board was rendered with Playwright and checked; see Self-check below. M5 implements the screens to match. Schema gaps are applied in the milestone that first needs each one (see the end of this file).

## Visual direction: refined cyber

- **Dark is the default theme, light is the alternate.** Both are complete; neither is an automatic inversion.
- **Surfaces:** near-black blue-violet, layered by lightness: background → card → raised → hover. Layers are separated by lightness and 1px borders, not shadows.
- **One neon accent**, used only for primary actions, focus rings, the Hot tier and key highlights. **Approved: accent A, electric cyan.** (Acid lime, accent B, was the rejected alternative.)
- **Cyan and teal are reserved** for the accent and the Hot tier, and amber for the Warm tier. Charts and other categorical colors never use them.

## Audience rule

- **Daily-work screens** (Overview, Leads, Lead detail, Review queue) speak plain language to sales reps: what happened, what it means, what to do next.
- **Technical detail** (prompt version, tokens, latency, cost, HTTP codes, idempotency keys, the dead-letter queue, signatures, error codes) sits behind a "Technical details" disclosure that only Admin and Owner see. Members never see the control.
- **Landing** leads with outcomes. "Under the hood" sits lower down for technical buyers.
- **Settings and the Routing rules editor** are used by the customer's Owner/Admin: a sales manager or ops person, not a developer. Members don't see Settings or Routing rules at all, not even in the sidebar.
  - Every Settings screen is written for a non-technical admin: one-click "Connect Slack" or "Connect HubSpot" flows; "copy this snippet" or "email it to your web developer" for the embed form; the ICP rubric as plain questions (industries, company size, countries, buying signals, deal-breakers); routing rules that read as sentences ("If tier is Hot and country is US → assign to Mia, notify #hot-leads").
  - API keys, HMAC secrets, raw webhooks, endpoints and prompt versions live in a separate **Advanced / Developer** tab in Settings. Nothing else in Settings shows them.
  - New workspaces get a short **setup checklist**: connect a source → describe your ideal customer → connect Slack or email → invite your team.
- Example: a failed action reads "Couldn't send to n8n after 5 tries. Paused." with a Retry button. `502 Bad Gateway`, the attempt count and the job id are in the disclosure.
- "AI cost" (never "LLM spend") is Admin/Owner only: the Overview KPI and the sidebar meter are hidden for Members.
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
| accent (cyan, approved) | `#22E1F0`; text on it `#031417` (11.7:1) | `#0A7D8C`; white text 4.9:1; accent text on tints `#076A77` |
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
| 3 · Partners (violet) | `#9085E9` | `#6250D6` |
| 4 · Spreadsheet uploads (orange) | `#D95926` | `#EB6834` |
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

## Batch 3 decisions (approved)

Designed for a non-technical Owner/Admin (see Audience rule).

- **Settings menu:** Get started, Lead sources, Ideal customer, Integrations, Team, Change history, and Advanced / Developer last and muted.
- **Get started (setup checklist):** four steps with progress: connect a source → describe your ideal customer → connect Slack or email (one-click "Connect Slack", or "Use email instead") → invite your team (they join as Members). Done steps show what was set up and a Change link. A "Load sample leads" option for people who are only exploring. The same list shows on Overview until it's finished.
- **Lead sources:** your sources with a plain status ("Working · 487 leads in the last 30 days", or "Quiet: no leads for 14 days, check that Livestorm is still connected"). The website form is three steps: copy the snippet or "Email it to your web developer", choose which fields the form asks for, check it's working. Add a source: website form, Zapier/Make/n8n, upload a spreadsheet, or "another tool" (which leads to Advanced / Developer).
- **Ideal customer:** plain questions: which industries, which countries, what tells you a lead is ready to buy, what are your deal-breakers, how big are the companies, anything else the AI should know. Also: when a lead is Hot, Warm or Cold (score cut-offs), and when someone should double-check (the review threshold, with how many leads that would have sent to review last month). Saving can also ask the AI to look again at open leads.
- **Routing rules:** each rule reads as one sentence under its name ("If tier is Hot and country is US or Canada → assign to the next account executive, notify #hot-leads, email the owner, add to HubSpot"). The editor is "If … then …", and "Test with a sample lead" says which rule decides and why, without sending anything.
- **Advanced / Developer:** API keys (a new key shown once), endpoints per source, HMAC signature and secret rotation, embed and curl snippets, outgoing webhook signing, and prompt versions with evaluation accuracy and cost per lead.
- **Members:** the sidebar hides Routing rules and Settings for Members.
- **States:** no rules yet, first-run sources, revoke-key confirmation in the page (never a browser dialog), and an Ideal customer field error.

## Batch 4 decisions (approved)

- **General:** workspace name, language, currency, time zone, and the monthly AI cost limit. The page says in plain words what happens at the limit: leads keep arriving and are saved, they're rated by simple rules and marked "Rated without AI", the AI resumes on the 1st or when the limit is raised, and those leads can be looked at again later. Owner and admins get an email at 80% and 100%. In demo mode the built-in sample AI is free.
- **Integrations:** Slack, Email, HubSpot, "Send to another tool" (webhook) and Telegram, each in a connected, not connected or needs-attention state. Connected tools have "Send test message", with the result shown under the card. Errors say what happened and what to do ("HubSpot stopped accepting new contacts because the connection expired… Reconnect"). Webhook addresses and secrets stay in Advanced / Developer.
- **Team:** invite by email as Member or Admin; Owner, Admin and Member explained in one line each; people with role, open leads and last active; Remove asks for confirmation in the row and says what happens to that person's leads; pending invites with Resend and Cancel.
- **Change history:** plain sentences ("Daniel Park turned off the rule “Partner leads”."), grouped by day, filterable by area, person and time range, with an optional before/after view.
- **States:** integrations loading, team with only you, change history load error, and the no-access page a Member sees on any Settings URL.

## Self-check (Playwright)

All 67 boards were rendered at their real size, served locally with the canvas runtime, in dark, light and Vietnamese where those exist. Each render was checked automatically (placeholder or `[object Object]` text, horizontal overflow, clipped or wrapped labels, empty space below content, content taller than the frame, technical words on daily-work screens, light-on-dark buttons, WCAG AA contrast of every text node), and every screenshot was reviewed by eye. Known exceptions: Foundations shows disabled-state and "subtle" swatches below AA on purpose, and the Landing "Under the hood" cards wrap their descriptions by design.

Not covered: real devices and browsers other than Chrome, screen readers, keyboard-only walkthroughs, the WebGL heroes in motion (checked as a still frame), and how hover and focus states look.

## Vietnamese glossary

One term per concept, on every board. Product names (LeadPilot, Slack, HubSpot, Zapier, n8n) and "lead" stay in English.

| English | Tiếng Việt | Notes |
|---|---|---|
| lead | lead | Common in Vietnamese sales teams; not translated. |
| Hot / Warm / Cold / Junk | Nóng / Ấm / Lạnh / Rác | Tier names. |
| tier | hạng | "Xếp hạng" is the verb: the AI rates a lead. |
| score | điểm | "Chấm điểm" is the verb: the AI scores a lead. |
| owner (of a lead) | người phụ trách | Never shortened to "phụ trách". |
| owner (of a workspace) | chủ sở hữu | |
| admin / member | quản trị viên / thành viên | |
| workspace | không gian làm việc | |
| source | nguồn | "Nguồn lead" in Settings. |
| routing, routing rule | phân bổ, quy tắc phân bổ | |
| review queue | hàng chờ duyệt | |
| enrichment, company info | thông tin công ty | Not "làm giàu dữ liệu". |
| pipeline (the lead flow) | luồng lead | Not left in English. |
| ideal customer | khách hàng lý tưởng | Not "tiêu chí ICP". |
| deal-breaker | điều loại trừ | |
| integration | tích hợp | |
| team | đội ngũ | |
| change history | lịch sử thay đổi | |
| AI cost, monthly limit | chi phí AI, hạn mức | |
| technical details | chi tiết kỹ thuật | |
| sales rep / account executive | nhân viên sale / nhân viên kinh doanh | |
| spreadsheet | bảng tính | |

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

## Schema gaps (proposed; applied per milestone)

**Status by milestone.** Applied in M1 (migration `m1_auth_tenancy`): 1, 7 (as `Workspace.aiMonthlyLimitUsd`), 9, 10, 18, 21, plus three found while planning M1: `Membership.lastActiveAt` (Team "Last active"), `RefreshToken.workspaceId` (one session per workspace) and a real `Invite.invitedBy` relation. Already in the M0 schema: 14. Deferred: 6, 13 (jobTitle), 15, 17 → M2; 4, 5, 11, 12 (`kind` only: `note` already exists), 13 (company size), 16, 19 → M3; 8, 20 → M4; 2, 3 → M5.

From the backlog:
1. `Workspace.currency` (`USD` | `VND`). `Lead.dealValue` is "in the workspace's currency", but nothing stores which currency that is.
2. A saved-views model, e.g. `SavedView(workspaceId, userId?, name, filters Json, sort Json, isShared)`.
3. `pg_trgm` GIN indexes on `Lead` email, first and last name, and company, for search.
4. A partial unique index: only one active `PromptVersion` per name.
5. CHECK constraints: `score` 0–100, `confidence` and `reviewThreshold` 0–1.

Found in batch 1:

6. A junk/filtered lead status. `LeadStatus` has no value for leads the pipeline filtered out (shown as "Filtered").
7. `Workspace.llmMonthlyCapUsd` (applied in M1 as `aiMonthlyLimitUsd`), for the AI cost meter and limit in the sidebar.
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

Found in batch 4:

18. `Workspace.timezone` (IANA name), for daily totals and Change history times.
19. A "rated without AI" marker on `Score` (for example `Score.method`: `ai` | `rules`), so leads rated after the AI cost limit was reached can be found and looked at again.
20. `Integration.status` (`connected` | `needs_attention` | `paused`), `lastError` and `lastTestedAt`, for the Integrations states and "Send test message".
21. `AuditLog.area` (`rules` | `sources` | `ideal_customer` | `integrations` | `team` | `general`), for the Change history filters. The before/after values SPEC §4.8 already asks for drive the "See before and after" view.
