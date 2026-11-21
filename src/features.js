// Yakyard features: phone push, status, do-not-disturb, saved, pins, reminders,
// scheduled sends, full-text search, files browser, and the once-a-minute clock.
import { buildPushHTTPRequest } from '@pushforge/builder';

const now = () => Date.now();
const uid = (p = '') => p + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const err = (status, message) => json({ error: message }, status);
export const PUSH_EMPTY = 0;

// ---------------------------------------------------------------- push
const plain = (t, names) => String(t || '')
  .replace(/<@(U\w+)>/g, (_, id) => '@' + (names[id] || 'someone'))
  .replace(/<!(channel|here|everyone)>/g, '@$1')
  .replace(/<#\w+\|([^>]+)>/g, '#$1')
  .replace(/<([^>|]+)\|([^>]+)>/g, '$2').replace(/<([^>]+)>/g, '$1')
  .replace(/[*_~`]/g, '').slice(0, 180);

function hhmm(tz) {
  try { return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: tz || 'UTC' }).format(new Date()); } catch { return ''; }
}
export function inDnd(u) {
  if (u.dnd_until && u.dnd_until > now()) return true;
  if (!u.dnd_start || !u.dnd_end || u.dnd_start === u.dnd_end) return false;
  const t = hhmm(u.tz);
  return u.dnd_start < u.dnd_end ? t >= u.dnd_start && t < u.dnd_end : t >= u.dnd_start || t < u.dnd_end;
}

async function activeUsers(env) {
  try { return new Set(await (await env.HUB.get(env.HUB.idFromName('workspace')).fetch('https://hub/active')).json()); } catch { return new Set(); }
}

async function pushOne(env, sub, payload) {
  if (!env.VAPID_PRIVATE) return 0;
  const { endpoint, headers, body } = await buildPushHTTPRequest({
    privateJWK: JSON.parse(env.VAPID_PRIVATE),
    subscription: { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
    message: { payload, adminContact: env.VAPID_SUBJECT || env.APP_URL || 'mailto:admin@example.com', options: { ttl: 3600, urgency: 'high', topic: String(payload.tag || '').slice(0, 32).replace(/[^\w-]/g, '') || undefined } },
  });
  const r = await fetch(endpoint, { method: 'POST', headers, body });
  if (r.status === 404 || r.status === 410) await env.DB.prepare('DELETE FROM push_subs WHERE endpoint=?').bind(sub.endpoint).run();
  return r.ok ? 1 : 0;
}

export async function pushToUsers(env, userIds, payload) {
  if (!userIds.length) return 0;
  const want = new Set(userIds);
  const subs = (await env.DB.prepare('SELECT * FROM push_subs').all()).results.filter((x) => want.has(x.user_id));
  const res = await Promise.allSettled(subs.map((s) => pushOne(env, s, payload)));
  return res.filter((x) => x.status === 'fulfilled' && x.value).length;
}

// Who gets a phone buzz for a new message. Same rules as Slack's defaults:
// DMs, @mentions and replies in threads you're in. "All messages" adds every channel message.
// Muted channels only buzz for a direct @mention. Do-not-disturb and people looking at Yakyard get nothing.
export async function sendPushes(env, { msg, ch, sender, members, direct, wide, followers, parent }) {
  followers = followers.filter((u) => members.includes(u)); // never notify people who left
  const cand = new Set([...members, ...followers]); cand.delete(sender.id);
  if (!cand.size) return;
  // Only people with a phone or computer signed up for pushes (a small list), so no long IN() lists.
  const users = (await env.DB.prepare(`SELECT u.id,u.notify_level,u.dnd_until,u.dnd_start,u.dnd_end,u.tz,u.vips,m.muted FROM users u LEFT JOIN members m ON m.user_id=u.id AND m.channel_id=?
    WHERE u.active=1 AND u.id IN (SELECT DISTINCT user_id FROM push_subs)`).bind(ch.id).all()).results.filter((u) => cand.has(u.id));
  if (!users.length) return;
  const active = await activeUsers(env);
  const targets = users.filter((u) => {
    const lvl = u.notify_level || 'mentions';
    const isDirect = direct.includes(u.id);
    let vip = false; try { vip = JSON.parse(u.vips || '[]').includes(sender.id) && (ch.kind === 'dm' || isDirect); } catch {}
    if (lvl === 'none' || active.has(u.id) || (inDnd(u) && !vip)) return false;
    if (u.muted) return isDirect;
    if (ch.kind === 'dm' || isDirect || (wide && members.includes(u.id)) || followers.includes(u.id)) return true;
    return lvl === 'all' && members.includes(u.id) && !msg.thread_id;
  }).map((u) => u.id);
  if (!targets.length) return;
  const nameRows = (await env.DB.prepare('SELECT id,name FROM users').all()).results;
  const names = Object.fromEntries(nameRows.map((r) => [r.id, r.name]));
  let title = sender.name;
  if (ch.kind !== 'dm') title += ` in #${ch.name}`;
  else if (members.length > 2) title += ' (group)';
  if (msg.thread_id) title = `${sender.name} replied in a thread` + (ch.kind === 'dm' ? '' : ` in #${ch.name}`);
  const body = plain(msg.text, names) || (msg.files?.length ? `Sent ${msg.files.length > 1 ? msg.files.length + ' files' : 'a file'}` : '');
  await pushToUsers(env, targets, {
    title, body, tag: msg.thread_id || ch.id, icon: '/brand/icon-192.png', badge: '/brand/favicon-64.png',
    data: { url: `/#/c/${ch.id}${msg.thread_id ? '/t/' + msg.thread_id : ''}`, id: msg.id },
  });
}

// ---------------------------------------------------------------- message extras
export async function hydrateExtras(env, ids) {
  const pins = {};
  for (let i = 0; i < ids.length; i += 90) {
    const chunk = ids.slice(i, i + 90);
    const r = await env.DB.prepare(`SELECT message_id, user_id FROM pins WHERE message_id IN (${chunk.map(() => '?').join(',')})`).bind(...chunk).all();
    for (const x of r.results) pins[x.message_id] = x.user_id;
  }
  return { pins };
}

// ---------------------------------------------------------------- search
const SEARCH_LIMIT = 40;
function parseQuery(q) {
  const f = { words: [], from: [], in: [], has: [], before: 0, after: 0, on: 0 };
  for (const tok of q.match(/"[^"]+"|\S+/g) || []) {
    const m = tok.match(/^(from|in|has|before|after|on|during):(.+)$/i);
    if (!m) { f.words.push(tok.replace(/"/g, '')); continue; }
    const [, k, v] = m; const key = k.toLowerCase();
    if (key === 'from') f.from.push(v.replace(/^@/, '').toLowerCase());
    else if (key === 'in') f.in.push(v.replace(/^#/, '').toLowerCase());
    else if (key === 'has') f.has.push(v.toLowerCase());
    else {
      const d = Date.parse(v.length === 7 ? v + '-01' : v);
      if (!isNaN(d)) {
        if (key === 'before') f.before = d;
        else if (key === 'after') f.after = d + 864e5;
        else { f.after = d; f.before = d + (v.length === 7 ? 31 : 1) * 864e5; }
      }
    }
  }
  return f;
}
async function search(env, user, q, hydrate) {
  const f = parseQuery(q);
  const where = ['x.deleted=0', "x.source != 'huddle'"], args = [user.id];
  let join = '';
  const words = f.words.map((w) => w.replace(/[^\p{L}\p{N}'@.\-]/gu, ' ').trim()).filter(Boolean);
  if (words.length) {
    const match = words.flatMap((w) => w.split(/\s+/)).filter(Boolean).map((w) => `"${w.replace(/"/g, '')}"*`).join(' ');
    // Words match the message text or what was said in a voice note.
    where.push('x.rowid IN (SELECT rowid FROM messages_fts WHERE messages_fts MATCH ?) OR x.id IN (SELECT message_id FROM voice_fts WHERE voice_fts MATCH ?)'); args.push(match, match);
  }
  if (f.from.length) {
    const ids = [];
    for (const n of f.from) {
      if (n === 'me') { ids.push(user.id); continue; }
      const r = await env.DB.prepare("SELECT id FROM users WHERE lower(name) LIKE ? OR lower(email) LIKE ?").bind(n + '%', n + '%').all();
      ids.push(...r.results.map((x) => x.id));
    }
    if (!ids.length) return [];
    where.push(`x.user_id IN (${ids.map(() => '?').join(',')})`); args.push(...ids);
  }
  if (f.in.length) {
    const r = await env.DB.prepare(`SELECT id FROM channels WHERE lower(name) IN (${f.in.map(() => '?').join(',')})`).bind(...f.in).all();
    if (!r.results.length) return [];
    where.push(`x.channel_id IN (${r.results.map(() => '?').join(',')})`); args.push(...r.results.map((x) => x.id));
  }
  for (const h of f.has) {
    if (h === 'file' || h === 'files') where.push("x.files != '[]'");
    else if (h === 'image' || h === 'images') where.push("x.files LIKE '%\"type\": \"image/%' OR x.files LIKE '%\"type\":\"image/%'");
    else if (h === 'voice' || h === 'audio') where.push("x.files LIKE '%\"voice\":%'");
    else if (h === 'link' || h === 'links') where.push("x.text LIKE '%<http%'");
    else if (h === 'pin' || h === 'pins') where.push('x.id IN (SELECT message_id FROM pins)');
    else if (h === 'reaction' || h === 'reactions') where.push('x.id IN (SELECT message_id FROM reactions)');
  }
  if (f.before) { where.push('x.ts < ?'); args.push(f.before); }
  if (f.after) { where.push('x.ts >= ?'); args.push(f.after); }
  if (!words.length && !f.from.length && !f.in.length && !f.has.length && !f.before && !f.after) return [];
  const sql = `SELECT x.* FROM messages x ${join} JOIN members m ON m.channel_id=x.channel_id AND m.user_id=?
    WHERE ${where.map((w) => '(' + w + ')').join(' AND ')} ORDER BY x.ts DESC LIMIT ${SEARCH_LIMIT}`;
  const r = await env.DB.prepare(sql).bind(...args).all();
  return hydrate(env, r.results);
}

// ---------------------------------------------------------------- reminders / scheduled
async function slackbotId(env) {
  let b = await env.DB.prepare("SELECT id FROM users WHERE email='uslackbot@bot.local'").first();
  if (b) return b.id;
  const id = uid('U');
  await env.DB.prepare("INSERT INTO users (id,email,name,role,active,created_at,color) VALUES (?,?,?,?,1,?,?)").bind(id, 'uslackbot@bot.local', 'Slackbot', 'member', now(), '#4a154b').run();
  return id;
}
async function dmWith(env, a, b) {
  const ids = [...new Set([a, b])].sort(); const key = ids.join(',');
  let ch = await env.DB.prepare('SELECT * FROM channels WHERE dm_key=?').bind(key).first();
  if (!ch) {
    const id = uid('D');
    await env.DB.prepare("INSERT INTO channels (id,kind,name,dm_key,private,created_by,created_at,last_ts) VALUES (?,'dm','',?,1,?,?,?)").bind(id, key, a, now(), now()).run();
    for (const u of ids) await env.DB.prepare('INSERT OR IGNORE INTO members (channel_id,user_id,last_read,joined_at) VALUES (?,?,?,?)').bind(id, u, 0, now()).run();
    ch = await env.DB.prepare('SELECT * FROM channels WHERE id=?').bind(id).first();
  }
  if (ch.archived) await env.DB.prepare('UPDATE channels SET archived=0 WHERE id=?').bind(ch.id).run();
  return ch;
}

export async function cronTick(env, ctx, postMessage, runImports) {
  const t = now();
  if (runImports) await runImports(env).catch((e) => console.log('imports', e));
  // scheduled messages
  const due = (await env.DB.prepare('SELECT * FROM scheduled WHERE send_at <= ? ORDER BY send_at LIMIT 25').bind(t).all()).results;
  for (const s of due) {
    await env.DB.prepare('DELETE FROM scheduled WHERE id=?').bind(s.id).run();
    const user = await env.DB.prepare('SELECT * FROM users WHERE id=? AND active=1').bind(s.user_id).first();
    const ch = await env.DB.prepare('SELECT * FROM channels WHERE id=?').bind(s.channel_id).first();
    const member = user && ch && (await env.DB.prepare('SELECT 1 FROM members WHERE channel_id=? AND user_id=?').bind(ch.id, user.id).first());
    if (!member) continue;
    try { await postMessage(env, ctx, user, ch, { text: s.text, files: JSON.parse(s.files || '[]'), thread_id: s.thread_id, also_channel: s.also_channel }); } catch (e) { console.log('scheduled send failed', e); }
  }
  // reminders, delivered by Slackbot like Slack does
  const rem = (await env.DB.prepare('SELECT * FROM reminders WHERE done=0 AND due_at <= ? ORDER BY due_at LIMIT 25').bind(t).all()).results;
  if (rem.length) {
    const botId = await slackbotId(env);
    const bot = await env.DB.prepare('SELECT * FROM users WHERE id=?').bind(botId).first();
    for (const r of rem) {
      await env.DB.prepare('UPDATE reminders SET done=1 WHERE id=?').bind(r.id).run();
      const ch = await dmWith(env, botId, r.user_id);
      const link = r.message_id ? ` <${env.APP_URL || ''}/#/m/${r.message_id}|View message>` : '';
      try { await postMessage(env, ctx, bot, ch, { text: `⏰ Reminder: ${r.text || 'this message'}${link}` }); } catch (e) { console.log('reminder failed', e); }
    }
  }
  // housekeeping, once an hour
  if (new Date(t).getUTCMinutes() === 7) {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(t),
      env.DB.prepare('DELETE FROM invites WHERE expires_at < ?').bind(t),
      env.DB.prepare("UPDATE users SET status_emoji='', status_text='', status_until=0 WHERE status_until > 0 AND status_until < ?").bind(t),
      env.DB.prepare('UPDATE users SET dnd_until=0 WHERE dnd_until > 0 AND dnd_until < ?').bind(t),
      // Sign-in counters only matter for the current 15-minute window.
      env.DB.prepare('DELETE FROM login_attempts WHERE k NOT LIKE ?').bind('%|' + Math.floor(t / (15 * 60e3))),
    ]);
  }
}

// ---------------------------------------------------------------- API routes
export async function featureApi(req, env, user, path, method, body, x) {
  const { hydrateMessages: hydrate, broadcast, isMember, postMessage, ctx } = x;
  let m;
  const url = new URL(req.url);

  // push devices
  if (path === '/api/push/subscribe' && method === 'POST') {
    const ep = String(body.endpoint || ''), k = body.keys || {};
    // Only the browsers' own push services, so the worker can't be pointed at any other address.
    const host = (() => { try { const u = new URL(ep); return u.protocol === 'https:' ? u.hostname : ''; } catch { return ''; } })();
    if (!/(^|\.)(fcm\.googleapis\.com|push\.services\.mozilla\.com|notify\.windows\.com|push\.apple\.com)$/.test(host) || !k.p256dh || !k.auth) return err(400, 'Bad subscription');
    await env.DB.prepare('INSERT OR REPLACE INTO push_subs (endpoint,user_id,p256dh,auth,ua,created_at) VALUES (?,?,?,?,?,?)')
      .bind(ep, user.id, String(k.p256dh), String(k.auth), String(req.headers.get('user-agent') || '').slice(0, 200), now()).run();
    return json({ ok: true });
  }
  if (path === '/api/push/unsubscribe' && method === 'POST') {
    await env.DB.prepare('DELETE FROM push_subs WHERE endpoint=? AND user_id=?').bind(String(body.endpoint || ''), user.id).run();
    return json({ ok: true });
  }
  if (path === '/api/push/test' && method === 'POST') {
    const n = await pushToUsers(env, [user.id], { title: 'Yakyard', body: 'Notifications are on. This is how they will look.', tag: 'test', icon: '/brand/icon-192.png', data: { url: '/' } });
    return json({ sent: n });
  }
  if (path === '/api/prefs' && method === 'GET') {
    const devices = (await env.DB.prepare('SELECT ua, created_at FROM push_subs WHERE user_id=? ORDER BY created_at DESC').bind(user.id).all()).results;
    return json({ vips: user.vips || '[]', notify_level: user.notify_level || 'mentions', dnd_until: user.dnd_until || 0, dnd_start: user.dnd_start || '', dnd_end: user.dnd_end || '', devices });
  }

  // saved for later
  if ((m = path.match(/^\/api\/messages\/([^/]+)\/save$/)) && method === 'POST') {
    const has = await env.DB.prepare('SELECT done FROM saved WHERE user_id=? AND message_id=?').bind(user.id, m[1]).first();
    if (has && !has.done && !body.done) { await env.DB.prepare('DELETE FROM saved WHERE user_id=? AND message_id=?').bind(user.id, m[1]).run(); return json({ saved: false }); }
    if (body.done) { await env.DB.prepare('UPDATE saved SET done=1 WHERE user_id=? AND message_id=?').bind(user.id, m[1]).run(); return json({ saved: false, done: true }); }
    const msg = await env.DB.prepare('SELECT channel_id FROM messages WHERE id=?').bind(m[1]).first();
    if (!msg || !(await isMember(env, msg.channel_id, user.id))) return err(403, 'Not a member');
    await env.DB.prepare('INSERT OR REPLACE INTO saved (user_id,message_id,created_at,done) VALUES (?,?,?,0)').bind(user.id, m[1], now()).run();
    return json({ saved: true });
  }

  // pins
  if ((m = path.match(/^\/api\/messages\/([^/]+)\/pin$/)) && method === 'POST') {
    const msg = await env.DB.prepare('SELECT * FROM messages WHERE id=?').bind(m[1]).first();
    if (!msg || msg.deleted) return err(404, 'Message not found');
    if (!(await isMember(env, msg.channel_id, user.id))) return err(403, 'Not a member');
    if (user.role === 'guest') return err(403, 'Guests cannot pin');
    const has = await env.DB.prepare('SELECT 1 FROM pins WHERE message_id=?').bind(msg.id).first();
    if (has) await env.DB.prepare('DELETE FROM pins WHERE message_id=?').bind(msg.id).run();
    else await env.DB.prepare('INSERT INTO pins (channel_id,message_id,user_id,created_at) VALUES (?,?,?,?)').bind(msg.channel_id, msg.id, user.id, now()).run();
    const [full] = await hydrate(env, [msg]);
    await broadcast(env, { type: 'message_changed', message: full }, await x.channelMembers(env, msg.channel_id));
    return json(full);
  }
  if ((m = path.match(/^\/api\/channels\/([^/]+)\/pins$/)) && method === 'GET') {
    if (!(await isMember(env, m[1], user.id))) return err(403, 'Not a member');
    const r = await env.DB.prepare('SELECT x.* FROM pins p JOIN messages x ON x.id=p.message_id WHERE p.channel_id=? AND x.deleted=0 ORDER BY p.created_at DESC').bind(m[1]).all();
    return json(await hydrate(env, r.results));
  }

  // Later: saved + reminders + scheduled in one page
  if (path === '/api/later' && method === 'GET') {
    const sv = await env.DB.prepare(`SELECT x.*, s.created_at AS saved_at FROM saved s JOIN messages x ON x.id=s.message_id JOIN members me ON me.channel_id=x.channel_id AND me.user_id=?
      WHERE s.user_id=? AND s.done=0 AND x.deleted=0 ORDER BY s.created_at DESC LIMIT 100`).bind(user.id, user.id).all();
    const rm = await env.DB.prepare('SELECT * FROM reminders WHERE user_id=? AND done=0 ORDER BY due_at').bind(user.id).all();
    const sc = await env.DB.prepare('SELECT * FROM scheduled WHERE user_id=? ORDER BY send_at').bind(user.id).all();
    const saved = await hydrate(env, sv.results);
    saved.forEach((s, i) => (s.saved_at = sv.results[i].saved_at));
    return json({ saved, reminders: rm.results, scheduled: sc.results.map((s) => ({ ...s, files: JSON.parse(s.files || '[]') })) });
  }
  if (path === '/api/reminders' && method === 'POST') {
    const due = +body.due_at;
    if (!due || due < now() - 60e3) return err(400, 'Pick a time in the future');
    if (body.message_id) {
      const msg = await env.DB.prepare('SELECT channel_id FROM messages WHERE id=?').bind(String(body.message_id)).first();
      if (!msg || !(await isMember(env, msg.channel_id, user.id))) return err(403, 'Not a member');
    }
    const r = { id: uid('R'), user_id: user.id, message_id: body.message_id || null, text: String(body.text || '').slice(0, 500), due_at: due, done: 0 };
    await env.DB.prepare('INSERT INTO reminders (id,user_id,message_id,text,due_at) VALUES (?,?,?,?,?)').bind(r.id, r.user_id, r.message_id, r.text, r.due_at).run();
    return json(r);
  }
  if ((m = path.match(/^\/api\/reminders\/([^/]+)$/))) {
    if (method === 'DELETE') { await env.DB.prepare('DELETE FROM reminders WHERE id=? AND user_id=?').bind(m[1], user.id).run(); return json({ ok: true }); }
    if (method === 'PATCH') { await env.DB.prepare('UPDATE reminders SET due_at=? WHERE id=? AND user_id=?').bind(+body.due_at || now(), m[1], user.id).run(); return json({ ok: true }); }
  }
  if (path === '/api/scheduled' && method === 'POST') {
    const at = +body.send_at;
    if (!at || at < now() + 30e3) return err(400, 'Pick a time in the future');
    const ch = await env.DB.prepare('SELECT * FROM channels WHERE id=?').bind(String(body.channel_id || '')).first();
    if (!ch || !(await isMember(env, ch.id, user.id))) return err(403, 'Not a member');
    const text = String(body.text || '').slice(0, 40000);
    const files = Array.isArray(body.files) ? body.files.slice(0, 10) : [];
    if (!text.trim() && !files.length) return err(400, 'Empty message');
    const s = { id: uid('Q'), user_id: user.id, channel_id: ch.id, thread_id: body.thread_id || null, text, files: JSON.stringify(files), also_channel: body.also_channel ? 1 : 0, send_at: at, created_at: now() };
    await env.DB.prepare('INSERT INTO scheduled (id,user_id,channel_id,thread_id,text,files,also_channel,send_at,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .bind(s.id, s.user_id, s.channel_id, s.thread_id, s.text, s.files, s.also_channel, s.send_at, s.created_at).run();
    return json({ ...s, files });
  }
  if ((m = path.match(/^\/api\/scheduled\/([^/]+)$/))) {
    const s = await env.DB.prepare('SELECT * FROM scheduled WHERE id=? AND user_id=?').bind(m[1], user.id).first();
    if (!s) return err(404, 'Already sent or deleted');
    if (method === 'DELETE') { await env.DB.prepare('DELETE FROM scheduled WHERE id=?').bind(s.id).run(); return json({ ok: true }); }
    if (method === 'PATCH') {
      if (body.send_now) {
        const ch = await env.DB.prepare('SELECT * FROM channels WHERE id=?').bind(s.channel_id).first();
        if (!ch || !(await isMember(env, ch.id, user.id))) return err(403, 'Not a member');
        await env.DB.prepare('DELETE FROM scheduled WHERE id=?').bind(s.id).run();
        return postMessage(env, ctx, user, ch, { text: s.text, files: JSON.parse(s.files || '[]'), thread_id: s.thread_id, also_channel: s.also_channel });
      }
      await env.DB.prepare('UPDATE scheduled SET send_at=?, text=? WHERE id=?').bind(+body.send_at || s.send_at, body.text != null ? String(body.text).slice(0, 40000) : s.text, s.id).run();
      return json({ ok: true });
    }
  }

  // search with filters: from:@name in:#channel has:file|link|image|pin before:/after:/on:YYYY-MM-DD
  if (path === '/api/search' && method === 'GET') {
    const q = (url.searchParams.get('q') || '').trim();
    if (q.length < 2) return json([]);
    try { return json(await search(env, user, q, hydrate)); }
    catch (e) {
      console.log('fts failed, falling back', e);
      const like = '%' + q.replace(/[%_]/g, '') + '%';
      const r = await env.DB.prepare(`SELECT x.* FROM messages x JOIN members m ON m.channel_id=x.channel_id AND m.user_id=? WHERE x.deleted=0 AND x.text LIKE ? ORDER BY x.ts DESC LIMIT 40`).bind(user.id, like).all();
      return json(await hydrate(env, r.results));
    }
  }

  // threads I started or replied to (one pass, no per-row subquery)
  if (path === '/api/threads' && method === 'GET') {
    const r = await env.DB.prepare(
      `WITH mine AS (SELECT DISTINCT thread_id AS id FROM messages WHERE user_id=? AND thread_id IS NOT NULL
         UNION SELECT id FROM messages WHERE user_id=? AND reply_count>0)
       SELECT p.* FROM messages p JOIN mine ON mine.id=p.id JOIN members me ON me.channel_id=p.channel_id AND me.user_id=?
       WHERE p.reply_count>0 AND p.deleted=0 ORDER BY p.last_reply_ts DESC LIMIT 25`).bind(user.id, user.id, user.id).all();
    const parents = await hydrate(env, r.results);
    if (parents.length) {
      const ids = parents.map((p) => p.id);
      const rr = await env.DB.prepare(`SELECT * FROM (SELECT x.*, ROW_NUMBER() OVER (PARTITION BY thread_id ORDER BY ts DESC) rn FROM messages x
        WHERE x.thread_id IN (${ids.map(() => '?').join(',')}) AND x.deleted=0) WHERE rn<=2`).bind(...ids).all();
      const replies = await hydrate(env, rr.results);
      for (const p of parents) p.latest = replies.filter((x) => x.thread_id === p.id).sort((a, b) => a.ts - b.ts);
    }
    return json(parents);
  }

  // files browser
  if (path === '/api/files' && method === 'GET') {
    const before = +url.searchParams.get('before') || 9e15;
    const type = url.searchParams.get('type') || '';
    const cid = url.searchParams.get('channel') || '';
    const q = (url.searchParams.get('q') || '').toLowerCase();
    const mine = url.searchParams.get('mine') === '1';
    const where = ["x.files != '[]'", 'x.deleted=0', 'x.ts < ?'], args = [user.id, before];
    if (cid) { where.push('x.channel_id=?'); args.push(cid); }
    if (mine) { where.push('x.user_id=?'); args.push(user.id); }
    if (q) { where.push('lower(x.files) LIKE ?'); args.push('%' + q.replace(/[%_]/g, '') + '%'); }
    const r = await env.DB.prepare(`SELECT x.id,x.channel_id,x.user_id,x.ts,x.thread_id,x.files FROM messages x JOIN members m ON m.channel_id=x.channel_id AND m.user_id=?
      WHERE ${where.join(' AND ')} ORDER BY x.ts DESC LIMIT 60`).bind(...args).all();
    const out = [];
    for (const row of r.results) {
      for (const f of JSON.parse(row.files || '[]')) {
        const kind = /^image\//.test(f.type) ? 'image' : /^video\//.test(f.type) ? 'video' : /^audio\//.test(f.type) ? 'audio' : /pdf|word|document|sheet|excel|presentation|powerpoint|text\//.test(f.type) || /\.(pdf|docx?|xlsx?|pptx?|csv|txt|key|numbers|pages)$/i.test(f.name) ? 'doc' : 'other';
        if (type && type !== kind) continue;
        if (q && !String(f.name).toLowerCase().includes(q)) continue;
        out.push({ ...f, kind, message_id: row.id, channel_id: row.channel_id, user_id: row.user_id, ts: row.ts, thread_id: row.thread_id });
      }
    }
    return json({ files: out, next: r.results.length === 60 ? r.results[r.results.length - 1].ts : null });
  }


  // ---------- channel management (admins, owners, or whoever created the channel)
  if ((m = path.match(/^\/api\/channels\/([^/]+)\/manage$/)) && method === 'POST') {
    const ch = await env.DB.prepare("SELECT * FROM channels WHERE id=? AND kind='channel'").bind(m[1]).first();
    if (!ch) return err(404, 'Channel not found');
    const admin = ['owner', 'admin'].includes(user.role);
    if (!admin && ch.created_by !== user.id) return err(403, 'Only admins or the person who made this channel can change it');
    if (ch.name === 'general' && (body.archived || body.delete || body.name)) return err(403, '#general stays as it is');
    if (body.delete) {
      if (!admin) return err(403, 'Only admins can delete channels');
      const mem = await x.channelMembers(env, ch.id);
      await env.DB.batch([
        env.DB.prepare('DELETE FROM reactions WHERE message_id IN (SELECT id FROM messages WHERE channel_id=?)').bind(ch.id),
        env.DB.prepare('DELETE FROM mentions WHERE channel_id=?').bind(ch.id),
        env.DB.prepare('DELETE FROM pins WHERE channel_id=?').bind(ch.id),
        env.DB.prepare('DELETE FROM messages WHERE channel_id=?').bind(ch.id),
        env.DB.prepare('DELETE FROM members WHERE channel_id=?').bind(ch.id),
        env.DB.prepare('DELETE FROM channels WHERE id=?').bind(ch.id),
      ]);
      await broadcast(env, { type: 'channel_removed', channel_id: ch.id }, mem);
      return json({ ok: true });
    }
    if (body.name != null) {
      const name = String(body.name).toLowerCase().trim().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
      if (!name) return err(400, 'Name required');
      if (await env.DB.prepare("SELECT 1 FROM channels WHERE kind='channel' AND name=? AND id<>?").bind(name, ch.id).first()) return err(409, 'That name is taken');
      await env.DB.prepare('UPDATE channels SET name=? WHERE id=?').bind(name, ch.id).run();
    }
    if (body.private != null) await env.DB.prepare('UPDATE channels SET private=? WHERE id=?').bind(body.private ? 1 : 0, ch.id).run();
    if (body.archived != null) await env.DB.prepare('UPDATE channels SET archived=? WHERE id=?').bind(body.archived ? 1 : 0, ch.id).run();
    const out = await env.DB.prepare('SELECT * FROM channels WHERE id=?').bind(ch.id).first();
    const mem = await x.channelMembers(env, ch.id);
    await broadcast(env, out.archived ? { type: 'channel_removed', channel_id: ch.id } : { type: 'channel_updated', channel: out }, mem);
    return json(out);
  }
  if ((m = path.match(/^\/api\/channels\/([^/]+)\/remove$/)) && method === 'POST') {
    const ch = await env.DB.prepare("SELECT * FROM channels WHERE id=? AND kind='channel'").bind(m[1]).first();
    if (!ch) return err(404, 'Channel not found');
    if (!['owner', 'admin'].includes(user.role) && ch.created_by !== user.id) return err(403, 'Only admins or the person who made this channel can remove people');
    const who = String(body.user_id || '');
    await env.DB.prepare('DELETE FROM members WHERE channel_id=? AND user_id=?').bind(ch.id, who).run();
    await broadcast(env, { type: 'channel_removed', channel_id: ch.id }, [who]);
    return json(await x.channelMembers(env, ch.id));
  }
  // workspace setting: who can create channels
  if (path === '/api/settings' && method === 'GET') {
    const r = await env.DB.prepare("SELECT value FROM settings WHERE key='create_channels'").first();
    return json({ create_channels: r?.value || 'everyone' });
  }
  if (path === '/api/settings' && method === 'POST') {
    if (!['owner', 'admin'].includes(user.role)) return err(403, 'Admins only');
    const v = body.create_channels === 'admins' ? 'admins' : 'everyone';
    await env.DB.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('create_channels',?)").bind(v).run();
    return json({ create_channels: v });
  }
  if (path === '/api/channels' && method === 'POST' && !['owner', 'admin'].includes(user.role)) {
    const r = await env.DB.prepare("SELECT value FROM settings WHERE key='create_channels'").first();
    if (r?.value === 'admins') return err(403, 'Only admins can create channels here. Ask a workspace admin.');
  }
  // profile photo
  if (path === '/api/me/avatar' && method === 'POST') {
    const fd = await req.formData().catch(() => null);
    const f = fd?.get('file');
    if (!f || typeof f === 'string') return err(400, 'Pick a photo');
    if (!/^image\/(png|jpe?g|gif|webp|heic|heif)$/i.test(f.type)) return err(400, 'Use a JPG, PNG, GIF or WebP photo');
    if (f.size > 8e6) return err(400, 'That photo is too big (8 MB max)');
    let bytes = await f.arrayBuffer(), type = f.type, ext = (f.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
    if (env.IMAGES && !/gif/i.test(f.type)) {
      try {
        const out = await env.IMAGES.input(new Response(bytes).body).transform({ width: 400, height: 400, fit: 'cover' }).output({ format: 'image/webp', quality: 85 });
        bytes = await out.response().arrayBuffer(); type = 'image/webp'; ext = 'webp';
      } catch (e) {}
    }
    const key = `avatars/${user.id}-${Date.now().toString(36)}.${ext}`;
    await env.FILES.put(key, bytes, { httpMetadata: { contentType: type } });
    const avatarUrl = '/files/' + key;
    await env.DB.prepare('UPDATE users SET avatar=? WHERE id=?').bind(avatarUrl, user.id).run();
    await broadcast(env, { type: 'user_updated', user: { id: user.id, avatar: avatarUrl } });
    return json({ avatar: avatarUrl });
  }

  // guests only see places of people they share a channel with
  if (path === '/api/team/places' && method === 'GET' && user.role === 'guest') return json([]);
  return null;
}
