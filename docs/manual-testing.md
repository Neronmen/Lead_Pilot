# Trying LeadPilot by hand

For a person who wants to click through the app with demo data. Everything runs on your machine with
mock providers: no key, no card, nothing leaves the computer (`ACTIONS_MODE=mock`, `LLM_PROVIDER=auto`
with no key uses the free built-in AI).

## Start

1. Docker Desktop running, then in the repo folder: `docker compose up -d`.
2. `pnpm dev` (API :3001, web :3000, emails in Mailpit at http://localhost:8025).
3. Open http://localhost:3000, sign up. You are the Owner of a new workspace.

## Get a lead in

1. Settings > Lead sources > Add a source. Copy the address and the key (shown once).
2. Send a lead (replace `<address>` and `<key>`):

   ```bash
   curl -X POST "<address>" -H "Authorization: Bearer <key>" -H "Content-Type: application/json" \
     -d '{"name":"Mia Tran","email":"mia@acme-logistics.com","company":"Acme Logistics","country":"US","message":"We need a tracking tool this quarter, budget approved.","budget":"$20k","timeline":"This quarter"}'
   ```

3. Leads: the lead appears within seconds and gets a tier and a score.

## Routing rules and Integrations (M4)

1. Settings > Integrations > Slack > Connect: any address that starts with
   `https://hooks.slack.com/` works in mock mode (nothing is sent). Press "Send test message".
2. Settings > Routing rules > Add a rule: name "Hot leads", add a condition "Tier is Hot", actions
   "Assign to a person" (pick yourself), "Send to Slack", "Email the owner". Save.
3. "Test with a sample lead": tier Hot says "Hot leads" decides; tier Cold says no rule matches.
4. Send another lead like the one above. Open it: the owner is set, and "What the rules did" lists
   each action. The Hot lead email is in Mailpit (http://localhost:8025).
5. A failed action shows Retry. To see one, switch the Slack integration off, send a lead, then
   look at the lead.

## Checks the owner can run

```bash
pnpm lint && pnpm typecheck && pnpm format:check
pnpm test
pnpm --filter api test:e2e
pnpm test:render
```
