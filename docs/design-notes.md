# LeadPilot design notes

**Design canvas:** https://claude.ai/artifact/VjAxmCrJVRUxSPxGzwAT5f (private until shared from the page's Share menu)

**Status:** milestone D in progress. Batch 1 (foundations, landing, auth, overview, leads list) is redone in the "refined cyber" direction and awaits approval. Per-screen field, filter and metric lists are added here as each batch is approved; M5 implements the screens to match.

## Visual direction: refined cyber

- **Dark is the default theme, light is the alternate.** Both are complete; neither is an automatic inversion.
- **Surfaces:** near-black blue-violet, layered by lightness: background → card → raised → hover. Layers are separated by lightness and 1px borders, not shadows.
- **One neon accent**, used only for primary actions, focus rings, the Hot tier and key highlights. Two options are on the Foundations board: electric cyan (default) and acid lime.
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
| accent, cyan | `#22E1F0`; text on it `#031417` (11.7:1) | `#0A7D8C`; white text 4.9:1 |
| accent, lime | `#B8F23A`; text on it `#0D1400` (14.1:1) | `#4D7C0F`; white text 5.0:1 |
| tier Hot | the accent | the accent |
| tier Warm | `#D8B26A` (9.4:1) | `#8A5A0B` (5.9:1) |
| tier Cold | `#B4A6E0` (8.5:1) | `#5B4BA8` (7.0:1) |
| tier Junk | `#8B8EA8`, struck through (5.8:1) | `#6B6F86`, struck through |
| danger | `#F87171` (6.8:1) | `#B91C1C` |

Every tier badge always shows its text label, so color is never the only signal.

Chart series by source were run through the dataviz palette validator (lightness band, chroma, colorblind separation, contrast) against each surface:

| Series | Dark (cyan accent) | Light (cyan accent) |
|---|---|---|
| 1 · Website form | `#00A0B3` (lime accent: `#6FA51F`) | `#0089A3` (lime accent: `#4E8A0E`) |
| 2 · LinkedIn Ads | `#8E7BEA` | `#6B55D9` |
| 3 · Partner webhook | `#C08A1F` | `#B07400` |
| 4 · CSV import | `#4C7FE0` | `#2F64D6` |
| Other (folded) | `#5A5D78` | `#9A9CB0` |

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
