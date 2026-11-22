<!-- nav -->
<p><a href="../README.md"><img src="brand/yakyard-app-icon.svg" width="20" height="20" alt="" align="top">&nbsp; <b>Yakyard</b></a> &nbsp;/&nbsp; <a href="WHY-YAKYARD.md">Why</a> · <a href="PROS-AND-CONS.md">Pros and cons</a> · <a href="COMPARE.md">Compare</a> · <a href="FAQ.md">FAQ</a> · <a href="SETUP.md">Setup</a> · <a href="GUIDE.md">Guide</a> · <a href="TECHNICAL.md">Technical</a> · <b>Press kit</b></p>
<!-- /nav -->

# Yakyard press kit

Everything you need to write about Yakyard or show it. Use it freely for articles, reviews, videos and talks.

## One-liner

Yakyard is free team chat you run on your own Cloudflare account.

Tagline: **Yak all you want. Pay nobody.**

## 50 words

Yakyard is a team chat you deploy to your own Cloudflare account. It has channels, threads, DMs, calls, voice notes with automatic transcripts, and locked conversations with end-to-end encryption. Built to fit Cloudflare's free plan, it costs nothing for teams of up to about 50 people. Free and open source.

## 150 words

Yakyard is team chat for small teams that are tired of paying per seat to talk to each other. You deploy it once to your own Cloudflare account, with one command or a Deploy to Cloudflare button, and there's no server to run.

It covers what teams use every day: public and private channels, threads, direct and group messages, mentions, reactions, search, scheduled send, reminders, guests and push notifications. It adds voice notes with automatic, searchable transcripts, and "Pop in" calls with screen share in any channel. It installs like an app on phones and computers, and each person can bring their Slack DMs and private channels along. Since version 2, any DM or private channel can be locked: end-to-end encrypted on each device with vodozemac, the library behind Element, so not even the admin can read it.

Yakyard is written to fit Cloudflare's free plan, so a team of up to about 50 people pays $0. Messages stay in the team's own account. It's free and open source under the Apache License 2.0.

## Boilerplate

> Yakyard is free team chat that runs on your own Cloudflare account. It started as the internal chat of a team that left Slack, and that team still uses it every day. Yakyard is free and open source under the Apache License 2.0. Learn more at github.com/yakyard/yakyard.

## Facts

| | |
|---|---|
| What | Self-hosted team chat on Cloudflare Workers |
| Price | Free. Runs on Cloudflare's free plan for about 50 people; Cloudflare's Workers Paid plan ($5 a month minimum per account) above that |
| Features | Channels, threads, DMs, mentions, reactions, search, voice notes with transcripts, calls with screen share, locked conversations (end-to-end encrypted DMs and private channels), scheduled send, reminders, Later, push notifications, guests, Google sign-in, Slack import, three themes |
| Encryption | Optional, per conversation: Olm and Megolm (vodozemac 0.11.2, Apache-2.0, audited by Least Authority in 2022) in the browser. Yakyard's own code around it (Apache-2.0, `packages/yakyard-lock`) is not independently audited yet. |
| Runs on | Cloudflare Workers, Durable Objects, D1, R2, Workers AI |
| Apps | Installable web app (PWA) for iPhone, Android, Mac and Windows |
| License | Apache License 2.0 (OSI-approved open source). Versions 1.0.0 and 2.0.0 were released under PolyForm Shield 1.0.0. |
| Version | 2.1.0 |
| Code | github.com/yakyard/yakyard |

Yakyard is open source under the Apache License 2.0, so "free and open source" is accurate.

## Logos

All files are SVG in [`docs/brand/`](brand/). Usage notes are in [`docs/brand/README.md`](brand/README.md).

| File | Use it for | Ground |
|---|---|---|
| [`yakyard-lockup.svg`](brand/yakyard-lockup.svg) | Default logo: icon plus wordmark | Light |
| [`yakyard-wordmark.svg`](brand/yakyard-wordmark.svg) | Name only | Light |
| [`yakyard-wordmark-reverse.svg`](brand/yakyard-wordmark-reverse.svg) | Name only | Dark or indigo |
| [`yakyard-app-icon.svg`](brand/yakyard-app-icon.svg) | Avatars, favicons, social profile pictures | Any |
| [`yakyard-mark.svg`](brand/yakyard-mark.svg) | The horned bubble alone, for stickers and small spots | Light or dark |

A PNG wordmark is at [`docs/wordmark.png`](wordmark.png), and app icons at 180, 192 and 512 px are in [`public/brand/`](../public/brand/). The social preview card (1280 × 640) is [`docs/brand/social-preview.png`](brand/social-preview.png), and the README banner is in [`docs/brand/`](brand/) in light and dark.

**Please:**
- Keep one horn height of clear space around the logo.
- Keep it at least 96 px wide for the lockup, 72 px for the wordmark, 16 px for the icon.
- On dark grounds, use the reverse wordmark or the app icon. The plain wordmark disappears on dark.

**Please don't** recolor the horns, rotate or tilt the mark, add outlines, shadows or gradients, retype the wordmark in another font, or put the logo on a photo.

## Colors

| Name | Hex | Use |
|---|---|---|
| Yak indigo | `#2B1BD6` | The brand color: app icon tile, frames, primary buttons |
| Yak yellow | `#FFD93B` | The bubble, highlights, your own messages |
| Horn red | `#FF4B2B` | The horns and the red "y". Accent only, never body text |
| Night | `#120F2E` | Ink and dark grounds |
| Paper | `#FFF8E6` | Warm light ground |
| Surface | `#FFFFFF` | Cards and reading areas |

## Fonts

| Font | Used for | License |
|---|---|---|
| Rammetto One | The logo and big headlines | SIL Open Font License 1.1 |
| Wix Madefor Text | Everything people read | SIL Open Font License 1.1 |
| Martian Mono | Times, numbers, code | SIL Open Font License 1.1 |

## Screenshots

Real screenshots of the app, with made-up team names and messages. Use any of them.

| File | Shows |
|---|---|
| [`docs/screens/hero-light.png`](screens/hero-light.png) | Hero, light theme: a shared design, reactions, a thread, a voice note with transcript (1440 × 900 at 1.5x) |
| [`docs/screens/hero-yaky.png`](screens/hero-yaky.png) | Hero, Yaky theme |
| [`docs/screens/desktop-dark.png`](screens/desktop-dark.png) | The dark theme: a link, a mention and a voice note |
| [`docs/screens/thread-panel.png`](screens/thread-panel.png) | A thread open beside a channel |
| [`docs/screens/voice-note-transcript.png`](screens/voice-note-transcript.png) | Close-up of a voice note and its transcript |
| [`docs/screens/search-voice.png`](screens/search-voice.png) | Search for `has:voice`, matched by transcript |
| [`docs/screens/phone-light-channel.png`](screens/phone-light-channel.png) | Phone, light theme, a channel |
| [`docs/screens/phone-light-dms.png`](screens/phone-light-dms.png) | Phone, light theme, direct messages |
| [`docs/screens/phone-yaky-channel.png`](screens/phone-yaky-channel.png) | Phone, Yaky theme, a channel |
| [`docs/screens/phone-yaky-dms.png`](screens/phone-yaky-dms.png) | Phone, Yaky theme, direct messages |
| [`docs/screens/help-panel.png`](screens/help-panel.png) | The Help panel |
| [`docs/screens/admin-usage.png`](screens/admin-usage.png) | Admin: team numbers and free plan usage |
| [`docs/guide/later.png`](guide/later.png) | Later: a scheduled message |
| [`docs/screens/slack-import.png`](screens/slack-import.png) | A finished Slack import |
| [`docs/screens/locked-dm.png`](screens/locked-dm.png) | A locked DM: the Locked tag, the lock banner, a photo and a voice note |
| [`docs/screens/phone-locked-dm.png`](screens/phone-locked-dm.png) | Phone, a locked DM |
| [`docs/guide/locked-step1.png`](guide/locked-step1.png) | Locking, step 1: what works and what doesn't |
| [`docs/guide/locked-recovery-key.png`](guide/locked-recovery-key.png) | The recovery key screen |
| [`docs/guide/notifications.png`](guide/notifications.png) | Notification settings |

## Contact

For press questions or interviews, [open an issue on GitHub](https://github.com/yakyard/yakyard/issues/new/choose) and mark it **Question**. For security problems, follow [SECURITY.md](../SECURITY.md) instead.

Yakyard's copyright is held by QVINTA Ltd (Hong Kong), which releases it under the Apache License 2.0.
