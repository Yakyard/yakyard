# Security

## Report a problem privately

Please don't report security problems in public issues, discussions or pull requests.

Use GitHub's private reporting instead:

1. Open the repository's **Security** tab.
2. Click **Report a vulnerability**.
3. Describe the problem, how to reproduce it, and what someone could do with it.

Only the maintainers can see the report. We'll reply there, work on a fix with you, and credit you in the release notes if you'd like.

If the **Report a vulnerability** button isn't there, open an issue that says only "I have a security report, please enable private reporting", with no details, and we'll set it up.

## What to expect

Yakyard is maintained by a small team with no paid security staff, so we can't promise fixed response times. Serious problems come first. We'll tell you when we've confirmed the problem, when a fix is ready, and when it's released.

Please give us a reasonable time to fix a problem before you publish it.

## What counts

In scope: the code in this repository, including the Worker (`src/`), the web app (`public/`), the deploy, backup and restore scripts (`scripts/`), and the encryption for locked conversations (`packages/yakyard-lock/`, `public/locked.js`, `src/e2ee.js`). For locked conversations we especially want to hear about anything that lets the server, an admin or a removed member read a locked message, slip a device into someone's account, or fake who sent something. The threat model is in [docs/E2EE.md](docs/E2EE.md#threat-model).

Not in scope:
- Cloudflare itself. Report those to Cloudflare.
- Someone's own deployment that changed the code or settings, unless the problem is in Yakyard's defaults.
- Limits we already list: normal conversations (not locked ones) are readable to anyone with access to the Cloudflare account, and metadata of locked conversations (who, when, sizes) is visible to the server. See [docs/E2EE.md](docs/E2EE.md#threat-model).
- Denial of service by using up a free plan's daily quota. Yakyard stops cleanly and resets at midnight UTC by design.

## Supported versions

Only the newest release gets security fixes. Update with `npm run backup` then `npm run update`.

## Keeping your Yakyard safe

- Turn on two-factor sign-in for your Cloudflare account. Anyone who can sign in to it can read your messages, except locked conversations.
- For sensitive DMs and private channels, use locked conversations, and keep your recovery key in a password manager.
- After an update, `npm run lock:verify -- https://your-yakyard` checks that your server sends the published locking code ([docs/E2EE-HASHES.md](docs/E2EE-HASHES.md)).
- Keep `SETUP_TOKEN`, `TOKEN_KEY` and the other secrets out of git (`.dev.vars` is already ignored).
- Keep `DEV_LOGIN` at `"0"` in production.
- Update when a new version comes out.
