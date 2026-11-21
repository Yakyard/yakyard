import { unfurl } from './unfurl.js';
import { slackRoutes, slackApi, runImports } from './slackimport.js';
import { sendPushes, cronTick, featureApi, hydrateExtras, PUSH_EMPTY } from './features.js';
import { parseVoiceMeta, transcribe, patchMessage, waitTranscripts, voiceCron, fmtDur } from './voice.js';
// Yakyard: Cloudflare Worker (API + auth + files) and the Hub Durable Object (live updates).
import { DurableObject } from 'cloudflare:workers';

const SESSION_DAYS = 30;
const PAGE = 50;
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

// ---------------------------------------------------------------- auth
async function currentUser(req, env) {
  const sid = cookie(req, 'pwc_session');
  if (!sid) return null;
  const row = await env.DB.prepare(
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id = ? AND s.expires_at > ? AND u.active = 1`
  ).bind(sid, now()).first();
  return row || null;
}

const ownerEmail = (email, env) => (env.OWNER_EMAILS || '').toLowerCase().split(',').map((e) => e.trim()).includes(email.toLowerCase());
function allowedEmail(email, env) {
  const domains = (env.ALLOWED_DOMAINS || '').split(',').map((d) => d.trim().toLowerCase()).filter(Boolean);
  const domain = email.split('@')[1]?.toLowerCase();
  return domains.includes(domain);
}

const PALETTE = ['#e8912d', '#2bac76', '#1264a3', '#e01e5a', '#7c3085', '#36c5f0', '#4a154b', '#c56a00', '#0b7a5c', '#9b1f5c'];
const colorFor = (s) => PALETTE[[...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % PALETTE.length];

async function findOrCreateUser(env, { email, name, picture }) {
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
  if (!allowedEmail(email, env) && !ownerEmail(email, env)) return null; // everyone else must be invited first
  const count = await env.DB.prepare('SELECT COUNT(*) n FROM users').first();
  user = {
    id: uid('U'), email, name: name || email.split('@')[0], title: '', avatar: picture || '',
    color: colorFor(email), role: count.n === 0 || ownerEmail(email, env) ? 'owner' : 'member', active: 1, created_at: now(),
  };
  await env.DB.prepare(
    'INSERT INTO users (id,email,name,title,avatar,color,role,active,created_at) VALUES (?,?,?,?,?,?,?,?,?)'
  ).bind(user.id, user.email, user.name, '', user.avatar, user.color, user.role, 1, user.created_at).run();
  if (count.n === 0) {
    for (const [name, topic] of [['general', 'Company-wide announcements and work-based matters'], ['random', 'Non-work banter and water cooler conversation']]) {
      await env.DB.prepare('INSERT OR IGNORE INTO channels (id,kind,name,topic,private,archived,created_by,created_at,last_ts) VALUES (?,?,?,?,0,0,?,?,?)')
        .bind(uid('C'), 'channel', name, topic, user.id, now(), now()).run();
    }
  }
  await joinDefaultChannels(env, user.id);
  await ensureDefaultSections(env, user.id);
  await broadcast(env, { type: 'user_updated', user: { id: user.id, email: user.email, name: user.name, title: '', avatar: user.avatar, color: user.color, role: user.role, active: 1 } }).catch(() => {});
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

async function createSession(env, userId) {
  const sid = uid('sess_') + uid();
  await env.DB.prepare('INSERT INTO sessions (id,user_id,created_at,expires_at) VALUES (?,?,?,?)')
    .bind(sid, userId, now(), now() + SESSION_DAYS * 864e5).run();
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
    headers: { location: 'https://accounts.google.com/o/oauth2/v2/auth?' + p, 'set-cookie': setCookie('pwc_state', state, 600, isSecure(req)) },
  });
}

async function googleCallback(req, env) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code || !state || state !== cookie(req, 'pwc_state')) return loginPage('Sign-in expired. Please try again.');
  const tok = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: url.origin + '/auth/callback', grant_type: 'authorization_code',
    }),
  }).then((r) => r.json());
  if (!tok.id_token) return loginPage('Google sign-in failed. Please try again.');
  // The id_token comes straight from Google over TLS in exchange for our secret, so its claims can be trusted.
  const claims = JSON.parse(atob(tok.id_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
  if (claims.aud !== env.GOOGLE_CLIENT_ID || !claims.email_verified) return loginPage('Google sign-in failed.');
  const user = await findOrCreateUser(env, { email: claims.email, name: claims.name, picture: claims.picture });
  if (!user) return loginPage(`${claims.email} doesn't have access. Ask your workspace admin for an invite.`);
  const sid = await createSession(env, user.id);
  const headers = new Headers({ location: '/' });
  headers.append('set-cookie', setCookie('pwc_session', sid, SESSION_DAYS * 86400, isSecure(req)));
  headers.append('set-cookie', setCookie('pwc_state', '', 0, isSecure(req)));
  return new Response(null, { status: 302, headers });
}


// ---------------------------------------------------------------- password sign-in + invite links
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
async function hashPassword(password, saltB64) {
  const salt = saltB64 ? Uint8Array.from(atob(saltB64), (c) => c.charCodeAt(0)) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 }, key, 256);
  return { hash: b64(bits), salt: b64(salt) };
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
  return new Response(null, { status: 303, headers: { location: '/', 'set-cookie': setCookie('pwc_session', sid, SESSION_DAYS * 86400, isSecure(req)) } });
}
async function passwordLogin(req, env) {
  const f = await req.formData();
  const email = String(f.get('email') || '').toLowerCase().trim();
  const password = String(f.get('password') || '');
  const ip = req.headers.get('cf-connecting-ip') || 'x';
  const win = Math.floor(now() / (15 * 60e3));
  const hit = async (k) => (await env.DB.prepare('INSERT INTO login_attempts (k,n) VALUES (?,1) ON CONFLICT(k) DO UPDATE SET n=n+1 RETURNING n').bind(k + '|' + win).first()).n;
  if ((await hit('ip:' + ip)) > 30 || (await hit('em:' + email + '|' + ip)) > 8) return loginPage('Too many tries. Wait 15 minutes or ask your workspace admin for a new link.', email);
  const failKey = 'unused', since = 0, count = 0;
  const row = await env.DB.prepare('SELECT u.id, c.hash, c.salt FROM users u JOIN credentials c ON c.user_id=u.id WHERE u.email=? AND u.active=1').bind(email).first();
  const ok = row && sameText((await hashPassword(password, row.salt)).hash, row.hash);
  if (!ok) return loginPage('Wrong email or password.', email);
  return signedIn(req, await createSession(env, row.id));
}
const page = (title, inner) => new Response(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><link rel="icon" href="/favicon.ico" sizes="48x48"><link rel="icon" href="/brand/favicon-64.png" type="image/png"><link rel="manifest" href="/manifest.webmanifest?v=2"><link rel="apple-touch-icon" href="/brand/app-icon-180.png"><meta name="theme-color" content="#eef0f3"><meta name="apple-mobile-web-app-capable" content="yes"><link rel="stylesheet" href="/app.css"></head><body class="login"><main class="login-card"><img class="login-logo" src="/brand/logo.png" alt="Yakyard"><p class="login-brands">${escH(globalThis.__wsName || 'Yakyard')}</p>${inner}</main></body></html>`,
  { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
const escH = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function joinPage(req, env, token) {
  const inv = await inviteFor(env, token);
  if (!inv) return loginPage('This link has expired or was already used. Ask your workspace admin for a new one.');
  if (req.method === 'POST') {
    const f = await req.formData();
    const name = String(f.get('name') || '').trim().slice(0, 80);
    const password = String(f.get('password') || '');
    if (!name || password.length < 8) return joinForm(inv, 'Add your name and a password of at least 8 characters.');
    const { hash, salt } = await hashPassword(password);
    await env.DB.batch([
      env.DB.prepare('INSERT OR REPLACE INTO credentials (user_id,hash,salt,updated_at) VALUES (?,?,?,?)').bind(inv.id, hash, salt, now()),
      env.DB.prepare('UPDATE users SET name=? WHERE id=?').bind(name, inv.id),
      env.DB.prepare('DELETE FROM invites WHERE user_id=?').bind(inv.id),
      env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(inv.id),
      // Give back the channels they were in on Slack.
      env.DB.prepare('INSERT OR IGNORE INTO members (channel_id,user_id,last_read,joined_at) SELECT channel_id, user_id, ?, ? FROM pending_members WHERE user_id=?').bind(now(), now(), inv.id),
      env.DB.prepare('DELETE FROM pending_members WHERE user_id=?').bind(inv.id),
    ]);
    await broadcast(env, { type: 'user_updated', user: { id: inv.id, name } }).catch(() => {});
    return signedIn(req, await createSession(env, inv.id));
  }
  return joinForm(inv);
}
// First run only: the first owner creates their account. Their email must be in OWNER_EMAILS.
async function setupPage(req, env) {
  if (await env.DB.prepare('SELECT 1 FROM users LIMIT 1').first()) return new Response(null, { status: 302, headers: { location: '/' } });
  const form = (error = '', email = '') => page('Set up Yakyard', `<h1>Set up Yakyard</h1><p>Create the owner account. Use an email listed in OWNER_EMAILS.</p>
${error ? `<p class="login-error">${escH(error)}</p>` : ''}
<form method="post" class="login-form">
<label>Your name<input class="input" name="name" required maxlength="80" autocomplete="name"></label>
<label>Email<input class="input" name="email" type="email" required autocomplete="username" value="${escH(email)}"></label>
<label>Choose a password<input class="input" name="password" type="password" required minlength="8" autocomplete="new-password" placeholder="At least 8 characters"></label>
<button class="login-btn primary" type="submit">Create workspace</button></form>`);
  if (req.method !== 'POST') return form();
  const o = req.headers.get('origin');
  if (o && o !== new URL(req.url).origin) return err(403, 'Bad origin');
  const f = await req.formData();
  const email = String(f.get('email') || '').trim().toLowerCase(), name = String(f.get('name') || '').trim().slice(0, 80), password = String(f.get('password') || '');
  if (!(env.OWNER_EMAILS || '').trim()) return form('Set OWNER_EMAILS in wrangler.toml first, then deploy again.', email);
  if (!ownerEmail(email, env)) return form('That email is not in OWNER_EMAILS.', email);
  if (!name || password.length < 8) return form('Add your name and a password of at least 8 characters.', email);
  const u = await findOrCreateUser(env, { email, name });
  if (!u) return form('Could not create the account.', email);
  const { hash, salt } = await hashPassword(password);
  await env.DB.prepare('INSERT OR REPLACE INTO credentials (user_id,hash,salt,updated_at) VALUES (?,?,?,?)').bind(u.id, hash, salt, now()).run();
  return signedIn(req, await createSession(env, u.id));
}
function joinForm(inv, error = '') {
  const isNew = inv.name === inv.email.split('@')[0];
  return page('Join Yakyard', `<h1>Join Yakyard</h1><p>You're signing in as <b>${escH(inv.email)}</b>.</p>
${error ? `<p class="login-error">${escH(error)}</p>` : ''}
<form method="post" class="login-form">
<label>Your name<input class="input" name="name" required maxlength="80" autocomplete="name" value="${isNew ? '' : escH(inv.name)}"></label>
<label>Choose a password<input class="input" name="password" type="password" required minlength="8" autocomplete="new-password" placeholder="At least 8 characters"></label>
<button class="login-btn primary" type="submit">Continue</button></form>`);
}

function loginPage(message = '', email = '', env) {
  const google = globalThis.__googleOn ? `<div class="login-or"><span>or</span></div>
<a class="login-btn" href="/auth/google"><svg width="18" height="18" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.6-.4-3.9z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.6-.4-3.9z"/></svg>Continue with Google</a>` : '';
  return page('Sign in to Yakyard', `<h1>Sign in to Yakyard</h1>
${message ? `<p class="login-error">${escH(message)}</p>` : ''}
<form method="post" action="/auth/login" class="login-form">
<label>Email<input class="input" name="email" type="email" required autocomplete="username" value="${escH(email)}"></label>
<label>Password<input class="input" name="password" type="password" required autocomplete="current-password"></label>
<button class="login-btn primary" type="submit">Sign in</button></form>${google}
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
  // A message in an old, archived conversation brings it back.
  if (ch.archived && ch.kind === 'dm') await env.DB.prepare('UPDATE channels SET archived=0 WHERE id=?').bind(ch.id).run();
  if (ch.kind === 'dm') await env.DB.prepare('UPDATE members SET hidden=0 WHERE channel_id=? AND hidden=1').bind(ch.id).run();
  else if (ch.archived) return err(403, 'This channel is archived');
  const text = String(body.text || '').slice(0, 40000);
  const asked = Array.isArray(body.files) ? body.files.slice(0, 10) : [];
  const files = [];
  for (const f of asked) {
    const rec = f && typeof f.key === 'string' ? await env.DB.prepare('SELECT uploader, channel_id, voice, transcript, t_status FROM files WHERE key=?').bind(f.key).first() : null;
    if (!rec || rec.uploader !== user.id || (rec.channel_id && rec.channel_id !== ch.id)) continue;
    const item = { key: f.key, name: String(f.name || 'file').slice(0, 200), size: +f.size || 0, type: String(f.type || 'application/octet-stream').slice(0, 100) };
    if (rec.voice) { try { item.voice = JSON.parse(rec.voice); } catch { item.voice = { dur: 0, wave: [] }; } item.t = rec.t_status === 'done' ? 'done' : rec.t_status === 'failed' ? 'failed' : 'pending'; item.transcript = rec.transcript || ''; }
    files.push(item);
    await env.DB.prepare('UPDATE files SET channel_id=? WHERE key=?').bind(ch.id, f.key).run();
  }
  if (!text.trim() && !files.length) return err(400, 'Empty message');
  const threadId = body.thread_id || null;
  const also = threadId && body.also_channel ? 1 : 0;
  let parent = null;
  if (threadId) {
    parent = await env.DB.prepare('SELECT * FROM messages WHERE id=? AND channel_id=?').bind(threadId, ch.id).first();
    if (!parent) return err(404, 'Thread not found');
  }
  const msg = {
    id: uid('M'), channel_id: ch.id, user_id: user.id, ts: now(), thread_id: threadId, text,
    files: JSON.stringify(files), reply_count: 0, last_reply_ts: 0, reply_users: '[]', edited_ts: null, deleted: 0, source: 'app', also_channel: also,
  };
  const stmts = [
    env.DB.prepare('INSERT INTO messages (id,channel_id,user_id,ts,thread_id,text,files,also_channel) VALUES (?,?,?,?,?,?,?,?)')
      .bind(msg.id, ch.id, user.id, msg.ts, threadId, text, msg.files, also),
  ];
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
  const members = await channelMembers(env, ch.id);
  let mentioned = mentionedIds(text).filter((u) => members.includes(u));
  if (/<!(channel|here)>/.test(text)) mentioned = members.filter((u) => u !== user.id);
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
    const fresh = await env.DB.prepare('SELECT files FROM messages WHERE id=?').bind(msg.id).first();
    if (fresh) msg.files = fresh.files;
  }
  } catch (e) { console.log('voice index', e); }
  const [full] = await hydrateMessages(env, [msg]);
  const event = { type: 'message', message: full, channel: { id: ch.id, kind: ch.kind, name: ch.name }, mentioned };
  if (parent) {
    event.parent = (await hydrateMessages(env, [parent]))[0];
    // Everyone in the thread hears about new replies, like Slack.
    const fol = await env.DB.prepare('SELECT DISTINCT user_id FROM messages WHERE thread_id=? UNION SELECT user_id FROM messages WHERE id=?').bind(parent.id, parent.id).all();
    event.followers = fol.results.map((r) => r.user_id).filter((u) => u !== user.id);
  }
  await broadcast(env, event, members);
  const direct = mentionedIds(text).filter((u) => members.includes(u));
  const job = (async () => {
    let pmsg = full;
    const vfiles = full.files.filter((x) => x.voice);
    if (vfiles.length && !text.trim()) {
      // Phone notification shows what was said. Wait a little for the transcript, never block the send.
      const got = vfiles.some((x) => x.t === 'pending') ? await waitTranscripts(env, vfiles.map((x) => x.key)) : Object.fromEntries(vfiles.map((x) => [x.key, x.transcript || '']));
      const v = vfiles[0], said = (got && got[v.key]) || '';
      pmsg = { ...full, text: `🎙 Voice note ${fmtDur(v.voice?.dur)}${said ? ': ' + said.slice(0, 160) + (said.length > 160 ? '…' : '') : ''}` };
    }
    return sendPushes(env, { msg: pmsg, ch, sender: user, members, direct, wide: /<!(channel|here|everyone)>/.test(text), followers: event.followers || [], parent });
  })();
  if (ctx?.waitUntil) ctx.waitUntil(job.catch((e) => console.log('push failed', e))); else await job.catch(() => {});
  return json(full);

}

// ---------------------------------------------------------------- API
async function api(req, env, user, path, ctx) {
  const method = req.method;
  const body = method === 'GET' || method === 'DELETE' ? null : await req.json().catch(() => ({}));
  let m;
  const fx = await featureApi(req, env, user, path, method, body, { postMessage, hydrateMessages, broadcast, isMember, channelMembers, ctx });
  if (fx) return fx;
  const sx = await slackApi(req, env, user, path, method, body, ctx);
  if (sx) return sx;

  // ----- bootstrap: everything the sidebar needs
  if (path === '/api/bootstrap' && method === 'GET') {
    // Where people are: Cloudflare already knows the city and time zone of each connection.
    const cf = req.cf || {};
    if (cf.timezone && (cf.timezone !== user.tz || cf.city !== user.city)) {
      await env.DB.prepare('UPDATE users SET city=?, region=?, country=?, tz=?, lat=?, lon=?, loc_at=? WHERE id=?')
        .bind(cf.city || '', cf.region || '', cf.country || '', cf.timezone, +cf.latitude || null, +cf.longitude || null, now(), user.id).run();
      Object.assign(user, { city: cf.city || '', country: cf.country || '', tz: cf.timezone });
    }
    const ucols = 'u.id,u.email,u.name,u.title,u.avatar,u.color,u.role,u.active,u.city,u.country,u.tz,u.status_emoji,u.status_text,u.status_until,u.dnd_until,u.dnd_start,u.dnd_end,u.away';
    const [usersR, savedR, pushR, chans, dmR, sections, ceR] = await env.DB.batch([
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
    ]);
    const users = usersR, savedIds = savedR.results.map((r) => r.message_id), pushOn = pushR.results[0]?.n || 0;
    const dmMembers = {};
    for (const x of dmR.results) (dmMembers[x.channel_id] ||= []).push(x.user_id);
    const ce = ceR.results[0];
    return json({
      emoji: ce ? JSON.parse(ce.value) : {},
      me: (({ ...x }) => x)(user),
      workspace: { name: env.WORKSPACE_NAME || 'Yakyard' },
      users: users.results,
      channels: chans.results.map((c) => ({ ...c, members: dmMembers[c.id] })),
      sections: sections.results,
      saved: savedIds, push_key: env.VAPID_PUBLIC || '', push_devices: pushOn,
    });
  }

  // ----- browse all public channels
  if (path === '/api/channels' && method === 'GET') {
    const r = await env.DB.prepare(
      `SELECT c.id,c.name,c.topic,c.private,c.archived,(SELECT COUNT(*) FROM members m WHERE m.channel_id=c.id) members,
        EXISTS(SELECT 1 FROM members m WHERE m.channel_id=c.id AND m.user_id=?) joined
       FROM channels c WHERE c.kind='channel' AND ((c.private=0 AND ?<>'guest') OR EXISTS(SELECT 1 FROM members m WHERE m.channel_id=c.id AND m.user_id=?))
       ORDER BY c.archived, c.name`
    ).bind(user.id, user.role, user.id).all();
    return json(r.results);
  }

  // ----- create channel
  if (path === '/api/channels' && method === 'POST') {
    if (user.role === 'guest') return err(403, 'Guests cannot create channels');
    const name = String(body.name || '').toLowerCase().trim().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
    if (!name) return err(400, 'Name required');
    if (await env.DB.prepare("SELECT 1 FROM channels WHERE kind='channel' AND name=?").bind(name).first()) return err(409, 'That name is taken');
    const id = uid('C');
    await env.DB.prepare('INSERT INTO channels (id,kind,name,topic,private,created_by,created_at,last_ts) VALUES (?,?,?,?,?,?,?,?)')
      .bind(id, 'channel', name, String(body.topic || '').slice(0, 250), body.private ? 1 : 0, user.id, now(), now()).run();
    await env.DB.prepare('INSERT INTO members (channel_id,user_id,last_read,joined_at,section_id) VALUES (?,?,?,?,?)')
      .bind(id, user.id, now(), now(), body.section_id || null).run();
    const ch = await env.DB.prepare('SELECT * FROM channels WHERE id=?').bind(id).first();
    await broadcast(env, { type: 'channel_created', channel: ch }, body.private ? [user.id] : null);
    return json({ ...ch, last_read: now(), section_id: body.section_id || null, unread: 0, mentions: 0 });
  }

  // ----- DM open (1:1 or group)
  if (path === '/api/dm' && method === 'POST') {
    const ids = [...new Set([user.id, ...(body.user_ids || [])])].sort();
    if (ids.length < 1 || ids.length > 9) return err(400, 'Pick 1 to 8 people');
    const key = ids.join(',');
    let ch = await env.DB.prepare('SELECT * FROM channels WHERE dm_key=?').bind(key).first();
    if (ch && ch.archived) { await env.DB.prepare('UPDATE channels SET archived=0 WHERE id=?').bind(ch.id).run(); ch.archived = 0; }
    if (!ch) {
      const id = uid('D');
      await env.DB.prepare('INSERT INTO channels (id,kind,name,dm_key,private,created_by,created_at,last_ts) VALUES (?,?,?,?,1,?,?,?)')
        .bind(id, 'dm', '', key, user.id, now(), now()).run();
      for (const u of ids) {
        await env.DB.prepare('INSERT INTO members (channel_id,user_id,last_read,joined_at) VALUES (?,?,?,?)').bind(id, u, now(), now()).run();
      }
      ch = await env.DB.prepare('SELECT * FROM channels WHERE id=?').bind(id).first();
    }
    return json({ ...ch, members: ids, last_read: now(), unread: 0, mentions: 0 });
  }

  if ((m = path.match(/^\/api\/channels\/([^/]+)(\/.*)?$/))) {
    const cid = m[1];
    const sub = m[2] || '';
    const ch = await env.DB.prepare('SELECT * FROM channels WHERE id=?').bind(cid).first();
    if (!ch) return err(404, 'Channel not found');
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
    if (!member && !(sub === '/messages' && method === 'GET' && !priv && user.role !== 'guest')) return err(403, 'Not a member');

    if (sub === '/leave' && method === 'POST') {
      await env.DB.prepare('DELETE FROM members WHERE channel_id=? AND user_id=?').bind(cid, user.id).run();
      return json({ ok: true });
    }
    if (sub === '/members' && method === 'GET') return json(await channelMembers(env, cid));
    if (sub === '/members' && method === 'POST') {
      if (ch.kind === 'dm') return err(403, 'Start a new group message instead');
      if (user.role === 'guest') return err(403, 'Guests cannot add people');
      const ids = [...new Set((body.user_ids || []).map(String))].slice(0, 50);
      const ok = ids.length ? (await env.DB.prepare(`SELECT id FROM users WHERE active=1 AND id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all()).results.map((r) => r.id) : [];
      if (ok.length) await env.DB.batch(ok.map((u) => env.DB.prepare('INSERT OR IGNORE INTO members (channel_id,user_id,last_read,joined_at) VALUES (?,?,?,?)').bind(cid, u, 0, now())));
      body.user_ids = ok;
      const all = await channelMembers(env, cid);
      await broadcast(env, { type: 'channel_added', channel: ch, user_ids: body.user_ids || [] }, body.user_ids || []);
      return json(all);
    }
    if (sub === '' && method === 'PATCH') {
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

  if ((m = path.match(/^\/api\/messages\/([^/]+)(\/.*)?$/))) {
    const mid = m[1];
    const sub = m[2] || '';
    const msg = await env.DB.prepare('SELECT * FROM messages WHERE id=?').bind(mid).first();
    if (!msg) return err(404, 'Message not found');
    if (!(await isMember(env, msg.channel_id, user.id))) {
      const ch = await env.DB.prepare('SELECT private, kind FROM channels WHERE id=?').bind(msg.channel_id).first();
      if (!ch || ch.private || ch.kind === 'dm' || user.role === 'guest' || method !== 'GET') return err(403, 'Not a member');
    }
    const members = () => channelMembers(env, msg.channel_id);

    if (sub === '/thread' && method === 'GET') {
      const r = await env.DB.prepare('SELECT * FROM messages WHERE thread_id=? ORDER BY ts').bind(mid).all();
      return json({ parent: (await hydrateMessages(env, [msg]))[0], replies: await hydrateMessages(env, r.results) });
    }
    if (sub === '/reactions' && method === 'POST') {
      const emoji = String(body.emoji || '').slice(0, 64);
      if (!emoji) return err(400, 'Emoji required');
      const has = await env.DB.prepare('SELECT 1 FROM reactions WHERE message_id=? AND user_id=? AND emoji=?').bind(mid, user.id, emoji).first();
      if (has) await env.DB.prepare('DELETE FROM reactions WHERE message_id=? AND user_id=? AND emoji=?').bind(mid, user.id, emoji).run();
      else await env.DB.prepare('INSERT INTO reactions (message_id,user_id,emoji) VALUES (?,?,?)').bind(mid, user.id, emoji).run();
      const [full] = await hydrateMessages(env, [msg]);
      await broadcast(env, { type: 'message_changed', message: full }, await members());
      return json(full);
    }
    if (sub === '' && method === 'PATCH') {
      if (msg.deleted) return err(400, 'Deleted');
      if (msg.user_id !== user.id) return err(403, 'Only the author can edit');
      const text = String(body.text || '').slice(0, 40000);
      await env.DB.prepare('UPDATE messages SET text=?, edited_ts=? WHERE id=?').bind(text, now(), mid).run();
      const [full] = await hydrateMessages(env, [{ ...msg, text, edited_ts: now() }]);
      await broadcast(env, { type: 'message_changed', message: full }, await members());
      return json(full);
    }
    if (sub === '' && method === 'DELETE') {
      if (msg.user_id !== user.id && !['owner', 'admin'].includes(user.role)) return err(403, 'Not allowed');
      await env.DB.prepare("UPDATE messages SET deleted=1, text='', files='[]' WHERE id=?").bind(mid).run();
      const [full] = await hydrateMessages(env, [{ ...msg, deleted: 1, text: '', files: '[]' }]);
      await broadcast(env, { type: 'message_changed', message: full }, await members());
      return json(full);
    }
    return err(404, 'Not found');
  }

  // ----- sections (per person, like Slack)
  if (path === '/api/sections' && method === 'POST') {
    const max = await env.DB.prepare('SELECT COALESCE(MAX(position),-1)+1 p FROM sections WHERE user_id=?').bind(user.id).first();
    const s = { id: uid('S'), user_id: user.id, name: String(body.name || 'New section').slice(0, 60), position: max.p, collapsed: 0 };
    await env.DB.prepare('INSERT INTO sections (id,user_id,name,position) VALUES (?,?,?,?)').bind(s.id, user.id, s.name, s.position).run();
    return json(s);
  }
  if ((m = path.match(/^\/api\/sections\/([^/]+)$/))) {
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
  if (path === '/api/mentions' && method === 'GET') {
    const r = await env.DB.prepare(
      `SELECT x.* FROM mentions n JOIN messages x ON x.id=n.message_id WHERE n.user_id=? AND x.deleted=0 ORDER BY n.ts DESC LIMIT 50`
    ).bind(user.id).all();
    return json(await hydrateMessages(env, r.results));
  }

  // ----- activity: reactions to my messages
  if (path === '/api/activity/reactions' && method === 'GET') {
    const r = await env.DB.prepare(
      `SELECT x.*, r.emoji AS r_emoji, r.user_id AS r_user FROM reactions r JOIN messages x ON x.id=r.message_id
       JOIN members me ON me.channel_id=x.channel_id AND me.user_id=?
       WHERE x.user_id=? AND r.user_id<>? AND x.deleted=0 ORDER BY x.ts DESC LIMIT 60`).bind(user.id, user.id, user.id).all();
    const rows = await hydrateMessages(env, r.results);
    return json(rows.map((m, i) => ({ ...m, r_emoji: r.results[i].r_emoji, r_user: r.results[i].r_user })));
  }
  // ----- threads I started or replied to
  if (path === '/api/threads' && method === 'GET') {
    const r = await env.DB.prepare(
      `SELECT p.* FROM messages p JOIN members me ON me.channel_id=p.channel_id AND me.user_id=?
       WHERE p.reply_count>0 AND p.deleted=0 AND (p.user_id=? OR EXISTS(SELECT 1 FROM messages q WHERE q.thread_id=p.id AND q.user_id=?))
       ORDER BY p.last_reply_ts DESC LIMIT 25`).bind(user.id, user.id, user.id).all();
    const parents = await hydrateMessages(env, r.results);
    for (const p of parents) {
      const rr = await env.DB.prepare('SELECT * FROM messages WHERE thread_id=? AND deleted=0 ORDER BY ts DESC LIMIT 2').bind(p.id).all();
      p.latest = (await hydrateMessages(env, rr.results)).reverse();
    }
    return json(parents);
  }

  // ----- search
  if (path === '/api/search' && method === 'GET') {
    const q = (new URL(req.url).searchParams.get('q') || '').trim();
    if (q.length < 2) return json([]);
    const like = '%' + q.replace(/[%_]/g, '') + '%';
    const r = await env.DB.prepare(
      `SELECT x.* FROM messages x JOIN members m ON m.channel_id=x.channel_id AND m.user_id=?
       WHERE x.deleted=0 AND x.source != 'huddle' AND x.text LIKE ? ORDER BY x.ts DESC LIMIT 40`
    ).bind(user.id, like).all();
    return json(await hydrateMessages(env, r.results));
  }

  // ----- profile
  if (path === '/api/me' && method === 'PATCH') {
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
    };
    await env.DB.prepare('UPDATE users SET name=?, title=?, status_emoji=?, status_text=?, status_until=?, dnd_until=?, dnd_start=?, dnd_end=?, notify_level=?, vips=?, away=? WHERE id=?')
      .bind(upd.name, upd.title, upd.status_emoji, upd.status_text, upd.status_until, upd.dnd_until, upd.dnd_start, upd.dnd_end, upd.notify_level, upd.vips || '[]', upd.away || 0, user.id).run();
    const pub = { id: user.id, name, title, status_emoji: upd.status_emoji, status_text: upd.status_text, status_until: upd.status_until, dnd_until: upd.dnd_until, dnd_start: upd.dnd_start, dnd_end: upd.dnd_end, away: upd.away };
    await broadcast(env, { type: 'user_updated', user: pub });
    return json({ ok: true });
  }

  // ----- invites (owner/admin): pre-create a guest or teammate account
  if (path === '/api/team/places' && method === 'GET') {
    const r = await env.DB.prepare(`SELECT id, city, region, country, tz, lat, lon FROM users
      WHERE active=1 AND tz IS NOT NULL AND tz<>'' AND lat IS NOT NULL`).all();
    const places = {};
    for (const u of r.results) {
      const k = `${u.city}|${u.country}|${u.tz}`;
      (places[k] ||= { city: u.city, region: u.region, country: u.country, tz: u.tz, lat: u.lat, lon: u.lon, people: [] }).people.push(u.id);
    }
    const list = Object.values(places);
    if (list.length) {
      const key = new Request('https://weather.cache/' + list.map((p) => `${p.lat.toFixed(2)},${p.lon.toFixed(2)}`).join(';'));
      let wx = await caches.default.match(key).then((x) => x && x.json()).catch(() => null);
      if (!wx) {
        try {
          const q = `latitude=${list.map((p) => p.lat.toFixed(3)).join(',')}&longitude=${list.map((p) => p.lon.toFixed(3)).join(',')}`;
          const res = await fetch(`https://api.open-meteo.com/v1/forecast?${q}&current=temperature_2m,weather_code,is_day&timezone=auto`);
          const j = await res.json(); wx = Array.isArray(j) ? j : [j];
          await caches.default.put(key, new Response(JSON.stringify(wx), { headers: { 'cache-control': 'max-age=1200', 'content-type': 'application/json' } }));
        } catch (e) { wx = []; }
      }
      list.forEach((p, i) => { const c = wx[i]?.current; if (c) Object.assign(p, { temp: c.temperature_2m, code: c.weather_code, day: c.is_day }); });
    }
    for (const p of list) { delete p.lat; delete p.lon; }
    return json(list);
  }

  if (path === '/api/unfurl' && method === 'GET') {
    const target = new URL(req.url).searchParams.get('url') || '';
    let host = '';
    try { host = new URL(target).hostname; } catch { return err(400, 'Bad url'); }
    if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|\[)|\.local$|\.internal$|^\d+$/i.test(host)) return err(400, 'Bad url');
    const cache = caches.default;
    const key = new Request('https://unfurl.cache/' + encodeURIComponent(target));
    const hit = await cache.match(key);
    if (hit) return hit;
    const r = await Promise.race([unfurl(target), new Promise((res) => setTimeout(() => res({ ok: false }), 5000))]);
    const res = new Response(JSON.stringify(r.ok ? r.value : {}), { headers: { 'content-type': 'application/json', 'cache-control': 'max-age=86400' } });
    await cache.put(key, res.clone());
    return res;
  }

  if (path === '/api/ice' && method === 'GET') {
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
  if (path.startsWith('/api/admin/')) {
    if (!['owner', 'admin'].includes(user.role)) return err(403, 'Admins only');
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
        await env.DB.prepare('UPDATE users SET deactivated=0 WHERE id=?').bind(t.id).run();
      }
      const nu = await env.DB.prepare('SELECT id,email,name,title,avatar,color,role,active FROM users WHERE id=?').bind(t.id).first();
      await broadcast(env, { type: 'user_updated', user: nu }).catch(() => {});
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
        const target = await env.DB.prepare("SELECT kind FROM channels WHERE id=?").bind(body.channel_id).first();
        if (!target || target.kind !== 'channel') return err(400, 'Channels only');
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
    if ((m = path.match(/^\/api\/admin\/channels\/([\w]+)$/)) && method === 'PATCH') {
      if (body.archived !== undefined) await env.DB.prepare('UPDATE channels SET archived=? WHERE id=?').bind(body.archived ? 1 : 0, m[1]).run();
      if (body.private !== undefined) await env.DB.prepare('UPDATE channels SET private=? WHERE id=?').bind(body.private ? 1 : 0, m[1]).run();
      if (body.name) await env.DB.prepare('UPDATE channels SET name=? WHERE id=?').bind(String(body.name).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').slice(0, 80), m[1]).run();
      const ch = await env.DB.prepare('SELECT * FROM channels WHERE id=?').bind(m[1]).first();
      await broadcast(env, { type: 'channel_updated', channel: ch }, await channelMembers(env, ch.id));
      return json(ch);
    }
    if (path === '/api/admin/stats' && method === 'GET') {
      const r = await env.DB.prepare(`SELECT (SELECT COUNT(*) FROM messages) messages,
          (SELECT COUNT(*) FROM messages WHERE files<>'[]') with_files,
          (SELECT COUNT(*) FROM messages WHERE ts > ?) messages_7d,
          (SELECT COUNT(DISTINCT user_id) FROM sessions WHERE created_at > ?) active_7d`).bind(now() - 7 * 864e5, now() - 7 * 864e5).first();
      return json(r);
    }
    return err(404, 'Not found');
  }

  if (path === '/api/invite' && method === 'POST') {
    if (!['owner', 'admin'].includes(user.role)) return err(403, 'Only admins can invite');
    const email = String(body.email || '').toLowerCase().trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return err(400, 'Valid email required');
    const exists = await env.DB.prepare('SELECT * FROM users WHERE email=?').bind(email).first();
    if (exists) {
      if (exists.role === 'owner' && user.role !== 'owner') return err(403, 'Not allowed');
      const hasPw = await env.DB.prepare('SELECT 1 FROM credentials WHERE user_id=?').bind(exists.id).first();
      if (hasPw && user.role !== 'owner') return err(403, 'Only the owner can reset a password');
      if (hasPw) { await env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(exists.id).run(); await kick(env, exists.id); }
      await env.DB.prepare('UPDATE users SET active=1, deactivated=0 WHERE id=?').bind(exists.id).run();
      return json({ ...exists, link: await makeInviteLink(env, new URL(req.url).origin, exists.id), existing: true });
    }
    const role = body.guest ? 'guest' : 'member';
    const id = uid('U');
    await env.DB.prepare('INSERT INTO users (id,email,name,title,avatar,color,role,active,created_at) VALUES (?,?,?,?,?,?,?,1,?)')
      .bind(id, email, String(body.name || email.split('@')[0]), '', '', colorFor(email), role, now()).run();
    for (const c of body.channel_ids || []) {
      await env.DB.prepare('INSERT OR IGNORE INTO members (channel_id,user_id,last_read,joined_at) VALUES (?,?,?,?)').bind(c, id, 0, now()).run();
    }
    if (role === 'member') { await joinDefaultChannels(env, id); await ensureDefaultSections(env, id); }
    const nu = { id, email, name: String(body.name || email.split('@')[0]), title: '', avatar: '', color: colorFor(email), role, active: 1 };
    await broadcast(env, { type: 'user_updated', user: nu }).catch(() => {});
    return json({ ...nu, link: await makeInviteLink(env, new URL(req.url).origin, id) });
  }

  return err(404, 'Not found');
}

// ---------------------------------------------------------------- files (R2)
async function uploadFile(req, env, user) {
  const form = await req.formData();
  const file = form.get('file');
  if (!file || typeof file === 'string') return err(400, 'No file');
  if (file.size > 100 * 1024 * 1024) return err(413, 'Max 100 MB per file');
  const key = `${new Date().toISOString().slice(0, 7)}/${uid('F')}/${file.name.replace(/[^\w.\- ]+/g, '_')}`;
  await env.FILES.put(key, file.stream(), {
    httpMetadata: { contentType: file.type || 'application/octet-stream' },
    customMetadata: { uploader: user.id, name: file.name },
  });
  const voice = parseVoiceMeta(form);
  await env.DB.prepare('INSERT OR REPLACE INTO files (key,uploader,channel_id,created_at,voice,t_status) VALUES (?,?,NULL,?,?,?)').bind(key, user.id, now(), voice ? JSON.stringify(voice) : null, voice ? 'pending' : null).run();
  return json({ key, name: file.name, size: file.size, type: file.type || 'application/octet-stream', ...(voice ? { voice, t: 'pending' } : {}) });
}

// Big files (up to 1 GB): sent in 20 MB pieces, put back together in R2.
const BIG_MAX = 1024 * 1024 * 1024;
async function bigUpload(req, env, user, path, url) {
  const mine = async (key) => { const f = await env.DB.prepare('SELECT uploader, channel_id FROM files WHERE key=?').bind(key).first(); return f && f.uploader === user.id && !f.channel_id; };
  if (path === '/api/upload/start' && req.method === 'POST') {
    const b = await req.json().catch(() => ({}));
    const name = String(b.name || 'file').slice(0, 200), size = +b.size || 0, type = String(b.type || 'application/octet-stream').slice(0, 120);
    if (size > BIG_MAX) return err(413, 'Max 1 GB per file');
    const key = `${new Date().toISOString().slice(0, 7)}/${uid('F')}/${name.replace(/[^\w.\- ]+/g, '_')}`;
    const up = await env.FILES.createMultipartUpload(key, { httpMetadata: { contentType: type }, customMetadata: { uploader: user.id, name } });
    await env.DB.prepare('INSERT OR REPLACE INTO files (key,uploader,channel_id,created_at) VALUES (?,?,NULL,?)').bind(key, user.id, now()).run();
    return json({ key, upload_id: up.uploadId });
  }
  if (path === '/api/upload/part' && req.method === 'PUT') {
    const key = url.searchParams.get('key') || '', id = url.searchParams.get('id') || '', n = parseInt(url.searchParams.get('n') || '0', 10);
    if (!key || !id || !(n >= 1 && n <= 10000) || !(await mine(key))) return err(403, 'Not allowed');
    const body = await req.arrayBuffer();
    if (body.byteLength > 30 * 1024 * 1024) return err(413, 'Piece too big');
    const part = await env.FILES.resumeMultipartUpload(key, id).uploadPart(n, body);
    return json({ partNumber: part.partNumber, etag: part.etag });
  }
  if (path === '/api/upload/finish' && req.method === 'POST') {
    const b = await req.json().catch(() => ({}));
    if (!b.key || !b.upload_id || !Array.isArray(b.parts) || !(await mine(b.key))) return err(403, 'Not allowed');
    const up = env.FILES.resumeMultipartUpload(b.key, b.upload_id);
    if (b.cancel) { try { await up.abort(); } catch {} await env.DB.prepare('DELETE FROM files WHERE key=?').bind(b.key).run(); return json({ ok: true }); }
    const obj = await up.complete(b.parts.map((x) => ({ partNumber: +x.partNumber, etag: String(x.etag) })));
    if (obj.size > BIG_MAX) { await env.FILES.delete(b.key); return err(413, 'Max 1 GB per file'); }
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
const SAFE_INLINE = /^(image\/(png|jpe?g|gif|webp|heic|heif)|video\/(mp4|webm|quicktime)|audio\/[\w.+-]+|application\/pdf)$/i;
async function serveFile(req, env, key) {
  const url = new URL(req.url);
  const wq = parseInt(url.searchParams.get('w') || '0', 10) || 0;
  const w = wq ? [96, 880, 1600].find((x) => x >= wq) || 1600 : 0;
  // Small preview for chat: made once with Cloudflare Images, then kept in R2.
  if (w && env.IMAGES && /\.(png|jpe?g|webp|heic|heif|bmp|tiff?)$/i.test(key)) {
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
      } catch (e) { /* fall back to the original */ }
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

// ---------------------------------------------------------------- worker entry
export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(cronTick(env, ctx, postMessage, runImports));
    ctx.waitUntil(voiceCron(env, { hydrateMessages, broadcast, channelMembers }).catch((e) => console.log('voice cron', e)));
  },
  async fetch(req, env, ctx) {
    const res = await handle(req, env, ctx);
    return res;
  },
};
async function handle(req, env0, ctx) {
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
async function route(req, env, ctx, url, path) {

    globalThis.__googleOn = !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_ENABLED === '1');
    globalThis.__wsName = env.WORKSPACE_NAME || 'Yakyard';
    if (path === '/auth/login' && req.method === 'POST') {
      const o = req.headers.get('origin');
      if (o && o !== url.origin) return err(403, 'Bad origin');
      return passwordLogin(req, env);
    }
    if (path.startsWith('/join/')) {
      const o = req.headers.get('origin');
      if (req.method === 'POST' && o && o !== url.origin) return err(403, 'Bad origin');
      return joinPage(req, env, path.slice(6));
    }
    if (path === '/auth/google') return googleStart(req, env);
    if (path === '/auth/callback') return googleCallback(req, env);
    // Local testing only: needs DEV_LOGIN=1 AND a localhost address. Never reachable on the live site.
    if (path === '/auth/dev' && env.DEV_LOGIN === '1' && ['127.0.0.1', 'localhost'].includes(url.hostname)) {
      const u = await findOrCreateUser(env, { email: url.searchParams.get('email') || '', name: url.searchParams.get('name') || '' });
      if (!u) return loginPage('No access');
      return new Response(null, { status: 302, headers: { location: '/', 'set-cookie': setCookie('pwc_session', await createSession(env, u.id), SESSION_DAYS * 86400, false) } });
    }
    if (path === '/auth/logout') {
      const sid = cookie(req, 'pwc_session');
      if (sid) await env.DB.prepare('DELETE FROM sessions WHERE id=?').bind(sid).run();
      return new Response(null, { status: 302, headers: { location: '/', 'set-cookie': setCookie('pwc_session', '', 0, isSecure(req)) } });
    }

    const isStatic = !path.startsWith('/files/') && /\.(css|js|woff2|png|svg|ico|webmanifest|json)$/.test(path);
    if (isStatic) return env.ASSETS.fetch(req);

    if (path === '/setup') return setupPage(req, env);
    const user = await currentUser(req, env);
    if (!user) {
      if (path.startsWith('/api/') || path === '/ws' || path.startsWith('/files/')) return err(401, 'Sign in required');
      if (!(await env.DB.prepare('SELECT 1 FROM users LIMIT 1').first())) return new Response(null, { status: 302, headers: { location: '/setup' } });
      return loginPage();
    }

    // Same-origin check on writes (blocks cross-site form posts).
    if (!['GET', 'HEAD'].includes(req.method)) {
      const origin = req.headers.get('origin');
      if (origin && origin !== url.origin) return err(403, 'Bad origin');
    }

    if (path === '/ws') {
      if (req.headers.get('upgrade') !== 'websocket') return err(426, 'WebSocket required');
      const hub = env.HUB.get(env.HUB.idFromName('workspace'));
      const fwd = new Request('https://hub/ws', req);
      fwd.headers.set('x-user-id', user.id);
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
    if (path === '/api/me/avatar' && req.method === 'POST') return (await featureApi(req, env, user, path, 'POST', {}, { postMessage, hydrateMessages, broadcast, isMember, channelMembers, ctx })) || err(404, 'Not found');
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
        console.error(e);
        return err(500, 'Something went wrong');
      }
    }
    // The app shell
    const shell = await env.ASSETS.fetch(new Request(new URL('/', url), req));
    const hs = new Headers(shell.headers);
    hs.set('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data: blob:; media-src 'self' blob:; connect-src 'self' wss:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    hs.set('x-content-type-options', 'nosniff'); hs.set('referrer-policy', 'same-origin');
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
      pair[1].serializeAttachment({ userId, sid: crypto.randomUUID().slice(0, 12) });
      this.broadcastPresence();
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

  online() {
    return [...new Set(this.ctx.getWebSockets().map((ws) => ws.deserializeAttachment()?.userId).filter(Boolean))];
  }
  broadcastPresence() {
    const data = JSON.stringify({ type: 'presence', online: this.online() });
    for (const ws of this.ctx.getWebSockets()) { try { ws.send(data); } catch (e) {} }
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
      ws.serializeAttachment({ userId: a.userId, sid: a.sid });
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
    if (msg.type === 'typing' && msg.channel_id && Array.isArray(msg.to)) {
      // Client sends the channel's member list; we only relay to those people.
      const data = JSON.stringify({ type: 'typing', channel_id: msg.channel_id, thread_id: msg.thread_id || null, user_id: from });
      for (const u of msg.to.slice(0, 200)) {
        if (u === from) continue;
        for (const s of this.ctx.getWebSockets(u)) { try { s.send(data); } catch (e) {} }
      }
    }
  }
  async webSocketClose(ws) { const was = this.att(ws).huddle; ws.serializeAttachment({}); this.broadcastPresence(); if (was) { this.broadcastHuddles(); await this.afterLeave(was); } }
  async webSocketError(ws) { const was = this.att(ws).huddle; ws.serializeAttachment({}); this.broadcastPresence(); if (was) { this.broadcastHuddles(); await this.afterLeave(was); } }
}
