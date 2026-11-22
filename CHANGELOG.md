# Changelog

What changed in each Yakyard release, newest first.

## Unreleased

Nothing yet.

## 2.0.0

Yakyard 2. The big one: locked conversations, with end-to-end encryption.

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
