# Run Yakyard on your own server

Yakyard also runs on any Linux server with Docker. Same app, your hardware. If you have started a `docker compose` app before, this takes about 15 minutes.

It runs in workerd, the open-source runtime Cloudflare Workers is built on, through Wrangler's local mode. That mode gives it a SQLite database, file storage and background jobs on your disk. Caddy sits in front and gets the HTTPS certificate by itself.

Read [What's different from Cloudflare](#whats-different-from-cloudflare) before you move your team. Short version: transcripts need a free Cloudflare token, and it's one server with no automatic scaling.

## What you need

- A Linux server with Docker and Docker Compose v2 (`docker compose version` works). 1 GB of memory is enough for a small team; Yakyard itself uses about 300 MB.
- A domain or subdomain, like `chat.example.com`, with its DNS pointing at the server.
- Ports 80 and 443 open. Caddy needs both to get the certificate.

HTTPS isn't optional: installing the app on phones and push notifications only work over HTTPS.

## Set it up

### 1. Get the files

```bash
git clone https://github.com/yakyard/yakyard.git
cd yakyard
cp .env.example .env
```

### 2. Fill in .env

Open `.env` and set two lines:

```bash
DOMAIN=chat.example.com
SETUP_TOKEN=paste-a-long-random-code-here
```

Make the setup code with `openssl rand -hex 24`. Keep it: you type it once, to create the owner account. Set `WORKSPACE_NAME` too if you like. Every other line is optional.

### 3. Start it

```bash
docker compose up -d
```

The first start downloads the images and gets the certificate. Check it with `docker compose ps`: when `yakyard` says `healthy`, it's ready. That takes about a minute.

To build the image from the code in this folder instead of downloading it, run `docker compose up -d --build`.

### 4. Create the owner account

Open `https://chat.example.com/setup`, paste the setup code, and create the owner account.

### 5. Invite your team

Click **Invite people** and send the links. From here on it's the same Yakyard: the [user guide](GUIDE.md) covers the rest.

## Settings

Everything goes in `.env`, with the same names as on Cloudflare. [All settings](TECHNICAL.md#all-settings) explains each one. After a change, run `docker compose up -d` again.

Two are worth a look on your own server:

- `STORAGE_PER_PERSON_GB` and `STORAGE_TOTAL_GB`. The defaults (2 and 9) fit Cloudflare's free file storage. Here the limit is your disk, so raise them.
- `APP_URL` is set for you, from `DOMAIN`.

### Voice note transcripts

Transcripts come from Whisper on Cloudflare Workers AI, which only runs at Cloudflare. Your server calls it over the internet if you give it a token:

1. Make a free [Cloudflare account](https://dash.cloudflare.com/sign-up). You don't need R2 or a Worker, only the account.
2. In the dashboard, open **Workers AI** and select **Use REST API**. Copy the **Account ID**.
3. On the same page, select **Create a Workers AI API Token**, then **Create API Token**, and copy the token.
4. Put both in `.env`, then run `docker compose up -d`:

```bash
CF_ACCOUNT_ID=your-account-id
CF_API_TOKEN=your-token
```

The audio is sent to Cloudflare to be transcribed, and the free allowance is the same as on Cloudflare: about 214 minutes of voice notes a day.

Without a token, voice notes still record, send and play. Under each one, Yakyard says "Transcripts are off on this server." Notes sent while transcripts were off stay without one.

### Phone notifications

Make the keys with the image you already have:

```bash
docker compose run --rm yakyard node scripts/vapid.mjs
```

It prints three values. Put them in `.env` instead of where it says: `VAPID_PUBLIC`, `VAPID_SUBJECT` (a `mailto:` address) and `VAPID_PRIVATE` (the whole `{...}` line). Then `docker compose up -d`.

### Google sign-in, Slack import and calls

They work the same as on Cloudflare. Use your own address wherever [Optional features](TECHNICAL.md#optional-features) says your workers.dev address, for example `https://chat.example.com/auth/google/callback`. `TURN_KEY_ID` and `TURN_KEY_TOKEN` (Cloudflare Realtime) also work from here, for calls behind strict networks.

## Backups

One command backs up everything: messages, files, voice notes and settings.

```bash
sh docker/backup.sh
```

It stops Yakyard for a few seconds, so the database is copied whole, and saves `backups/yakyard-<date>.tar.gz`. Copy that file somewhere off the server.

To back up every night at 3:00, add this line with `crontab -e` (change the folder):

```bash
0 3 * * * cd /home/you/yakyard && sh docker/backup.sh >> backups/backup.log 2>&1
```

Old files aren't deleted for you. Clear out the `backups` folder now and then.

### Restore

```bash
sh docker/restore.sh backups/yakyard-2026-11-22-0300.tar.gz
```

It asks first, then replaces everything in this Yakyard with the backup and starts it again. Sign in and open a channel to check.

`npm run backup` and the nightly GitHub workflow in [SETUP.md](SETUP.md#updates-and-backups-by-themselves) are for Cloudflare installs. On your own server, use the two scripts above.

## Updates

```bash
sh docker/backup.sh
git pull
docker compose pull
docker compose up -d
```

The database is brought up to date each time the container starts. It only adds what's missing, so starting twice is safe. Open apps then offer the new version.

`latest` follows releases. To update only when you choose, pin one in `.env`, for example `YAKYARD_VERSION=2.2.0`. To go back, set the version you had and restore the backup you took before the update.

Built it yourself? Run `git pull` and `docker compose up -d --build` instead.

The automatic updates in [SETUP.md](SETUP.md#updates-and-backups-by-themselves) are a GitHub workflow for Cloudflare installs. They don't touch a Docker server.

## What's different from Cloudflare

- **The same runtime, run by you.** The Worker runs in workerd, the open-source runtime Cloudflare uses, through Wrangler's local mode, which Cloudflare built for development. Every change to Yakyard runs the full security suite against this image before it's released. It's still a newer way to run Yakyard than Cloudflare, with fewer teams on it.
- **Transcripts need a Cloudflare token.** See [Voice note transcripts](#voice-note-transcripts). Everything else runs on your server, photo previews included.
- **The free plan math doesn't apply.** No daily request or database limits. Your limits are the server's memory, CPU and disk.
- **One server, no automatic scaling.** No copies around the world, no failover. If the server is down, so is your chat. Size it for your team and keep backups off the server.
- **You look after the server.** Operating system updates, the firewall, disk space and Docker are yours. Yakyard updates are the four commands above.
- **Who can read your messages.** People in your workspace, and anyone who can get into the server or its backups. Locked conversations stay end-to-end encrypted.

## When something fails

**`docker compose ps` doesn't say healthy.** Look at `docker compose logs yakyard`. A missing `SETUP_TOKEN` doesn't stop it; a typo in `.env` can.

**The browser warns about the certificate, or the page doesn't load.** Check that `DOMAIN` is spelled right, that its DNS points at this server, and that ports 80 and 443 are open. `docker compose logs caddy` says what Caddy tried.

**The setup page says to set a setup code.** `SETUP_TOKEN` is empty or shorter than 24 characters. Fix `.env`, then `docker compose up -d`.

**"Bad origin" when you sign in.** Open Yakyard at the exact address in `DOMAIN`, with `https://`.

More in the [FAQ](FAQ.md) and [GitHub issues](https://github.com/yakyard/yakyard/issues).
