# Running LeadPilot for real customers

This is the path from "works on my laptop" to "a customer signs up, sends leads and gets Slack, Telegram
and email alerts". It uses one small server and services with a free tier. Nothing here needs a card
except renting the server (many have a free plan; a cheap one is a few dollars a month).

## What you need

| Thing | Why | Free option |
|---|---|---|
| A small server with Docker (1 GB RAM is enough to start) | runs everything | Oracle Cloud "Always Free", or any cheap VPS |
| A domain name and two DNS records | `app.<domain>` and `api.<domain>` pointing at the server | any registrar; Cloudflare DNS is free |
| An SMTP account | invites, password reset, Hot lead alerts | Brevo free (300 emails a day) |
| An AI key | real ratings (without one the free built-in mock rates by simple rules) | Gemini free tier (see the warning below) |

## First run (about 15 minutes)

1. On the server, install Docker, then `git clone` this repository.
2. Point two DNS A records, `app.example.com` and `api.example.com`, at the server's address. They must be
   subdomains of the **same domain**: the sign-in cookie is `SameSite=Lax`.
3. Create the settings file and fill it in:

   ```bash
   cd deploy
   cp .env.production.example .env.production
   nano .env.production      # domains, secrets (openssl rand -base64 32), SMTP, AI key
   ```

4. Start everything (builds the images, runs the database migrations, gets HTTPS certificates):

   ```bash
   docker compose --env-file .env.production up -d --build
   ```

5. Open `https://app.example.com`, create your own account (it is the owner of its own workspace) and
   check the email arrives. Open `https://api.example.com/health/ready`: it should say `ok`.

To update later: `git pull`, then the same `up -d --build` command. Migrations run on every start and are
safe to repeat.

## What each setting does

- `ENCRYPTION_KEY`: 32 random bytes in base64. It encrypts every Slack address, bot token and signing
  secret in the database. **Back it up**: if it is lost, those secrets cannot be read and customers must
  reconnect their tools. Never change it on a running system.
- `ACTIONS_MODE=live`: Slack, Telegram and webhook messages are really sent. Outgoing calls go only to public
  https addresses, to the address that was checked (no DNS tricks), without following redirects.
- `ENRICHMENT_PROVIDER=website`: reads a lead's company homepage (public pages only) for the AI.
- `TRUST_PROXY=1` (already set): Caddy is one proxy in front of the API, so each visitor is rate limited on
  their own address.
- `API_DOCS=off`: the Swagger page is not public.
- `NEXT_PUBLIC_DEMO_LOGIN=off`: no demo button. Do not run `pnpm --filter api seed` on a real server.

## What a customer does (the first ten minutes)

1. Sign up, then confirm the email address (a banner asks until they do).
2. **Settings > Ideal customer**: describe who is a good lead.
3. **Settings > Lead sources**: add a source. Send leads three ways: the **API** (address + key, with optional
   signing), a **website form** (switch it on, copy the link or the embed code), or **import a spreadsheet**.
4. **Settings > Integrations**: connect Slack (an Incoming Webhook address), Telegram (a bot token from
   @BotFather and a chat id) or a webhook. "Send test message" proves it works.
5. **Routing rules**: for example "If tier is Hot → send to #hot-leads, email the admins". "Test with a
   sample lead" shows which rule would decide.
6. Send a sample lead from Lead sources and watch the alert arrive.

## Running it safely

- **Backups.** The database is the only thing that matters. A daily dump, copied off the server:

  ```bash
  docker compose --env-file .env.production exec -T postgres pg_dump -U leadpilot leadpilot | gzip > leadpilot-$(date +%F).sql.gz
  ```

- **Watching.** `https://api.example.com/health/ready` answers 200 when the database and Redis are up. Point a
  free uptime monitor (UptimeRobot, Better Stack) at it. Logs: `docker compose logs -f api`.
- **Email that arrives.** In Brevo, verify your sending domain and add the SPF and DKIM records it shows, or
  alerts land in spam.
- **A leaked key.** Each source has "Create new key" under Settings > Advanced / Developer; the old one stops
  at once. A leaked Slack address is replaced in Slack and reconnected here.

## About the AI and customer data (read before selling)

- Every lead's text (name, company, message) is sent to the AI provider for rating. Tell customers so.
- **Do not send real customers' leads to a free AI tier.** Free tiers (including Gemini's) may use what you send to
  improve their products, and their limits are small (Gemini Flash-Lite: 500 requests a day). Use them for the
  demo and your own testing. For real customers use the provider's paid tier (billing on, data not used for
  training) or an Anthropic/OpenAI key, and keep `AI_DEFAULT_MONTHLY_LIMIT_USD` low. LeadPilot rates leads by
  simple rules, marked "Rated without AI", once a workspace reaches its monthly limit.
- The cost of each rating is shown in the lead's technical details (Owner and Admin).

## Known limits

- One API process runs the workers. To scale, run a second API container with `QUEUE_WORKERS=on` (jobs are safe
  to run twice) and keep the web container separate.
- No billing or plans: access is by sign-up. Add payment (for example Stripe Checkout) before charging.
- No single sign-on, no audit export, no data-deletion button: delete a workspace from the database on request.
- Registration is open: anyone can create a workspace. Put the app behind an allow-list or add an invite-only
  switch before a public launch if that matters.
