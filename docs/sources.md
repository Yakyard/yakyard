<!-- nav -->
<p><a href="../README.md"><img src="brand/yakyard-app-icon.svg" width="20" height="20" alt="Yakyard" align="top"></a>&nbsp; <a href="../README.md"><b>Yakyard</b></a> &nbsp;/&nbsp; <a href="WHY-YAKYARD.md">Why</a> · <a href="PROS-AND-CONS.md">Pros and cons</a> · <a href="COMPARE.md">Compare</a> · <a href="FAQ.md">FAQ</a> · <a href="SETUP.md">Setup</a> · <a href="GUIDE.md">Guide</a> · <a href="TECHNICAL.md">Technical</a> · <a href="PRESS-KIT.md">Press kit</a></p>
<!-- /nav -->

# Sources

Every price, limit and license in the Yakyard docs comes from one of the pages below. All were checked on **21 November 2026**. Prices are in US dollars, before tax, and can change at any time. If you spot one that's out of date, [open an issue](https://github.com/yakyard/yakyard/issues/new/choose) and we'll fix it.

Where a vendor doesn't publish a number, the docs say "not published" instead of guessing.

## Cloudflare (what Yakyard runs on)

| Fact | Source |
|---|---|
| Workers Free: 100,000 requests a day, 10 ms of CPU per invocation. Workers Paid: minimum $5 a month per account. Durable Objects Free: 100,000 requests a day. D1 Free: 5 million rows read and 100,000 rows written a day, 5 GB storage. | [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) |
| R2 free tier: 10 GB-month of storage, 1 million Class A and 10 million Class B operations a month, no egress charges. | [R2 pricing](https://developers.cloudflare.com/r2/pricing/) |
| Workers AI: 10,000 Neurons a day free, reset at 00:00 UTC. `whisper-large-v3-turbo` costs 46.63 Neurons per audio minute, so about 214 free minutes a day. $0.011 per 1,000 Neurons above that, on Workers Paid. | [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/) |

Yakyard's own measurements (CPU per request, people per free plan) are in the [README](../README.md#what-it-costs) and [TECHNICAL.md](TECHNICAL.md#free-plan-math). They come from Yakyard's test scripts (`npm run cpu-bench`, `scripts/cpu-check.mjs`), not from Cloudflare.

## Slack

| Fact | Source |
|---|---|
| Pro $7.25 per user a month paid yearly, $8.75 paid monthly. Business+ $15 yearly, $18 monthly. Enterprise+ by quote. Free plan: 90 days of message history, up to 10 apps, huddles 1:1 only. Over 2,600 apps in the App Directory. Pro: Slack Connect with up to 250 outside organizations; group huddles with audio, video and screen sharing. | [slack.com/pricing](https://slack.com/intl/en-us/pricing) |
| "Messages and files on the Free plan will only be stored for one year. Any content in your workspace more than a year old will be permanently deleted." | [Slack Pro plan pricing changes](https://slack.com/help/articles/7050776459923-Pricing-changes-for-the-Pro-plan-and-updates-to-our-Fair-Billing-Policy) |
| Deletion of messages and files older than one year on free workspaces started on 26 August 2024, on a rolling basis, and can't be undone. | [Updates to message and file history on free workspaces](https://slack.com/help/articles/29414264463635-Updates-to-message-and-file-history-on-free-workspaces) |

## Microsoft Teams

| Fact | Source |
|---|---|
| Teams Essentials $4.00 per user a month, Microsoft 365 Business Basic $7.00, both paid yearly. Monthly-billing prices not shown on the page. Essentials: meetings up to 30 hours, 300 participants, 10 GB cloud storage per user. | [Compare Teams business options](https://www.microsoft.com/en-us/microsoft-teams/compare-microsoft-teams-business-options) |
| Free Teams: group calls up to 60 minutes, up to 100 participants, 5 GB of cloud storage per user. Aimed at friends and family, "available for anyone to use, including small business use". | [Microsoft Teams free](https://www.microsoft.com/en-us/microsoft-teams/free) |

## Google Chat (Google Workspace)

| Fact | Source |
|---|---|
| Business Starter $7 per user a month on the annual plan, $8.40 on the flexible plan. Business Standard $14 / $16.80. Business Plus $22 / $26.40. | [Compare flexible and annual plans](https://knowledge.workspace.google.com/admin/billing/compare-flexible-and-annual-fixed-term-payment-plans) |
| Chat is included in every Workspace plan. | [Workspace pricing](https://workspace.google.com/pricing) |

## Discord

| Fact | Source |
|---|---|
| Nitro Basic $2.99 a month, Nitro $9.99 a month (per person, prices vary by country). | [discord.com/nitro](https://discord.com/nitro) |
| Users must be at least 13. You give Discord a license to your content. The software license is granted "solely to access our services". No self-hosting is offered. | [Discord Terms of Service](https://discord.com/terms) |

## Mattermost

| Fact | Source |
|---|---|
| All paid plans are quote-based. Professional is "up to 250 users", self-hosted. Enterprise Advanced lists air-gapped deployment. | [mattermost.com/pricing](https://mattermost.com/pricing/) |
| Mattermost Entry: free mode of the commercially licensed Enterprise Edition, "best suited for teams less than 50 users", capped at 10,000 channel messages of history. Team Edition: free, MIT licensed, single Linux binary plus PostgreSQL, for under 250 activated users, no SSO. | [Editions and offerings](https://docs.mattermost.com/product-overview/editions-and-offerings) |

## Rocket.Chat

| Fact | Source |
|---|---|
| Starter: free, up to 50 users, self-managed and self-hosted. Commercial, Government and Defense plans: on-premises, private or sovereign cloud, air-gapped. Community: free, open source (MIT), self-hosted, up to 100 concurrent users. Commercial plans: prices not published. Pro moved to legacy and can't be bought after 29 April 2026. | [Rocket.Chat plans](https://docs.rocket.chat/our-plans) |

## Zulip

| Fact | Source |
|---|---|
| Cloud Standard $6.67 per user a month yearly, $8 monthly. Cloud Plus $10 / $12 (10-user minimum). Cloud Free: 10,000 messages of search history, 5 GB of files. Self-hosted Free, Basic $3.50 monthly, Business $6.67 yearly / $8 monthly (25-user minimum). | [zulip.com/plans](https://zulip.com/plans/) |
| Zulip server license: Apache 2.0. | [github.com/zulip/zulip](https://github.com/zulip/zulip) |
| Native apps for macOS, Windows, Linux, Android and iOS. | [zulip.com/apps](https://zulip.com/apps/) |

## Campfire (ONCE, by 37signals)

| Fact | Source |
|---|---|
| "Entirely free and open source under the MIT License". Self-hosted on your own server. Rooms, mentions, DMs, PWA with push, search. The page lists no voice or video calls. | [once.com/campfire](https://once.com/campfire) |

## Element and Matrix

| Fact | Source |
|---|---|
| Community: free, self-hosted, "Open source under AGPL", for non-professional deployments and evaluations. Enterprise: "Priced per seat/month", price not published. | [element.io/pricing](https://element.io/pricing) |
| Synapse (the Matrix server) is dual-licensed: AGPL-3.0 or a paid Element commercial license. | [github.com/element-hq/synapse](https://github.com/element-hq/synapse) |
| "End-to-end encrypted messaging and calls". Matrix "vendor-agnostic federation". | [element.io](https://element.io/) |

## Licensing and contributions

| Fact | Source |
|---|---|
| Yakyard's license text. | [LICENSE.md](../LICENSE.md), [PolyForm Shield 1.0.0](https://polyformproject.org/licenses/shield/1.0.0) |
| Example of a PolyForm project that takes contributions under a second, permissive license so the licensor can still offer other terms ("Contributor License Compromise": PolyForm NonCommercial plus Blue Oak Model License 1.0.0). | [muni-town/weird CONTRIBUTING.md](https://github.com/muni-town/weird/blob/main/CONTRIBUTING.md) |
| Blue Oak Model License 1.0.0 text. | [blueoakcouncil.org/license/1.0.0](https://blueoakcouncil.org/license/1.0.0) |
| Contributor Covenant 2.1. | [contributor-covenant.org](https://www.contributor-covenant.org/version/2/1/code_of_conduct/) |

## Community rules for launch posts

| Fact | Source |
|---|---|
| r/selfhosted: projects younger than 3 months may only be posted in the current "New Project Megathread"; promoted apps "must be production ready and have docs". Taken from a third-party copy of the rules, because reddit.com was not reachable from where these docs were written. Read the live sidebar before posting. | [willitstay.com/r/selfhosted](https://willitstay.com/r/selfhosted) |
| Show HN: title begins with "Show HN"; something people can try; avoid signups; don't ask friends to upvote or comment. | [news.ycombinator.com/showhn.html](https://news.ycombinator.com/showhn.html) |
| Product Hunt: tagline up to 60 characters, description up to 500, gallery 1270 × 760 px, logo 240 × 240 px, launches go live at midnight Pacific Time. | [Product Hunt: build your product page](https://help.producthunt.com/en/articles/17834537-4-build-your-product-page) |
| GitHub: no more than 20 topics per repository; lowercase letters, numbers and hyphens, 50 characters or less. | [GitHub docs: topics](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/classifying-your-repository-with-topics) |
