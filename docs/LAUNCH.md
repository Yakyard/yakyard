<!-- nav -->
<p><a href="../README.md"><img src="brand/yakyard-app-icon.svg" width="20" height="20" alt="" align="top">&nbsp; <b>Yakyard</b></a> &nbsp;/&nbsp; <a href="WHY-YAKYARD.md">Why</a> · <a href="PROS-AND-CONS.md">Pros and cons</a> · <a href="COMPARE.md">Compare</a> · <a href="FAQ.md">FAQ</a> · <a href="SETUP.md">Setup</a> · <a href="GUIDE.md">Guide</a> · <a href="TECHNICAL.md">Technical</a> · <a href="PRESS-KIT.md">Press kit</a></p>
<!-- /nav -->

# Launch kit

Ready-to-post drafts for telling people about Yakyard, plus a plan for launch day and the month after. Every claim in these drafts is in the [README](../README.md) or [sources](sources.md). Before posting, check three things are still true: the prices in [sources](sources.md), the repository address, and each community's current rules.

Rules for every post:
- Say "free and open source" and name the license (Apache 2.0). Anyone can use it, change it and sell it.
- No made-up numbers, user counts, testimonials or "as seen on".
- Say the limits out loud: built for Cloudflare first (it runs on your own server with Docker too, but transcripts there need a Cloudflare token and it's one server with no failover), no native mobile apps, end-to-end encryption only in locked conversations (and not audited yet), no paid support.
- Reply to every comment for the first day, especially the critical ones. Thank people for bugs.

## Positioning

> For small teams who are tired of paying per seat to talk to each other, Yakyard is free, open source team chat that runs on their own Cloudflare account, or on their own server with Docker. Unlike Slack's free plan, it keeps all your history. Unlike most self-hosted chat, the Cloudflare way has no server to look after.

No customer panel was run for this. The positioning comes from the competitor research in [COMPARE.md](COMPARE.md): the gap is "self-hosted, but no server".

## Ten hooks

1. Team chat that costs $0 for 50 people, because it fits Cloudflare's free plan.
2. Your team's chat history shouldn't expire after 90 days.
3. Self-hosted chat, without the server.
4. Built so every request stays under 10 ms of CPU, so it fits Cloudflare's free plan.
5. Voice notes your team can search, because each one gets a transcript.
6. Stop paying per seat to talk to your own team.
7. Slack Pro for 25 people: $2,175 a year. This: $0.
8. One command to deploy. One to update. One to back up.
9. Built for a real team that left Slack. They still use it every day.
10. Bring your Slack DMs and private channels with you.

## Show HN

From the [Show HN rules](https://news.ycombinator.com/showhn.html): the title begins with "Show HN", it has to be something people can try, no signups in the way, and never ask friends to upvote or comment. Write it plain, like you'd explain it to another developer. Post from your own account and stay around to answer.

**Title**

```
Show HN: Yakyard, Slack-style team chat that runs on Cloudflare's free plan
```

**URL:** `https://github.com/yakyard/yakyard`

**Text**

```
Yakyard is a team chat you deploy to your own Cloudflare account, or run
on your own server with Docker: channels, threads, DMs, mentions, search,
calls, and voice notes with automatic transcripts (Whisper on Workers AI).

It's free and open source under Apache 2.0. Any person or business can
use it, change it, host it or sell it.

It started as the internal chat for a small team that left Slack. The
constraint that shaped everything: fit Cloudflare's free plan, which allows
10 ms of CPU per request. Some things that took:

- Password stretching (PBKDF2, 600k rounds) runs in the browser. The server
  does one SHA-256, about 0.05 ms.
- Every background task (scheduled messages, reminders, transcripts, Slack
  import slices, push fan-out) is its own Durable Object with an alarm, so
  each gets its own 10 ms. Queues and Workflows have account-wide daily caps
  on the free plan; DO requests have 100k a day.
- Web Push encryption is written out by hand, no library.
- No framework, no build step. The API is a table of small handlers so a
  cold request only compiles what it uses.

On a real Cloudflare account, normal requests take 1 to 7 ms. The daily
allowances work out to about 50 people. When a quota runs out (database
reads, transcript minutes), it tells you and resets at midnight UTC, and
Workers Paid ($5/month per account) lifts it.

What it doesn't do: no native mobile apps (it's a PWA with push),
end-to-end encryption only in the DMs and private channels you lock (Olm/Megolm
via vodozemac, our wrapper not yet audited), calls are browser-to-browser mesh so small groups
only, Slack import brings DMs and private channels but not public channel
history, and on your own server (Docker, workerd and Caddy) transcripts
still need a Cloudflare token.

There's a one-command deploy, a Deploy to Cloudflare button, a Docker
setup and a live demo: https://yakyard-demo.qvinta.workers.dev. Happy to
answer anything about the free-plan constraints.
```

## Product Hunt

**Name:** Yakyard

**Tagline** (60 characters max)

```
Free, open source Slack alternative you run yourself
```

**Description** (500 characters max)

```
Slack-style team chat you run on your own Cloudflare account or your own server with Docker. Channels, threads, DMs, calls and voice notes with transcripts. On Cloudflare it fits the free plan for about 50 people, so it costs $0. Free and open source (Apache 2.0). Try the live demo with one click, no signup.
```

**Topics:** pick from Product Hunt's list at launch time, such as Open Source, Messaging, Productivity and Remote Work.

**First comment (maker)**

```
Hi, I'm one of the people behind Yakyard.

We were paying per seat for a chat app, and the free plan meant losing
history. So we built a team chat that runs on our own Cloudflare account,
and wrote it to fit the free plan: every request finishes in under 10 ms
of CPU. For a team of up to about 50, it costs nothing.

What's in it: channels, threads, DMs, search, scheduled send, reminders,
calls with screen share, push notifications, guests, Google sign-in, a
Slack import, and voice notes that get written transcripts.

What isn't: native app store apps (it installs from the browser),
end-to-end encryption on every conversation (only the ones you lock, and
that's a preview), or paid support. It's free and open source (Apache 2.0):
use it, change it, build on it. It also runs on your own server with
Docker.

Setup takes about 30 minutes without coding. I'd love to hear what's
missing for your team.
```

**Gallery** (Product Hunt recommends 1270 × 760; crop or pad the screenshots on `#FFF8E6`)

1. [`docs/screens/hero-light.png`](screens/hero-light.png): a busy channel, light theme
2. [`docs/screens/hero-yaky.png`](screens/hero-yaky.png): the Yaky theme
3. [`docs/screens/desktop-dark.png`](screens/desktop-dark.png): the dark theme
4. [`docs/screens/search-voice.png`](screens/search-voice.png): searching voice notes
5. [`docs/guide/later.png`](guide/later.png): Later, with a scheduled message
6. [`docs/screens/slack-import.png`](screens/slack-import.png): a finished Slack import
7. [`docs/screens/phone-yaky-channel.png`](screens/phone-yaky-channel.png): on a phone

Logo: [`docs/brand/yakyard-app-icon.svg`](brand/yakyard-app-icon.svg), exported at 240 × 240 (Product Hunt's recommended size).

## Reddit

### r/selfhosted

Rules to check on the live sidebar before posting (from a copy of the rules, see [sources](sources.md#community-rules-for-launch-posts)):
- Projects younger than 3 months may only be posted in the current **New Project Megathread**. Yakyard's first public commit is recent, so it goes there, not as its own post.
- Promoted apps must be production ready and have docs.
- Don't promote your own projects too much.

Be upfront about how it runs: Cloudflare first, and on your own box with Docker since 2.2.0, where transcripts still need a Cloudflare token. People in r/selfhosted will ask, so say it first.

**Comment for the New Project Megathread**

```
**Yakyard**: Slack-style team chat on your own Cloudflare account or your own server

- What: channels, threads, DMs, search, calls with screen share, push
  notifications, guests, Slack import, and voice notes with automatic
  transcripts.
- Hosting: built for Cloudflare Workers + D1 + R2 + Durable Objects. Since
  2.2.0 it also runs on your own hardware with `docker compose up -d`
  (workerd, the open-source Workers runtime, with Caddy for HTTPS and one
  volume for data). On your own box, transcripts need a Cloudflare token,
  and it's one server with no failover. The Docker way is new.
- Cost: built to fit Cloudflare's free plan, about 50 people at $0. R2
  needs a card on file.
- License: Apache 2.0. Free and open source. Use it, fork it, sell it.
- Limits: no native apps (PWA), E2EE only in locked conversations, mesh calls for small groups.
- Docs: step-by-step setup, a how-to guide, backups and restore.
- Repo: https://github.com/yakyard/yakyard
```

### Slack-alternative and small-business subs

Check each sub's self-promotion rules first. Many allow it only in weekly threads or not at all. Where it's allowed, answer the question people are asking, don't drop a link and run.

**Post or comment**

```
Title: We moved our team off Slack to a free chat on our own Cloudflare account

We're a small team and were paying per seat for chat. The free plan
wasn't an option because it hides anything older than 90 days.

We built Yakyard, which runs on our own Cloudflare account. It works like
Slack (channels, threads, DMs, search, reminders) and adds voice notes
with transcripts. It fits Cloudflare's free plan for about 50 people, so
it costs us nothing.

Honest trade-offs: someone has to own setup and updates (one command
each), there are no app store apps (it installs from the browser),
end-to-end encryption only in conversations you lock, and no paid support. Each person can copy their
own Slack DMs and private channels across, but public channel history
stays in Slack.

It's free and open source (Apache 2.0).
Repo and setup guide: https://github.com/yakyard/yakyard

Happy to answer questions about the move.
```

## X and Bluesky thread

Each post is under 280 characters (the longest is 230), so the same thread fits X and Bluesky's 300. Attach the screenshot listed with a post.

```
1/ We stopped paying per seat for team chat.

Yakyard is Slack-style chat that runs on your own Cloudflare account. For a team of up to about 50, it costs $0.

github.com/yakyard/yakyard
[docs/guide/channel.png]
```

```
2/ Channels, threads, DMs, mentions, search, reminders, scheduled send, guests, push notifications.

The usual. Your team will know where everything is.
```

```
3/ Plus voice notes with automatic transcripts. Talk instead of typing, and everyone can still skim and search what you said.
[docs/guide/search.png]
```

```
4/ How it's free: it's written to fit Cloudflare's free plan, 10 ms of CPU per request. On real Cloudflare, normal requests take 1 to 7 ms. Past about 50 people, Cloudflare charges $5 a month for the whole account. Not per person.
```

```
5/ Your history stays in your account. No 90-day window. One command backs it all up.
```

```
6/ Moving from Slack? Each person copies their own DMs and private channels, with files.
[docs/screens/slack-import.png]
```

```
7/ What it doesn't have: no app store apps (it installs from the browser), no paid support. End-to-end encryption is there, but only in conversations you lock. Built for Cloudflare, and it runs on your own server with Docker too.
```

```
8/ Free and open source under Apache 2.0. Use it at any company, change it, build on it.

Setup guide, about 30 min, no coding: github.com/yakyard/yakyard/blob/main/docs/SETUP.md
```

## LinkedIn

```
We were paying per person, every month, for our team to talk to each other.

So we built Yakyard, a team chat that runs on our own Cloudflare account. It works like Slack: channels, threads, DMs, search, reminders. It adds voice notes that get written transcripts, and calls you start right in a channel.

The part that matters for a small business: it's written to fit Cloudflare's free plan. For a team of up to about 50 people, the bill is $0. Past that, $5 a month for the whole account, not per person.

For 25 people on Slack Pro, that's $2,175 a year we don't spend.

What to know before you try it:
• Someone on your team owns setup and updates. One command each, no coding.
• It installs from the browser on phones, with notifications. No app store app.
• Messages live in your Cloudflare account. Lock a DM or private channel to encrypt it end to end.
• Each person can bring their Slack DMs and private channels across.

It's free and open source. The setup guide takes about 30 minutes: github.com/yakyard/yakyard

#smallbusiness #selfhosted #teamchat
```

## 30-second demo video

A shorter cut for social posts. The full 84-second tour with voiceover is already on the website and in the README (`site/static/media/yakyard-demo.mp4`). Screen recording of the real app, a seeded workspace with made-up names. No stock footage, no AI imagery. Calm music or none. Subtitles burned in.

| Time | Screen | Voice-over |
|---|---|---|
| 0:00 to 0:04 | The Yakyard wordmark on paper, then the tagline | "Yak all you want. Pay nobody." |
| 0:04 to 0:09 | A busy channel, scrolling; open a thread | "Yakyard is team chat. Channels, threads, DMs. Everything your team already knows." |
| 0:09 to 0:15 | Tap the mic, record a short note, send; the transcript appears | "Send a voice note and it writes itself down. Search finds it later." |
| 0:15 to 0:19 | Click Pop in; a call bar with two people and a shared screen | "Pop into a call right in the channel." |
| 0:19 to 0:24 | Cloudflare dashboard showing the yakyard Worker; then the cost table from the README | "It runs on your own Cloudflare account, and fits the free plan. About fifty people, zero dollars." |
| 0:24 to 0:30 | Phone in the Yaky theme, then the repo URL and "Free and open source" | "No server. No per-seat bill. Get it on GitHub." |

## GitHub repository

**Description** (under 350 characters)

```
Free, open source Slack alternative for small teams. Run it on your own Cloudflare account (fits the free plan for about 50 people) or on your own server with Docker. Channels, threads, DMs, calls with screen share, voice notes with transcripts, Slack import and optional end-to-end encrypted conversations. Apache 2.0.
```

**Website:** `https://yakyard.pages.dev`

**Topics** (GitHub allows up to 20: lowercase letters, numbers and hyphens)

```
team-chat, slack-alternative, self-hosted, open-source, chat, messaging, collaboration, cloudflare-workers, durable-objects, cloudflare-d1, cloudflare-r2, workers-ai, docker, pwa, voice-notes, transcription, whisper, webrtc, web-push, end-to-end-encryption
```

**Social preview** (1280 × 640): the lockup on `#FFF8E6` with the tagline, or the channel screenshot cropped to 2:1.

## Launch plan

### Before: a small real test

Before the public posts, prove a stranger can set it up without help.

- Ask 3 to 5 small teams you know (not the team that built it) to set it up from the README alone, and use it for one week.
- Success line, written down before you start: at least 3 of them get to a working workspace without asking for help, and at least 2 are still using it after 7 days.
- Fix every place they got stuck, in the docs first, then the code. Only then post publicly.
- If fewer than 3 finish setup alone, the setup is the problem. Don't launch yet.

### Countdown

| When | What | Blocks launch if it slips |
|---|---|---|
| Launch minus 14 days | Repo public, description, topics and social preview set. CI green. | Yes |
| Minus 14 | Real-team test starts | Yes |
| Minus 7 | Test results in. Docs fixed. CHANGELOG up to date. | Yes |
| Minus 5 | Record the 30-second video. Export the Product Hunt gallery. | No |
| Minus 3 | Check every price in [sources](sources.md) again. Check each sub's rules. | Yes |
| Minus 1 | Schedule Product Hunt (launches go live at midnight Pacific). Draft all posts in one place. | No |

### Launch day

Spread the posts over the day so you can answer every reply. Times are US Pacific.

| Time | Do |
|---|---|
| 00:00 | Product Hunt goes live. Post the maker comment. |
| 07:00 | Show HN. Stay at the keyboard for the next 3 hours to answer comments. |
| 09:00 | X and Bluesky thread. |
| 10:00 | LinkedIn post. |
| 11:00 | r/selfhosted New Project Megathread comment. |
| All day | Answer every comment and issue. Log every bug as a GitHub issue. |
| Evening | Write down what people asked most. That's the next FAQ update. |

**If something breaks:** a setup bug gets a fix or a docs workaround in the README within the hour, and a reply under the post saying what changed. If the Deploy button breaks, point people to the one-command path in [SETUP.md](SETUP.md).

### First 30 days

Numbers to watch every week, and the level that means something needs changing:

| Number | Where | Change something if |
|---|---|---|
| Setup failures reported | GitHub issues with the Bug label, tagged setup | More than 2 a week with the same cause: fix the docs or the deploy script first |
| Questions asked twice | Issues and comments | Any question asked twice goes into the [FAQ](FAQ.md) |
| Stars and forks | GitHub Insights | Use as a trend only, not a goal |
| Traffic to SETUP.md vs README | GitHub Insights, Traffic | Under 1 in 10 README visitors reach SETUP: the README isn't convincing, rework the top |

Reviews:
- **Day 7:** What broke? What did people ask most? Which channel brought people who actually set it up?
- **Day 14:** Are the free-plan limits holding for real teams? Any reports of quota messages?
- **Day 30:** Write a short "first month" note in the CHANGELOG: what changed and why.
