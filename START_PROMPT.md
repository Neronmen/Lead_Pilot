# Prompts to paste into Claude Code

## Prompt 1 — first session (M0)

Read CLAUDE.md and SPEC.md fully. We are building LeadPilot.

Start with milestone M0 – Foundation only. Before writing any code:
1. Restate in 5 bullets what M0 delivers and how we will verify it.
2. Propose the folder structure and the list of packages per app, with one line on why each dependency is needed.
3. Draft Prisma schema v1 for the entities in SPEC.md section 6 (only fields, relations and indexes — no business logic yet).
4. List anything in SPEC.md that is ambiguous or that you would change.

Wait for my approval before creating files. After approval, build M0 in small steps, run the checks, use the tester and code-reviewer subagents, then commit.

## Prompt for each next milestone

Milestone M{N} from SPEC.md. Plan first: list the steps, the endpoints/pages, the tests you will write, and risks. Wait for my approval. Then implement step by step; after each feature run tester then code-reviewer, fix blockers, commit. At the end, update the Commands section of CLAUDE.md and the README.

## When something breaks

Here is the error: <paste>. Find the root cause before changing code. Explain it in 3 lines, propose the fix, then apply it and add a test that would have caught it.

## End of each milestone — learning check

Explain to me, as to a junior developer, the 3 most important technical decisions in this milestone and the trade-offs. Ask me 3 questions to check I understood.
