// Yakyard: Cloudflare Worker (API + auth + files) and the Hub Durable Object (live updates).
import { unfurl, safeFetchUrl, safeFetch } from './unfurl.js';
import { slackRoutes, slackApi, importJob } from './slackimport.js';
import { sendPushes, featureApi, hydrateExtras, openDm, v6, arm, routes, runRoutes, jobArm, jobAlarm, sweep, housekeeping, sendScheduled, sendReminder, pushBatch, PUSHES_PER_JOB, dbQuotaError, QUOTA_MSG } from './features.js';
import { parseVoiceMeta, transcribe, patchMessage, voiceJob, fmtDur, VOICE_MAX } from './voice.js';
import { DurableObject, WorkerEntrypoint } from 'cloudflare:workers';
import { cacheGet, cachePut, cacheCleanup } from './cache.js';
import { e2eeApi, startLockedChannel, openLockedDm, lockedAllowed, e2eeHousekeeping } from './e2ee.js';

const SESSION_DAYS = 30;
const SESSION_COOKIE = 'yy_session', STATE_COOKIE = 'yy_state';
const PAGE = 50;
const MIN_PW = 10; // shortest password allowed for new passwords
const now = () => Date.now();
const uid = (p = '') => p + crypto.randomUUID().replace(/-/g, '').slice(0, 16);

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...headers } });
const err = (status, message) => json({ error: message }, status);

function cookie(req, name) {
  const c = req.headers.get('cookie') || '';
  const m = c.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return m ? decodeURIComponent(m[1]) : null;
}
function setCookie(name, value, maxAgeSec, secure) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure ? '; Secure' : ''}`;
}
const isSecure = (req) => new URL(req.url).protocol === 'https:';
// Session ids are stored hashed, so a copy of the database can't be used to sign in.
async function sha256hex(s) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
// Security headers for every HTML page the worker writes itself (sign-in, join, setup).
const SEC = {
  'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'",
  'x-frame-options': 'DENY',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'same-origin',
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
};
// Who may hear about a person's profile: everyone but guests, plus guests who share a conversation with them.
async function audience(env, uid) {
  return (await env.DB.prepare("SELECT id FROM users WHERE role<>'guest' AND active=1 UNION SELECT a.user_id FROM members a JOIN members b ON b.channel_id=a.channel_id WHERE b.user_id=?").bind(uid).all()).results.map((r) => r.id);
}
async function nonGuestIds(env) {
  return (await env.DB.prepare("SELECT id FROM users WHERE role<>'guest' AND active=1").all()).results.map((r) => r.id);
}

// ---------------------------------------------------------------- auth
async function currentUser(req, env) {
  const sid = cookie(req, SESSION_COOKIE);
  if (!sid) return null;
  const q = `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id = ? AND s.expires_at > ? AND u.active = 1`;
  const hid = await sha256hex(sid);
  let row = await env.DB.prepare(q).bind(hid, now()).first();
  if (!row && sid.startsWith('sess_')) {
    // Sessions made before ids were hashed: hash them on first use.
    row = await env.DB.prepare(q).bind(sid, now()).first();
    if (row) await env.DB.prepare('UPDATE sessions SET id=? WHERE id=?').bind(hid, sid).run();
  }
  return row || null;
}

const ownerEmail = (email, env) => (env.OWNER_EMAILS || '').toLowerCase().split(',').map((e) => e.trim()).includes(email.toLowerCase());
function allowedEmail(email, env) {
  const domains = (env.ALLOWED_DOMAINS || '').split(',').map((d) => d.trim().toLowerCase()).filter(Boolean);
  const domain = email.split('@')[1]?.toLowerCase();
  return domains.includes(domain);
}

// Avatar colors: all keep white initials at AA contrast.
const PALETTE = ['#2b1bd6', '#8a1f5c', '#16606b', '#a24a06', '#6b2fb3', '#0f6e8c', '#5b5670', '#3d3a8c'];
const locationOn = (env) => env.TEAM_LOCATION === '1';
const weatherOn = (env) => env.WEATHER === '1';
// What the browser gets about the signed-in person (no coordinates, no Slack id).
const ME_KEYS = ['id', 'email', 'name', 'title', 'avatar', 'color', 'role', 'tz', 'city', 'country', 'status_emoji', 'status_text', 'status_until', 'dnd_until', 'dnd_start', 'dnd_end', 'notify_level', 'vips', 'away', 'share_location'];
const pickMe = (u) => Object.fromEntries(ME_KEYS.map((k) => [k, u[k]]));
const colorFor = (s) => PALETTE[[...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % PALETTE.length];

async function findOrCreateUser(env, { email, name, picture, setup }) {
  email = email.toLowerCase();
  let user = await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
  if (user) {
    if (!user.active) return null;
    if (name && user.name === user.email.split('@')[0]) {
      await env.DB.prepare('UPDATE users SET name = ? WHERE id = ?').bind(name, user.id).run();
      user.name = name;
    }
    if (ownerEmail(email, env) && user.role !== 'owner') {
      await env.DB.prepare("UPDATE users SET role='owner' WHERE id = ?").bind(user.id).run();
      user.role = 'owner';
    }
    if (picture && picture !== user.avatar) {
      await env.DB.prepare('UPDATE users SET avatar = ? WHERE id = ?').bind(picture, user.id).run();
      user.avatar = picture;
    }
    return user;
  }
  if (!setup && !allowedEmail(email, env) && !ownerEmail(email, env)) return null; // everyone else must be invited first
  const count = await env.DB.prepare('SELECT COUNT(*) n FROM users').first();
  user = {
    id: uid('U'), email, name: name || email.split('@')[0], title: '', avatar: picture || '',
    color: colorFor(email), role: count.n === 0 || ownerEmail(email, env) ? 'owner' : 'member', active: 1, created_at: now(),
  };
  await env.DB.prepare(
    'INSERT INTO users (id,email,name,title,avatar,color,role,active,created_at) VALUES (?,?,?,?,?,?,?,?,?)'
  ).bind(user.id, user.email, user.name, '', user.avatar, user.color, user.role, 1, user.created_at).run();
  if (count.n === 0) {
    for (const [name, topic] of [['general', 'Announcements for everyone'], ['random', 'Anything not about work']]) {
      await env.DB.prepare('INSERT OR IGNORE INTO channels (id,kind,name,topic,private,archived,created_by,created_at,last_ts) VALUES (?,?,?,?,0,0,?,?,?)')
        .bind(uid('C'), 'channel', name, topic, user.id, now(), now()).run();
    }
  }
  await joinDefaultChannels(env, user.id);
  await ensureDefaultSections(env, user.id);
  await broadcast(env, { type: 'user_updated', user: { id: user.id, email: user.email, name: user.name, title: '', avatar: user.avatar, color: user.color, role: user.role, active: 1 } }, await nonGuestIds(env)).catch(() => {});
  return user;
}

async function joinDefaultChannels(env, userId) {
  const general = await env.DB.prepare(
    "SELECT id FROM channels WHERE kind='channel' AND name IN ('general','random') AND private=0 AND archived=0"
  ).all();
  for (const c of general.results) {
    await env.DB.prepare('INSERT OR IGNORE INTO members (channel_id,user_id,last_read,joined_at) VALUES (?,?,?,?)')
      .bind(c.id, userId, now(), now()).run();
  }
}

async function ensureDefaultSections(env, userId) {
  const has = await env.DB.prepare('SELECT COUNT(*) n FROM sections WHERE user_id = ?').bind(userId).first();
  if (has.n > 0) return;
  // Copy the workspace's default sections (set by the owner) if any.
  const tpl = await env.DB.prepare("SELECT value FROM settings WHERE key='default_sections'").first();
  if (!tpl) return;
  const list = JSON.parse(tpl.value); // [{name, channels:[name]}]
  let pos = 0;
  for (const s of list) {
    const sid = uid('S');
    await env.DB.prepare('INSERT INTO sections (id,user_id,name,position) VALUES (?,?,?,?)').bind(sid, userId, s.name, pos++).run();
    for (const cname of s.channels || []) {
      await env.DB.prepare(
        "UPDATE members SET section_id=? WHERE user_id=? AND channel_id=(SELECT id FROM channels WHERE name=? AND kind='channel')"
      ).bind(sid, userId, cname).run();
    }
  }
}

// The session row, and a note that this account has signed in at least once (used by invite resets).
const sessionStmts = (env, userId, hid) => [
  env.DB.prepare('INSERT INTO sessions (id,user_id,created_at,expires_at) VALUES (?,?,?,?)').bind(hid, userId, now(), now() + SESSION_DAYS * 864e5),
  env.DB.prepare('INSERT OR IGNORE INTO signins (user_id,first_at) VALUES (?,?)').bind(userId, now()),
];
async function createSession(env, userId) {
  const sid = uid('sess_') + uid();
  await env.DB.batch(sessionStmts(env, userId, await sha256hex(sid)));
  return sid;
}

async function googleStart(req, env) {
  const url = new URL(req.url);
  const state = uid('st');
  const p = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: url.origin + '/auth/callback',
    response_type: 'code',
    scope: 'openid email profile',
    prompt: 'select_account',
    state,
  });
  return new Response(null, {
    status: 302,
    headers: { location: 'https://accounts.google.com/o/oauth2/v2/auth?' + p, 'set-cookie': setCookie(STATE_COOKIE, state, 600, isSecure(req)) },
  });
}

async function googleCallback(req, env) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code || !state || state !== cookie(req, STATE_COOKIE)) return loginPage(env, 'Sign-in timed out. Try again.');
  const tok = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: url.origin + '/auth/callback', grant_type: 'authorization_code',
    }),
  }).then((r) => r.json());
  if (!tok.id_token) return loginPage(env, "Google sign-in didn't work. Try again.");
  // The id_token comes straight from Google over TLS in exchange for our secret, so its claims can be trusted.
  const claims = JSON.parse(atob(tok.id_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
  if (claims.aud !== env.GOOGLE_CLIENT_ID || !claims.email_verified) return loginPage(env, "Google sign-in didn't work. Try again.");
  // An address on an ALLOWED_DOMAINS domain (invited or not) must come from that company's Google Workspace,
  // not a personal Google account made on that address. Other invited addresses (gmail, guests) are not checked.
  const dom = String(claims.email).split('@')[1]?.toLowerCase();
  if (allowedEmail(claims.email, env) && !ownerEmail(claims.email, env) && String(claims.hd || '').toLowerCase() !== dom) return loginPage(env, 'Use your work Google account.');
  const user = await findOrCreateUser(env, { email: claims.email, name: claims.name, picture: claims.picture });
  if (!user) return loginPage(env, `${claims.email} doesn't have access. Ask your workspace admin for an invite.`);
  const sid = await createSession(env, user.id);
  const headers = new Headers({ location: '/' });
  headers.append('set-cookie', setCookie(SESSION_COOKIE, sid, SESSION_DAYS * 86400, isSecure(req)));
  headers.append('set-cookie', setCookie(STATE_COOKIE, '', 0, isSecure(req)));
  return new Response(null, { status: 302, headers });
}


// ---------------------------------------------------------------- password sign-in + invite links
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (t) => Uint8Array.from(atob(t), (c) => c.charCodeAt(0));
// Passwords: the slow part (PBKDF2-SHA256, 600,000 rounds) runs in the browser (public/auth.js),
// Bitwarden style, so sign-in stays far under the 10 ms CPU limit of the free plan. The server keeps
// SHA-256(salt + key), marked "c1:".
// Rows from before that change hold the old server-side hash (PBKDF2, 100,000 rounds, no marker). Checking one
// takes about 18 ms of CPU, over the free plan's limit, and the server can't check that a new browser key matches
// the password without doing the 600,000 rounds itself. So an old row is never checked or upgraded in place: the
// person gets a clear message and sets a new password once through a sign-in link (admin "Invite" / owner
// "npm run signin-link"). That costs one link per old account and never trusts a key the server can't verify.
const KDF_ITER = 600000;
const goodB64 = (t, n) => { try { return typeof t === 'string' && t.length < 64 && unb64(t).length === n; } catch { return false; } };
const isOld = (row) => !!row && !row.hash.startsWith('c1:');
const OLD_PASSWORD = 'This account needs a new password, once: Yakyard changed how it protects passwords. Ask your workspace owner for a sign-in link.';
async function keyHash(key, saltB64) {
  return 'c1:' + b64(await crypto.subtle.digest('SHA-256', new Uint8Array([...unb64(saltB64), ...unb64(key)])));
}
// Checks a sign-in key against a credentials row. No account, or an old row: the same one hash, so the
// response time doesn't tell which emails have an account.
async function checkKey(row, key) {
  const k = goodB64(key, 32) ? key : 'A'.repeat(43) + '=';
  if (!row || isOld(row) || k !== key) { await keyHash(k, 'AAAAAAAAAAAAAAAAAAAAAA=='); return false; }
  return sameText(await keyHash(key, row.salt), row.hash);
}
// One random server secret, made on first use, so unknown emails get a stable fake salt.
let PEPPER;
async function pepper(env) {
  if (PEPPER) return PEPPER;
  await env.DB.prepare("INSERT OR IGNORE INTO settings (key,value) VALUES ('pepper',?)").bind(b64(crypto.getRandomValues(new Uint8Array(32)))).run();
  return (PEPPER = unb64((await env.DB.prepare("SELECT value FROM settings WHERE key='pepper'").first()).value));
}
async function hmac(keyBytes, text) {
  const k = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(text)));
}
// What the server tells about an email before sign-in: its salt and whether it is an old account. Unknown
// emails get a fake salt that never changes, and "old" is faked half the time while old rows exist, so the
// answer doesn't tell anyone which emails have an account. Both paths do the same queries and hashing.
async function accountHint(env, email) {
  const [row, anyOld] = await Promise.all([
    env.DB.prepare('SELECT u.id, c.hash, c.salt FROM users u JOIN credentials c ON c.user_id=u.id WHERE u.email=? AND u.active=1').bind(email).first(),
    env.DB.prepare("SELECT 1 FROM credentials WHERE hash NOT LIKE 'c1:%' LIMIT 1").first(),
  ]);
  const h = await hmac(await pepper(env), 'salt:' + email);
  return row ? { row, salt: row.salt, legacy: isOld(row) } : { row: null, salt: b64(h.slice(0, 16)), legacy: !!anyOld && (h[16] & 1) === 1 };
}
async function saltFor(req, env) {
  const email = String((await req.json().catch(() => ({}))).email || '').toLowerCase().trim().slice(0, 200);
  if ((await bump(env, 'salt:' + clientIp(req))) > 100) return json({ error: 'Too many sign-in tries from this network. Wait 15 minutes.' }, 429);
  const { salt, legacy } = await accountHint(env, email);
  return json({ salt, iter: KDF_ITER, legacy, ...(legacy ? { note: OLD_PASSWORD } : {}) });
}
// Counters for sign-in limits, one row per key per 15-minute window (cleared hourly by the cron).
async function bump(env, k) {
  return (await env.DB.prepare('INSERT INTO login_attempts (k,n) VALUES (?,1) ON CONFLICT(k) DO UPDATE SET n=n+1 RETURNING n').bind(k + '|' + Math.floor(now() / (15 * 60e3))).first()).n;
}
// IPv6 addresses count per /64, since one connection usually owns the whole block.
function clientIp(req) {
  const ip = req.headers.get('cf-connecting-ip') || 'x';
  return ip.includes(':') ? v6(ip).slice(0, 4).join(':') + '::/64' : ip;
}
// New password from a join, setup or change form: the browser sends key, salt and the password length.
function newKey(f) {
  const key = String(f.get('key') || ''), salt = String(f.get('salt') || ''), len = +f.get('len') || 0;
  return goodB64(key, 32) && goodB64(salt, 16) && len >= MIN_PW ? { key, salt } : null;
}
function sameText(a, b) {
  if (a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
async function makeInviteLink(env, origin, userId) {
  const token = uid('inv') + uid();
  await env.DB.prepare('DELETE FROM invites WHERE user_id=?').bind(userId).run();
  await env.DB.prepare('INSERT INTO invites (token,user_id,created_at,expires_at) VALUES (?,?,?,?)')
    .bind(token, userId, now(), now() + 14 * 864e5).run();
  return `${origin}/join/${token}`;
}
async function inviteFor(env, token) {
  return env.DB.prepare('SELECT i.token, u.* FROM invites i JOIN users u ON u.id=i.user_id WHERE i.token=? AND i.expires_at>? AND u.active=1')
    .bind(token, now()).first();
}
function signedIn(req, sid) {
  return new Response(null, { status: 303, headers: { location: '/', 'set-cookie': setCookie(SESSION_COOKIE, sid, SESSION_DAYS * 86400, isSecure(req)) } });
}
async function passwordLogin(req, env) {
  const f = await req.formData();
  const email = String(f.get('email') || '').toLowerCase().trim();
  const key = String(f.get('key') || '');
  if (!key) return loginPage(env, 'Turn on JavaScript to sign in.', email);
  const ip = clientIp(req), hit = (k) => bump(env, k);
  // Per address, per account from any address, and per account from one address.
  if ((await hit('ip:' + ip)) > 30 || (await hit('em:' + email)) > 25 || (await hit('em:' + email + '|' + ip)) > 8) return loginPage(env, 'Too many tries. Wait 15 minutes or ask your workspace admin for a new link.', email);
  // Same answer as /auth/salt gave, so an old account and a made-up email look alike here too.
  const { row, legacy } = await accountHint(env, email);
  const ok = await checkKey(row, key);
  if (legacy) return loginPage(env, OLD_PASSWORD, email);
  if (!ok) return loginPage(env, 'Wrong email or password.', email);
  return signedIn(req, await createSession(env, row.id));
}
const googleOn = (env) => !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_ENABLED === '1');
const page = (env, title, inner) => new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><link rel="icon" href="/favicon.ico" sizes="48x48"><link rel="icon" href="/brand/favicon-64.png" type="image/png"><link rel="manifest" href="/manifest.webmanifest?v=2"><link rel="apple-touch-icon" href="/brand/app-icon-180.png"><meta name="theme-color" content="#fff8e6"><meta name="apple-mobile-web-app-capable" content="yes"><link rel="stylesheet" href="/app.css"><script src="/theme.js"></script><script src="/auth.js" defer></script></head><body class="login"><main class="login-card"><img class="login-logo" src="/brand/logo.png" alt="Yakyard" width="64" height="64"><p class="login-brands">${escH(env.WORKSPACE_NAME || 'Yakyard')}</p>${inner}</main></body></html>`,
  { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...SEC } });
const escH = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function joinPage(req, env, token) {
  const inv = await inviteFor(env, token);
  if (!inv) return loginPage(env, 'This link has expired or was already used. Ask your workspace admin for a new one.');
  if (req.method === 'POST') {
    const f = await req.formData();
    const name = String(f.get('name') || '').trim().slice(0, 80);
    const nk = newKey(f);
    if (!name || !nk) return joinForm(env, inv, `Add your name and a password of at least ${MIN_PW} characters.`);
    await env.DB.batch([
      env.DB.prepare('INSERT OR REPLACE INTO credentials (user_id,hash,salt,updated_at) VALUES (?,?,?,?)').bind(inv.id, await keyHash(nk.key, nk.salt), nk.salt, now()),
      env.DB.prepare('UPDATE users SET name=? WHERE id=?').bind(name, inv.id),
      env.DB.prepare('DELETE FROM invites WHERE user_id=?').bind(inv.id),
      env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(inv.id),
      // Add them to the private channels they were in on Slack (queued by an import).
      env.DB.prepare('INSERT OR IGNORE INTO members (channel_id,user_id,last_read,joined_at) SELECT channel_id, user_id, ?, ? FROM pending_members WHERE user_id=?').bind(now(), now(), inv.id),
      env.DB.prepare('DELETE FROM pending_members WHERE user_id=?').bind(inv.id),
    ]);
    await broadcast(env, { type: 'user_updated', user: { id: inv.id, name } }, await audience(env, inv.id)).catch(() => {});
    return signedIn(req, await createSession(env, inv.id));
  }
  return joinForm(env, inv);
}
// First run only: the first owner creates their account. They must know the SETUP_TOKEN secret
// (made and printed by the first deploy), so nobody else can claim a fresh deploy first.
// If OWNER_EMAILS is set, their email must be on it.
async function setupPage(req, env) {
  const done = () => new Response(null, { status: 302, headers: { location: '/' } });
  if (await env.DB.prepare('SELECT 1 FROM users LIMIT 1').first()) return done();
  const ready = !!env.SETUP_TOKEN && env.SETUP_TOKEN.length >= 24;
  const form = (error = '', email = '') => page(env, 'Set up Yakyard', ready ? `<h1>Set up Yakyard</h1><p>Create the owner account. The setup code was shown when you deployed.</p>
${error ? `<p class="login-error" role="alert">${escH(error)}</p>` : ''}
<form method="post" class="login-form" data-kdf="new"><input type="hidden" name="salt" value="${b64(crypto.getRandomValues(new Uint8Array(16)))}">
<label>Setup code<input class="input" name="token" type="password" required autocomplete="off" placeholder="The SETUP_TOKEN you set"></label>
<label>Your name<input class="input" name="name" required maxlength="80" autocomplete="name"></label>
<label>Email<input class="input" name="email" type="email" required autocomplete="username" spellcheck="false" autocapitalize="off" value="${escH(email)}"></label>
<label>Choose a password<input class="input" data-pw type="password" required minlength="${MIN_PW}" autocomplete="new-password" placeholder="At least ${MIN_PW} characters"></label>
<button class="login-btn primary" type="submit">Create workspace</button></form>` : `<h1>Set up Yakyard</h1>
<p class="login-error" role="alert">Set a setup code first.</p>
<p>Run <code>npx wrangler secret put SETUP_TOKEN</code> and paste a long random code (at least 24 characters, for example from <code>openssl rand -hex 24</code>). Then reload this page.</p>`);
  if (req.method !== 'POST' || !ready) return form();
  const o = req.headers.get('origin');
  if (o && o !== new URL(req.url).origin) return err(403, 'Bad origin');
  const f = await req.formData();
  const email = String(f.get('email') || '').trim().toLowerCase(), name = String(f.get('name') || '').trim().slice(0, 80), nk = newKey(f);
  if (!sameText(String(f.get('token') || ''), env.SETUP_TOKEN)) return form('Wrong setup code.', email);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return form('Enter a full email address, like name@company.com.', email);
  if ((env.OWNER_EMAILS || '').trim() && !ownerEmail(email, env)) return form('That email is not in OWNER_EMAILS.', email);
  if (!name || !nk) return form(`Add your name and a password of at least ${MIN_PW} characters.`, email);
  // Everything in one batch, which D1 runs as one transaction: the claim (settings.key is the primary key, so only
  // one request can ever win it), the owner, the two starting channels, the password and the session.
  // If any part fails, none of it stays. One round trip also keeps the very first request after a deploy small.
  const id = uid('U'), sid = uid('sess_') + uid(), t = now();
  const ok = await env.DB.batch([
    env.DB.prepare("INSERT INTO settings (key,value) VALUES ('setup_done',?)").bind(String(t)),
    env.DB.prepare("INSERT INTO users (id,email,name,title,avatar,color,role,active,created_at) VALUES (?,?,?,'','',?,'owner',1,?)").bind(id, email, name, colorFor(email), t),
    env.DB.prepare("INSERT OR IGNORE INTO channels (id,kind,name,topic,private,archived,created_by,created_at,last_ts) VALUES (?,'channel','general','Announcements for everyone',0,0,?,?,?), (?,'channel','random','Anything not about work',0,0,?,?,?)").bind(uid('C'), id, t, t, uid('C'), id, t, t),
    env.DB.prepare("INSERT OR IGNORE INTO members (channel_id,user_id,last_read,joined_at) SELECT id,?,?,? FROM channels WHERE kind='channel' AND name IN ('general','random')").bind(id, t, t),
    env.DB.prepare('INSERT INTO credentials (user_id,hash,salt,updated_at) VALUES (?,?,?,?)').bind(id, await keyHash(nk.key, nk.salt), nk.salt, t),
    env.DB.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('app_url',?)").bind(new URL(req.url).origin),
    ...sessionStmts(env, id, await sha256hex(sid)),
  ]).then(() => true, () => false);
  if (!ok) return (await env.DB.prepare("SELECT 1 FROM settings WHERE key='setup_done'").first()) ? done() : form('Could not create the account.', email);
  return signedIn(req, sid);
}
function joinForm(env, inv, error = '') {
  const isNew = inv.name === inv.email.split('@')[0];
  return page(env, 'Join Yakyard', `<h1>Join Yakyard</h1><p>You're signing in as <b>${escH(inv.email)}</b>.</p>
${error ? `<p class="login-error" role="alert">${escH(error)}</p>` : ''}
<form method="post" class="login-form" data-kdf="new"><input type="hidden" name="salt" value="${b64(crypto.getRandomValues(new Uint8Array(16)))}">
<label>Your name<input class="input" name="name" required maxlength="80" autocomplete="name" value="${isNew ? '' : escH(inv.name)}"></label>
<label>Choose a password<input class="input" data-pw type="password" required minlength="${MIN_PW}" autocomplete="new-password" placeholder="At least ${MIN_PW} characters"></label>
<button class="login-btn primary" type="submit">Continue</button></form>`);
}

function loginPage(env, message = '', email = '') {
  const google = googleOn(env) ? `<div class="login-or"><span>or</span></div>
<a class="login-btn" href="/auth/google"><svg width="18" height="18" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.6-.4-3.9z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.6-.4-3.9z"/></svg>Continue with Google</a>` : '';
  return page(env, 'Sign in to Yakyard', `<h1>Sign in to Yakyard</h1>
${message ? `<p class="login-error" role="alert">${escH(message)}</p>` : ''}
<form method="post" action="/auth/login" class="login-form" data-kdf="login">
<label>Email<input class="input" name="email" type="email" required autocomplete="username" spellcheck="false" autocapitalize="off" value="${escH(email)}"></label>
<label>Password<input class="input" data-pw type="password" required autocomplete="current-password"></label>
<button class="login-btn primary" type="submit">Sign in</button></form><noscript><p class="login-error">Turn on JavaScript to sign in.</p></noscript>${google}
<p class="login-note">New here or forgot your password? Ask your workspace admin for a sign-in link.</p>`);
}

// ---------------------------------------------------------------- helpers
async function isMember(env, channelId, userId) {
  return !!(await env.DB.prepare('SELECT 1 FROM members WHERE channel_id=? AND user_id=?').bind(channelId, userId).first());
}
async function channelMembers(env, channelId) {
  const r = await env.DB.prepare('SELECT user_id FROM members WHERE channel_id=?').bind(channelId).all();
  return r.results.map((x) => x.user_id);
}
async function kick(env, userId) {
  try { await env.HUB.get(env.HUB.idFromName('workspace')).fetch('https://hub/kick', { method: 'POST', body: JSON.stringify({ user_id: userId }) }); } catch (e) {}
}
async function broadcast(env, event, toUserIds = null) {
  try { return await broadcastRaw(env, event, toUserIds); } catch (e) { console.log('broadcast failed', e); }
}
async function broadcastRaw(env, event, toUserIds = null) {
  const hub = env.HUB.get(env.HUB.idFromName('workspace'));
  await hub.fetch('https://hub/broadcast', { method: 'POST', body: JSON.stringify({ event, to: toUserIds }) });
}

async function hydrateMessages(env, rows) {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const results = [];
  for (let i = 0; i < ids.length; i += 90) {
    const chunk = ids.slice(i, i + 90);
    const rx = await env.DB.prepare(`SELECT message_id, user_id, emoji FROM reactions WHERE message_id IN (${chunk.map(() => '?').join(',')})`).bind(...chunk).all();
    results.push(...rx.results);
  }
  const byMsg = {};
  for (const r of results) {
    const m = (byMsg[r.message_id] ||= {});
    (m[r.emoji] ||= []).push(r.user_id);
  }
  const extra = await hydrateExtras(env, ids);
  return rows.map((r) => ({
    ...r,
    pinned_by: extra.pins[r.id] || null,
    files: JSON.parse(r.files || '[]'),
    reply_users: JSON.parse(r.reply_users || '[]'),
    reactions: Object.entries(byMsg[r.id] || {}).map(([emoji, users]) => ({ emoji, users })),
    text: r.deleted ? '' : r.text,
  }));
}

function mentionedIds(text) {
  const ids = new Set();
  for (const m of text.matchAll(/<@(U[a-z0-9]+)>/gi)) ids.add(m[1]);
  return [...ids];
}


// One place that posts a message: the composer, scheduled sends and reminders all use it.
async function postMessage(env, ctx, user, ch, body) {
  // Every caller goes through here, so this is the one membership check that can't be skipped.
  // Few database round trips on purpose: each one costs CPU in the Worker, and a send must stay well under 10 ms.
  if (!ch) return err(403, "You're not in this channel.");
  const members = await channelMembers(env, ch.id);
  if (!members.includes(user.id)) return err(403, "You're not in this channel.");
  if (ch.kind !== 'dm' && ch.archived) return err(403, 'This channel is archived. Nobody can post here.');
  // Locked conversations: the server takes only the encrypted message, never words. Waiting ones take nothing.
  if (ch.locked === 2) return err(403, 'This conversation is waiting for approval to lock. Nobody can post until then.');
  const encd = ch.locked === 1 ? String(body.enc || '') : null;
  if (ch.locked === 1 && (!encd || encd.length > 60000 || (body.text || '').length)) return err(400, 'This conversation is locked. Update Yakyard and try again.');
  if (ch.locked !== 1 && body.enc) return err(400, "This conversation isn't locked.");
  const text = encd ? '' : String(body.text || '').slice(0, 40000);
  const asked = (Array.isArray(body.files) ? body.files.slice(0, 10) : []).filter((f) => f && typeof f.key === 'string');
  const threadId = body.thread_id || null;
  const [recs, parentRow, fol] = await Promise.all([
    asked.length ? env.DB.prepare(`SELECT key, uploader, channel_id, voice, transcript, t_status FROM files WHERE key IN (${asked.map(() => '?').join(',')})`).bind(...asked.map((f) => f.key)).all().then((r) => r.results) : [],
    threadId ? env.DB.prepare('SELECT * FROM messages WHERE id=? AND channel_id=? AND thread_id IS NULL').bind(threadId, ch.id).first() : null,
    threadId ? env.DB.prepare('SELECT DISTINCT user_id FROM messages WHERE thread_id=? UNION SELECT user_id FROM messages WHERE id=?').bind(threadId, threadId).all() : null,
  ]);
  const files = [], stmts = [];
  for (const f of asked) {
    const rec = recs.find((r) => r.key === f.key);
    if (!rec || rec.uploader !== user.id || (rec.channel_id && rec.channel_id !== ch.id)) continue;
    if (encd && rec.voice) continue; // a plain voice note never goes into a locked conversation
    const item = { key: f.key, name: String(f.name || 'file').slice(0, 200), size: +f.size || 0, type: String(f.type || 'application/octet-stream').slice(0, 100) };
    if (rec.voice) { try { item.voice = JSON.parse(rec.voice); } catch { item.voice = { dur: 0, wave: [] }; } item.t = rec.t_status === 'done' ? 'done' : rec.t_status === 'failed' ? 'failed' : 'pending'; item.transcript = rec.transcript || ''; }
    files.push(item);
    stmts.push(env.DB.prepare('UPDATE files SET channel_id=? WHERE key=?').bind(ch.id, f.key));
  }
  if (!text.trim() && !files.length && !encd) return err(400, 'Write something first.');
  const also = threadId && body.also_channel ? 1 : 0;
  const parent = parentRow;
  if (threadId && !parent) return err(404, 'Thread not found');
  // A message in an old, archived conversation brings it back.
  if (ch.kind === 'dm') {
    if (ch.archived) stmts.push(env.DB.prepare('UPDATE channels SET archived=0 WHERE id=?').bind(ch.id));
    stmts.push(env.DB.prepare('UPDATE members SET hidden=0 WHERE channel_id=? AND hidden=1').bind(ch.id));
  }
  const msg = {
    id: uid('M'), channel_id: ch.id, user_id: user.id, ts: now(), thread_id: threadId, text,
    files: JSON.stringify(files), reply_count: 0, last_reply_ts: 0, reply_users: '[]', edited_ts: null, deleted: 0, source: 'app', also_channel: also, enc: encd,
  };
  stmts.push(
    env.DB.prepare('INSERT INTO messages (id,channel_id,user_id,ts,thread_id,text,files,also_channel,enc) VALUES (?,?,?,?,?,?,?,?,?)')
      .bind(msg.id, ch.id, user.id, msg.ts, threadId, text, msg.files, also, encd),
  );
  if (!threadId || also) stmts.push(
    env.DB.prepare('UPDATE channels SET last_ts=? WHERE id=?').bind(msg.ts, ch.id),
    env.DB.prepare('UPDATE members SET last_read=MAX(last_read,?) WHERE channel_id=? AND user_id=?').bind(msg.ts, ch.id, user.id),
  );
  if (parent) {
    const ru = JSON.parse(parent.reply_users || '[]').filter((x) => x !== user.id);
    ru.unshift(user.id);
    stmts.push(env.DB.prepare('UPDATE messages SET reply_count=reply_count+1, last_reply_ts=?, reply_users=? WHERE id=?')
      .bind(msg.ts, JSON.stringify(ru.slice(0, 5)), parent.id));
    parent.reply_count += 1; parent.last_reply_ts = msg.ts; parent.reply_users = JSON.stringify(ru.slice(0, 5));
  }
  const said = encd ? (Array.isArray(body.mentions) ? body.mentions.map(String).slice(0, 50) : []) : mentionedIds(text);
  let mentioned = said.filter((u) => members.includes(u));
  if (encd && body.mention_all) mentioned = members.filter((u) => u !== user.id);
  if (/<!(channel|here|everyone)>/.test(text)) mentioned = members.filter((u) => u !== user.id);
  if (ch.kind === 'dm') mentioned = members.filter((u) => u !== user.id);
  for (const u of mentioned) {
    stmts.push(env.DB.prepare('INSERT OR IGNORE INTO mentions (message_id,user_id,channel_id,ts) VALUES (?,?,?,?)').bind(msg.id, u, ch.id, msg.ts));
  }
  await env.DB.batch(stmts);
  // Voice notes: index transcripts already done, and catch any that finished while we were saving.
  try {
  const voiceKeys = files.filter((x) => x.voice).map((x) => x.key);
  for (const x of files.filter((x) => x.voice && x.t === 'done' && x.transcript)) await env.DB.prepare('INSERT INTO voice_fts (text, message_id, file_key) VALUES (?,?,?)').bind(x.transcript, msg.id, x.key).run();
  if (voiceKeys.some((k) => files.find((x) => x.key === k).t === 'pending')) {
    for (const k of voiceKeys) await patchMessage(env, k, null);
    // The app transcribes right after upload; this job finishes the job if the app was closed or the AI was busy.
    await Promise.all(voiceKeys.filter((k) => files.find((x) => x.key === k).t === 'pending').map((k) => arm(env, 'voice', k, now() + 20e3)));
    const fresh = await env.DB.prepare('SELECT files FROM messages WHERE id=?').bind(msg.id).first();
    if (fresh) msg.files = fresh.files;
  }
  } catch (e) { console.log('voice index', e); }
  // A new message has no reactions or pins yet, so it needs no lookups to show.
  const full = { ...msg, files: JSON.parse(msg.files || '[]'), reply_users: [], reactions: [], pinned_by: null };
  const event = { type: 'message', message: full, channel: { id: ch.id, kind: ch.kind, name: ch.name }, mentioned };
  if (parent) {
    event.parent = (await hydrateMessages(env, [parent]))[0];
    // Everyone in the thread hears about new replies, like Slack. Only people still in the conversation.
    const memberSet = new Set(members);
    event.followers = fol.results.map((r) => r.user_id).filter((u) => u !== user.id && memberSet.has(u));
  }
  // Phone notifications are worked out and sent by background jobs, so the send itself stays small.
  await Promise.all([broadcast(env, event, members), arm(env, 'fanout', msg.id, now(), { ch: { id: ch.id, kind: ch.kind, name: ch.name, locked: ch.locked === 1 ? 1 : 0 }, sender: { id: user.id, name: user.name }, members,
    direct: said.filter((u) => members.includes(u)), wide: encd ? !!body.mention_all : /<!(channel|here|everyone)>/.test(text), followers: event.followers || [], at: msg.ts })]);
  return json(full);

}

// ---------------------------------------------------------------- API
async function api(req, env, user, path, ctx) {
  const method = req.method;
  const body = method === 'GET' || method === 'DELETE' ? null : await req.json().catch(() => ({}));
  const fx = await featureApi(req, env, user, path, method, body, { postMessage, hydrateMessages, broadcast, isMember, channelMembers, audience, ctx });
  if (fx) return fx;
  const sx = await slackApi(req, env, user, path, method, body, ctx);
  if (sx) return sx;
  if (path.startsWith('/api/e2ee/') || path.includes('/lock/')) {
    const ex = await e2eeApi({ req, env, user, path, method, body, x: { broadcast, isMember, channelMembers, audience } });
    if (ex) return ex;
  }
  return (await runRoutes(API_ROUTES, { req, env, user, path, ctx, method, body })) || err(404, 'Not found');
}

// Routes: each handler is its own function, so a request compiles only the one it uses.
const API_ROUTES = routes([
  ['GET', '/api/bootstrap', api_bootstrap_GET],
  ['GET', '/api/channels', api_channels_GET],
  ['POST', '/api/channels', api_channels_POST],
  ['POST', '/api/dm', api_dm_POST],
  [null, /^\/api\/channels\/([^/]+)(\/.*)?$/, api_channels_id],
  [null, /^\/api\/messages\/([^/]+)(\/.*)?$/, api_messages_id],
  ['POST', '/api/sections', api_sections_POST],
  [null, /^\/api\/sections\/([^/]+)$/, api_sections_id],
  ['GET', '/api/mentions', api_mentions_GET],
  ['GET', '/api/activity/reactions', api_activity_reactions_GET],
  ['PATCH', '/api/me', api_me_PATCH],
  ['POST', '/api/me/password', api_me_password_POST],
  ['GET', '/api/team/places', api_team_places_GET],
  ['GET', '/api/unfurl', api_unfurl_GET],
  ['GET', '/api/img', api_img_GET],
  ['GET', '/api/ice', api_ice_GET],
  [null, /^\/api\/admin\//, api_admin],
  ['POST', '/api/invite', api_invite_POST],
]);
async function api_bootstrap_GET(c, m) {
  const { req, env, user, path, ctx, method, body } = c;
  // Team clocks are opt-in: the workspace turns them on (TEAM_LOCATION) and each person chooses to share.
  // Only then is the city and time zone of the connection stored. Coordinates are kept, rounded to
  // about 10 km, only when weather is on (WEATHER), because the weather lookup needs them.
  const cf = req.cf || {};
  if (locationOn(env) && user.share_location && cf.timezone && (cf.timezone !== user.tz || cf.city !== user.city)) {
    const r1 = (v) => (weatherOn(env) && v != null && v !== '' ? Math.round(+v * 10) / 10 : null);
    await env.DB.prepare('UPDATE users SET city=?, region=?, country=?, tz=?, lat=?, lon=?, loc_at=? WHERE id=?')
      .bind(cf.city || '', cf.region || '', cf.country || '', cf.timezone, r1(cf.latitude), r1(cf.longitude), now(), user.id).run();
    Object.assign(user, { city: cf.city || '', country: cf.country || '', tz: cf.timezone });
  } else {
    // The browser's own time zone, kept private, so do-not-disturb hours work for everyone.
    const btz = new URL(req.url).searchParams.get('tz') || '';
    let valid = false;
    try { valid = /^[\w+\-\/]{1,64}$/.test(btz) && !!new Intl.DateTimeFormat('en', { timeZone: btz }); } catch {}
    if (valid && btz !== user.tz) { await env.DB.prepare('UPDATE users SET tz=? WHERE id=?').bind(btz, user.id).run(); user.tz = btz; }
  }
  const loc = (c) => (locationOn(env) ? `CASE WHEN u.share_location=1 THEN u.${c} ELSE '' END AS ${c}` : `'' AS ${c}`);
  const ucols = `u.id,u.email,u.name,u.title,u.avatar,u.color,u.role,u.active,${loc('city')},${loc('country')},${loc('tz')},u.status_emoji,u.status_text,u.status_until,u.dnd_until,u.dnd_start,u.dnd_end,u.away`;
  const [usersR, savedR, pushR, chans, dmR, sections, ceR, lockR] = await env.DB.batch([
    user.role === 'guest'
      ? env.DB.prepare(`SELECT DISTINCT ${ucols} FROM users u WHERE u.id=? OR u.role='owner' OR u.id IN (SELECT a.user_id FROM members a JOIN members b ON b.channel_id=a.channel_id WHERE b.user_id=?)`).bind(user.id, user.id)
      : env.DB.prepare(`SELECT ${ucols} FROM users u`),
    env.DB.prepare('SELECT message_id FROM saved WHERE user_id=? AND done=0').bind(user.id),
    env.DB.prepare('SELECT COUNT(*) n FROM push_subs WHERE user_id=?').bind(user.id),
    env.DB.prepare(
      `SELECT c.*, m.last_read, m.section_id, m.muted, m.starred, m.hidden,
        (SELECT COUNT(*) FROM messages x WHERE x.channel_id=c.id AND x.thread_id IS NULL AND x.ts > m.last_read AND x.user_id != ? AND x.deleted=0) AS unread,
        (SELECT COUNT(*) FROM mentions n WHERE n.channel_id=c.id AND n.user_id=? AND n.ts > m.last_read) AS mentions
       FROM members m JOIN channels c ON c.id = m.channel_id WHERE m.user_id = ? AND c.archived = 0`).bind(user.id, user.id, user.id),
    env.DB.prepare(`SELECT x.channel_id, x.user_id FROM members x JOIN members me ON me.channel_id = x.channel_id AND me.user_id = ?
      JOIN channels c ON c.id = x.channel_id WHERE c.kind = 'dm'`).bind(user.id),
    env.DB.prepare('SELECT * FROM sections WHERE user_id=? ORDER BY position').bind(user.id),
    env.DB.prepare("SELECT value FROM settings WHERE key='custom_emoji'"),
    env.DB.prepare("SELECT value FROM settings WHERE key='allow_locked'"),
  ]);
  const users = usersR, savedIds = savedR.results.map((r) => r.message_id), pushOn = pushR.results[0]?.n || 0;
  const dmMembers = {};
  for (const x of dmR.results) (dmMembers[x.channel_id] ||= []).push(x.user_id);
  const ce = ceR.results[0];
  return json({
    emoji: ce ? JSON.parse(ce.value) : {},
    me: pickMe(user),
    workspace: { name: env.WORKSPACE_NAME || 'Yakyard', location: locationOn(env), weather: locationOn(env) && weatherOn(env), locked: lockR.results[0]?.value === '1' },
    users: users.results,
    channels: chans.results.map((c) => ({ ...c, members: dmMembers[c.id] })),
    sections: sections.results,
    saved: savedIds, push_key: env.VAPID_PUBLIC || '', push_devices: pushOn,
  });
}

// ----- browse all public channels
async function api_channels_GET(c, m) {
  const { req, env, user, path, ctx, method, body } = c;
  const r = await env.DB.prepare(
    `SELECT c.id,c.name,c.topic,c.private,c.archived,(SELECT COUNT(*) FROM members m WHERE m.channel_id=c.id) members,
      EXISTS(SELECT 1 FROM members m WHERE m.channel_id=c.id AND m.user_id=?) joined
     FROM channels c WHERE c.kind='channel' AND ((c.private=0 AND ?<>'guest') OR EXISTS(SELECT 1 FROM members m WHERE m.channel_id=c.id AND m.user_id=?))
     ORDER BY c.archived, c.name`
  ).bind(user.id, user.role, user.id).all();
  return json(r.results);
}

// ----- create channel
async function api_channels_POST(c, m) {
  const { req, env, user, path, ctx, method, body } = c;
  if (user.role === 'guest') return err(403, "Guests can't create channels.");
  const name = String(body.name || '').toLowerCase().trim().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  if (!name) return err(400, 'Add a name first.');
  if (await env.DB.prepare("SELECT 1 FROM channels WHERE kind='channel' AND name=?").bind(name).first()) return err(409, 'That name is taken. Pick another one.');
  if (body.lock) {
    if (!(await lockedAllowed(env))) return err(403, 'Locked conversations are off in this workspace. The owner can turn them on in Admin.');
    body.private = true; // a locked channel is always private
  }
  const id = uid('C');
  await env.DB.prepare('INSERT INTO channels (id,kind,name,topic,private,created_by,created_at,last_ts) VALUES (?,?,?,?,?,?,?,?)')
    .bind(id, 'channel', name, String(body.topic || '').slice(0, 250), body.private ? 1 : 0, user.id, now(), now()).run();
  await env.DB.prepare('INSERT INTO members (channel_id,user_id,last_read,joined_at,section_id) VALUES (?,?,?,?,?)')
    .bind(id, user.id, now(), now(), body.section_id || null).run();
  let ch = await env.DB.prepare('SELECT * FROM channels WHERE id=?').bind(id).first();
  await broadcast(env, { type: 'channel_created', channel: ch }, body.private ? [user.id] : await nonGuestIds(env));
  if (body.lock) ch = await startLockedChannel(env, { broadcast, channelMembers }, user, ch);
  return json({ ...ch, last_read: now(), section_id: body.section_id || null, unread: 0, mentions: 0 });
}

// ----- DM open (1:1 or group)
async function api_dm_POST(c, m) {
  const { req, env, user, path, ctx, method, body } = c;
  const others = [...new Set((Array.isArray(body.user_ids) ? body.user_ids : []).map(String))].filter((x) => x !== user.id);
  if (others.length > 8) return err(400, 'Pick 1 to 8 people');
  if (others.length) {
    // Only real, active people. Guests can only message people they already share a conversation with (and the owner).
    const ph = others.map(() => '?').join(',');
    const valid = user.role === 'guest'
      ? await env.DB.prepare(`SELECT id FROM users u WHERE active=1 AND id IN (${ph}) AND (role='owner' OR id IN (SELECT a.user_id FROM members a JOIN members b ON b.channel_id=a.channel_id WHERE b.user_id=?))`).bind(...others, user.id).all()
      : await env.DB.prepare(`SELECT id FROM users WHERE active=1 AND id IN (${ph})`).bind(...others).all();
    if (valid.results.length !== others.length) return err(400, 'Unknown person');
  }
  const ids = [user.id, ...others].sort();
  if (body.lock) {
    if (!others.length) return err(400, 'Pick at least one person to lock a conversation with.');
    if (!(await lockedAllowed(env))) return err(403, 'Locked conversations are off in this workspace. The owner can turn them on in Admin.');
    const lc = await openLockedDm(env, { broadcast, channelMembers }, user, ids);
    return json({ ...lc, members: ids, last_read: now(), unread: 0, mentions: 0 });
  }
  const ch = await openDm(env, ids, user.id);
  return json({ ...ch, members: ids, last_read: now(), unread: 0, mentions: 0 });
}

async function api_channels_id(c, m) {
  const { req, env, user, path, ctx, method, body } = c;
  const cid = m[1];
  const sub = m[2] || '';
  const ch = await env.DB.prepare('SELECT * FROM channels WHERE id=?').bind(cid).first();
  if (!ch) return err(404, "That channel isn't here anymore.");
  const member = await isMember(env, cid, user.id);
  const priv = ch.private || ch.kind === 'dm';

  if (sub === '/join' && method === 'POST') {
    if (priv && !member) return err(403, 'Private channel');
    if (user.role === 'guest') return err(403, 'Guests need an invite');
    await env.DB.prepare('INSERT OR IGNORE INTO members (channel_id,user_id,last_read,joined_at,section_id) VALUES (?,?,?,?,?)')
      .bind(cid, user.id, 0, now(), body.section_id || null).run();
    await broadcast(env, { type: 'member_joined', channel_id: cid, user_id: user.id }, await channelMembers(env, cid));
    return json({ ...ch, last_read: 0, section_id: body.section_id || null, unread: 0, mentions: 0 });
  }
  if (!member && !(sub === '/messages' && method === 'GET' && !priv && user.role !== 'guest')) return err(403, "You're not in this channel.");

  if (sub === '/leave' && method === 'POST') {
    await env.DB.prepare('DELETE FROM members WHERE channel_id=? AND user_id=?').bind(cid, user.id).run();
    return json({ ok: true });
  }
  if (sub === '/members' && method === 'GET') return json(await channelMembers(env, cid));
  if (sub === '/members' && method === 'POST') {
    if (ch.kind === 'dm') return err(403, 'Start a new group message instead');
    if (user.role === 'guest') return err(403, "Guests can't add people.");
    const ids = [...new Set((body.user_ids || []).map(String))].slice(0, 50);
    const ok = ids.length ? (await env.DB.prepare(`SELECT id FROM users WHERE active=1 AND id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all()).results.map((r) => r.id) : [];
    if (ok.length) await env.DB.batch(ok.map((u) => env.DB.prepare('INSERT OR IGNORE INTO members (channel_id,user_id,last_read,joined_at) VALUES (?,?,?,?)').bind(cid, u, 0, now())));
    body.user_ids = ok;
    const all = await channelMembers(env, cid);
    await broadcast(env, { type: 'channel_added', channel: ch, user_ids: body.user_ids || [] }, body.user_ids || []);
    return json(all);
  }
  if (sub === '' && method === 'PATCH') {
    if (user.role === 'guest') return err(403, "Guests can't change the topic.");
    if (ch.archived && ch.kind !== 'dm') return err(403, 'This channel is archived. Nobody can post here.');
    const topic = body.topic != null ? String(body.topic).slice(0, 250) : ch.topic;
    await env.DB.prepare('UPDATE channels SET topic=? WHERE id=?').bind(topic, cid).run();
    await broadcast(env, { type: 'channel_updated', channel: { ...ch, topic } }, await channelMembers(env, cid));
    return json({ ok: true });
  }
  if (sub === '/read' && method === 'POST') {
    const ts = Math.max(0, Number(body.ts) || now());
    await env.DB.prepare(body.force ? 'UPDATE members SET last_read=? WHERE channel_id=? AND user_id=?' : 'UPDATE members SET last_read=MAX(last_read,?) WHERE channel_id=? AND user_id=?').bind(ts, cid, user.id).run();
    await broadcast(env, { type: 'read', channel_id: cid, ts }, [user.id]);
    return json({ ok: true });
  }
  if (sub === '/prefs' && method === 'POST') {
    const fields = [];
    const vals = [];
    if ('section_id' in body) { fields.push('section_id=?'); vals.push(body.section_id || null); }
    if ('muted' in body) { fields.push('muted=?'); vals.push(body.muted ? 1 : 0); }
    if ('starred' in body) { fields.push('starred=?'); vals.push(body.starred ? 1 : 0); }
    if ('hidden' in body) { fields.push('hidden=?'); vals.push(body.hidden ? 1 : 0); }
    if (fields.length) await env.DB.prepare(`UPDATE members SET ${fields.join(',')} WHERE channel_id=? AND user_id=?`).bind(...vals, cid, user.id).run();
    return json({ ok: true });
  }
  if (sub === '/messages' && method === 'GET') {
    const url = new URL(req.url);
    const around = Number(url.searchParams.get('around')), after = Number(url.searchParams.get('after'));
    if (around || after) {
      const older = around ? (await env.DB.prepare(`SELECT * FROM messages WHERE channel_id=? AND (thread_id IS NULL OR also_channel=1) AND ts <= ? ORDER BY ts DESC LIMIT 30`).bind(cid, around).all()).results.reverse() : [];
      const newer = (await env.DB.prepare(`SELECT * FROM messages WHERE channel_id=? AND (thread_id IS NULL OR also_channel=1) AND ts > ? ORDER BY ts ASC LIMIT 40`).bind(cid, around || after).all()).results;
      return json({ messages: await hydrateMessages(env, [...older, ...newer]), has_more: around ? older.length === 30 : undefined, has_newer: newer.length === 40 });
    }
    const before = Number(url.searchParams.get('before')) || 9e15;
    const r = await env.DB.prepare(
      `SELECT * FROM messages WHERE channel_id=? AND (thread_id IS NULL OR also_channel=1) AND ts < ? ORDER BY ts DESC LIMIT ?`
    ).bind(cid, before, PAGE).all();
    const rows = r.results.reverse();
    return json({ messages: await hydrateMessages(env, rows), has_more: r.results.length === PAGE });
  }
  if (sub === '/messages' && method === 'POST') return postMessage(env, ctx, user, ch, body);
  return err(404, 'Not found');
}

async function api_messages_id(c, m) {
  const { req, env, user, path, ctx, method, body } = c;
  const mid = m[1];
  const sub = m[2] || '';
  const msg = await env.DB.prepare('SELECT * FROM messages WHERE id=?').bind(mid).first();
  if (!msg) return err(404, "That message isn't here anymore.");
  if (!(await isMember(env, msg.channel_id, user.id))) {
    const ch = await env.DB.prepare('SELECT private, kind FROM channels WHERE id=?').bind(msg.channel_id).first();
    if (!ch || ch.private || ch.kind === 'dm' || user.role === 'guest' || method !== 'GET') return err(403, "You're not in this channel.");
  }
  const members = () => channelMembers(env, msg.channel_id);

  if (sub === '/thread' && method === 'GET') {
    const r = await env.DB.prepare('SELECT * FROM messages WHERE thread_id=? ORDER BY ts').bind(mid).all();
    return json({ parent: (await hydrateMessages(env, [msg]))[0], replies: await hydrateMessages(env, r.results) });
  }
  if (sub === '/reactions' && method === 'POST') {
    const lockedCh = (await env.DB.prepare('SELECT locked FROM channels WHERE id=?').bind(msg.channel_id).first())?.locked === 1;
    // In a locked conversation the reaction itself is encrypted ("e2:" + sealed emoji); nothing else is accepted.
    const emoji = String(body.emoji || '').slice(0, lockedCh ? 2000 : 64);
    if (!emoji) return err(400, 'Emoji required');
    if (lockedCh !== emoji.startsWith('e2:')) return err(400, lockedCh ? 'This conversation is locked. Update Yakyard and try again.' : 'Emoji required');
    const has = await env.DB.prepare('SELECT 1 FROM reactions WHERE message_id=? AND user_id=? AND emoji=?').bind(mid, user.id, emoji).first();
    if (has) await env.DB.prepare('DELETE FROM reactions WHERE message_id=? AND user_id=? AND emoji=?').bind(mid, user.id, emoji).run();
    else await env.DB.prepare('INSERT INTO reactions (message_id,user_id,emoji) VALUES (?,?,?)').bind(mid, user.id, emoji).run();
    const [full] = await hydrateMessages(env, [msg]);
    await broadcast(env, { type: 'message_changed', message: full }, await members());
    return json(full);
  }
  const arch = async () => (await env.DB.prepare("SELECT archived, kind FROM channels WHERE id=?").bind(msg.channel_id).first()) || {};
  if (sub === '' && method === 'PATCH') {
    if (msg.deleted) return err(400, 'Deleted');
    const a = await arch();
    if (a.archived && a.kind !== 'dm') return err(403, 'This channel is archived. Nobody can post here.');
    if (msg.user_id !== user.id) return err(403, 'Only the person who wrote it can edit it.');
    if (msg.enc) {
      const e = String(body.enc || '');
      if (!e || e.length > 60000) return err(400, 'This conversation is locked. Update Yakyard and try again.');
      await env.DB.prepare('UPDATE messages SET enc=?, edited_ts=? WHERE id=?').bind(e, now(), mid).run();
      const [full] = await hydrateMessages(env, [{ ...msg, enc: e, edited_ts: now() }]);
      await broadcast(env, { type: 'message_changed', message: full }, await members());
      return json(full);
    }
    const text = String(body.text || '').slice(0, 40000);
    await env.DB.prepare('UPDATE messages SET text=?, edited_ts=? WHERE id=?').bind(text, now(), mid).run();
    const [full] = await hydrateMessages(env, [{ ...msg, text, edited_ts: now() }]);
    await broadcast(env, { type: 'message_changed', message: full }, await members());
    return json(full);
  }
  if (sub === '' && method === 'DELETE') {
    if (msg.user_id !== user.id && !['owner', 'admin'].includes(user.role)) return err(403, 'Not allowed');
    await env.DB.prepare("UPDATE messages SET deleted=1, text='', files='[]', enc=NULL WHERE id=?").bind(mid).run();
    if (msg.thread_id && !msg.deleted) await env.DB.prepare('UPDATE messages SET reply_count=MAX(0,reply_count-1) WHERE id=?').bind(msg.thread_id).run();
    // Deleting a message deletes its files too, so old links stop working.
    const keys = JSON.parse(msg.files || '[]').map((f) => f.key).filter(Boolean);
    if (keys.length) { await env.FILES.delete(keys); await env.DB.prepare(`DELETE FROM files WHERE key IN (${keys.map(() => '?').join(',')})`).bind(...keys).run(); }
    const [full] = await hydrateMessages(env, [{ ...msg, deleted: 1, text: '', files: '[]', enc: null }]);
    await broadcast(env, { type: 'message_changed', message: full }, await members());
    return json(full);
  }
  return err(404, 'Not found');
}

// ----- sections (per person, like Slack)
async function api_sections_POST(c, m) {
  const { req, env, user, path, ctx, method, body } = c;
  const max = await env.DB.prepare('SELECT COALESCE(MAX(position),-1)+1 p FROM sections WHERE user_id=?').bind(user.id).first();
  const s = { id: uid('S'), user_id: user.id, name: String(body.name || 'New section').slice(0, 60), position: max.p, collapsed: 0 };
  await env.DB.prepare('INSERT INTO sections (id,user_id,name,position) VALUES (?,?,?,?)').bind(s.id, user.id, s.name, s.position).run();
  return json(s);
}

async function api_sections_id(c, m) {
  const { req, env, user, path, ctx, method, body } = c;
  const s = await env.DB.prepare('SELECT * FROM sections WHERE id=? AND user_id=?').bind(m[1], user.id).first();
  if (!s) return err(404, 'Section not found');
  if (method === 'PATCH') {
    await env.DB.prepare('UPDATE sections SET name=?, collapsed=?, position=? WHERE id=?')
      .bind(body.name != null ? String(body.name).slice(0, 60) : s.name, body.collapsed != null ? (body.collapsed ? 1 : 0) : s.collapsed,
        body.position != null ? Number(body.position) : s.position, s.id).run();
    return json({ ok: true });
  }
  if (method === 'DELETE') {
    await env.DB.batch([
      env.DB.prepare('UPDATE members SET section_id=NULL WHERE user_id=? AND section_id=?').bind(user.id, s.id),
      env.DB.prepare('DELETE FROM sections WHERE id=?').bind(s.id),
    ]);
    return json({ ok: true });
  }
}

// ----- mentions inbox
async function api_mentions_GET(c, m) {
  const { req, env, user, path, ctx, method, body } = c;
  const r = await env.DB.prepare(
    `SELECT x.* FROM mentions n JOIN messages x ON x.id=n.message_id JOIN members me ON me.channel_id=x.channel_id AND me.user_id=?
     WHERE n.user_id=? AND x.deleted=0 ORDER BY n.ts DESC LIMIT 50`
  ).bind(user.id, user.id).all();
  return json(await hydrateMessages(env, r.results));
}

// ----- activity: reactions to my messages
async function api_activity_reactions_GET(c, m) {
  const { req, env, user, path, ctx, method, body } = c;
  const r = await env.DB.prepare(
    `SELECT x.*, r.emoji AS r_emoji, r.user_id AS r_user FROM reactions r JOIN messages x ON x.id=r.message_id
     JOIN members me ON me.channel_id=x.channel_id AND me.user_id=?
     WHERE x.user_id=? AND r.user_id<>? AND x.deleted=0 ORDER BY x.ts DESC LIMIT 60`).bind(user.id, user.id, user.id).all();
  const rows = await hydrateMessages(env, r.results);
  return json(rows.map((m, i) => ({ ...m, r_emoji: r.results[i].r_emoji, r_user: r.results[i].r_user })));
}

// ----- profile
async function api_me_PATCH(c, m) {
  const { req, env, user, path, ctx, method, body } = c;
  const name = body.name != null ? String(body.name).slice(0, 80) : user.name;
  const title = body.title != null ? String(body.title).slice(0, 80) : user.title;
  const pick = (k, f) => (k in body ? f(body[k]) : user[k]);
  const upd = {
    name, title,
    status_emoji: pick('status_emoji', (v) => String(v || '').slice(0, 64)),
    status_text: pick('status_text', (v) => String(v || '').slice(0, 100)),
    status_until: pick('status_until', (v) => Math.max(0, +v || 0)),
    dnd_until: pick('dnd_until', (v) => Math.max(0, +v || 0)),
    dnd_start: pick('dnd_start', (v) => (/^\d\d:\d\d$/.test(v) ? v : '')),
    dnd_end: pick('dnd_end', (v) => (/^\d\d:\d\d$/.test(v) ? v : '')),
    notify_level: pick('notify_level', (v) => (['all', 'mentions', 'none'].includes(v) ? v : 'mentions')),
    away: pick('away', (v) => (v ? 1 : 0)),
    vips: pick('vips', (v) => JSON.stringify((Array.isArray(v) ? v : []).map(String).slice(0, 30))),
    share_location: pick('share_location', (v) => (v ? 1 : 0)),
  };
  if ('share_location' in body && !upd.share_location) {
    // Stop sharing: forget the stored place right away.
    await env.DB.prepare("UPDATE users SET city='', region='', country='', lat=NULL, lon=NULL, loc_at=NULL WHERE id=?").bind(user.id).run();
    await broadcast(env, { type: 'user_updated', user: { id: user.id, city: '', country: '', tz: '' } }, await audience(env, user.id));
  }
  await env.DB.prepare('UPDATE users SET name=?, title=?, status_emoji=?, status_text=?, status_until=?, dnd_until=?, dnd_start=?, dnd_end=?, notify_level=?, vips=?, away=?, share_location=? WHERE id=?')
    .bind(upd.name, upd.title, upd.status_emoji, upd.status_text, upd.status_until, upd.dnd_until, upd.dnd_start, upd.dnd_end, upd.notify_level, upd.vips || '[]', upd.away || 0, upd.share_location || 0, user.id).run();
  const pub = { id: user.id, name, title, status_emoji: upd.status_emoji, status_text: upd.status_text, status_until: upd.status_until, dnd_until: upd.dnd_until, dnd_start: upd.dnd_start, dnd_end: upd.dnd_end, away: upd.away };
  await broadcast(env, { type: 'user_updated', user: pub }, await audience(env, user.id));
  return json({ ok: true });
}

// ----- change password: the browser sends the current key (and the password once, for old accounts) and the new key
async function api_me_password_POST(c, m) {
  const { req, env, user, path, ctx, method, body } = c;
  const row = await env.DB.prepare('SELECT hash, salt FROM credentials WHERE user_id=?').bind(user.id).first();
  if (!row) return err(400, 'You sign in with Google, so there is no password to change.');
  if ((await bump(env, 'pw:' + user.id)) > 10) return err(429, 'Too many tries. Wait 15 minutes, then try again.');
  if (isOld(row)) return err(400, OLD_PASSWORD);
  if (!(await checkKey(row, String(body.key || '')))) return err(400, "That's not your current password.");
  const nk = newKey(new Map([['key', body.new_key], ['salt', body.new_salt], ['len', body.len]]));
  if (!nk) return err(400, `Pick a new password of at least ${MIN_PW} characters.`);
  const keep = await sha256hex(cookie(req, SESSION_COOKIE) || '');
  await env.DB.batch([
    env.DB.prepare('UPDATE credentials SET hash=?, salt=?, updated_at=? WHERE user_id=?').bind(await keyHash(nk.key, nk.salt), nk.salt, now(), user.id),
    // Signed out everywhere else, in case someone else knew the old password.
    env.DB.prepare('DELETE FROM sessions WHERE user_id=? AND id<>?').bind(user.id, keep),
  ]);
  return json({ ok: true });
}

// ----- team places: only people who chose to share, and only if the workspace allows it
async function api_team_places_GET(c, m) {
  const { req, env, user, path, ctx, method, body } = c;
  if (!locationOn(env)) return json([]);
  const r = await env.DB.prepare(`SELECT id, city, region, country, tz, lat, lon FROM users
    WHERE active=1 AND share_location=1 AND tz IS NOT NULL AND tz<>''`).all();
  const places = {};
  for (const u of r.results) {
    const k = `${u.city}|${u.country}|${u.tz}`;
    (places[k] ||= { city: u.city, region: u.region, country: u.country, tz: u.tz, lat: u.lat, lon: u.lon, people: [] }).people.push(u.id);
  }
  const list = Object.values(places);
  const withPos = list.filter((p) => p.lat != null && p.lon != null);
  if (weatherOn(env) && withPos.length) {
    const list = withPos;
    const key = 'weather/' + (await sha256hex(list.map((p) => `${p.lat.toFixed(2)},${p.lon.toFixed(2)}`).join(';')));
    let wx = await cacheGet(env, key).then((x) => x && x.json()).catch(() => null);
    if (!wx) {
      try {
        const q = `latitude=${list.map((p) => p.lat.toFixed(3)).join(',')}&longitude=${list.map((p) => p.lon.toFixed(3)).join(',')}`;
        const res = await fetch(`https://api.open-meteo.com/v1/forecast?${q}&current=temperature_2m,weather_code,is_day&timezone=auto`);
        const j = await res.json(); wx = Array.isArray(j) ? j : [j];
        await cachePut(env, key, JSON.stringify(wx), 1200e3, 'application/json');
      } catch (e) { wx = []; }
    }
    list.forEach((p, i) => { const c = wx[i]?.current; if (c) Object.assign(p, { temp: c.temperature_2m, code: c.weather_code, day: c.is_day }); });
  }
  for (const p of list) { delete p.lat; delete p.lon; }
  return json(list);
}

async function api_unfurl_GET(c, m) {
  const { req, env, user, path, ctx, method, body } = c;
  const target = new URL(req.url).searchParams.get('url') || '';
  if (user.role === 'guest') return json({});
  if (!safeFetchUrl(target)) return err(400, 'Bad url');
  const key = 'unfurl/' + (await sha256hex(target)), jh = { 'content-type': 'application/json', 'cache-control': 'private, max-age=86400' };
  const hit = await cacheGet(env, key);
  if (hit) return new Response(hit.body, { headers: jh });
  const r = await Promise.race([unfurl(target), new Promise((res) => setTimeout(() => res({ ok: false }), 5000))]);
  const out = JSON.stringify(r.ok ? r.value : {});
  await cachePut(env, key, out, r.ok ? 864e5 : 3600e3, 'application/json');
  return new Response(out, { headers: jh });
}

// Pictures from other sites: see imgProxy.
async function api_img_GET(c, m) {
  const { req, env, user, path, ctx, method, body } = c;
  const target = new URL(req.url).searchParams.get('u') || '';
  if (!safeFetchUrl(target)) return err(400, 'Bad url');
  return imgProxy(env, target);
}

async function api_ice_GET(c, m) {
  const { req, env, user, path, ctx, method, body } = c;
  const servers = [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }];
  if (env.TURN_KEY_ID && env.TURN_KEY_TOKEN) {
    try {
      const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`, {
        method: 'POST', headers: { authorization: `Bearer ${env.TURN_KEY_TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify({ ttl: 86400 }),
      }).then((x) => x.json());
      if (r.iceServers) return json(r.iceServers);
    } catch (e) {}
  }
  return json(servers);
}

// ---------------- admin dashboard (owner + admins)
async function api_admin(c, m) {
  const { req, env, user, path, ctx, method, body } = c;
  if (!['owner', 'admin'].includes(user.role)) return err(403, 'Only admins can do this.');
  if (path === '/api/admin/people' && method === 'GET') {
    const r = await env.DB.prepare(`SELECT u.id,u.email,u.name,u.title,u.avatar,u.color,u.role,u.active,u.deactivated,u.created_at,
        EXISTS(SELECT 1 FROM credentials c WHERE c.user_id=u.id) has_password,
        (SELECT MAX(expires_at) FROM invites i WHERE i.user_id=u.id) invite_expires,
        (SELECT MAX(created_at) FROM sessions s WHERE s.user_id=u.id) last_seen,
        (SELECT COUNT(*) FROM members m WHERE m.user_id=u.id) channels,
        (SELECT COUNT(*) FROM pending_members p WHERE p.user_id=u.id) pending_channels,
        (SELECT COUNT(*) FROM messages x WHERE x.user_id=u.id) messages,
        (SELECT MAX(ts) FROM messages x WHERE x.user_id=u.id) last_post
      FROM users u WHERE u.email NOT LIKE '%@bot.local' ORDER BY u.name COLLATE NOCASE`).all();
    return json(r.results.map((u) => ({ ...u,
      status: u.deactivated ? 'deactivated' : u.active && (u.has_password || u.last_seen) ? 'active' : u.invite_expires > now() ? 'invited' : 'not_invited' })));
  }
  if ((m = path.match(/^\/api\/admin\/users\/([\w]+)$/)) && method === 'PATCH') {
    const t = await env.DB.prepare('SELECT * FROM users WHERE id=?').bind(m[1]).first();
    if (!t) return err(404, 'Not found');
    if (t.role === 'owner') return err(403, 'The owner cannot be changed');
    if (body.role !== undefined) {
      if (!['admin', 'member', 'guest'].includes(body.role)) return err(400, 'Bad role');
      if ((body.role === 'admin' || t.role === 'admin') && user.role !== 'owner') return err(403, 'Only the owner can change admins');
      await env.DB.prepare('UPDATE users SET role=? WHERE id=?').bind(body.role, t.id).run();
    }
    if (body.deactivated === true) {
      if (t.role === 'admin' && user.role !== 'owner') return err(403, 'Only the owner can deactivate admins');
      await env.DB.batch([
        env.DB.prepare('UPDATE users SET active=0, deactivated=1 WHERE id=?').bind(t.id),
        env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(t.id),
        env.DB.prepare('DELETE FROM invites WHERE user_id=?').bind(t.id),
      ]);
      await kick(env, t.id);
    } else if (body.deactivated === false) {
      if (t.role === 'admin' && user.role !== 'owner') return err(403, 'Only the owner can reactivate admins.');
      await env.DB.prepare('UPDATE users SET deactivated=0, active=1 WHERE id=?').bind(t.id).run();
    }
    const nu = await env.DB.prepare('SELECT id,email,name,title,avatar,color,role,active FROM users WHERE id=?').bind(t.id).first();
    await broadcast(env, { type: 'user_updated', user: nu }, await nonGuestIds(env)).catch(() => {});
    return json(nu);
  }
  if ((m = path.match(/^\/api\/admin\/users\/([\w]+)\/channels$/))) {
    if (method === 'GET') {
      const r = await env.DB.prepare(`SELECT c.id,c.name,c.private,c.archived,
          EXISTS(SELECT 1 FROM members x WHERE x.channel_id=c.id AND x.user_id=?) member,
          EXISTS(SELECT 1 FROM pending_members p WHERE p.channel_id=c.id AND p.user_id=?) pending
        FROM channels c WHERE c.kind='channel' ORDER BY c.archived, c.name`).bind(m[1], m[1]).all();
      return json(r.results);
    }
    if (method === 'POST') {
      const t = await env.DB.prepare('SELECT id,active FROM users WHERE id=?').bind(m[1]).first();
      if (!t) return err(404, 'Not found');
      const target = await env.DB.prepare("SELECT kind, private FROM channels WHERE id=?").bind(body.channel_id).first();
      if (!target || target.kind !== 'channel') return err(400, 'Channels only');
      // Private stays private: only people already in a private channel can change who is in it.
      if (target.private && !(await isMember(env, body.channel_id, user.id))) return err(403, 'Only people in that private channel can change who is in it. Ask one of them.');
      const table = t.active ? 'members' : 'pending_members';
      if (body.member) {
        if (t.active) await env.DB.prepare('INSERT OR IGNORE INTO members (channel_id,user_id,last_read,joined_at) VALUES (?,?,?,?)').bind(body.channel_id, t.id, now(), now()).run();
        else await env.DB.prepare('INSERT OR IGNORE INTO pending_members (channel_id,user_id) VALUES (?,?)').bind(body.channel_id, t.id).run();
      } else {
        await env.DB.prepare(`DELETE FROM ${table} WHERE channel_id=? AND user_id=?`).bind(body.channel_id, t.id).run();
      }
      if (t.active) await broadcast(env, { type: 'channel_added', channel_id: body.channel_id }, [t.id]).catch(() => {});
      return json({ ok: true });
    }
  }
  if (path === '/api/admin/channels' && method === 'GET') {
    const r = await env.DB.prepare(`SELECT c.id,c.name,c.topic,c.private,c.archived,c.created_at,c.last_ts,
        (SELECT COUNT(*) FROM members x WHERE x.channel_id=c.id) members,
        (SELECT COUNT(*) FROM messages x WHERE x.channel_id=c.id) messages
      FROM channels c WHERE c.kind='channel' ORDER BY c.archived, c.name`).all();
    return json(r.results);
  }
  if (path === '/api/admin/stats' && method === 'GET') {
    const r = await env.DB.prepare(`SELECT (SELECT COUNT(*) FROM messages) messages,
        (SELECT COUNT(*) FROM messages WHERE files<>'[]') with_files,
        (SELECT COUNT(*) FROM messages WHERE ts > ?) messages_7d,
        (SELECT COUNT(DISTINCT user_id) FROM sessions WHERE created_at > ?) active_7d,
        (SELECT CAST(value AS INTEGER) FROM settings WHERE key='storage_bytes') storage,
        (SELECT COALESCE(SUM(json_extract(voice,'$.dur')),0) FROM files WHERE t_status='done' AND t_at >= ?) voice_secs_today,
        (SELECT value FROM settings WHERE key='ai_paused_until') ai_paused_until`).bind(now() - 7 * 864e5, now() - 7 * 864e5, new Date().setUTCHours(0, 0, 0, 0)).first();
    // Rough usage against the free plan, for the Usage card. Request counts live only in the Cloudflare dashboard.
    return json({ ...r, storage_limit: (+env.STORAGE_TOTAL_GB || 9) * GB, voice_free_secs: 214 * 60, ai_paused_until: +r.ai_paused_until > now() ? +r.ai_paused_until : 0 });
  }
  return err(404, 'Not found');
}

async function api_invite_POST(c, m) {
  const { req, env, user, path, ctx, method, body } = c;
  if (!['owner', 'admin'].includes(user.role)) return err(403, 'Only admins can invite people.');
  const email = String(body.email || '').toLowerCase().trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return err(400, 'Enter a full email address, like name@company.com.');
  const exists = await env.DB.prepare('SELECT * FROM users WHERE email=?').bind(email).first();
  if (exists) {
    if (exists.role === 'owner' && user.role !== 'owner') return err(403, 'Not allowed');
    const hasPw = await env.DB.prepare('SELECT 1 FROM credentials WHERE user_id=?').bind(exists.id).first();
    // A new link sets a new password, so it takes over the account. Admins may only do that for
    // people who have never signed in. Anyone else (Google sign-in users, admins, deactivated
    // accounts, Slack placeholders) needs the owner.
    if (user.role !== 'owner') {
      const seen = await env.DB.prepare('SELECT 1 FROM sessions WHERE user_id=? LIMIT 1').bind(exists.id).first()
        || await env.DB.prepare('SELECT 1 FROM signins WHERE user_id=?').bind(exists.id).first().catch(() => null);
      const sensitive = hasPw || seen || exists.slack_id || exists.role === 'admin' || exists.deactivated || !exists.active || exists.email.endsWith('@bot.local');
      if (sensitive) return err(403, 'Only the owner can reset this account');
    }
    if (hasPw) { await env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(exists.id).run(); await kick(env, exists.id); }
    await env.DB.prepare('UPDATE users SET active=1, deactivated=0 WHERE id=?').bind(exists.id).run();
    return json({ ...exists, link: await makeInviteLink(env, new URL(req.url).origin, exists.id), existing: true });
  }
  const role = body.guest ? 'guest' : 'member';
  if (role === 'guest' && !(Array.isArray(body.channel_ids) && body.channel_ids.length)) return err(400, 'Pick at least one channel for a guest.');
  const id = uid('U');
  await env.DB.prepare('INSERT INTO users (id,email,name,title,avatar,color,role,active,created_at) VALUES (?,?,?,?,?,?,?,1,?)')
    .bind(id, email, String(body.name || email.split('@')[0]), '', '', colorFor(email), role, now()).run();
  // Channels only: never a DM, and only ids that exist.
  const want = [...new Set((Array.isArray(body.channel_ids) ? body.channel_ids : []).map(String))].slice(0, 100);
  const okc = want.length ? (await env.DB.prepare(`SELECT id FROM channels WHERE kind='channel' AND id IN (${want.map(() => '?').join(',')})`).bind(...want).all()).results.map((r) => r.id) : [];
  for (const c of okc) {
    await env.DB.prepare('INSERT OR IGNORE INTO members (channel_id,user_id,last_read,joined_at) VALUES (?,?,?,?)').bind(c, id, 0, now()).run();
  }
  if (role === 'member') { await joinDefaultChannels(env, id); await ensureDefaultSections(env, id); }
  const nu = { id, email, name: String(body.name || email.split('@')[0]), title: '', avatar: '', color: colorFor(email), role, active: 1 };
  await broadcast(env, { type: 'user_updated', user: nu }, await nonGuestIds(env)).catch(() => {});
  return json({ ...nu, link: await makeInviteLink(env, new URL(req.url).origin, id) });
}


// ---------------------------------------------------------------- files (R2)
// Storage caps keep one person (or a runaway script) from filling the free 10 GB of R2.
// STORAGE_PER_PERSON_GB (default 2) and STORAGE_TOTAL_GB (default 9) change them.
const GB = 1024 ** 3;
async function roomFor(env, user, size) {
  const per = (+env.STORAGE_PER_PERSON_GB || 2) * GB, total = (+env.STORAGE_TOTAL_GB || 9) * GB;
  const [mine, team] = await Promise.all([
    env.DB.prepare('SELECT COALESCE(SUM(size),0) n FROM files WHERE uploader=?').bind(user.id).first(),
    env.DB.prepare("SELECT CAST(value AS INTEGER) n FROM settings WHERE key='storage_bytes'").first(),   // kept exact by triggers (schema.sql)
  ]);
  if (mine.n + size > per) return err(413, `You've used your ${per / GB} GB of file space. Delete messages with big old files, or ask your admin for more room.`);
  if ((team?.n || 0) + size > total) return err(413, `Your team's file space (${total / GB} GB) is full. Ask your admin to clear some room.`);
  return null;
}
async function uploadFile(req, env, user) {
  const form = await req.formData();
  const file = form.get('file');
  if (!file || typeof file === 'string') return err(400, 'No file');
  if (file.size > 100 * 1024 * 1024) return err(413, 'Files can be up to 100 MB here. Try a smaller one.');
  // Voice notes are transcribed in memory, so keep them small and audio only.
  if (form.get('voice') === '1' && (file.size > VOICE_MAX || !/^(audio\/|video\/(webm|mp4))/i.test(file.type || ''))) return err(413, 'Voice notes must be audio and under 25 MB.');
  const full = await roomFor(env, user, file.size);
  if (full) return full;
  const key = `${new Date().toISOString().slice(0, 7)}/${uid('F')}/${file.name.replace(/[^\w.\- ]+/g, '_')}`;
  await env.FILES.put(key, file.stream(), {
    httpMetadata: { contentType: file.type || 'application/octet-stream' },
    customMetadata: { uploader: user.id, name: file.name },
  });
  const voice = parseVoiceMeta(form);
  await env.DB.prepare('INSERT OR REPLACE INTO files (key,uploader,channel_id,created_at,voice,t_status,size) VALUES (?,?,NULL,?,?,?,?)').bind(key, user.id, now(), voice ? JSON.stringify(voice) : null, voice ? 'pending' : null, file.size).run();
  return json({ key, name: file.name, size: file.size, type: file.type || 'application/octet-stream', ...(voice ? { voice, t: 'pending' } : {}) });
}

// Big files (up to 1 GB): sent in 20 MB pieces, put back together in R2.
const BIG_MAX = 1024 * 1024 * 1024;
const PART_MAX = 30 * 1024 * 1024;
const MAX_PARTS = Math.ceil(BIG_MAX / (20 * 1024 * 1024)) + 2; // the app sends 20 MB pieces
async function bigUpload(req, env, user, path, url) {
  const mine = async (key) => { const f = await env.DB.prepare('SELECT uploader, channel_id FROM files WHERE key=?').bind(key).first(); return f && f.uploader === user.id && !f.channel_id; };
  if (path === '/api/upload/start' && req.method === 'POST') {
    const b = await req.json().catch(() => ({}));
    const name = String(b.name || 'file').slice(0, 200), size = +b.size || 0, type = String(b.type || 'application/octet-stream').slice(0, 120);
    if (size > BIG_MAX) return err(413, 'Files can be up to 1 GB. Try a smaller one.');
    const full = await roomFor(env, user, size);
    if (full) return full;
    const key = `${new Date().toISOString().slice(0, 7)}/${uid('F')}/${name.replace(/[^\w.\- ]+/g, '_')}`;
    const up = await env.FILES.createMultipartUpload(key, { httpMetadata: { contentType: type }, customMetadata: { uploader: user.id, name } });
    await env.DB.prepare('INSERT OR REPLACE INTO files (key,uploader,channel_id,created_at,size) VALUES (?,?,NULL,?,?)').bind(key, user.id, now(), size).run();
    return json({ key, upload_id: up.uploadId });
  }
  if (path === '/api/upload/part' && req.method === 'PUT') {
    const key = url.searchParams.get('key') || '', id = url.searchParams.get('id') || '', n = parseInt(url.searchParams.get('n') || '0', 10);
    if (!key || !id || !(n >= 1 && n <= MAX_PARTS) || !(await mine(key))) return err(403, 'Not allowed');
    if (+req.headers.get('content-length') > PART_MAX) return err(413, 'Piece too big');
    const body = await req.arrayBuffer();
    if (body.byteLength > PART_MAX) return err(413, 'Piece too big');
    const part = await env.FILES.resumeMultipartUpload(key, id).uploadPart(n, body);
    return json({ partNumber: part.partNumber, etag: part.etag });
  }
  if (path === '/api/upload/finish' && req.method === 'POST') {
    const b = await req.json().catch(() => ({}));
    if (!b.key || !b.upload_id || !Array.isArray(b.parts) || !(await mine(b.key))) return err(403, 'Not allowed');
    const up = env.FILES.resumeMultipartUpload(b.key, b.upload_id);
    if (b.cancel) { try { await up.abort(); } catch {} await env.DB.prepare('DELETE FROM files WHERE key=?').bind(b.key).run(); return json({ ok: true }); }
    const obj = await up.complete(b.parts.map((x) => ({ partNumber: +x.partNumber, etag: String(x.etag) })));
    if (obj.size > BIG_MAX) { await env.FILES.delete(b.key); return err(413, 'Files can be up to 1 GB. Try a smaller one.'); }
    await env.DB.prepare('UPDATE files SET size=? WHERE key=?').bind(obj.size, b.key).run();
    return json({ key: b.key, name: String(b.name || b.key.split('/').pop()), size: obj.size, type: obj.httpMetadata?.contentType || 'application/octet-stream' });
  }
  return err(404, 'Not found');
}

// Only the uploader (before posting) or members of the conversation where the file was shared may open it.
async function canReadFile(env, user, key) {
  if (key.startsWith('avatars/') || key.startsWith('emoji/')) return true;
  const f = await env.DB.prepare('SELECT uploader, channel_id FROM files WHERE key=?').bind(key.replace(/^thumbs\/w\d+\//, '')).first();
  if (!f) return false;
  if (!f.channel_id) return f.uploader === user.id;
  return isMember(env, f.channel_id, user.id);
}
let imagesOffUntil = 0;
const IMG_MAX = 5 * 1024 * 1024;
const SAFE_INLINE = /^(image\/(png|jpe?g|gif|webp|heic|heif)|video\/(mp4|webm|quicktime)|audio\/[\w.+-]+|application\/pdf)$/i;
async function serveFile(req, env, key) {
  const url = new URL(req.url);
  const wq = parseInt(url.searchParams.get('w') || '0', 10) || 0;
  const w = wq ? [96, 880, 1600].find((x) => x >= wq) || 1600 : 0;
  // Small preview for chat: made once with Cloudflare Images, then kept in R2.
  if (w && env.IMAGES && imagesOffUntil < Date.now() && /\.(png|jpe?g|webp|heic|heif|bmp|tiff?)$/i.test(key)) {
    const tkey = `thumbs/w${w}/${key}`;
    let t = await env.FILES.get(tkey);
    if (!t) {
      const orig = await env.FILES.get(key);
      if (!orig) return new Response('Not found', { status: 404 });
      try {
        const out = await env.IMAGES.input(orig.body).transform({ width: w, fit: 'scale-down' }).output({ format: 'image/webp', quality: 82 });
        const bytes = await out.response().arrayBuffer();
        await env.FILES.put(tkey, bytes, { httpMetadata: { contentType: 'image/webp' } });
        return new Response(bytes, { headers: { 'content-type': 'image/webp', 'cache-control': 'private, max-age=2592000' } });
      } catch (e) { imagesOffUntil = Date.now() + 3600e3; /* free transformations used up, or Images off: originals for an hour */ }
    } else {
      return new Response(t.body, { headers: { 'content-type': 'image/webp', 'cache-control': 'private, max-age=2592000' } });
    }
  }
  const range = req.headers.get('range');
  const obj = await env.FILES.get(key, range ? { range: req.headers } : undefined);
  if (!obj) return new Response('Not found', { status: 404 });
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('cache-control', 'private, max-age=2592000');
  headers.set('accept-ranges', 'bytes');
  const name = obj.customMetadata?.name || key.split('/').pop();
  const inline = SAFE_INLINE.test(headers.get('content-type') || '');
  if (!inline) headers.set('content-type', 'application/octet-stream');
  headers.set('content-security-policy', "sandbox; default-src 'none'; img-src 'self'; media-src 'self'");
  headers.set('content-disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(name)}`);
  headers.set('x-content-type-options', 'nosniff');
  if (range && obj.range) {
    const off = obj.range.offset || 0, len = obj.range.length ?? (obj.size - off);
    headers.set('content-range', `bytes ${off}-${off + len - 1}/${obj.size}`);
    headers.set('content-length', String(len));
    return new Response(obj.body, { status: 206, headers });
  }
  return new Response(obj.body, { headers });
}

// Link-preview images and Google profile photos come through here, so the app's CSP can stay img-src 'self'.
// Pictures only, 5 MB at most; kept a week, and a failed one remembered for an hour.
const IMG_TTL = 7 * 864e5, IMG_BAD_TTL = 3600e3;
const imgHeaders = (type) => ({ 'content-type': type, 'cache-control': 'private, max-age=86400', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; sandbox" });
async function imgProxy(env, target) {
  const key = 'img/' + (await sha256hex(target));
  const hit = await cacheGet(env, key);
  if (hit?.customMetadata?.bad === '1') { await hit.body.cancel(); return err(404, 'Not found'); }
  if (hit) return new Response(hit.body, { headers: imgHeaders(hit.httpMetadata?.contentType || 'image/png') });
  const got = await safeFetch(target, { accept: 'image/avif,image/webp,image/png,image/*', 'user-agent': 'Mozilla/5.0 (compatible; YakyardBot/1.0)' }).catch(() => null);
  const type = (got?.res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const ok = got?.res.ok && /^image\/(png|jpe?g|gif|webp|avif|x-icon|vnd\.microsoft\.icon)$/.test(type) && +(got.res.headers.get('content-length') || 0) <= IMG_MAX;
  const buf = ok ? await got.res.arrayBuffer() : null;
  if (!buf || buf.byteLength > IMG_MAX) { await cachePut(env, key, '', IMG_BAD_TTL, '', { bad: '1' }); return err(404, 'Not found'); }
  await cachePut(env, key, buf, IMG_TTL, type);
  return new Response(buf, { headers: imgHeaders(type) });
}

// ---------------------------------------------------------------- worker entry
export default {
  // Every 5 minutes, a safety net only: background work runs as its own jobs (class Job below). This re-arms
  // anything overdue and starts the hourly tidy-up.
  async scheduled(event, env) { await sweep(env, event.scheduledTime); },
  fetch: (req, env, ctx) => handle(req, env, ctx),
};
// Nothing should crash into a Cloudflare error page, including when a free daily allowance runs out.
async function handle(req, env0, ctx) {
  try { return await handle0(req, env0, ctx); } catch (e) {
    console.error(e);
    const kind = dbQuotaError(e), quota = !!kind;
    const msg = QUOTA_MSG[kind] || "That didn't go through. Try again.";
    const path = new URL(req.url).pathname;
    if (path.startsWith('/api/') || path.startsWith('/files/') || req.method !== 'GET') return json({ error: msg, quota }, 503);
    const r = page(env0, 'Yakyard', `<h1>Back soon</h1><p class="login-error" role="alert">${escH(msg)}</p><p class="login-note"><a href="/">Try again</a></p>`);
    return new Response(r.body, { status: 503, headers: r.headers });
  }
}
async function handle0(req, env0, ctx) {
    const url = new URL(req.url);
    const path = url.pathname;
    // Reads go to the nearest D1 replica. The app sends back the bookmark so you always see your own writes.
    let env = env0;
    if (env0.DB.withSession && !/\.(css|js|woff2|png|svg|ico|webmanifest|json)$/.test(path)) {
      const bm = req.headers.get('x-d1-bookmark');
      const db = env0.DB.withSession(bm && /^[\w-]+$/.test(bm) ? bm : 'first-unconstrained');
      env = { ...env0, DB: db };
      const r = await route(req, env, ctx, url, path);
      try { const b = db.getBookmark(); if (b && path.startsWith('/api/')) { const out = new Response(r.body, r); out.headers.set('x-d1-bookmark', b); return out; } } catch {}
      return r;
    }
    return route(req, env, ctx, url, path);
}
async function authRoute(req, env, url, path) {
    if (path === '/auth/login' && req.method === 'POST') {
      const o = req.headers.get('origin');
      if (o && o !== url.origin) return err(403, 'Bad origin');
      return passwordLogin(req, env);
    }
    if (path === '/auth/salt' && req.method === 'POST') {
      const o = req.headers.get('origin');
      if (o && o !== url.origin) return err(403, 'Bad origin');
      return saltFor(req, env);
    }
    if (path.startsWith('/join/')) {
      const o = req.headers.get('origin');
      if (req.method === 'POST' && o && o !== url.origin) return err(403, 'Bad origin');
      return joinPage(req, env, path.slice(6));
    }
    // Google sign-in only works when it is turned on (GOOGLE_ENABLED = "1"), not just hidden.
    if ((path === '/auth/google' || path === '/auth/callback') && !googleOn(env)) return loginPage(env);
    if (path === '/auth/google') return googleStart(req, env);
    if (path === '/auth/callback') return googleCallback(req, env);
    // Local testing only: needs DEV_LOGIN=1 AND a localhost address. Never reachable on the live site.
    if (path === '/auth/dev' && env.DEV_LOGIN === '1' && ['127.0.0.1', 'localhost'].includes(url.hostname)) {
      const u = await findOrCreateUser(env, { email: url.searchParams.get('email') || '', name: url.searchParams.get('name') || '' });
      if (!u) return loginPage(env, 'No access');
      return new Response(null, { status: 302, headers: { location: '/', 'set-cookie': setCookie(SESSION_COOKIE, await createSession(env, u.id), SESSION_DAYS * 86400, false) } });
    }
    if (path === '/auth/logout') {
      // Sign-out is a same-origin POST, so another site can't sign people out with a link or image.
      if (req.method !== 'POST') return page(env, 'Sign out of Yakyard', `<h1>Sign out</h1><form method="post" action="/auth/logout" class="login-form"><button class="login-btn primary" type="submit">Sign out</button></form><p class="login-note"><a href="/">Back to Yakyard</a></p>`);
      const o = req.headers.get('origin');
      if (o && o !== url.origin) return err(403, 'Bad origin');
      const sid = cookie(req, SESSION_COOKIE);
      if (sid) {
        const u = await currentUser(req, env);
        await env.DB.prepare('DELETE FROM sessions WHERE id=? OR id=?').bind(await sha256hex(sid), sid).run();
        if (u) await kick(env, u.id); // close open live connections too
      }
      return new Response(null, { status: 303, headers: { location: '/', 'set-cookie': setCookie(SESSION_COOKIE, '', 0, isSecure(req)) } });
    }
    return loginPage(env);
}
async function route(req, env, ctx, url, path) {
    // Sign-in pages have their own function, so app requests don't compile them.
    if (path.startsWith('/auth/') || path.startsWith('/join/')) return authRoute(req, env, url, path);
    const isStatic = !path.startsWith('/files/') && /\.(css|js|woff2|png|svg|ico|webmanifest|json|wasm)$/.test(path);
    if (isStatic) return env.ASSETS.fetch(req);

    if (path === '/setup') return setupPage(req, env);
    const user = await currentUser(req, env);
    if (!user) {
      if (path.startsWith('/api/') || path === '/ws' || path.startsWith('/files/')) return err(401, 'Sign in required');
      if (!(await env.DB.prepare('SELECT 1 FROM users LIMIT 1').first())) return new Response(null, { status: 302, headers: { location: '/setup' } });
      return loginPage(env);
    }

    // Same-origin check on writes (blocks cross-site form posts).
    if (!['GET', 'HEAD'].includes(req.method)) {
      const origin = req.headers.get('origin');
      if (origin && origin !== url.origin) return err(403, 'Bad origin');
    }

    if (path === '/ws') {
      // Browsers always send Origin on a WebSocket handshake. Only our own pages may connect.
      if (req.headers.get('origin') !== url.origin) return err(403, 'Bad origin');
      if (req.headers.get('upgrade') !== 'websocket') return err(426, 'WebSocket required');
      const hub = env.HUB.get(env.HUB.idFromName('workspace'));
      const fwd = new Request('https://hub/ws', req);
      fwd.headers.set('x-user-id', user.id);
      fwd.headers.set('x-guest', user.role === 'guest' ? '1' : '');
      return hub.fetch(fwd);
    }
    if (path === '/api/upload' && req.method === 'POST') return uploadFile(req, env, user);
    if (path === '/api/voice/transcribe' && req.method === 'POST') {
      // Runs as its own request (no background time cap), so long notes finish. The app fires it right after upload.
      const b = await req.json().catch(() => ({}));
      const f = b.key ? await env.DB.prepare('SELECT uploader, channel_id, voice FROM files WHERE key=?').bind(String(b.key)).first() : null;
      if (!f || !f.voice) return err(404, 'Not found');
      if (f.uploader !== user.id && !(f.channel_id && await isMember(env, f.channel_id, user.id))) return err(403, 'Not allowed');
      return json(await transcribe(env, String(b.key), { hydrateMessages, broadcast, channelMembers }, !!b.retry));
    }
    if (path.startsWith('/api/upload/')) return bigUpload(req, env, user, path, url);
    if (path === '/api/me/avatar' && req.method === 'POST') return (await featureApi(req, env, user, path, 'POST', {}, { postMessage, hydrateMessages, broadcast, isMember, channelMembers, audience, ctx })) || err(404, 'Not found');
    if (path.startsWith('/slack/')) return slackRoutes(req, env, user, ctx);
    if (path.startsWith('/files/')) {
      let key; try { key = decodeURIComponent(path.slice(7)); } catch { return err(400, 'Bad path'); }
      if (!(await canReadFile(env, user, key))) return err(404, 'Not found');
      return serveFile(req, env, key);
    }
    if (path.startsWith('/api/')) {
      try {
        return await api(req, env, user, path, ctx);
      } catch (e) {
        if (dbQuotaError(e)) throw e;   // handle() explains quota errors
        console.error(e);
        return err(500, "That didn't go through. Try again.");
      }
    }
    // The app shell
    const shell = await env.ASSETS.fetch(new Request(new URL('/', url), req));
    const hs = new Headers(shell.headers);
    const wsOrigin = (url.protocol === 'https:' ? 'wss://' : 'ws://') + url.host;
    hs.set('content-security-policy', `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' ${wsOrigin}; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`);
    hs.set('x-content-type-options', 'nosniff'); hs.set('referrer-policy', 'same-origin');
    hs.set('strict-transport-security', SEC['strict-transport-security']);
    return new Response(shell.body, { status: shell.status, headers: hs });
}

// ---------------------------------------------------------------- Hub Durable Object
// One hub for the workspace. Uses WebSocket hibernation, so idle connections cost nothing.
export class Hub extends DurableObject {
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === '/ws') {
      const userId = req.headers.get('x-user-id');
      const pair = new WebSocketPair();
      this.ctx.acceptWebSocket(pair[1], [userId]);
      pair[1].serializeAttachment({ userId, sid: crypto.randomUUID().slice(0, 12), guest: req.headers.get('x-guest') === '1' });
      this.broadcastPresence().catch((e) => console.log('presence', e));
      this.huddleStateFor().then((b) => { try { pair[1].send(JSON.stringify({ type: 'huddles', huddles: b[userId] || {} })); } catch (e) {} });
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    if (url.pathname === '/active') {
      // People looking at Yakyard right now (a visible window). They don't need a phone buzz.
      const act = new Set();
      for (const w of this.ctx.getWebSockets()) { const a = w.deserializeAttachment() || {}; if (a.userId && a.vis !== false) act.add(a.userId); }
      return new Response(JSON.stringify([...act]));
    }
    if (url.pathname === '/kick') {
      const { user_id } = await req.json();
      for (const w of this.ctx.getWebSockets(user_id)) { try { w.close(4001, 'signed out'); } catch (e) {} }
      return new Response('ok');
    }
    if (url.pathname === '/broadcast') {
      const { event, to } = await req.json();
      const data = JSON.stringify(event);
      const targets = to ? to.flatMap((u) => this.ctx.getWebSockets(u)) : this.ctx.getWebSockets();
      for (const ws of targets) {
        try { ws.send(data); } catch (e) { /* closed */ }
      }
      return new Response('ok');
    }
    return new Response('Not found', { status: 404 });
  }

  // Older versions queued phone notifications here. Hand any left over to push jobs, once.
  async alarm() {
    const q = (await this.ctx.storage.get('pushq')) || [];
    await this.ctx.storage.delete('pushq');
    for (let i = 0; i < q.length; i += PUSHES_PER_JOB) await arm(this.env, 'push', 'hub' + i + '-' + Date.now(), Date.now(), { subs: q.slice(i, i + PUSHES_PER_JOB).map((x) => x.s), payload: q[i].p });
  }

  online() {
    return [...new Set(this.ctx.getWebSockets().map((ws) => ws.deserializeAttachment()?.userId).filter(Boolean))];
  }
  // Guests only hear who is online among people they share a conversation with (and the owner).
  async broadcastPresence() {
    const online = this.online(), data = JSON.stringify({ type: 'presence', online });
    const socks = this.ctx.getWebSockets();
    const guests = [...new Set(socks.filter((w) => this.att(w).guest).map((w) => this.att(w).userId))];
    const see = {};
    if (guests.length) {
      const r = await this.env.DB.prepare(`SELECT b.user_id g, a.user_id u FROM members a JOIN members b ON b.channel_id=a.channel_id WHERE b.user_id IN (${guests.map(() => '?').join(',')})
        UNION SELECT g.id, o.id FROM users g, users o WHERE o.role='owner' AND g.id IN (${guests.map(() => '?').join(',')})`).bind(...guests, ...guests).all();
      for (const x of r.results) (see[x.g] ||= new Set([x.g])).add(x.u);
    }
    for (const ws of socks) {
      const a = this.att(ws);
      try { ws.send(a.guest ? JSON.stringify({ type: 'presence', online: online.filter((u) => see[a.userId]?.has(u)) }) : data); } catch (e) {}
    }
  }

  // ---- huddles: each socket can be in one huddle; state lives in the socket attachment (survives hibernation)
  att(ws) { return ws.deserializeAttachment() || {}; }
  huddleState() {
    const huddles = {};
    for (const s of this.ctx.getWebSockets()) {
      const a = this.att(s);
      if (!a.huddle) continue;
      (huddles[a.huddle] ||= []).push({ sid: a.sid, user_id: a.userId, muted: !!a.muted, video: !!a.video, screen: !!a.screen, since: a.since || 0 });
    }
    return { type: 'huddles', huddles };
  }
  // Each person only learns about huddles in conversations they belong to.
  async huddleStateFor() {
    const all = this.huddleState().huddles; const ids = Object.keys(all);
    const byUser = {};
    if (ids.length) {
      const r = await this.env.DB.prepare(`SELECT channel_id, user_id FROM members WHERE channel_id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all();
      for (const x of r.results) (byUser[x.user_id] ||= {})[x.channel_id] = all[x.channel_id];
      for (const s of this.ctx.getWebSockets()) { const t = this.att(s); if (t.huddle && all[t.huddle]) (byUser[t.userId] ||= {})[t.huddle] = all[t.huddle]; }
    }
    return byUser;
  }
  async broadcastHuddles() {
    const byUser = await this.huddleStateFor();
    for (const s of this.ctx.getWebSockets()) {
      const u = this.att(s).userId;
      try { s.send(JSON.stringify({ type: 'huddles', huddles: byUser[u] || {} })); } catch (e) {}
    }
  }
  inHuddle(channelId) { return this.ctx.getWebSockets().filter((s) => this.att(s).huddle === channelId); }
  async huddleCard(channelId, userId, ending) {
    const key = 'huddle:' + channelId;
    let h = await this.ctx.storage.get(key);
    const db = this.env.DB;
    const send = async (m) => {
      const members = (await db.prepare('SELECT user_id FROM members WHERE channel_id=?').bind(channelId).all()).results.map((r) => r.user_id);
      const data = JSON.stringify({ type: h && !ending && h.created ? 'message' : 'message_changed', message: m, mentioned: [] });
      for (const u of members) for (const s of this.ctx.getWebSockets(u)) { try { s.send(data); } catch (e) {} }
    };
    const row = (t) => ({ id: h.id, channel_id: channelId, user_id: h.by, ts: h.start, thread_id: null, text: t, files: [], reply_count: 0, last_reply_ts: 0, reply_users: [], edited_ts: null, deleted: 0, source: 'huddle', reactions: [] });
    if (!ending) {
      if (!h) {
        h = { id: 'M' + crypto.randomUUID().replace(/-/g, '').slice(0, 16), by: userId, start: Date.now(), users: [userId], created: true };
        const text = JSON.stringify({ start: h.start, users: h.users });
        await db.batch([
          db.prepare("INSERT INTO messages (id,channel_id,user_id,ts,thread_id,text,files,source) VALUES (?,?,?,?,NULL,?,'[]','huddle')").bind(h.id, channelId, userId, h.start, text),
          db.prepare('UPDATE channels SET last_ts=? WHERE id=?').bind(h.start, channelId),
        ]);
        await this.ctx.storage.put(key, h);
        await send(row(text));
        h.created = false; await this.ctx.storage.put(key, h);
      } else if (!h.users.includes(userId)) {
        h.users.push(userId); h.created = false; await this.ctx.storage.put(key, h);
        const text = JSON.stringify({ start: h.start, users: h.users });
        await db.prepare('UPDATE messages SET text=? WHERE id=?').bind(text, h.id).run();
        await send(row(text));
      }
    } else if (h) {
      const text = JSON.stringify({ start: h.start, end: Date.now(), users: h.users });
      await db.prepare('UPDATE messages SET text=? WHERE id=?').bind(text, h.id).run();
      await this.ctx.storage.delete(key);
      await send(row(text));
    }
  }
  async afterLeave(channelId) {
    if (channelId && !this.inHuddle(channelId).length) await this.huddleCard(channelId, null, true);
  }

  async handleHuddle(ws, msg) {
    const a = this.att(ws);
    if (msg.type === 'huddle_join' && msg.channel_id) {
      const ok = await this.env.DB.prepare('SELECT 1 FROM members WHERE channel_id=? AND user_id=?').bind(msg.channel_id, a.userId).first();
      // Someone in the call can add a person who isn't in the conversation: they join the call only, not the messages.
      const inv = ok ? null : await this.ctx.storage.get(`inv:${msg.channel_id}:${a.userId}`);
      if (!ok && !(inv && inv > Date.now() && this.inHuddle(msg.channel_id).length)) return;
      const prev = a.huddle;
      ws.serializeAttachment({ ...a, huddle: msg.channel_id, muted: false, video: false, screen: false, since: Date.now() });
      if (prev && prev !== msg.channel_id) await this.afterLeave(prev);
      const peers = this.ctx.getWebSockets().filter((s) => s !== ws && this.att(s).huddle === msg.channel_id)
        .map((s) => ({ sid: this.att(s).sid, user_id: this.att(s).userId }));
      ws.send(JSON.stringify({ type: 'huddle_joined', channel_id: msg.channel_id, sid: a.sid, peers }));
      this.broadcastHuddles();
      await this.huddleCard(msg.channel_id, a.userId, false);
    } else if (msg.type === 'huddle_leave') {
      ws.serializeAttachment({ userId: a.userId, sid: a.sid, guest: a.guest });
      this.broadcastHuddles();
      await this.afterLeave(a.huddle);
    } else if (msg.type === 'huddle_media' && a.huddle) {
      ws.serializeAttachment({ ...a, muted: !!msg.muted, video: !!msg.video, screen: !!msg.screen });
      this.broadcastHuddles();
    } else if (msg.type === 'huddle_invite' && a.huddle && msg.user_id) {
      const uid = String(msg.user_id);
      const u = await this.env.DB.prepare('SELECT id FROM users WHERE id=? AND active=1').bind(uid).first();
      if (!u) return;
      await this.ctx.storage.put(`inv:${a.huddle}:${uid}`, Date.now() + 10 * 60e3);
      const ch = await this.env.DB.prepare('SELECT id, kind, name FROM channels WHERE id=?').bind(a.huddle).first();
      const people = [...new Set(this.inHuddle(a.huddle).map((s) => this.att(s).userId))];
      const data = JSON.stringify({ type: 'huddle_invited', channel_id: a.huddle, from: a.userId, kind: ch?.kind, name: ch?.name || '', people });
      for (const s of this.ctx.getWebSockets(uid)) { try { s.send(data); } catch (e) {} }
    } else if (msg.type === 'huddle_mute' && a.huddle && msg.to) {
      const target = this.ctx.getWebSockets().find((s) => this.att(s).sid === msg.to && this.att(s).huddle === a.huddle);
      if (target) target.send(JSON.stringify({ type: 'huddle_mute_req', from: a.userId }));
    } else if (msg.type === 'huddle_signal' && a.huddle && msg.to) {
      const target = this.ctx.getWebSockets().find((s) => this.att(s).sid === msg.to && this.att(s).huddle === a.huddle);
      if (target) target.send(JSON.stringify({ type: 'huddle_signal', from: a.sid, user_id: a.userId, data: msg.data }));
    }
  }

  async webSocketMessage(ws, raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const from = ws.deserializeAttachment()?.userId;
    if (msg.type === 'ping') { ws.send('{"type":"pong"}'); return; }
    if (msg.type === 'vis') { const a = ws.deserializeAttachment() || {}; a.vis = !!msg.visible; a.visAt = Date.now(); ws.serializeAttachment(a); return; }
    if (String(msg.type).startsWith('huddle_')) return this.handleHuddle(ws, msg);
    if (msg.type === 'typing' && msg.channel_id) {
      // Only members hear it, and only from a member, so nobody can fake "X is typing" elsewhere.
      const mem = (await this.env.DB.prepare('SELECT user_id FROM members WHERE channel_id=?').bind(String(msg.channel_id)).all()).results.map((r) => r.user_id);
      if (!mem.includes(from)) return;
      const data = JSON.stringify({ type: 'typing', channel_id: msg.channel_id, thread_id: msg.thread_id || null, user_id: from });
      for (const u of mem) {
        if (u === from) continue;
        for (const s of this.ctx.getWebSockets(u)) { try { s.send(data); } catch (e) {} }
      }
    }
  }
  async webSocketClose(ws) { const was = this.att(ws).huddle; ws.serializeAttachment({}); await this.broadcastPresence().catch(() => {}); if (was) { this.broadcastHuddles(); await this.afterLeave(was); } }
  async webSocketError(ws) { return this.webSocketClose(ws); }
}

// ---------------------------------------------------------------- Job Durable Object
// One object per background job, named "<kind>:<id>" (see arm in features.js). Its alarm runs the job in its own
// invocation, with its own CPU budget, and sets the next alarm when the job wants to run again.
// The alarm itself only keeps time: the work runs as a separate call to this Worker (JobRunner, through the
// automatic ctx.exports loopback), so it gets its own CPU budget and usually an isolate that is already warm from
// serving the app, instead of compiling everything again in the Durable Object's own isolate.
export class Job extends DurableObject {
  arm(job, at) { return jobArm(this.ctx.storage, job, at); }
  alarm() { return jobAlarm(this.ctx.storage, (job) => (this.ctx.exports?.JobRunner ? this.ctx.exports.JobRunner.run(job) : runJob(this.env, this.ctx, job))); }
}
export class JobRunner extends WorkerEntrypoint {
  run(job) { console.log(`run ${job.kind}${job.data?.subs ? ' devices=' + job.data.subs.length : job.data?.members ? ' members=' + job.data.members.length : ''}`); return runJob(this.env, this.ctx, job); }
}
const voiceDeps = { hydrateMessages, broadcast, channelMembers };
// Who gets a phone buzz for a new message, then one push job per device (sendPushes). A voice note without text
// waits up to 20 seconds for its transcript, by sleeping between runs, so the notification can show the words.
async function fanoutJob(env, id, d) {
  const row = await env.DB.prepare('SELECT id, text, files, thread_id, deleted FROM messages WHERE id=?').bind(id).first();
  if (!row || row.deleted) return null;
  const msg = { ...row, files: JSON.parse(row.files || '[]') };
  const v = msg.files.find((x) => x.voice);
  if (v && !msg.text.trim()) {
    const f = await env.DB.prepare('SELECT transcript, t_status FROM files WHERE key=?').bind(v.key).first();
    if (f?.t_status === 'pending' || f?.t_status === 'working') { if (now() - d.at < 20e3) return now() + 3000; }
    const said = f?.t_status === 'done' ? f.transcript || '' : '';
    msg.text = `🎙 Voice note ${fmtDur(v.voice?.dur)}${said ? ': ' + said.slice(0, 160) + (said.length > 160 ? '…' : '') : ''}`;
  }
  await sendPushes(env, { msg, ch: d.ch, sender: d.sender, members: d.members, direct: d.direct, wide: d.wide, followers: d.followers });
  return null;
}
function runJob(env, ctx, { kind, id, data }) {
  if (kind === 'sched') return sendScheduled(env, ctx, id, postMessage);
  if (kind === 'rem') return sendReminder(env, ctx, id, postMessage);
  if (kind === 'voice') return voiceJob(env, id, voiceDeps);
  if (kind === 'import') return importJob(env, id);
  if (kind === 'push') return pushBatch(env, data);
  if (kind === 'fanout') return fanoutJob(env, id, data);
  if (kind === 'house') return Promise.all([housekeeping(env), cacheCleanup(env), e2eeHousekeeping(env)]).then(() => null);
  return null;
}
