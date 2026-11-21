# Contributing to Yakyard

Thanks for wanting to help. Bug reports, docs fixes and small, focused pull requests are the most useful things you can send.

## Before you start

- **Bugs:** [open a bug report](https://github.com/yakyard/yakyard/issues/new?template=bug.yml). Include what you did, what you expected, and the red lines from `npx wrangler tail` if there are any.
- **Ideas:** [open a feature request](https://github.com/yakyard/yakyard/issues/new?template=feature.yml) before writing code for anything bigger than a small fix. Yakyard has to fit Cloudflare's free plan, and some good ideas don't. A quick chat first saves you wasted work.
- **Security problems:** don't open an issue. Follow [SECURITY.md](SECURITY.md).

## The license, and what it means for your contribution

Yakyard is free and source-available under the [PolyForm Shield License 1.0.0](LICENSE.md). It isn't open source in the OSI sense. QVINTA Ltd (Hong Kong) holds the copyright, and also offers commercial licenses to people who need terms the free license doesn't give.

Because of that, a contribution can't simply come in under the same license it goes out under (the usual "inbound = outbound" rule). PolyForm Shield forbids competing uses, and QVINTA Ltd needs to be able to ship your change in both the free and the commercial versions.

So we use a short, plain grant instead of a long agreement to sign, the same approach [Weird](https://github.com/muni-town/weird/blob/main/CONTRIBUTING.md) takes for its PolyForm-licensed code:

> By sending a contribution to Yakyard (a pull request, patch, or code in an issue), you confirm that you wrote it or otherwise have the right to submit it, and you license it to QVINTA Ltd and to everyone else under the [Blue Oak Model License 1.0.0](https://blueoakcouncil.org/license/1.0.0). You keep your copyright. Your contribution then ships as part of Yakyard under PolyForm Shield 1.0.0, and may also ship in Yakyard's commercial licenses.

What this means in practice:
- You still own what you wrote, and can use it anywhere else.
- Blue Oak is a short permissive license, so your piece is reusable by anyone under its terms. Yakyard as a whole stays under PolyForm Shield.
- Add a sign-off line to each commit (`git commit -s`), which records that you agree:

```
Signed-off-by: Your Name <you@example.com>
```

If you can't agree to this, for example because your employer owns your code, please don't send code. Issues and ideas are still welcome.

This is a plain-words summary written for contributors, not legal advice.

## Working on the code

Yakyard has no framework and no build step: plain JavaScript in `public/`, a Cloudflare Worker in `src/`. [TECHNICAL.md](docs/TECHNICAL.md#how-its-built) maps where things live.

```bash
npm ci
cp .dev.vars.example .dev.vars     # put a long random code after SETUP_TOKEN=
npm run db:init:local
npm run dev                         # http://localhost:8787
```

### Rules that keep Yakyard free

- **10 ms of CPU per request.** Every request and every background job has to fit Cloudflare's free plan. Run `npm run cpu-bench` before and after your change. For anything on a hot path, run the check on real Cloudflare too ([how](docs/SETUP.md#check-the-cpu-limit)).
- **No new paid Cloudflare features.** Everything must work with zero paid features turned on.
- **No new dependencies** without asking first. Vendored files must be byte-for-byte upstream copies, listed in [THIRD-PARTY.md](THIRD-PARTY.md) with their license and SHA-256.
- **Database changes only add.** New columns and tables go in `schema.sql`; `scripts/migrate.mjs` brings old databases up to date. Never drop or rename.

### Tests

```bash
node --check src/*.js public/*.js scripts/*.mjs
npm test
```

`npm test` runs the unit tests, then the security suite if a local server is running (`npx wrangler dev --local --port 8797` on a fresh `npm run db:init:local`). The security suite needs Python 3 with `requests` and `playwright`. CI runs both on every pull request.

### Words on screen

Yakyard has a voice. Short sentences, plain words, "you" for the reader. Sentence case, even on buttons. No exclamation marks, no em dashes. Errors say what happened and what to do next. At most one joke per screen, and never where data or money is at stake.

## Pull requests

- One change per pull request. Small is easier to review.
- Say what changed and why, and how you tested it. The template asks.
- Add a line to [CHANGELOG.md](CHANGELOG.md) under **Unreleased** if people will notice the change.
- Screenshots for anything visible, in all three themes if it touches colors.

Be kind in issues and reviews. [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) applies everywhere in this project.
