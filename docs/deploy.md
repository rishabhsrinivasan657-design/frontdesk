# Deploying the pilot

This runbook puts Front Desk on the internet at `https://<name>.duckdns.org`, for $0, on an Oracle Cloud **Always Free** virtual machine. It covers the hosting choice and every step of the first deploy, then how to ship each weekly release.

Each step says who does it:

- **You:** only you can do it. Accounts, payment screens and anything that needs your password are yours.
- **Together:** run it yourself, or let Claude run it in your SSH session once you say so.

Claude asks before every step that makes something public: opening ports, the first deploy, publishing the Google app, and pushing a release tag.

**Secrets rule:** secrets go in exactly one place, `/opt/frontdesk/.env.production` on the VM, with `chmod 600`. Never paste them into chat, a commit, an issue or a screenshot. Never run `docker compose ... config` there, because it prints them.

## What runs where

```
visitor ──https──▶ Caddy (80/443, Let's Encrypt) ──┬─ /ws, /health ─▶ api  ──▶ Postgres, Redis
                                                    └─ everything else ─▶ web ─▶ api (owner pages)
                                                                    worker ──▶ Gmail, Redis, Postgres
```

Only Caddy listens on the internet. Postgres, Redis, the api, the worker and the web app talk inside a private Docker network (`deploy/compose.prod.yml`).

**Free-tier limits** (checked 2026-10-26 on Oracle's Always Free page):

- Ampere A1 gives 2 OCPU and 12 GB RAM in total; 200 GB disk; 10 TB/month outbound.
- Oracle may reclaim an Always Free VM that looks idle for 7 days: CPU, network **and** memory all under 20%. A 2 OCPU / 6 GB VM running this stack uses about 2–3 GB, so memory stays over 20%. Step 2.7 checks it.

## 1. Accounts (you)

1. **Oracle Cloud:**
   1. Go to <https://www.oracle.com/cloud/free/> and click **Start for free**.
   2. Use your own email. Oracle asks for a card to verify you're a person. Always Free resources are never charged.
   3. **Never click "Upgrade to Pay As You Go".** That is the only way this could start costing money.
   4. Pick your **home region** carefully, because it can't be changed later. Pick one near you, e.g. _US East (Ashburn)_. Always Free VMs must live in the home region.
2. **DuckDNS** (free subdomain):
   1. Go to <https://www.duckdns.org> and sign in with GitHub or Google.
   2. Type a name, e.g. `casa-fiorella`, and click **add domain**.
   3. Leave the IP for now; you'll set it in step 3.
3. **Cloudflare** (free, for the Turnstile bot check only; your domain doesn't move to Cloudflare):
   - Sign up at <https://dash.cloudflare.com/sign-up>.

## 2. Create the VM (you, in the Oracle console)

1. **Networking:**
   1. Open ☰ → **Networking** → **Virtual cloud networks** and click **Start VCN Wizard**.
   2. Choose **Create VCN with Internet Connectivity**, name it `frontdesk` and keep the defaults.
   3. Click **Next** → **Create**.
2. **The VM:**
   1. Open ☰ → **Compute** → **Instances** and click **Create instance**. Name it `frontdesk`.
   2. **Image:** click **Edit**, then **Change image**, and pick **Canonical Ubuntu 24.04** (the aarch64 one).
   3. **Shape:** click **Change shape** → **Ampere** → **VM.Standard.A1.Flex**. Set **2 OCPUs** and **6 GB memory**. It shows the _Always Free-eligible_ label.
   4. **Networking:** pick the `frontdesk` VCN and its **public** subnet. Leave "Assign a public IPv4 address" on.
   5. **SSH keys:** choose **Upload public key files** and pick `~/.ssh/id_ed25519.pub`. If you don't have one, run `ssh-keygen -t ed25519` on your Mac first.
   6. Click **Create**. If it says _Out of capacity_, pick another **Availability domain** at the top of the form or try again later. This is common on the free tier.
3. **IP address:** when the instance is **Running**, copy its **Public IP address**.
4. **Open ports 80 and 443 in Oracle's firewall** (together; Claude asks first):
   1. On the instance page, click the subnet → **Security** → the default security list → **Add Ingress Rules**.
   2. Add source `0.0.0.0/0`, TCP, destination port `80`.
   3. Add another rule: source `0.0.0.0/0`, TCP, destination port `443`.
   4. Port 22 (SSH) is already open. Nothing else should be.
5. **SSH in from your Mac:**

   ```bash
   ssh ubuntu@<public-ip>
   ```

6. **Open the same ports on the VM itself** (together, on the VM). Oracle's Ubuntu image blocks everything except SSH in iptables:

   ```bash
   sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
   sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
   sudo netfilter-persistent save
   ```

7. **Check memory later:** after the first deploy, run `free -m` on the VM. "used" should be over 1.2 GB (20% of 6 GB). If it's lower, tell Claude and we'll add a safeguard.

## 3. Point the name at the VM (you)

1. On <https://www.duckdns.org>, paste the VM's public IP into the **current ip** box next to your name and click **update ip**.
2. Wait a minute, then check from your Mac. It should print the VM's IP:

   ```bash
   dig +short casa-fiorella.duckdns.org
   ```

Only an IPv4 (A) record is needed. Leave IPv6 empty.

## 4. Turnstile widget (you)

1. In the Cloudflare dashboard, open **Turnstile** and click **Add widget**.
2. Fill it in:
   - name: `Front Desk pilot`
   - hostname: your DuckDNS name, e.g. `casa-fiorella.duckdns.org`
   - mode: **Managed**
   - pre-clearance: **No**
3. Click **Create**.
4. Keep the page open. The **Site Key** (public) and **Secret Key** (private) go into the env file in step 6, and nowhere else.

## 5. Google: stop the 7-day token expiry (you; Claude asks first)

In **Testing** mode, Google issues refresh tokens that expire after 7 days, which would stop bookings every week.

1. Open the Google Cloud console for the demo project → ☰ → **APIs & Services** → **OAuth consent screen** → **Audience**.
2. Under **Publishing status**, click **Publish app** and confirm.

The app stays unverified. That is fine for one account: you'll see a "Google hasn't verified this app" screen once, and Google caps an unverified app at 100 users for its lifetime.

Then get a fresh, long-lived token on your Mac:

1. Run `pnpm google:auth`.
2. Click **Advanced** → **Go to Front Desk (demo)** on the warning, and tick every box.
3. Run `pnpm test:google`. It should pass.

The new `GOOGLE_REFRESH_TOKEN` is now in your local `.env`. You'll copy it to the VM in step 6, typing it on the VM, never through chat.

**Gemini check:** in <https://aistudio.google.com>, open **API keys** and click the project. Its plan must say **Free tier** with no billing account linked. The api also refuses to start unless `LLM_TIER=free` and `SPEND_CAP_USD_MONTHLY=0`. Never put `GEMINI_API_KEY_2` on the VM; the api refuses to start if it's set.

## 6. Set up the VM (together, on the VM)

```bash
# Docker (official convenience script) and git
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu && newgrp docker
sudo apt-get install -y git

# A read-only key so the VM can fetch the (private) repo
ssh-keygen -t ed25519 -N "" -f ~/.ssh/frontdesk_deploy -C frontdesk-vm
cat ~/.ssh/frontdesk_deploy.pub
```

Add that read-only deploy key on GitHub (you):

1. Open the repo → **Settings** → **Deploy keys** → **Add deploy key**.
2. Set the title to `frontdesk-vm`, paste the line `cat` printed, and leave **Allow write access** unticked.
3. Click **Add key**.

Then continue on the VM:

```bash
printf 'Host github.com\n  IdentityFile ~/.ssh/frontdesk_deploy\n' >> ~/.ssh/config

# The code and the env file
sudo mkdir -p /opt/frontdesk && sudo chown ubuntu:ubuntu /opt/frontdesk
git clone git@github.com:rishabhsrinivasan657-design/frontdesk.git /opt/frontdesk/app
cp /opt/frontdesk/app/deploy/.env.production.example /opt/frontdesk/.env.production
chmod 600 /opt/frontdesk/.env.production
nano /opt/frontdesk/.env.production
```

In `nano`, fill every value. The comments in the file say where each comes from.

- **`POSTGRES_PASSWORD`, `KEY_HASH_SECRET`:** run `openssl rand -hex 32` on the VM.
- **Gemini and Google values:** copy them from your Mac's `.env` by reading them on your own screen and typing or pasting them into the VM's `nano`.
- **`OWNER_PASSWORD_HASH`:** on your Mac, run `printf 'your password' | pnpm owner:hash` and keep the single quotes around the hash.

Save with Ctrl+O, Enter, Ctrl+X.

## 7. First deploy (together; Claude asks first)

A deploy always runs a release tag, and the tag must include these deploy files. So the first release is cut **after** this runbook's PR is merged.

1. On your Mac:

   ```bash
   git switch main && git pull
   pnpm release
   ```

   It prints the new tag, e.g. `v2026.10.27`. Pushing the tag publishes it, so Claude asks first:

   ```bash
   git push origin main v2026.10.27
   ```

2. On the VM, with that tag:

   ```bash
   cd /opt/frontdesk/app
   deploy/deploy.sh v2026.10.27
   ```

   `deploy.sh` first checks the env file:
   - it is `chmod 600`
   - `OWNER_PASSWORD_HASH` is in single quotes
   - the Turnstile site key is set

   It stops with a one-line fix if any of these fail. It never prints a value.

The first build takes about 10 minutes on the VM. When it prints "is live", run this from your Mac:

```bash
pnpm smoke https://casa-fiorella.duckdns.org
```

All 9 checks should pass. Then:

1. Book a table from your phone at `/talk`.
2. Open `/dashboard?source=pilot` and look for it under **Pilot**.
3. Check that the event is on the demo calendar and the email arrived.

## 8. Keep it healthy

- **Backups:** on the VM, run `crontab -e` and add:

  ```
  30 3 * * * /opt/frontdesk/app/deploy/backup.sh
  ```

  The dumps hold pilot personal data. They are readable only by you and deleted after 3 days.

- **Alerts:**
  1. In GitHub → the repo → **Settings** → **Secrets and variables** → **Actions** → **Variables**, add `PILOT_URL` = `https://casa-fiorella.duckdns.org`.
  2. The `pilot-health` workflow then checks `/health/ready` every 6 hours, and GitHub emails you if it fails.
- **What `/health/ready` failures mean:**
  - `google: fail`: the refresh token is dead. Redo step 5's `pnpm google:auth`, then update the VM's env file and run `deploy/deploy.sh <current tag>`.
  - `worker: fail`: on the VM, run `docker compose -f deploy/compose.prod.yml ps` and check the logs with `logs worker --tail 50`.
  - `postgres` / `redis: fail`: same `ps` check. `deploy/deploy.sh <tag>` restarts everything.
- **Rollback:** `deploy/deploy.sh <previous tag>`. Migrations only ever add, so an older release runs on a newer database.
- **Weekly releases:** see `docs/pilot.md`.
