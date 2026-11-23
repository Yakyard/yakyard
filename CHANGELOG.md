# Changelog

What changed in each Yakyard release, newest first.

## Unreleased

### Fixes from launch testing
- Deploy to Cloudflare asks only for `SETUP_TOKEN`. The other secrets in `.dev.vars.example` are commented out, since a made-up value there broke phone notifications and calls.
- Signing in correctly no longer counts toward the lockout. Only wrong passwords do.
- Docker: `restore.sh` checks the backup file first and refuses a damaged one before touching anything. `backup.sh` writes to a temporary file, so a full disk can't leave a half backup, and backups are readable only by you.
- Docker guide: how to try it on your own computer with `DOMAIN=localhost`, and a reminder to keep a copy of `.env`.
- Website: links to headings with an apostrophe work again.
- Docs say plainly that locked conversations are a preview on the home page too, and that the 2022 audit was of an earlier version of vodozemac.

### Public demo
- Visitors can't change channel topics, pin, create channels, add people or rename themselves.
- @here in a demo channel no longer notifies every visitor.
- Typing signals and call actions over the live connection have their own small limit.
### Public demo
- The demo opens like a team that's been working for a while: two more channels (#design and #wholesale), a few days of messages, a pinned price list, and files (a packaging diagram, a PDF price list and a CSV order sheet).
- Each visitor gets a first name and their own DMs from the team, including a group DM, with unread counts and an @mention, so Home, DMs and Activity aren't empty.
- Team clocks and weather are on in the demo, with the made-up team spread over five cities.
- Visitors no longer see each other in member lists, member counts, people pickers or team clocks.
- A deploy that changes the seed reseeds the demo on the next visit (`SEED_VERSION` in `src/demo.js`).

### Phone
- One search box on Home and DMs: the top search bar now uses the full width instead of being cut off, and the extra "Find a conversation" box is gone on phones. Search lists matching channels and DMs above matching messages, on every screen size.

## 2.2.0 (22 November 2026)

Yakyard now runs on your own Linux server with Docker too, with HTTPS from Caddy, backups and updates. The database doesn't change.

### Run it on your own server
- Yakyard now runs on any Linux server with Docker: `docker compose up -d` starts it with Caddy in front for HTTPS, set by one `DOMAIN` line in `.env`. All data (database, files, background jobs) lives in one volume. [Step by step](docs/DOCKER.md), about 15 minutes.
- It runs in workerd, the open-source runtime Cloudflare Workers is built on, through Wrangler's local mode, with a non-root user and a health check. The database is brought up to date on every start.
- Voice notes work there. Transcripts use Workers AI over its REST API when you set `CF_ACCOUNT_ID` and `CF_API_TOKEN`. Without them, each voice note says "Transcripts are off on this server" instead of waiting for one. Photo previews are made on the server.
- `sh docker/backup.sh` and `sh docker/restore.sh` back up and restore the whole volume, files included. Updates are `git pull`, `docker compose pull`, `docker compose up -d`.
- Release tags publish the image to `ghcr.io/yakyard/yakyard`. CI builds the image on every change and runs the full security suite against the container, then restarts it and checks nothing was lost.
- The FAQ, pros and cons, comparison and website now say it runs on your own server too, with the limits: transcripts need a Cloudflare token, Cloudflare's free plan math doesn't apply, and it's one server with no automatic scaling.

## 2.1.0 (22 November 2026)

Yakyard is now open source under Apache 2.0, with a live demo anyone can click into. Versions 1.0.0 and 2.0.0 stay under PolyForm Shield 1.0.0.

### License
- The code is under the Apache License 2.0: use it, change it, host it for others or sell it. A NOTICE file carries the copyright and the third-party notices.
- Contributions come in under Apache 2.0 too, with a `Signed-off-by` line (Developer Certificate of Origin). No separate agreement.
- The docs, website, press kit and comparison tables now say open source.

### Live demo
- [yakyard-demo.qvinta.workers.dev](https://yakyard-demo.qvinta.workers.dev): one click on "Try the demo" signs you in as a visitor in a made-up team. No email, no password. Everyone sees what you post, and it resets every night at 03:00 UTC.
- Uploads, new voice notes, admin settings, the Slack import, invites, phone notifications, locked conversations and passwords are off in the demo, each with a short message.
- Run your own with `npm run demo:deploy`: a separate Worker with its own database and file storage, set by `DEMO_MODE` in `wrangler.demo.jsonc`. A normal install never has it. [Details](docs/TECHNICAL.md#public-demo).
- An 80-second tour of the real app, recorded in the demo, at the top of the README and on the website.

### Running it
- Updates and backups can run by themselves. With the Deploy button copy, a GitHub workflow backs up the database every night into your own R2 storage, keeps the last 7, and installs new releases on Sunday nights after one more backup. It's off until you turn it on, and it opens an issue in your copy if something fails. [How to turn it on](docs/SETUP.md#updates-and-backups-by-themselves).

### Docs and website
- "Who runs Yakyard" in the README and FAQ: QVINTA Ltd, and where Yakyard came from.
- Locked conversations are labelled as a preview everywhere, until Yakyard's own encryption code has an outside audit.
- Easier to find in search: one address per page with no redirects, a title of its own on every doc, structured data, a sitemap dated from git, and an `llms.txt` file with the plain facts.
- Branded release pages for 1.0.0 and 2.0.0, and a brand and accessibility pass on the website.

## 2.0.0

Yakyard 2 adds locked conversations: DMs and private channels with end-to-end encryption.

**Preview:** the encryption library is audited, Yakyard's own code around it is not yet. We have applied for an independent audit.

### Locked conversations
- Lock a DM or a private channel when you start it. Messages, edits, reactions, files and voice notes are encrypted on each person's device. The server stores only ciphertext: not the admin, not someone with the Cloudflare account, not us.
- Built on vodozemac 0.11.2 (Olm and Megolm, Apache-2.0, the library behind Element's encryption), compiled to WebAssembly. 131 KB gzipped, loaded only when you use a locked conversation.
- Two approvals, never one click: what changes and "I understand", then type the name (or `lock`). Then a second person: an admin approves a locked channel, everyone in a locked DM accepts. Each step is recorded in the conversation.
- The owner turns it on in Admin, with the same two steps. Off by default.
- Recovery key, shown once, with copy, download and a check that you saved it. New devices open with the key or are approved from another device after comparing a 20-digit code. An encrypted key backup on the server.
- Removing someone starts a new key, so they can't read what comes next.
- Clear limits in the app: a lock banner with "What's different here?", "Search here" on this device only, "No transcript in locked conversations" on voice notes, link previews off, phone notifications that only say "New message in a locked conversation", Slack import that never writes into them.
- A security code per release, shown in the app when it changes, with hashes in `docs/E2EE-HASHES.md` and `npm run lock:verify` to check a running server.
- The encryption package, `packages/yakyard-lock`, is Apache-2.0, so it can be audited and reused. Not independently audited yet: see [docs/E2EE.md](docs/E2EE.md) and [the audit application](docs/AUDIT-APPLICATION.md).

### Security tooling
- CodeQL, Semgrep (JavaScript and secrets rules, must pass), OpenSSF Scorecard and Dependabot (npm and GitHub Actions, weekly) on GitHub.
- New tests: encryption, key rotation, new devices, device approval, fake devices, every approval path, silent notifications, and checks against a running server that stored rows never hold plaintext.

### Since 1.0.0, in short
- A website, built from these docs, with motion and a live demo chat.
- The README became the landing page, with new screenshots of a believable team.
- CI on every change: syntax check, unit tests and the security suite on a local Worker.
- Pros and cons, comparison, FAQ, sales and press kits, rewritten and sourced.

## 1.0.0

The first public release. Team chat for your own Cloudflare account, built to cost nothing.

### Talking
- Public and private channels, threads, direct and group messages (up to 9 people).
- A message box with buttons for bold, italic, lists, quotes, code and links. Nobody has to type markdown.
- Mentions, including @here and @channel. Reactions, with who reacted.
- Files, photos and videos up to 1 GB, with link previews.
- Edit, delete, pin, save for Later, reminders and scheduled send.

### Voice and calls
- Voice notes up to 15 minutes, with a live waveform and 1x, 1.5x and 2x playback.
- Automatic transcripts with Whisper on Cloudflare Workers AI. Searchable, and shown in phone notifications. Set the language and the names it should spell right.
- Pop in: voice calls in any channel or DM, with camera and screen share. Optional TURN relay for strict networks.

### Finding things
- Search across messages and voice transcripts, with `from:`, `in:`, `has:`, `before:`, `after:` and `on:` filters.
- Activity, Threads, Mentions and reactions, Files and Later pages.

### Phones and computers
- Installs like an app on iPhone, Android, Mac and Windows.
- Push notifications with quiet hours, pause, muted channels and VIPs.
- Three themes: Light, Dark and Yaky. Bubbles or a classic list. Text size per device.

### Running it
- One command to deploy (`npm run deploy`), or the Deploy to Cloudflare button. No database ids to paste.
- One command to update (`npm run update`), back up (`npm run backup`) and restore (`npm run restore`).
- Invite links, passwords stretched in the browser, and optional Sign in with Google limited to your domain.
- Guests who only see the channels you give them.
- Slack import: each person brings their own DMs, group messages and private channels, with files and reactions.
- Admin page with people, roles, guests and a Usage card for storage and today's transcript minutes.
- Fits Cloudflare's free plan, about 50 people. When a free limit runs out, Yakyard says so and keeps working.

### Known limits
- No native app store apps. The installable web app does notifications.
- Not end-to-end encrypted (added in 2.0.0 as locked conversations).
- One transcript language per workspace.
- Calls connect every browser to every other, so they suit small groups.
- Slack import doesn't bring public channel history.
- Runs only on Cloudflare.
