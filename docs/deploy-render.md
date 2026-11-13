# Deploying on Render (free)

This runbook puts Front Desk on the internet at `https://casa-fiorella.onrender.com`, for $0, on Render's free tier. It's the quick path. The Oracle VM in [deploy.md](deploy.md) is still the long-term plan, but Oracle's free tier often has no capacity.

Each step says who does it:

- **You:** accounts, anything that needs your password, and typing secrets into a dashboard.
- **Together:** run it yourself, or let Claude run it once you say so.

**Secrets rule:** secrets go only into the Render dashboard's environment settings. Never paste them into chat, a commit, an issue or a screenshot.

## What runs where

```
visitor ──https──▶ casa-fiorella (Next.js web) ──▶ casa-fiorella-api (owner pages)
visitor ──wss────▶ casa-fiorella-api (api + confirmation worker) ──▶ Postgres, Redis (private)
```

Everything is described in [`render.yaml`](../render.yaml), a Render **Blueprint**. Render reads it and creates all four pieces.

| Piece                 | Render type | Free-tier catch                                                        |
| --------------------- | ----------- | ---------------------------------------------------------------------- |
| `casa-fiorella`       | Web service | Sleeps after 15 minutes without visitors; the first visit takes ~1 min |
| `casa-fiorella-api`   | Web service | Same. It also runs the email worker (Render's workers aren't free)     |
| `casa-fiorella-db`    | Postgres    | **Deleted 30 days after it's created**, with no backups                |
| `casa-fiorella-redis` | Key Value   | Not persisted: a restart loses queued emails and rate-limit counters   |

The two web services share 750 free hours a month. Sleeping services use no hours.

**Before a demo, open the site yourself a couple of minutes early** so both services are awake.

### Differences from the Oracle setup

- **Visitor addresses:** Render's proxy sits in front of the api, and the api doesn't trust it (its addresses aren't fixed). So every visitor looks like the same address, and the per-address chat limits (3 open chats, 10 new chats an hour) apply to everyone together. That's fine for a demo, not for real traffic.
- **The worker shares the api's container** ([`deploy/render/start-api.sh`](../deploy/render/start-api.sh)). If either process stops, the container exits and Render restarts it.
- **`pnpm smoke` doesn't fit**, because it expects the api and the web app on one address. Check `https://casa-fiorella-api.onrender.com/health/ready` instead.

## 1. Google: stop the 7-day token expiry (you)

In **Testing** mode, Google's refresh token expires every 7 days, which would stop bookings mid-week. Follow step 5 of [deploy.md](deploy.md):

1. Publish the OAuth app.
2. Run `pnpm google:auth` to get a long-lived token.
3. Run `pnpm test:google`.

## 2. Accounts (you)

1. **Render:**
   1. Sign up at <https://dashboard.render.com/register> with GitHub.
   2. Let it see the `frontdesk` repo.
   3. No card is needed for free services.
2. **Cloudflare Turnstile** (the bot check):
   1. In the Cloudflare dashboard, open **Turnstile** → **Add widget**.
   2. Fill it in:
      - name: `Front Desk (Render)`
      - hostname: `casa-fiorella.onrender.com`
      - mode: **Managed**
   3. Keep the page open for the site key and secret key.

## 3. Create the Blueprint (you)

1. In Render, click **New** → **Blueprint**, pick the `frontdesk` repo and the `main` branch.
2. Render lists the four pieces and asks for every value marked `sync: false`. Fill them in from your Mac's `.env`, reading them on your own screen.

**On `casa-fiorella-api`:**

| Variable               | Value                                               |
| ---------------------- | --------------------------------------------------- |
| `WEB_ORIGINS`          | `https://casa-fiorella.onrender.com`                |
| `TURNSTILE_HOSTNAMES`  | `casa-fiorella.onrender.com`                        |
| `TURNSTILE_SECRET_KEY` | the widget's **secret** key                         |
| `GEMINI_API_KEY`       | from `.env`                                         |
| `GOOGLE_*` (4 values)  | from `.env` (the refresh token from step 1)         |
| `OWNER_EMAIL`          | the email you log in to the dashboard with          |
| `OWNER_PASSWORD_HASH`  | the hash from `pnpm owner:hash`, **without** quotes |

Never add `GEMINI_API_KEY_2` here: the api refuses to start if it's set.

**On `casa-fiorella`:**

| Variable                         | Value                                                        |
| -------------------------------- | ------------------------------------------------------------ |
| `NEXT_PUBLIC_API_WS_URL`         | `wss://casa-fiorella-api.onrender.com/ws`                    |
| `API_URL`                        | `https://casa-fiorella-api.onrender.com`                     |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | the widget's **site** key                                    |
| `NEXT_PUBLIC_PRIVACY_CONTACT`    | optional: where deletion requests go                         |
| `NEXT_PUBLIC_DASHBOARD_SOURCE`   | `pilot` (set by the Blueprint): the dashboard opens on Pilot |

3. Click **Apply**. The first build takes about 10 minutes.

**If a name was taken,** Render adds a suffix, e.g. `casa-fiorella-x7k2.onrender.com`. Then:

1. Change the URLs above to match.
2. Add the new hostname to the Turnstile widget.
3. Redeploy the web service. The `NEXT_PUBLIC_*` values are baked in when the web app is built, so they only take effect after a fresh build.

## 4. Check it (together)

1. `https://casa-fiorella-api.onrender.com/health/ready` should show every check as `ok`.
2. Open `https://casa-fiorella.onrender.com/talk`, book a table, and confirm it.
3. Check that the event is on the demo calendar and the confirmation email arrived.
4. Open `/dashboard?source=pilot` and look for it under **Pilot**.

## 5. Updates and the 30-day limit

- **Updates:** every push to `main` redeploys both web services.
- **The 30-day limit:** the free database is deleted 30 days after creation. Before then, either:
  - delete it and re-sync the Blueprint to get a fresh one (conversation history is lost, bookings are safe in Google Calendar), or
  - move to the Oracle setup.
