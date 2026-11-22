<!-- nav -->
<p><a href="../README.md"><img src="brand/yakyard-app-icon.svg" width="20" height="20" alt="Yakyard" align="top"></a>&nbsp; <a href="../README.md"><b>Yakyard</b></a> &nbsp;/&nbsp; <a href="WHY-YAKYARD.md">Why</a> · <a href="PROS-AND-CONS.md">Pros and cons</a> · <a href="COMPARE.md">Compare</a> · <a href="FAQ.md">FAQ</a> · <a href="SETUP.md">Setup</a> · <a href="GUIDE.md">Guide</a> · <a href="TECHNICAL.md">Technical</a> · <a href="PRESS-KIT.md">Press kit</a></p>
<!-- /nav -->

# The Yakyard pitch kit

For the person who wants their team on Yakyard and has to convince someone: a boss, a co-founder, the team. Nobody is paying you to sell it, so the only rule is to be straight. Every number here is in [sources](sources.md). There are no testimonials or customer counts here, because we don't have verified ones to share.

- [Pitches: 10 seconds, 30 seconds, 2 minutes](#pitches)
- [Convincing your boss](#convincing-your-boss)
- [Objections, and honest answers](#objections-and-honest-answers)
- [What it costs: 10, 25 and 50 people](#what-it-costs-10-25-and-50-people)
- [A move from Slack, step by step](#a-move-from-slack-step-by-step)
- [Email to pitch it internally](#email-to-pitch-it-internally)

## Pitches

### 10 seconds

> Yakyard is team chat that runs on our own Cloudflare account. It works like Slack, and for a team our size it costs nothing.

### 30 seconds

> We pay per person, every month, to talk to each other. Yakyard is a team chat we'd run on our own Cloudflare account instead. Channels, threads, DMs, calls, and voice notes that get written down automatically. It fits Cloudflare's free plan for about 50 people, so it's $0, and $5 a month for the whole account if we outgrow that. Our messages stay in our account, with no 90-day limit. Setup takes about 30 minutes and nobody needs to code.

### 2 minutes

> Our chat is where most of our decisions get made, and right now we rent it. Slack Pro is $7.25 per person a month on a yearly plan. For us that's [your number] a year, and it goes up with every hire. The free plan isn't a real option: it shows 90 days of history and deletes anything older than a year.
>
> Yakyard is a full team chat that we'd deploy to our own Cloudflare account. It looks and works like Slack: channels, threads, DMs, mentions, reactions, search, reminders, scheduled send. It adds voice notes with written transcripts, so people can talk instead of type and the rest of us can still skim and search it. Calls start right in a channel.
>
> It's built to fit Cloudflare's free plan. Measured on real Cloudflare, normal requests use 1 to 7 ms of CPU against a 10 ms limit, which works out to about 50 people. If we grow past that, Cloudflare's paid plan is $5 a month for the whole account, not per person.
>
> There's no server to look after. Updates and backups are one command each. Each of us can copy our own Slack DMs and private channels across.
>
> The trade-offs: no native app store apps (it installs from the browser, with notifications), no end-to-end encryption, no support contract, and public channel history stays in Slack. It's free and source-available: any business can use it, but nobody can resell it.
>
> It was built for a real team that left Slack, and they use it every day. I'd like to try it with [a few people / one project] for two weeks before we decide.

## Convincing your boss

Bosses care about four things. Answer them in this order.

1. **Money.** "We'd stop paying [Slack total] a year. Yakyard runs on Cloudflare's free plan at our size. Worst case, $60 a year."
2. **Risk.** "Nothing to sign and nothing to cancel. We try it with one team for two weeks. If it doesn't work, we stay where we are and lose an afternoon."
3. **Effort.** "About 30 minutes to set up, no coding. I'll own updates and backups: one command each, once a month."
4. **Our data.** "Our messages sit in our own Cloudflare account, and we keep a backup. No vendor can lock history behind a paywall."

Then stop talking and ask: "Can I run a two-week trial with [team]?"

## Objections, and honest answers

Each answer starts by agreeing with what's true, answers with facts, and ends with a question that moves things on. If the honest answer is "Yakyard isn't for us", say so.

### "Is it secure?"

*What's underneath:* fear of a leak, and of being the one who picked the tool.

> Fair question. It's not end-to-end encrypted, and it hasn't had a formal audit, so I won't oversell it. What it does have: passwords are stretched in the browser and only a hash is stored, sign-in is rate-limited, private channels stay private even from admins, guests only see what they're given, and there's a security test suite in the code. The data sits in our own Cloudflare account, so the biggest thing we control is who can sign in to that account. We'd turn on two-factor sign-in there. Would that cover what you're worried about, or do we need end-to-end encryption?

If the answer is "we need end-to-end encryption", recommend Element, not Yakyard.

### "Free means abandoned."

*What's underneath:* fear of building on something that disappears.

> That happens, so here's what it would mean for us. Yakyard runs in our account, not on someone else's server. If nobody touched the code again, our copy would keep running, we'd have the code and a full backup, and nothing phones home. We'd lose new features and fixes. The bigger risk is what we have now: a vendor can change the price or the history rules, and Slack's free plan has already done both. Want to look at how recently it was updated before we decide?

### "Who do we call when it breaks?"

*What's underneath:* nobody wants to be the help desk.

> Nobody. There's no support contract. There's a troubleshooting guide, GitHub issues, and Cloudflare running the infrastructure. In practice, when a free limit runs out, Yakyard says so in plain words and keeps working, and it resets at midnight UTC. I'd be the person who handles it. Is that OK for a two-week trial, so we can see how often it comes up?

### "Moving off Slack will be a mess."

*What's underneath:* losing history, and people refusing to switch.

> Moving is the real cost, so let's be specific. Each of us connects our own Slack, read-only, and copies our DMs, group messages and private channels with files and reactions. A DM both people import becomes one conversation. Public channel history doesn't come over, so we'd keep Slack's free plan around to read it for a while. The layout is close to Slack, so the learning curve is small. Which channels would we miss most?

### "I need it on my phone."

*What's underneath:* will people actually see messages?

> It works on phones. You install it from the browser on iPhone or Android, it gets its own icon, and it sends push notifications with quiet hours and VIPs. On iPhone you add it to the Home Screen first. What you don't get is an App Store download. Can you try it on your phone for a day and tell me if it's enough?

### "What about compliance?"

*What's underneath:* legal or customer requirements.

> If we need SOC 2, HIPAA or a data processing agreement for chat, Yakyard isn't the right choice. It has no certifications, and nobody is selling it with paperwork. If we don't have those requirements for chat, owning our data in our own account is simpler than another vendor contract. Do any of our contracts actually require it?

### "Is it even legal to use at a company?"

> Yes. The license is PolyForm Shield 1.0.0. Any business can use it for free, change it and run it. The only thing it forbids is selling it or building a competing product. It's source-available, not open source, so if we have an open-source-only policy, it doesn't qualify.

### "It's from a company I've never heard of."

> True. It's young, and it's not trying to be a big vendor. That's why the trial is short and the exit is easy: we keep a backup, and Slack is still there.

### Don't

- Don't claim it's open source, enterprise-grade, or more secure than Slack.
- Don't promise uptime or support.
- Don't make up how many teams use it.
- Don't skip the trade-offs. Your boss will find them, and then your pitch is the problem.

## What it costs: 10, 25 and 50 people

Slack Pro is $7.25 per person a month paid yearly, $8.75 paid monthly. Yakyard's software is free. The only possible bill is Cloudflare's.

| People | Slack Pro, yearly | Slack Pro, monthly | Yakyard, free plan | Yakyard, if we need Workers Paid |
|---|---|---|---|---|
| 10 | $870 | $1,050 | $0 | $60 |
| 25 | $2,175 | $2,625 | $0 | $60 |
| 50 | $4,350 | $5,250 | $0 | $60 |

How it's worked out: people × price × 12. Workers Paid is a $5 a month minimum for the whole Cloudflare account. Heavy use above its included amounts costs more. The Cloudflare dashboard shows where you stand.

For comparison, per person a month: Microsoft Teams Essentials $4 (yearly), Google Workspace Business Starter $7 (yearly) or $8.40 (flexible), Zulip Cloud Standard $6.67 (yearly) or $8 (monthly). Details in [COMPARE.md](COMPARE.md).

Not counted: the time of whoever runs it. Plan on about 30 minutes to set up and a few minutes a month for updates and backups.

## A move from Slack, step by step

An example plan for a team of about 20. Adjust the days to taste.

**Week 0: set up (one person, about an hour).**
1. Follow [the setup guide](SETUP.md): Cloudflare account, R2, deploy, claim the workspace.
2. Turn on phone notifications (step 9) and, if you use Google accounts, Google sign-in (step 10).
3. Create the Slack app for the import (step 11).
4. Recreate your main channels with the same names.

**Week 1: one team tries it.**
1. Invite 4 to 6 people. Send them [the user guide](GUIDE.md).
2. Everyone installs it on their phone and computer and turns on notifications.
3. Each person runs **Import from Slack** once.
4. Move one project's conversations to Yakyard. Keep Slack open for everything else.

**Week 2: decide.**
1. Ask the trial group: did you miss messages? Did anything break? Did voice notes help?
2. Check the **Usage** card in Admin. Are you near any free limit?
3. Go or no-go.

**Week 3: everyone moves.**
1. Invite the rest. Each person imports their own Slack history.
2. Pin a message in Slack's main channels: "We've moved. Here's the link."
3. Set Slack to read-only by habit: no new conversations there.
4. Run `npm run backup` and put the file somewhere safe.

**After that.** Downgrade or cancel the paid Slack plan when the billing period ends. Keep the free Slack workspace for reading old public channels if you need them, remembering that Slack's free plan only shows 90 days and deletes what's older than a year.

## Email to pitch it internally

> **Subject:** Our chat bill, and a free option
>
> Hi [name],
>
> We pay [Slack total] a year for chat, and it goes up with every hire.
>
> I found Yakyard: team chat that runs on our own Cloudflare account. It works like Slack (channels, threads, DMs, search, reminders) and adds voice notes with transcripts and calls in any channel. It fits Cloudflare's free plan for about 50 people, so for us it would cost $0. If we outgrow that, it's $5 a month for the whole account.
>
> What I like: no per-seat price, our messages stay in our account with no 90-day limit, and there's no server to look after.
>
> What to know: no app store apps (it installs from the browser, with notifications), no end-to-end encryption, no support contract, and public channel history stays in Slack. Any business can use it free. It just can't be resold.
>
> I'd like to try it with [team] for two weeks. Setup takes me about 30 minutes, and if it doesn't work we change nothing.
>
> OK to go ahead?
>
> [your name]
>
> Links: [Why Yakyard](https://github.com/yakyard/yakyard/blob/main/docs/WHY-YAKYARD.md) · [Pros and cons](https://github.com/yakyard/yakyard/blob/main/docs/PROS-AND-CONS.md)
