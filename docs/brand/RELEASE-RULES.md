# Release and update design rules

Every Yakyard release, update note and changelog page follows these rules. No exceptions.

## GitHub release page

1. Real text, never pictures of text. Every heading, sentence and command is Markdown so it reads on a phone and can be copied.
2. One branded banner at the top: `docs/brand/release-vX.png`, made with `tools/release-banner.py` (Rammetto One headline, Wix Madefor Text line, app icon, version pill, four brand pills). 1760 x 560. Nothing clipped.
3. Then this order, like 1.0.0 and 2.0.0:
   - a centered `<h3>` with the one-line promise, a centered line under it, and two centered links (main link bold)
   - `##` sections in sentence case, one idea each
   - real app screenshots between sections, full width or two side by side at 49%
   - a "Before you" or "Worth knowing" section with the honest limits
   - an "Update" or "Get it" section with the commands in a code block
   - the Deploy to Cloudflare button, centered
   - the sign-off, centered and bold: Yak all you want. Pay nobody.
4. The source lives in `docs/releases/X.Y.Z.md`. Paste that file into the release.

## Website

Each release also gets `yakyard.pages.dev/releases/X.Y.Z`, built in `site/src/pages.mjs` with the home page's parts: hero, tiles, list cards, update block. The latest release gets the band at the top of the home page.

## Copy

- Run every line through the copywriting and humanizer skills before it goes out.
- Voice from the brand guide: short, plain, "you", sentence case, no exclamation marks, no em dashes, no emoji, no "users".
- Facts only from the code and the changelog. Limits stated plainly.

## Look

- Brand tokens only: yak-indigo, yak-yellow, horn-red (shapes and type 24px and up), night, paper, surface.
- Rammetto One for headlines and stickers, never under 20px, never all caps. Wix Madefor Text for reading. Martian Mono for code and versions.
- Quiet depth: night-tinted shadows, never black, no glows, no gradients between brand colors, no glass.
- Check on a phone before it ships.
