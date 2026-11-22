<!-- nav -->
<p><a href="../README.md"><img src="brand/yakyard-app-icon.svg" width="20" height="20" alt="Yakyard" align="top"></a>&nbsp; <a href="../README.md"><b>Yakyard</b></a> &nbsp;/&nbsp; <a href="WHY-YAKYARD.md">Why</a> · <a href="PROS-AND-CONS.md">Pros and cons</a> · <a href="COMPARE.md">Compare</a> · <b>FAQ</b> · <a href="SETUP.md">Setup</a> · <a href="GUIDE.md">Guide</a> · <a href="TECHNICAL.md">Technical</a> · <a href="PRESS-KIT.md">Press kit</a></p>
<!-- /nav -->

# Yakyard FAQ

Straight answers. Prices and limits were checked on 21 November 2026. The links are in [sources](sources.md).

**Money**
- [Is Yakyard really free?](#is-yakyard-really-free)
- [Why does Cloudflare want my payment card?](#why-does-cloudflare-want-my-payment-card)
- [When do I have to pay, and how much?](#when-do-i-have-to-pay-and-how-much)
- [How many people can use it?](#how-many-people-can-use-it)
- [What happens when a free limit runs out?](#what-happens-when-a-free-limit-runs-out)

**Your data**
- [Who owns our messages?](#who-owns-our-messages)
- [Who can read our messages?](#who-can-read-our-messages)
- [Is it end-to-end encrypted?](#is-it-end-to-end-encrypted)
- [Does Yakyard collect anything about us?](#does-yakyard-collect-anything-about-us)
- [How do backups work?](#how-do-backups-work)
- [How long is history kept?](#how-long-is-history-kept)
- [How do I remove Yakyard completely?](#how-do-i-remove-yakyard-completely)

**Using it**
- [Is there a phone app?](#is-there-a-phone-app)
- [Does it work offline?](#does-it-work-offline)
- [Which languages do transcripts support?](#which-languages-do-transcripts-support)
- [How do calls work, and how many people can join?](#how-do-calls-work-and-how-many-people-can-join)
- [Can we invite clients or freelancers?](#can-we-invite-clients-or-freelancers)
- [Can people sign in with Google?](#can-people-sign-in-with-google)
- [Can it use our own domain?](#can-it-use-our-own-domain)
- [Does it connect to our other tools?](#does-it-connect-to-our-other-tools)

**Moving in**
- [Can we bring our Slack history?](#can-we-bring-our-slack-history)
- [How long does setup take, and do I need to code?](#how-long-does-setup-take-and-do-i-need-to-code)
- [How do updates work?](#how-do-updates-work)

**License, support and the future**
- [Is it open source?](#is-it-open-source)
- [Can I use it at work?](#can-i-use-it-at-work)
- [Can I sell it, or host it for other companies?](#can-i-sell-it-or-host-it-for-other-companies)
- [Can I change the code?](#can-i-change-the-code)
- [Who is behind Yakyard?](#who-is-behind-yakyard)
- [Where do I get help?](#where-do-i-get-help)
- [What if the project stops?](#what-if-the-project-stops)
- [Is it secure?](#is-it-secure)
- [How do I report a security problem?](#how-do-i-report-a-security-problem)
- [Is it compliant with SOC 2, HIPAA or GDPR?](#is-it-compliant-with-soc-2-hipaa-or-gdpr)
- [Can I run it on my own server instead of Cloudflare?](#can-i-run-it-on-my-own-server-instead-of-cloudflare)

---

## Money

### Is Yakyard really free?

The software costs nothing. It runs on your own Cloudflare account, on Cloudflare's free plan, for a team of up to about 50 people. For most small teams, the total is $0.

### Why does Cloudflare want my payment card?

Cloudflare asks for a card before it turns on R2, the file storage Yakyard uses for photos, files and voice notes. The first 10 GB a month are free, and Yakyard stops new uploads at 9 GB by default so you stay under it. You can change that cap.

### When do I have to pay, and how much?

When you outgrow the free plan: roughly more than 50 busy people, more than about 3 hours of voice notes a day, or regular "free database allowance" messages. Then you switch on Cloudflare's Workers Paid plan, which has a $5 a month minimum for your whole account. It isn't per person. Above the paid plan's included usage, Cloudflare charges by use ([pricing](sources.md#cloudflare-what-yakyard-runs-on)).

### How many people can use it?

About 50 on the free plan, comfortably. The tightest daily allowance works out to about 250 average people, and we plan on a fifth of that because real teams are bursty. On Workers Paid, much more. The math is in [TECHNICAL.md](TECHNICAL.md#free-plan-math).

### What happens when a free limit runs out?

Nothing breaks, and nothing is lost:
- **Voice transcripts:** notes still send and play. The transcript says it comes tomorrow and fills in after midnight UTC.
- **Photo previews:** photos show at full size for an hour, then Yakyard tries again.
- **Database:** pages show "Your team used up today's free database allowance" until midnight UTC.
- **File storage:** uploads stop with a clear message at 2 GB per person or 9 GB for the team.

Admins see storage and today's voice minutes on the **Usage** card in Admin.

## Your data

### Who owns our messages?

You do. They're stored in a D1 database and an R2 bucket in your Cloudflare account. We never get a copy. Cloudflare runs the hardware, under your account and Cloudflare's terms, so it isn't the same as a server in your office.

### Who can read our messages?

People in your workspace can read the conversations they're in. Private channels are only for their members: admins can't add themselves to one. Anyone who can sign in to your Cloudflare account can read the database, except locked conversations, which are end-to-end encrypted (see the next answer). Keep that account locked down with two-factor sign-in.

### Is it end-to-end encrypted?

Yes, optionally, for DMs and private channels. Tick **Lock it** when you start one. Messages, edits, reactions, files and voice notes are then encrypted on each person's device. The server stores only scrambled data. Your admin can't read it, someone with your Cloudflare account can't, and we can't.

The owner turns locked conversations on first, and each lock takes two steps plus a second person: an admin approves a locked channel, and everyone in a locked DM accepts it.

The limits, in plain words:
- Search only finds locked messages already on your device.
- Phone notifications say "New message in a locked conversation", nothing more.
- No voice transcripts, no link previews, no scheduled messages, and Slack import can't add to them.
- Each person gets a recovery key. Lose every device and that key, and the locked messages are gone for good.
- The server still sees who talks to whom and when, and file sizes.
- A conversation can't be unlocked later. Public channels and older conversations stay as they are.
- The encryption library underneath (vodozemac, the one Element uses) was checked by outside experts. Yakyard's own code around it hasn't been yet.

How it works, and what it protects against: [Locked conversations](E2EE.md).

### Does Yakyard collect anything about us?

No. There's no analytics and nothing reports back to us. Yakyard only talks to outside services you turn on: Cloudflare, push services for notifications, Google for Google sign-in, Slack during an import, and Open-Meteo if you turn on weather for team clocks.

### How do backups work?

`npm run backup` saves the whole database to a plain SQL file on your computer. `npm run restore` puts it back, search included. Photos and voice notes live in R2 and aren't in that file. Details and a practice drill are in [SETUP.md](SETUP.md#backups). You run Yakyard, so backups are your job: nobody else has a copy.

### How long is history kept?

Forever, until you delete it. There's no 90-day window. The limits are space: 5 GB of database and 10 GB of files on the free plan.

### How do I remove Yakyard completely?

Back up first if you want to keep anything. Then, in the Yakyard folder:

```
npx wrangler delete
npx wrangler d1 delete yakyard
npx wrangler r2 bucket delete yakyard-files
```

If the bucket won't delete because it isn't empty, empty it in the Cloudflare dashboard first. The names are the defaults. Check yours in `wrangler.jsonc` or the dashboard.

## Using it

### Is there a phone app?

Yakyard installs from the browser on iPhone, Android, Mac and Windows. It gets its own icon, opens like an app and sends push notifications. On iPhone, add it to the Home Screen first. There's no App Store or Play Store app.

### Does it work offline?

The app opens without a connection, but reading and sending messages need one.

### Which languages do transcripts support?

One language for the whole workspace, set by the admin with `VOICE_LANGUAGE`. The default is English. Whisper handles many languages, but mixed-language teams get rough transcripts for whatever isn't the set language. You can also give it names and product words to spell right (`VOICE_HINT`).

### How do calls work, and how many people can join?

Click **Pop in** in any channel or DM. Calls carry voice, camera and screen share, browser to browser. Every person connects to every other person, so calls are best for small groups. There's no hard cap, but each extra person adds load to everyone's connection. For big meetings, use a meeting app. On strict office or hotel networks, set up Cloudflare's TURN relay ([how](TECHNICAL.md#optional-features)).

### Can we invite clients or freelancers?

Yes, as guests. Guests only see the channels you invite them to and the people in them. They can't create channels, add people, pin messages or change topics. Guests count against nothing: there's no per-seat price.

### Can people sign in with Google?

Yes, if you turn it on. You can let anyone with your company email domain sign in without an invite. Passwords and invite links keep working too ([how](TECHNICAL.md#optional-features)).

### Can it use our own domain?

Yes. Add a custom domain to the `yakyard` Worker in the Cloudflare dashboard, then set `APP_URL` to it.

### Does it connect to our other tools?

Not much yet. There's no app directory or bot marketplace. Link previews, Google sign-in and the Slack import are the outside connections today.

## Moving in

### Can we bring our Slack history?

Partly. Each person connects their own Slack account (read-only) and copies their DMs, group messages and private channels, with files and reactions. People are matched by Slack account and email, so a DM imported by both people becomes one conversation. Access to Slack is removed when the copy is done. **Public channel history doesn't come over**, and guests can't import. The setup needs a small Slack app you create once ([how](TECHNICAL.md#optional-features)).

### How long does setup take, and do I need to code?

About 30 minutes the first time, and no coding. You'll type a few commands that the [setup guide](SETUP.md) gives you, one at a time. If you have a GitHub account, the **Deploy to Cloudflare** button skips the terminal.

### How do updates work?

`npm run backup`, then `npm run update`. It pulls the new version, keeps your settings and deploys. Open apps show "New version of Yakyard" and update in one tap. With the Deploy button, sync your GitHub copy and Cloudflare redeploys ([details](TECHNICAL.md#updating)).

## License, support and the future

### Is it open source?

No. Yakyard is free and source-available under the [PolyForm Shield License 1.0.0](../LICENSE.md). You get the full code and can use, change and run it. PolyForm Shield isn't an OSI-approved open source license, because it forbids competing uses, so we don't call Yakyard open source.

### Can I use it at work?

Yes. Any person or business, of any size, can run Yakyard for their own team, for free. That includes commercial companies.

### Can I sell it, or host it for other companies?

No, not under the free license. Selling Yakyard, running it as a chat service for other people or companies, or building a product that competes with it all need a commercial license from QVINTA Ltd, which owns Yakyard. Ask by [opening an issue](https://github.com/yakyard/yakyard/issues/new/choose).

### Can I change the code?

Yes. Change anything for your own use. You can share your changed version too, under the same license, as long as it isn't used to compete with Yakyard.

### Who is behind Yakyard?

It started as the internal chat of a real team that left Slack, and that team still uses it every day. QVINTA Ltd (Hong Kong) owns the copyright and licenses it.

### Where do I get help?

Start with [When something fails](SETUP.md#when-something-fails). Then [GitHub issues](https://github.com/yakyard/yakyard/issues) for bugs and questions. There's no paid support or SLA. See [SUPPORT.md](../SUPPORT.md).

### What if the project stops?

Your Yakyard keeps running. It lives on your Cloudflare account, you have the code, and nothing depends on a server of ours. You'd stop getting updates, and you could keep fixing your own copy under the license.

### Is it secure?

Nobody outside the project has audited it. Here's what it does:

- Passwords are stretched in your browser (PBKDF2, 600,000 rounds), and the server stores only a hash of the result.
- Sign-in is rate-limited.
- Private channels stay private, even from admins.
- Guests only see what they're given.
- Outside pictures load through a proxy.
- A security test suite runs on every change.

- Locked conversations: optional end-to-end encryption for DMs and private channels ([how it works](E2EE.md)).

What it doesn't have: two-factor sign-in for passwords (Google sign-in can cover that), or a formal audit. The encryption library inside locked conversations (vodozemac) was audited; Yakyard's own code wasn't, yet.

### How do I report a security problem?

Privately, through GitHub's security advisories. Please don't open a public issue. See [SECURITY.md](../SECURITY.md).

### Is it compliant with SOC 2, HIPAA or GDPR?

Yakyard has no certifications. You run it, so you're the one responsible for how it's used, much like any software you host. Cloudflare publishes its own compliance information. If your chat must be certified, Yakyard isn't the right choice today.

### Can I run it on my own server instead of Cloudflare?

No. It's built for Cloudflare Workers, Durable Objects, D1 and R2. If you need your own hardware, see the [comparison](COMPARE.md) for chat apps that run there.
