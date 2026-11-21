<p align="center"><img src="docs/wordmark.png" width="420" alt="Yakyard"></p>

<p align="center"><b>Yak all you want. Pay nobody.</b></p>

<p align="center">Your own team chat. Channels, threads, calls and voice notes with transcripts.<br>Runs on your Cloudflare account, so nobody bills you per seat and nobody else holds your messages.</p>

<p align="center"><img src="docs/screenshot-app.png" alt="Yakyard" width="860"></p>

---

**Start here**

- **Running it for your team?** [Set up Yakyard, free](docs/SETUP.md): a step-by-step guide, no coding needed. About 30 minutes.
- **Using it?** [Using Yakyard](docs/GUIDE.md): channels, threads, voice notes, search, notifications and more, with pictures.
- **Know Cloudflare already?** [![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/yakyard/yakyard) The button copies Yakyard to your GitHub, creates the database, file storage and background jobs, and deploys. It asks for one secret, `SETUP_TOKEN`. Turn on R2 in your Cloudflare account first (step 2 of the setup guide).

Runs on Cloudflare's free plan for a team of up to about 50 people. The math is in [Free plan](#free-plan).

## Why

Team chat gets expensive fast, and your company history ends up on someone else's servers. Yakyard is a full team chat you deploy once to your own Cloudflare account. If your team knows Slack, they know Yakyard. It works on phones and computers, and it can bring your Slack history with it.

## What's inside

**Talking**
- Channels (public and private), threads, direct and group messages
- Rich message box: bold, italic, lists, quotes, code and links from buttons or shortcuts, so nobody has to type markdown
- Emoji picker with search and skin tones. Reactions, with "who reacted" cards
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
- Presence (active / away) and status with emoji
- Team clocks (off by default): when the admin turns them on, each person can choose to share their city and local time, optionally with the weather there. See "Team clocks and privacy" below

**Finding things**
- Full-text search across messages and voice transcripts, with `from:` `in:` `has:` `before:` `after:` filters
- Activity, Threads, Mentions, Files and Later pages

**Running it**
- Invite links and passwords, or Sign in with Google (optionally limited to your company domain)
- Admin page: people, roles, guests, who can create channels. Private channels stay private: admins can only change who is in a private channel they are in themselves
- Slack import: each person imports their own Slack DMs, group messages and private channels (read-only Slack access, revoked when done). People are matched by Slack account and email, and DMs from two people's imports end up in one conversation
- New-version pop-up so everyone updates at once
- Three looks: light, dark and Yaky (bold color). Each person picks theirs

## What you need

- A Cloudflare account. The free plan is enough (see [Free plan](#free-plan)). File storage (R2) asks for a payment card before you can turn it on, even though the first 10 GB are free.
- Node.js 22.5 or newer on your computer, only to deploy. Works on macOS, Linux and Windows.

Yakyard uses Workers, Durable Objects, D1 (database), R2 (files), Workers AI (transcripts) and the Images binding (photo previews).

## Free plan

Yakyard is built to fit Cloudflare's free plan with zero paid features turned on. Free plan limits (November 2026): 10 ms of CPU per request, 100,000 Worker requests a day, 100,000 Durable Object requests a day, 5 million database rows read and 100,000 written a day, 10 GB of files, 10,000 Workers AI neurons a day, 5,000 photo previews a month. Daily limits reset at midnight UTC.

**CPU per request.** Every request, and every background job, has to finish in under 10 ms of CPU. Estimated in Node.js on the code paths that do real work, and checked on Cloudflare itself with `scripts/cpu-check.mjs` (a copy of Yakyard with the 10 ms limit switched on, used end to end, see [SETUP.md](docs/SETUP.md#check-the-cpu-limit)):

| What | CPU | How it fits |
|---|---|---|
| Password sign-in | 0.05 ms | The slow part (PBKDF2-SHA256, 600,000 rounds, about 130 ms) runs in your browser, like Bitwarden. The server only does one SHA-256 of a salt and that key. |
| Sign-in of an account made before browser-side stretching | 0.05 ms | The server never runs the old 18 ms hash. The person is asked to set a new password once, from a sign-in link (see [Old accounts](#old-accounts)). |
| Unknown email at sign-in | 0.05 ms | Same work as a real account, so the reply doesn't reveal who has one. |
| Opening a conversation (50 messages) | 0.05 ms | Database time doesn't count as CPU. |
| One phone notification | 1.5 ms | Encryption and signing. Notifications go out four to a background job, so a message to 30 people is 8 small jobs, never one big request. |
| Slack import, one page of 50 messages | 2 ms | Each import is a chain of background jobs: 3 pages (150 messages) per job, the next job 4 seconds later. |
| Voice note to transcript, per minute of audio | under 1 ms | Native base64. Each note gets its own background job, which retries if Workers AI is busy and waits for tomorrow if today's free time is used up. |
| Link previews and outside pictures | small | Page parsing is native (HTMLRewriter), capped at 512 KB. Pictures are streamed, 5 MB max. |

Calls (Pop in) go browser to browser. The server only relays the short setup messages.

**Background jobs.** Scheduled messages, reminders, transcripts, Slack imports and phone notifications each run as their own job: a small Durable Object woken by its own alarm. Every job is its own run with its own 10 ms, so nothing waits behind anything else, and a scheduled message goes out within seconds of its time. A check every 5 minutes (the cron) only re-wakes anything that is overdue. Cloudflare Queues are on the free plan too, but their 10,000 operations a day are shared by the whole account, and one Slack import plus a day of notifications can use them up. Durable Objects allow 100,000 requests a day.

**How many people.** Rough daily numbers for one active person: 40 messages sent, 150 conversations opened, 5 app opens.

| Allowance | Per active person a day | Free plan a day | People |
|---|---|---|---|
| Worker requests | about 400 (sends, opens, read marks, uploads) | 100,000, minus 288 for the 5-minute check | about 250 |
| Durable Object requests | about 300 (live updates, plus about 2 per background job) | 100,000 | about 330 |
| Database rows read | about 20,000 | 5,000,000 | about 250 |
| Database rows written | about 350 | 100,000 | about 285 |
| Voice transcripts | depends | about 214 minutes for the whole team | |
| File storage | depends | 10 GB (Yakyard stops new uploads at 9 GB) | |

The tightest line is about 250 people. Real teams are bursty and some people are heavy users, so plan on a fifth of that: **up to about 50 people**, comfortably. The first things a busy team feels are voice transcripts (about 4 minutes per person a day for 50 people) and photo previews (5,000 a month).

**When something runs out, nothing breaks:**
- Voice transcripts: notes still send and play. The transcript says it comes tomorrow and its background job fills it in after midnight UTC.
- Photo previews: photos show at full size for an hour, then Yakyard tries again.
- Database: pages and the app show "Your team used up today's free database allowance" instead of an error page, until midnight UTC.
- File storage: uploads stop with a clear message at 2 GB per person or 9 GB for the team. Change both with `STORAGE_PER_PERSON_GB` and `STORAGE_TOTAL_GB`.

Admins see storage and today's voice minutes on the **Usage** card in Admin. Requests and database use are in the Cloudflare dashboard.

**When to pay $5 a month (Workers Paid).** More than about 50 busy people, more than about 3 hours of voice notes a day, or if you see "free database allowance" or error 1102 more than once. Upgrade in the Cloudflare dashboard. Nothing in Yakyard changes.

## Try it on your computer first

```bash
git clone https://github.com/yakyard/yakyard.git
cd yakyard
npm ci
cp .dev.vars.example .dev.vars            # then put a long random code after SETUP_TOKEN=, for example from: openssl rand -hex 24
npm run db:init:local                      # creates the tables in a local database
npm run dev                                # open the address it prints, usually http://localhost:8787
```

The first visit shows **Set up Yakyard**. The setup code is the `SETUP_TOKEN` in `.dev.vars`.

Notes for local testing:
- `.dev.vars` holds secrets for `wrangler dev`, one `NAME=value` per line. It is in `.gitignore`. Put `VAPID_PRIVATE`, `TOKEN_KEY` and others here when you test those features.
- Workers AI always runs on Cloudflare, even locally, so voice transcripts need `npx wrangler login` and count against your account.
- If every page shows `no such table: users`, run `npm run db:init:local` again.

## Deploy

The step-by-step version, for people who don't use a terminal every day, is [docs/SETUP.md](docs/SETUP.md). The short version:

```bash
npx wrangler login
npm run deploy
```

Settings live in `wrangler.jsonc`, which works as it is. The first `npm run deploy` creates the D1 database and the R2 bucket (Wrangler's automatic provisioning, so there are no ids to paste), deploys, brings the database tables up to date, and makes a setup code that it prints once. Turn on R2 in the Cloudflare dashboard first.

Or use the **Deploy to Cloudflare** button at the top: it does the same from your browser, keeps a copy of Yakyard in your GitHub, and redeploys when you push to it. Type your own long random setup code when it asks for `SETUP_TOKEN`.

Open the address it prints. The first visit shows **Set up Yakyard**: enter the setup code, then create the owner account. The setup code makes sure nobody else can claim your new workspace. It only works once. If you set `OWNER_EMAILS`, the owner email must be on that list.

Then invite your team from the menu (**Invite people**). Invites make a link: you send it yourself, by email, chat or text.

To keep R2 tidy, add a lifecycle rule to the bucket in the Cloudflare dashboard (R2, the bucket, Settings, Object lifecycle rules) that aborts incomplete multipart uploads after 1 day.

### Notifications (recommended)

```bash
npm run vapid                             # prints VAPID_PUBLIC, VAPID_SUBJECT and a private key
# put VAPID_PUBLIC and VAPID_SUBJECT in wrangler.jsonc under "vars", then:
npx wrangler secret put VAPID_PRIVATE     # paste the private key line
npm run deploy
```

`VAPID_SUBJECT` is an email address push services can reach you at, written as `mailto:you@example.com`. Until these are set, the owner sees "Phone notifications are off" in the first-run checklist.

On iPhone, people add Yakyard to the Home Screen first (Share, Add to Home Screen), then turn notifications on inside the app.

### Optional

| Feature | What to set |
|---|---|
| Sign in with Google | Create an OAuth client in Google Cloud (redirect `https://YOUR-URL/auth/callback`). Set `GOOGLE_CLIENT_ID`, `"GOOGLE_ENABLED": "1"`, secret `GOOGLE_CLIENT_SECRET`. `ALLOWED_DOMAINS` lets anyone with your company email in. |
| Calls on strict networks | Create a TURN key in Cloudflare Realtime. Secrets `TURN_KEY_ID` and `TURN_KEY_TOKEN`. |
| Slack import | Create a Slack app with user scopes `channels:read groups:history groups:read im:history im:read mpim:history mpim:read users:read users:read.email files:read reactions:read`, redirect `https://YOUR-URL/slack/callback`. Set `SLACK_CLIENT_ID` and `SLACK_TEAM_ID` (your Slack workspace id, starts with `T`), secrets `SLACK_CLIENT_SECRET` and `TOKEN_KEY`. `TOKEN_KEY` must be exactly 32 random bytes written as base64: make one with `openssl rand -base64 32` and paste the whole line into `npx wrangler secret put TOKEN_KEY`. Instead of the `SLACK_CLIENT_SECRET` secret, the owner can paste the Client Secret on the import page. It is stored encrypted with `TOKEN_KEY`. Guests can't import. |
| Team clocks | `"TEAM_LOCATION": "1"`. See "Team clocks and privacy". |
| Weather on team clocks | `"WEATHER": "1"` as well. See "Team clocks and privacy". |
| Better transcripts | `VOICE_LANGUAGE` (e.g. `en`, `fr`, `es`) and `VOICE_HINT` with names and words to spell right. |
| Your own domain | Add a custom domain to the `yakyard` Worker in the Cloudflare dashboard and update `APP_URL`. |

### Team clocks and privacy

Team clocks are off unless you set `"TEAM_LOCATION": "1"`. Even then, nothing is collected until a person turns on **Share my city and local time** in Status and notifications. Then Yakyard stores the city, region, country and time zone that Cloudflare reports for their connection, and shows them to teammates (never to guests). Turning it off deletes the stored city right away.

With `"WEATHER": "1"`, coordinates rounded to about 10 km are also stored for people who share, and sent to [Open-Meteo](https://open-meteo.com/) to get the weather. Open-Meteo's free API is for non-commercial use only. A company running Yakyard is likely commercial use: check [their terms](https://open-meteo.com/en/terms) and get an API plan if needed, or leave `WEATHER` off.

Each person's time zone is always saved from their own browser (not their location), so do-not-disturb hours work. It is only shown to others if they share.

### All settings

Settings marked `vars` go in `wrangler.jsonc`, under `"vars"`. Secrets are set with `npx wrangler secret put NAME` (the full list is in `.dev.vars.example`).

| Name | Where | Needed | What it does |
|---|---|---|---|
| `WORKSPACE_NAME` | `vars` | no | Team name on the sign-in page. Default "Yakyard". |
| `OWNER_EMAILS` | `vars` | no | Comma-separated emails that are always owners. When set, setup only accepts one of them. |
| `APP_URL` | `vars` | no | Public address for reminder links. Default: the address setup was done on. |
| `SETUP_TOKEN` | secret | first run | Setup code for the first visit, 24+ characters. `npm run deploy` makes one if it is missing. |
| `STORAGE_PER_PERSON_GB`, `STORAGE_TOTAL_GB` | `vars` | no | File space caps. Default 2 and 9 (R2 is free up to 10 GB). |
| `VAPID_PUBLIC`, `VAPID_SUBJECT` | `vars` | for notifications | From `npm run vapid`. |
| `VAPID_PRIVATE` | secret | for notifications | From `npm run vapid`. |
| `ALLOWED_DOMAINS` | `vars` | no | Email domains that may sign in with Google without an invite. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_ENABLED` | `vars` | no | Google sign-in. |
| `GOOGLE_CLIENT_SECRET` | secret | with Google | Google sign-in. |
| `SLACK_CLIENT_ID`, `SLACK_TEAM_ID` | `vars` | no | Slack import. |
| `SLACK_CLIENT_SECRET`, `TOKEN_KEY` | secret | with Slack import | `TOKEN_KEY` is base64 of 32 random bytes. |
| `TURN_KEY_ID`, `TURN_KEY_TOKEN` | secret | no | Calls behind strict networks. |
| `VOICE_LANGUAGE`, `VOICE_HINT` | `vars` | no | Transcript language and spelling hints. |
| `TEAM_LOCATION`, `WEATHER` | `vars` | no | Team clocks and weather. Both default to off. |
| `DEV_LOGIN` | `vars` | no | Local testing only: `/auth/dev?email=...` signs in on localhost. Keep `"0"` in production. |
| `IMG_CACHE_MB` | `vars` | no | Room in R2 for copies of outside pictures, link previews and weather. Default 200. |
| `SLACK_API` | `vars` | no | Tests only: point the Slack import at a mock server. |
| `VOICE_AI_URL` | `vars` | no | Tests only: a local stand-in for Workers AI (localhost addresses only). |
| `PUSH_TEST_URL` | `vars` | no | Tests only: a local stand-in for the push services (localhost addresses only). |

## Updating

```bash
npm run backup     # a copy of the database first, see "Backups"
npm run update     # gets the newest Yakyard and deploys it
```

`npm run update` sets your own settings in `wrangler.jsonc` aside, pulls the new version, puts your settings back and runs `npm run deploy`. Deploying updates the database before the new code goes live (`scripts/migrate.mjs`): it adds any column an existing table is missing, then creates any new tables, indexes and triggers from `schema.sql`. Safe to run again and again. An install from before `wrangler.jsonc` keeps its settings: the first deploy moves them over from `wrangler.toml`.

With the Deploy button, Cloudflare redeploys your GitHub copy on every push. To update it, sync your copy with the original on GitHub (Sync fork, or a pull request from the original).

Open apps show "New version of Yakyard" and update in one tap. If the new version misbehaves, `npx wrangler rollback` puts the previous one back. The database changes only add, so it keeps working. Cloudflare can't roll back past the update that adds background jobs, because it adds a Durable Object class: back up first (details in [SETUP.md](docs/SETUP.md#updates)).

## Backups

```bash
npm run backup                       # saves backups/yakyard-remote-<date>.sql
npm run restore -- backups/<file>    # puts it back (asks first); --local works on your computer's copy
```

`wrangler d1 export` can't make a backup Yakyard can restore: it stops on the full-text search tables, and its option for them writes a file D1 can't import. `npm run backup` reads every table itself and writes plain SQL. `npm run restore` loads it, rebuilds both search indexes and recounts storage. Photos and voice notes live in R2 and are not in the backup. Details and a restore drill in [SETUP.md](docs/SETUP.md#backups).

## Old accounts

Accounts made before Yakyard moved password stretching into the browser hold an older kind of password hash. Checking it would take about 18 ms of CPU, over the free plan's limit, and the server can't check that a new browser key matches the old password without the same cost. So these people set a new password once, from a link: they see "This account needs a new password, once" at sign-in. The owner sends them a new link (**Invite people** with their email). An owner who can't sign in makes their own link from the computer they deploy from:

```bash
npm run signin-link -- you@example.com
```

## Sign-in throttling

Sign-in allows 30 tries per network address and 25 per account in 15 minutes, from anywhere. That means someone who keeps guessing at one person's email can keep that person locked out of password sign-in for a while. Google sign-in and a new link from an admin still work. Admins can only send new links to people who never signed in. The owner can send one to anyone.

The step before sign-in (the browser asking for its password salt) allows 100 requests per address in 15 minutes. Changing a password allows 10 tries per person.

## Tests

```bash
npm test
```

Runs the unit tests, then the security checks against a local server if one is running (`npx wrangler dev --local --port 8797` on a fresh `npm run db:init:local`). The security checks need Python 3 with `requests` and `playwright`. To use another port and database copy: `node scripts/migrate.mjs --local --persist-to=/tmp/yy`, `npx wrangler dev --local --persist-to /tmp/yy --port 8811`, then `YY_BASE=http://localhost:8811 YY_PERSIST=/tmp/yy npm test`.

## How it's built

No framework and no build step. Plain JavaScript in `public/app.js`, a Cloudflare Worker in `src/`.

| Part | File |
|---|---|
| API, sign-in, files | `src/worker.js` |
| Live updates, presence, calls signaling | `Hub` Durable Object in `src/worker.js` |
| Push, status, search, reminders, scheduled send | `src/features.js` |
| Background jobs (one Durable Object per job) | `Job` in `src/worker.js`, `arm`, `jobAlarm` and the job runners in `src/features.js` |
| 5-minute safety check and hourly tidy-up | `scheduled()` in `src/worker.js`, `sweep` and `housekeeping` in `src/features.js` |
| Voice notes and transcripts | `src/voice.js` |
| Slack import | `src/slackimport.js` |
| Link previews | `src/unfurl.js` |
| Database tables | `schema.sql`, brought up to date by `scripts/migrate.mjs` |
| Backups | `scripts/backup.mjs`, `scripts/restore.mjs` |
| CPU check on Cloudflare | `scripts/cpu-check.mjs` |
| Password stretching in the browser | `public/auth.js` |

## License

Yakyard is free to use, change and run for your own team or company, under the [PolyForm Shield License 1.0.0](LICENSE.md).

What you can't do is use it to make a product that competes with Yakyard: selling it, or offering it as a hosted chat service to others. If you want to do that, ask QVINTA Ltd for a commercial license by opening an issue.

Bundled fonts and libraries keep their own licenses, see [THIRD-PARTY.md](THIRD-PARTY.md).

Yakyard is an independent project. It is not affiliated with or endorsed by Slack or Salesforce. "Slack" is used only to describe the import feature.
