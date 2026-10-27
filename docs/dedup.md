# How duplicates are handled

LeadPilot decides in the ingest endpoint (`POST /v1/ingest/:sourceId`) whether a submission is a new
person or one we already know. The rule is deliberately cautious: **a wrong merge is worse than a
duplicate**, because a merge changes what a sales rep sees about a real person.

| The submission has… | …and we already know | Result |
| --- | --- | --- |
| an email | a lead with exactly that email (case-insensitive) | **Merged** into that lead (HTTP 200). |
| no email, a phone | a lead with that phone (E.164) | **Merged** into the oldest lead with that phone (200). |
| an email, a phone | no lead with that email, but a lead with that phone | **New lead** (201), marked *possible duplicate of* the older one. Nothing is merged. |
| anything else | nothing | **New lead** (201). |

Why the third row: two people can share a phone line (an office, a family). A different email is a
signal they may be different people, so a person decides, not the machine. (SPEC §4.2 also merged on
phone and, later, on "domain + similar name"; both were dropped. Fuzzy matching is revisited with AI in M3.)

## What a merge does

- The newest non-empty value wins. A merge never blanks a stored value.
- The lead keeps the latest `rawPayload`; **every** submission also leaves its own `ingested` event on
  the lead's timeline, with its own received time and its own raw payload. A `merged` event records
  which rule matched and which fields changed.
- A *possible duplicate* leaves a `possible_duplicate` event on both leads.
- Retention: raw payloads hold personal data; the plan is to purge them after 90 days (backlog, M3).

## Numbers on Lead sources

Per source, last 30 days: **received = new + merged + rejected**. A *rejected* submission passed
authentication but was refused (bad email, no contact, too fast…); the most common reasons are shown in
plain words. An idempotent retry answered from the stored first result is a *repeated send*: counted
separately and not part of *received*. Submissions with a wrong key cannot be attributed to a source and
are not counted.

## Known limits

- Two *new* leads with the same phone and different emails sent at the same instant can both be
  created without the flag (email is protected by a unique index; phone is not).
- Leads are not merged or split by hand yet; that arrives with lead detail.
