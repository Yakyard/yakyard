---
title: Slack's 90-day limit, and how to keep your history
seo: "Slack 90-day message history limit: how to keep it"
description: "On Slack's free plan you see 90 days of messages, and anything over a year old is deleted for good. What you can save, and how, before it goes."
lede: What the free plan hides, what it deletes, and the four ways to keep your team's messages.
date: 2026-11-26
target: slack 90 day message history limit
---

On Slack's free plan you can only see and search the last 90 days of messages and files. Older messages are hidden, and anything more than a year old is deleted for good. To keep your history, export your public channels now, pay for a Slack plan, or move to a chat app that keeps everything, and do it before the one-year mark passes.

Here's what happens to your messages, and the steps for each way to keep them.

## What the 90-day limit does

Slack's help page on [usage limits for free workspaces](https://slack.com/help/articles/115002422943) puts it in two lines. "You can view and search messages and files from the last 90 days." And: "Messages and files more than one year old will be permanently deleted."

So every message lives through three stages:

| Age | What you can do with it |
|---|---|
| Under 90 days | Read it and search it |
| 90 days to 1 year | Hidden. It still exists, but you can't open or search it |
| Over 1 year | Deleted for good |

The deletion started on 26 August 2024 and runs all the time, on a rolling basis. Slack says on its [history update page](https://slack.com/help/articles/29414264463635) that "it will not be possible to restore messages and files once deletion occurs." If your workspace is more than a year old, each day you wait deletes another day of it.

Owners can also choose to delete messages after 90 days instead of keeping them hidden for a year. Check this setting before you count on the hidden messages still being there.

## Option 1: export your public channels now

Every free workspace can export data. Only workspace owners and admins can run it. Steps, from Slack's [export guide](https://slack.com/help/articles/201658943):

1. Open **Admin**, then **Workspace settings**.
2. Go to **Security**, then **Import & export data**.
3. Open the **Export** tab, pick a date range, and click **Start export**.
4. Slack emails you when the file is ready. Download the ZIP from the export page.

Know what you get. On the free plan, the export covers messages and file links from public channels, in JSON. Private channels and direct messages aren't included. File links only cover the last 90 days. The JSON is readable by tools, not by people, so it works as an archive more than a place you go back to.

Do it anyway. It's free, it takes a few minutes, and it's the only copy of your public channels you control.

## Option 2: pay for Slack

If Slack works well for your team, paying is a fair answer. Slack says that if you stay free you "have full access to the past 90 days," and "the remaining 275 days will become available should you upgrade to a paid plan." Slack says upgrading removes the message, file and app limits.

Two things to know. Anything already older than a year doesn't come back, since it's been deleted. And the bill is per person, every month, for as long as you want your history. Current prices are on [Slack's pricing page](https://slack.com/pricing).

## Option 3: move to chat that keeps everything

The other path is a chat app with no history window, ideally one you run yourself, so nobody can change the rules on your old messages later. A few open source choices:

- [Mattermost Team Edition](https://docs.mattermost.com/product-overview/editions-and-offerings) is free and MIT licensed. You run it on a Linux server with PostgreSQL. Watch for the Entry edition, which caps history at 10,000 channel messages.
- [Zulip](https://zulip.com/plans/) has a free self-hosted plan, and its server is Apache 2.0 licensed. Its free cloud plan keeps 10,000 messages of search history.
- [Yakyard](/) is ours. It's free and open source under Apache 2.0, and runs on your own Cloudflare account or your own server with Docker.

In Yakyard, history stays until you delete it. There's no 90-day window and no one-year cutoff. Cloudflare's free plan fits a team of up to about 50 people, and its limits are about space: 5 GB of database and 10 GB of files. Yakyard stops new uploads at 9 GB to leave some room, so the **Usage** card counts against 9 GB.

![The Admin page in Yakyard with the Usage card, showing 2 MB of 9 GB of file storage used and voice transcript minutes for today](screens/admin-usage.png)

## Option 4: bring your DMs and private channels over

The free export skips the messages people usually care about most: DMs and private channels. Yakyard's Slack import is built for those.

Each person connects their own Slack account, read-only, and copies their DMs, group messages and private channels, with files and reactions. People are matched by their Slack account and email, so a DM that both people import becomes one conversation. When the copy is done, Yakyard's access to Slack is removed.

How to set it up:

1. Put Yakyard on your own account. The [setup guide](/docs/setup) takes about 30 minutes and needs no coding.
2. Create the small Slack app the import needs, once, as the owner. The scopes and settings are in the [technical notes](/docs/technical#optional-features), row "Slack import".
3. Ask each person to open **Import from Slack** and connect their account.
4. Let it run. It copies about a thousand messages a minute, slower when Slack asks it to wait. You can close Yakyard while it works.

![Yakyard's Import from Slack page after a finished import: 355 messages copied from 2 conversations, with a See my messages button](screens/slack-import.png)

If your team keeps using Slack for a while, **Copy again to catch new messages** picks up what was said since.

Limits, plainly:

- Public channel history doesn't come over. Use the Slack export from option 1 for those.
- The import can only copy what Slack still hands over. On a free workspace that means what's inside the limit. Files hidden by the limit are skipped, and anything Slack already deleted is gone. The sooner you start, the more you keep.
- Guests can't import.
- Yakyard is a new project, and there's no paid support. Help comes from the docs and GitHub issues.
- You run it, so backups are your job. `npm run backup` saves the whole database to a file on your computer, and with the Deploy button your GitHub copy can back up every night by itself.

## Which one should you pick?

If your team is happy in Slack and the bill is fine, upgrade, and do it before more of your history passes the one-year mark.

If you're on the free plan and staying there, run the public channel export today and repeat it every few months.

If you want your history to be yours for good, export the public channels, then move to a chat app you run yourself and import your DMs and private channels while Slack still shows them. Our [comparison page](/compare) puts Yakyard next to Slack and eight other chat apps, including the places they beat it.

## Try it before you move

Open the [live demo](https://yakyard-demo.qvinta.workers.dev). It's one click, no signup, and it resets every night. When you're ready, [deploy your own](https://deploy.workers.cloudflare.com/?url=https://github.com/yakyard/yakyard) on your Cloudflare account and start copying your history over.
