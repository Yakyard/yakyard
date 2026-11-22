<!-- nav -->
<p><a href="../README.md"><img src="brand/yakyard-app-icon.svg" width="20" height="20" alt="" align="top">&nbsp; <b>Yakyard</b></a> &nbsp;/&nbsp; <a href="WHY-YAKYARD.md">Why</a> · <b>Pros and cons</b> · <a href="COMPARE.md">Compare</a> · <a href="FAQ.md">FAQ</a> · <a href="SETUP.md">Setup</a> · <a href="GUIDE.md">Guide</a> · <a href="TECHNICAL.md">Technical</a> · <a href="PRESS-KIT.md">Press kit</a></p>
<!-- /nav -->

# Yakyard: pros and cons

What Yakyard does well, what's worth knowing before you move your team, and the fine print.

## Good

**It costs nothing for most small teams.** Yakyard runs on Cloudflare's free plan. We measured it on a real Cloudflare account: normal requests took 1 to 7 ms of CPU, under the free plan's 10 ms limit. The daily allowances work out to about 50 people, comfortably. Past that, Cloudflare's Workers Paid plan has a $5 a month minimum for the whole account, not per person. ([math](TECHNICAL.md#free-plan-math), [Cloudflare pricing](sources.md#cloudflare-what-yakyard-runs-on))

**No price per head, ever.** Adding the 11th person, or the 40th, doesn't change the bill. Neither does keeping a client or freelancer around as a guest.

**Your data sits in your account.** Messages are in a Cloudflare D1 database and files in an R2 bucket, both in your Cloudflare account. Deleting the Worker, database and bucket removes everything.

**Your history doesn't expire.** Slack's free plan shows 90 days and deletes anything older than a year ([source](sources.md#slack)). Yakyard keeps everything until you delete it, limited only by the free database size (5 GB) and file storage (10 GB, capped at 9 GB by default).

**Voice notes with transcripts.** Record up to 15 minutes, and Yakyard writes it down with Whisper on Cloudflare Workers AI. Transcripts are searchable and show in phone notifications.

**Calls without a meeting app.** "Pop in" starts a voice call in any channel or DM, with screen share and camera. Optional TURN relay for strict office and hotel networks.

**It brings Slack history.** Each person copies their own Slack DMs, group messages and private channels, with files and reactions. People are matched by account and email, so both halves of a DM land in one conversation.

**Works on phones and computers.** Installable app (PWA) with push notifications, quiet hours, muted channels and VIPs, an unread badge and a phone layout.

**Private channels stay private.** Only members can read them. Admins can't add themselves to one.

**No server to babysit.** One click on Deploy to Cloudflare, or one command. No VPS, no Docker, no PostgreSQL, no TLS certificates, no OS updates. Cloudflare runs the infrastructure.

**Backups you keep.** `npm run backup` writes the whole database to a plain SQL file on your computer.

**It feels like what your team already knows.** Channels, threads, DMs, mentions, reactions, Later, reminders, scheduled send, Ctrl/⌘ + K. People coming from Slack find their way in minutes.

**Made to be fun.** Three themes: Light, Dark and Yaky, the loud one. Each person picks their own.

**Fast to make yours.** No framework, no build step: plain JavaScript and one Cloudflare Worker. You can read every line in an afternoon and change what you need.

**Open source, under Apache 2.0.** Use it at any company, change it, host it for clients or sell it. No fee and no permission to ask. Keep the copyright and license notices, and mark what you changed. ([license](../LICENSE))

**Locked conversations when you need them.** Tick **Lock it** on a DM or private channel and its messages, files and voice notes are encrypted on each person's device, with the same library Element uses (vodozemac). Not even the admin or someone with your Cloudflare account can read them. It takes two approvals, so nobody locks a channel by accident. ([how it works](E2EE.md))

**Preview:** the encryption library is audited, Yakyard's own code around it is not yet. We have applied for an independent audit.

**Nothing phones home.** Yakyard doesn't report to us. The outside services it talks to are the ones you turn on: Cloudflare, push services for notifications, Google if you use Google sign-in, Slack during an import, Open-Meteo if you turn on weather.

**Used for real.** It was built for and is used every day by a real team that left Slack.

## Worth knowing

**Someone on your team runs it.** That person owns the Cloudflare account, runs updates (`npm run update`) and takes backups (`npm run backup`). Each is one command, but nobody does it for you.

**Cloudflare only.** Yakyard is built on Workers, Durable Objects, D1, R2 and Workers AI. It doesn't run on your own server, in Docker, or on another cloud. If you leave Cloudflare, you take the data (SQL backup plus files), not a running app.

**No app store app.** Yakyard installs from the browser and sends push notifications, including on iPhone (after Add to Home Screen). It isn't in the App Store or Play Store, and it needs a connection to load messages.

**Only locked conversations are end-to-end encrypted, and they have limits.** Normal channels and DMs are stored readable in your Cloudflare database, for anyone with access to that account. Locked conversations (DMs and private channels, after two approvals) are encrypted on each device instead. In those, search only covers what's on your device, notifications don't show the message, there are no voice transcripts, link previews or scheduled messages, and someone who loses every device and their recovery key loses those messages for good. The server still sees who talks to whom and when. Locked conversations are a preview: the encryption library is audited, Yakyard's own code around it is not yet. We have applied for an independent audit. Details in [Locked conversations](E2EE.md).

## The fine print

**Calls are for small groups.** Calls connect every browser to every other browser. That's fine for a handful of people and gets heavy for big groups. Use a meeting app for all-hands.

**One transcript language.** The admin sets one language for the whole team (English by default). Teams that talk in several languages get rough transcripts for the others.

**Slack import has gaps.** It copies each person's DMs, group messages and private channels. Public channel history stays in Slack, and guests can't import.

**No support contract.** There's no company selling support, no SLA and no uptime promise. Help comes from the [docs](SETUP.md#when-something-fails), [GitHub issues](https://github.com/yakyard/yakyard/issues) and other people running it. Cloudflare's own uptime is Cloudflare's.

**No compliance paperwork.** Yakyard has no SOC 2, ISO 27001 or HIPAA certification, and no data processing agreement from us. If your industry needs those for chat, Yakyard isn't the right tool yet.

**A payment card, even for free.** Cloudflare asks for a card before it turns on R2 file storage. Nothing is charged under 10 GB.

**Free-plan ceilings are real.** About 214 minutes of transcripts a day for the whole team, 5,000 photo previews a month, and daily database limits that reset at midnight UTC. When one runs out, Yakyard tells you and keeps working ([what happens](TECHNICAL.md#free-plan-math)), but a big team will hit them.

**Few integrations.** No app directory, bots marketplace or Jira/GitHub/Google Drive connectors. It's chat, calls and voice notes.

**Young.** Version 2. Fewer people have run it than the big names, so you'll find rough edges first.

---

Next: [Compare Yakyard with other chat apps](COMPARE.md) · [FAQ](FAQ.md) · [Set it up](SETUP.md)
