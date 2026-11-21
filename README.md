<p align="center"><img src="docs/wordmark.png" width="420" alt="Yakyard"></p>

<p align="center"><b>Your own team chat. Channels, threads, calls and voice notes with transcripts.<br>Runs on your Cloudflare account. No per-seat bill, no one else holding your messages.</b></p>

<p align="center"><img src="docs/screenshot-app.png" alt="Yakyard" width="860"></p>

---

## Why

Team chat gets expensive fast, and your company history ends up on someone else's servers. Yakyard is a full team chat you deploy once to your own Cloudflare account. It feels familiar from day one, it works on phones and computers, and it can bring your old Slack history with it.

It started as the in-house chat of a small consumer-products company spread across several time zones. Every feature here is used daily by a real team.

## What's inside

**Talking**
- Channels (public and private), threads, direct and group messages
- Rich message box: bold, italic, lists, quotes, code, links. No markdown typing needed
- Emoji picker with search, skin tones and your own custom emoji. Reactions, with "who reacted" cards
- Files, photos and videos up to 1 GB, with link previews
- Edit, delete, pin, save for later, reminders, scheduled send

**Voice notes with transcripts**
- Tap the mic, talk, send. Live waveform while recording, up to 15 minutes
- Player with seek and 1x / 1.5x / 2x speed
- Every note is transcribed automatically (Whisper on Cloudflare Workers AI). Transcripts are searchable and show in phone notifications
- Set the language and a list of names it should spell right (people, brands, product words)

**Calls**
- "Pop-in" audio calls in any channel or DM, with screen share and camera
- Mute yourself or others, pick mic and speaker, clear connected / not connected status per person
- TURN relay support, so calls work on strict office and hotel networks

**Phones and computers**
- Installs like an app on iPhone, Android, Mac and Windows (PWA)
- Push notifications with do-not-disturb hours, muted channels and VIPs
- Unread badge on the app icon. Phone layout with tabs and swipe back
- Presence (active / away), status with emoji, and each teammate's local time, city and weather

**Finding things**
- Full-text search across messages and voice transcripts, with `from:` `in:` `has:` `before:` `after:` filters
- Activity, Threads, Mentions, Files and Later pages

**Running it**
- Invite links and passwords, or Sign in with Google (optionally limited to your company domain)
- Admin page: people, roles, guests, who can create channels
- "Moving day": each person imports their own Slack DMs, group messages and private channels with one click (read-only Slack access, revoked when done)
- New-version pop-up so everyone updates at once

## What you need

- A Cloudflare account. Small teams usually fit in the free plan. Check [Cloudflare's pricing](https://developers.cloudflare.com/workers/platform/pricing/) for current limits.
- Node.js 20 or newer on your computer, only to deploy.

Yakyard uses Workers, Durable Objects, D1 (database), R2 (files), Workers AI (transcripts) and the Images binding (photo previews).

## Deploy

```bash
git clone https://github.com/yakyard/yakyard.git
cd yakyard
npm install
npx wrangler login

# 1. Database and file storage
npx wrangler d1 create yakyard          # copy the database_id it prints
npx wrangler r2 bucket create yakyard-files

# 2. Settings
cp wrangler.toml.example wrangler.toml   # fill in every line marked CHANGE
npm run db:init                          # creates the tables

# 3. Go live
./deploy.sh
```

Open the URL it prints. The first visit shows **Set up Yakyard**: create the owner account with an email you listed in `OWNER_EMAILS`. Then invite your team from the menu (Invite people).

### Notifications (recommended)

```bash
npm run vapid                        # prints a public key and a private key
# put the public key in wrangler.toml as VAPID_PUBLIC, then:
npx wrangler secret put VAPID_PRIVATE  # paste the private key line
./deploy.sh
```

On iPhone, people add Yakyard to the Home Screen first (Share, Add to Home Screen), then turn notifications on inside the app.

### Optional

| Feature | What to set |
|---|---|
| Sign in with Google | Create an OAuth client in Google Cloud (redirect `https://YOUR-URL/auth/callback`). Set `GOOGLE_CLIENT_ID`, `GOOGLE_ENABLED = "1"`, secret `GOOGLE_CLIENT_SECRET`. `ALLOWED_DOMAINS` lets anyone with your company email in. |
| Calls on strict networks | Create a TURN key in Cloudflare Realtime. Secrets `TURN_KEY_ID` and `TURN_KEY_TOKEN`. |
| Slack import ("Moving day") | Create a Slack app with user scopes `channels:read groups:history groups:read im:history im:read mpim:history mpim:read users:read files:read reactions:read`, redirect `https://YOUR-URL/slack/callback`. Set `SLACK_CLIENT_ID`, optional `SLACK_TEAM_ID`, secrets `SLACK_CLIENT_SECRET` and `TOKEN_KEY` (any long random string). |
| Better transcripts | `VOICE_LANGUAGE` (e.g. `en`, `fr`, `es`) and `VOICE_HINT` with names and words to spell right. |
| Your own domain | Add a custom domain to the `yakyard` Worker in the Cloudflare dashboard and update `APP_URL`. |

## Updating

```bash
git pull
npm run db:init   # safe to run again, only adds what's missing
./deploy.sh
```

Open apps show "New version of Yakyard" and update in one tap.

## How it's built

No framework and no build step. Plain JavaScript in `public/app.js`, a Cloudflare Worker in `src/`.

| Part | File |
|---|---|
| API, sign-in, files | `src/worker.js` |
| Live updates, presence, calls signaling | `Hub` Durable Object in `src/worker.js` |
| Push, status, search, reminders, scheduled send | `src/features.js` |
| Voice notes and transcripts | `src/voice.js` |
| Slack import | `src/slackimport.js` |
| Link previews | `src/unfurl.js` |
| Database tables | `schema.sql` |

## License

Yakyard is free to use, change and run for your own team or company, under the [PolyForm Shield License 1.0.0](LICENSE.md).

What you can't do is use it to make a product that competes with Yakyard: selling it, or offering it as a hosted chat service to others. If you want to do that, ask QVINTA Ltd for a commercial license by opening an issue.

Bundled fonts and libraries keep their own licenses, see [THIRD-PARTY.md](THIRD-PARTY.md).

Yakyard is an independent project. It is not affiliated with or endorsed by Slack or Salesforce. "Slack" is used only to describe the import feature.
