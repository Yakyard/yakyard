# Yakyard brand guide

How Yakyard looks, sounds and moves. Everything public follows this: the website, the blog, the README, GitHub releases, social images, emails about Yakyard. Release pages also follow [RELEASE-RULES.md](RELEASE-RULES.md). Logo files and their rules are in [README.md](README.md).

## The idea

Yak all you want. Pay nobody. Your team's chat belongs to your team.

Who it's for: small teams tired of paying per seat to rent their own conversations. Practical, a bit fed up, and they want things that work without a sales call.

Four traits:
- **Fun.** A character people remember. One joke per screen, never where something is at stake.
- **Edgy.** Says it out loud: per-seat pricing is silly, and your messages are yours.
- **Cool.** Short and sure of itself. No begging, no hype words.
- **Free.** Costs nothing, holds back nothing, and is still well made.

## Logo

The horned bubble: a chat bubble mid-sentence, with yak horns. The wordmark is Rammetto One with the second y in horn red. Always use the files in this folder. Never retype or redraw it.

- Clear space is one horn height on every side. Smallest: app icon 16px, lockup 96px wide, wordmark 72px wide.
- Never put the yellow bubble straight on yellow. Use paper, white, indigo or night behind it.
- On dark grounds use the app icon, the mark or the reverse wordmark. There is no reverse lockup yet.
- Don't tilt, recolor, or add shadows or effects.

## Color

Indigo and yellow are the brand. Red is for horns, badges and one hot word per screen. Everything people read sits on calm paper and white.

| Name | Hex | Use |
|---|---|---|
| yak-indigo | #2B1BD6 | Buttons, links, selected, the app frame |
| yak-yellow | #FFD93B | The mark, your messages, highlights |
| horn-red | #FF4B2B | Horns, badges, one hot word |
| night | #120F2E | Ink and dark mode |
| paper | #FFF8E6 | Page ground |
| danger | #C8280F | Error text |

- Contrast: white on indigo 9.4:1, night on yellow 13.5:1, night on red 5.6:1.
- Horn red is never small text (3.15:1 on paper). Only shapes and type 24px and up.
- Dark theme: UI indigo lightens to lilac (#9C93FF) so text stays readable. The logo tile and brand slabs keep electric indigo.
- The live tokens are at the top of `site/src/site.css`. Use them, never new hex values.

## Type

- **Rammetto One**: display. Logo, headlines, stickers. 20px and up, never body text, never all caps.
- **Wix Madefor Text**: everything people read and tap. 400, 600, 700. Messages are 15px on 22px line height.
- **Martian Mono**: times, sizes, codes, shortcuts. Small doses.

No other fonts. Fonts are self-hosted in `site/static/fonts`.

## Voice

Talk like a friend who builds things.

- Short sentences, plain words. Say "you", never "users".
- Sentence case everywhere, buttons and headings too.
- No exclamation marks, anywhere. No emoji. No em dashes.
- No hype words: revolutionary, seamless, robust, game-changing, unlock, supercharge, leverage, cutting-edge.
- The yak can trip. You never "messed up".
- When money, data or security is involved, no jokes. Say exactly what happened and what to do.
- State limits plainly: locked conversations are a preview, there is no paid support, it is a new project.

| Not this | Write |
|---|---|
| No messages yet! 🎉 | Quiet in here. Say something. |
| Oops! Something went wrong!! | That didn't go through. Try again. |
| 404 Not Found | The yak looked everywhere. This page isn't here. |
| Record audio message | Hold to yak |
| Are you sure? | Delete this message? It's gone for everyone, you included. No undo. |
| © All rights reserved | Free forever. Made by QVINTA Ltd. |

Emails to press and creators are personal notes from Tristan Roquette, so they use his own voice (short, direct, warm open and close) and sign "Tristan Roquette, QVINTA Ltd". The voice rules above still apply: no exclamation marks, no emoji, no em dashes, no hype.

## Shapes and depth

Chunky, round, a little stuck on. Thick strokes, big radii (10, 18, 28, pill) and soft light from the top left. Shadows are felt more than seen. No color gradients, no glass, no glow.

## Blog articles

- Same page shell, header, footer and tokens as the rest of the site. Built by `site/build.mjs`, never hand-written HTML.
- One H1 in Rammetto One, body in Wix Madefor Text, max 68 characters a line.
- Real screenshots from `site/static/img` or the demo, with alt text. No stock photos, no AI images.
- Every article ends with one call to action: try the live demo or deploy your own.
- Phone check at 390px wide before publishing.

## Before anything goes public

1. Colors and fonts only from the tokens above.
2. Voice rules checked line by line.
3. Copy run through copywriting, humanizer and copy-editing passes.
4. Checked on a phone width.

Free forever. Made by QVINTA Ltd.
