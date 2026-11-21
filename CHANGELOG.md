# Changelog

What changed in each Yakyard release, newest first.

## Unreleased

Nothing yet.

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
- Not end-to-end encrypted.
- One transcript language per workspace.
- Calls connect every browser to every other, so they suit small groups.
- Slack import doesn't bring public channel history.
- Runs only on Cloudflare.
