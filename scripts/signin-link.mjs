// Makes a one-time sign-in link for a person, from the computer you deploy from. For an owner who can't sign in
// (forgotten password, or an account from before Yakyard moved password stretching to the browser).
//   npm run signin-link -- you@example.com            (your live Yakyard)
//   npm run signin-link -- you@example.com --local    (the copy on your computer)
// The link works once, for 14 days, and lets them choose a new password.
import { randomBytes } from 'node:crypto';
import { d1json, target } from './wrangler.mjs';

const email = (process.argv.slice(2).find((a) => !a.startsWith('--')) || '').trim().toLowerCase();
if (!/^[^@\s']+@[^@\s']+\.[^@\s']+$/.test(email)) { console.error('Give the email address: npm run signin-link -- you@example.com'); process.exit(1); }
const { where, extra } = target();
const token = 'inv' + randomBytes(24).toString('hex'), t = Date.now();
const [, ins, setting] = d1json(where, extra, `DELETE FROM invites WHERE user_id IN (SELECT id FROM users WHERE email='${email}');
INSERT INTO invites (token,user_id,created_at,expires_at) SELECT '${token}', id, ${t}, ${t + 14 * 864e5} FROM users WHERE email='${email}' AND active=1 RETURNING user_id;
SELECT value FROM settings WHERE key='app_url'`);
if (!ins?.results?.length) { console.error(`No active account with the email ${email}. Check the spelling, or invite them from the app.`); process.exit(1); }
const base = process.argv.find((a) => a.startsWith('--url='))?.slice(6) || setting?.results?.[0]?.value || 'https://<your Yakyard address>';
console.log(`\nSign-in link for ${email} (works once, for 14 days):\n\n  ${base.replace(/\/$/, '')}/join/${token}\n`);
