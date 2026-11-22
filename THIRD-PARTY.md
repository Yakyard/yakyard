# Third-party code and fonts

Yakyard ships with these, each under its own license:

| What | Where | License |
|---|---|---|
| emoji-mart 5.6.0 | `public/vendor/emoji-mart.js` | MIT, Copyright (c) Missive |
| @emoji-mart/data 1.2.1 | `public/vendor/emoji-data.json` | MIT, Copyright (c) Missive |
| Rammetto One | `public/fonts/RammettoOne-Regular.woff2` | SIL Open Font License 1.1, Copyright 2011 The Rammetto Project Authors, Reserved Font Name "Rammetto" |
| Wix Madefor Text | `public/fonts/WixMadeforText-Variable.woff2` | SIL Open Font License 1.1, Copyright 2021 The Wix Madefor Project Authors |
| Martian Mono | `public/fonts/MartianMono-Variable.woff2` | SIL Open Font License 1.1, Copyright 2020 The Martian Mono Project Authors |
| Link preview parser | `src/unfurl.js` (adapted from tldraw/cloudflare-workers-unfurl) | MIT, Copyright 2024 tldraw GB Ltd. |
| Phosphor Icons (bold), path data for 9 icons | `site/src/icons.mjs` (website only) | MIT, Copyright (c) 2023 Phosphor Icons |
| marked | npm dev dependency, turns the docs into website pages at build time | MIT, Copyright (c) 2018+ MarkedJS |

## Vendored files

These are byte-for-byte copies of the upstream builds. Check them with `sha256sum public/vendor/*`.

| File | Upstream | SHA-256 |
|---|---|---|
| `public/vendor/emoji-mart.js` | https://cdn.jsdelivr.net/npm/emoji-mart@5.6.0/dist/browser.js | `dd59b205b2ff0def13f50a622de004088ae64e958ae99ca6ff10630f1eb55d28` |
| `public/vendor/emoji-data.json` | https://cdn.jsdelivr.net/npm/@emoji-mart/data@1.2.1/sets/15/native.json | `e1e7d657dba21af5904ffecf043f313852f5495833fc7bff6b1f0c5c4906d148` |

npm dependencies are pinned in `package-lock.json`. Install with `npm ci`.

Voice transcripts use OpenAI Whisper (MIT) running on Cloudflare Workers AI.
Emoji art is drawn by each device's own system font.

The SIL Open Font License 1.1 is at https://openfontlicense.org. The fonts are unmodified and are not sold on their own.

Thanks to OpenSlaq (MIT) for call UX ideas. No code was copied.

