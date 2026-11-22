<!-- nav -->
<p><a href="../README.md"><img src="brand/yakyard-app-icon.svg" width="20" height="20" alt="" align="top">&nbsp; <b>Yakyard</b></a> &nbsp;/&nbsp; <b>Why</b> · <a href="PROS-AND-CONS.md">Pros and cons</a> · <a href="COMPARE.md">Compare</a> · <a href="FAQ.md">FAQ</a> · <a href="SETUP.md">Setup</a> · <a href="GUIDE.md">Guide</a> · <a href="TECHNICAL.md">Technical</a> · <a href="PRESS-KIT.md">Press kit</a></p>
<!-- /nav -->

# Why Yakyard

## Chat shouldn't be rent

A team chat is where a company thinks out loud. The decision about the supplier, the photo of the broken sample, the voice note from the warehouse at 7 a.m. Five years from now, that's the record of how things got done.

Most teams rent that record. The bill grows with every hire: Slack Pro is $7.25 per person a month paid yearly, $8.75 paid monthly. For 25 people that's $2,175 a year, every year, to talk to each other ([sources](sources.md#slack)).

The free plans aren't much better. Slack's free plan shows the last 90 days. Since August 2024 it deletes anything older than a year, and deleted messages can't be restored ([sources](sources.md#slack)). So the choice is to pay per head or lose your history.

Per-seat pricing made sense when every new person meant another server in a rack. It doesn't now. A message is a few hundred bytes. Cloudflare's free plan alone handles 100,000 requests a day.

## So we built one that runs for free

Yakyard is a full team chat you deploy to your own Cloudflare account. It started as an internal tool for a team that was done paying Slack. They switched, and they use it every day.

**1. Free means free.** Yakyard is built to fit Cloudflare's free plan. Every request has to finish in under 10 ms of CPU, so that's how it's written. Measured on a real Cloudflare account, normal requests take 1 to 7 ms. That's enough for a team of about 50 people at $0. Bigger than that, the next step is Cloudflare's $5 a month, and that's for the whole account however many people you add.

**2. Your history is yours.** Messages live in a database in your Cloudflare account, and files in your own storage bucket. One command backs it all up to a file you keep. No 90-day window, no deletion after a year, no export request to a vendor.

**3. No server, no sysadmin.** Self-hosted chat usually means a Linux box, Docker, PostgreSQL, certificates and patch days. Yakyard skips all of that. Cloudflare runs the machines, and you run one command.

## What we didn't skip

Yakyard has what a team uses every day: channels and threads, DMs, mentions, reactions, search, scheduled send, reminders, Later, push notifications, guests, Google sign-in and a Slack import. It also has two things you don't see in every chat app:

- **Voice notes with transcripts.** Talk instead of typing, and everyone can still skim and search what you said.
- **Pop in.** A voice call in any channel or DM, with screen share, without opening a meeting app.
- **Locked conversations.** Lock a DM or private channel and only the people in it can read it: not the admin, not the server. End-to-end encrypted with vodozemac, the library behind Element. Two approvals to turn it on, and plain words about what works differently. **Preview:** the encryption library is audited, Yakyard's own code around it is not yet. We have applied for an independent audit.

There are three themes. One of them, Yaky, is not subtle.

## Who it's for

- **Small teams, roughly 5 to 50 people,** who are tired of paying per seat to rent their own conversations.
- **Teams on a free chat plan** who are losing history to a 90-day window.
- **Founders and ops leads** who'd rather own a tool than renew a contract.
- **Teams with clients and freelancers** who want them in a channel without paying for another seat.
- **People who like voice notes** and want them searchable.
- **Teams with a few things that must stay private** (pay, hiring, a client's numbers) next to everything else.
- **Someone on the team can follow a setup guide** and type a few commands. No coding.

## Who it's not for

We'd rather lose you now than disappoint you later.

- **Teams that need every conversation end-to-end encrypted, or an audited client.** Yakyard encrypts only the DMs and private channels you lock, and its own code around the encryption library isn't audited yet. Look at Element (Matrix).
- **Regulated industries** that need SOC 2, HIPAA or similar paperwork for chat. Yakyard has none.
- **Teams that need their own hardware** or can't use Cloudflare. Yakyard only runs on Cloudflare.
- **Large organizations** that want a vendor, an SLA, a support line and a sales contact.
- **Teams that live in integrations** (Jira bots, CI alerts, app directories). Yakyard is chat, calls and voice notes.
- **Big video meetings.** Calls are browser to browser and suit small groups.
- **Communities and public servers.** Yakyard is built for a team that knows each other, not for thousands of strangers.

## Free, and open source

Yakyard is open source under the [Apache License 2.0](../LICENSE). Use it at any company, change it, run it, host it for clients, even sell it. No fee, no permission to ask. Keep the copyright and license notices, and say what you changed.

We picked Apache 2.0 so that as many teams as possible can use Yakyard and build on it.

---

Ready? [Set up Yakyard, free](SETUP.md). Not sure? Read the [pros and cons](PROS-AND-CONS.md) or the [comparison](COMPARE.md).
