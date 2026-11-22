// Locked conversations (end-to-end encrypted). See docs/E2EE.md.
// The server never sees a key or a word of a locked message: every bit of cryptography runs in the browser
// (public/e2ee.js, vodozemac compiled to WebAssembly). This file only stores public device keys, relays
// sealed key packages between devices, keeps the encrypted key backup, and runs the two-step locking approvals.
// Every handler is a few small queries, so each request stays far under the free plan's 10 ms of CPU.

const now = () => Date.now();
const uid = (p = '') => p + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const err = (status, message) => json({ error: message }, status);
const isAdmin = (u) => ['owner', 'admin'].includes(u.role);
const B64 = /^[A-Za-z0-9+/=_-]+$/;
const key64 = (v) => typeof v === 'string' && v.length >= 40 && v.length <= 64 && B64.test(v);
const devId = (v) => typeof v === 'string' && /^[A-Za-z0-9_-]{8,40}$/.test(v);
const INBOX_DAYS = 30;

export async function lockedAllowed(env) {
  const r = await env.DB.prepare("SELECT value FROM settings WHERE key='allow_locked'").first();
  return r?.value === '1';
}

// A line in the conversation that records who asked and who approved. Plain text on purpose: it holds
// names and actions only, never message content.
export async function systemNote(env, x, ch, userId, text) {
  const id = uid('M'), ts = now();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO messages (id,channel_id,user_id,ts,text,source) VALUES (?,?,?,?,?,'system')").bind(id, ch.id, userId, ts, text),
    env.DB.prepare('UPDATE channels SET last_ts=? WHERE id=?').bind(ts, ch.id),
  ]);
  const full = { id, channel_id: ch.id, user_id: userId, ts, thread_id: null, text, files: [], reply_count: 0, last_reply_ts: 0, reply_users: [], edited_ts: null, deleted: 0, source: 'system', also_channel: 0, reactions: [], pinned_by: null, enc: null };
  await x.broadcast(env, { type: 'message', message: full, channel: { id: ch.id, kind: ch.kind, name: ch.name }, mentioned: [] }, await x.channelMembers(env, ch.id));
  return full;
}

async function userName(env, id) {
  return (await env.DB.prepare('SELECT name FROM users WHERE id=?').bind(id).first())?.name || 'Someone';
}
async function adminIds(env) {
  return (await env.DB.prepare("SELECT id FROM users WHERE role IN ('owner','admin') AND active=1").all()).results.map((r) => r.id);
}

// ---------------------------------------------------------------- creating a locked conversation
// Called from channel and DM creation when the request asks to lock it. The conversation starts as
// "waiting" (locked=2): nobody can post until the second approval arrives.
export async function startLockedChannel(env, x, user, ch) {
  await env.DB.prepare("UPDATE channels SET locked=2, lock_by=?, lock_accepts='[]' WHERE id=?").bind(user.id, ch.id).run();
  await systemNote(env, x, ch, user.id, `${user.name} asked to lock this channel. An admin needs to approve it before anyone can post.`);
  const admins = (await adminIds(env)).filter((a) => a !== user.id);
  await x.broadcast(env, { type: 'lock_request', channel_id: ch.id, name: ch.name, by: user.id }, admins.length ? admins : [user.id]);
  return { ...ch, locked: 2, lock_by: user.id, lock_accepts: '[]' };
}

export async function openLockedDm(env, x, user, ids) {
  ids = [...new Set(ids)].sort();
  const key = 'L:' + ids.join(',');
  const have = await env.DB.prepare('SELECT * FROM channels WHERE dm_key=?').bind(key).first();
  if (have) return have;
  const id = uid('D'), t = now();
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO channels (id,kind,name,dm_key,private,created_by,created_at,last_ts,locked,lock_by,lock_accepts) VALUES (?,'dm','',?,1,?,?,?,2,?,?)")
      .bind(id, key, user.id, t, t, user.id, JSON.stringify([user.id])),
    ...ids.map((u) => env.DB.prepare('INSERT OR IGNORE INTO members (channel_id,user_id,last_read,joined_at) SELECT id,?,?,? FROM channels WHERE dm_key=?').bind(u, t, t, key)),
  ]);
  const ch = await env.DB.prepare('SELECT * FROM channels WHERE dm_key=?').bind(key).first();
  if (ch.id === id) {
    await systemNote(env, x, ch, user.id, `${user.name} asked to lock this conversation. It locks when everyone here accepts.`);
    await x.broadcast(env, { type: 'channel_added', channel: ch, user_ids: ids }, ids.filter((u) => u !== user.id));
  }
  return ch;
}

async function finishLock(env, x, ch, byId) {
  await env.DB.prepare('UPDATE channels SET locked=1 WHERE id=? AND locked=2').bind(ch.id).run();
  const out = await env.DB.prepare('SELECT * FROM channels WHERE id=?').bind(ch.id).first();
  await x.broadcast(env, { type: 'channel_updated', channel: out }, await x.channelMembers(env, ch.id));
  return out;
}

async function removeConversation(env, x, ch) {
  const mem = await x.channelMembers(env, ch.id);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM messages WHERE channel_id=?').bind(ch.id),
    env.DB.prepare('DELETE FROM members WHERE channel_id=?').bind(ch.id),
    env.DB.prepare('DELETE FROM channels WHERE id=?').bind(ch.id),
  ]);
  await x.broadcast(env, { type: 'channel_removed', channel_id: ch.id, reason: 'lock_declined' }, mem);
}

// ---------------------------------------------------------------- routes
export async function e2eeApi(c) {
  const { env, user, path, method, body, req, x } = c;
  if (!path.startsWith('/api/e2ee/') && !/^\/api\/channels\/[^/]+\/lock\//.test(path)) return null;
  const q = (s, ...a) => env.DB.prepare(s).bind(...a);

  // Owner turns the workspace setting on or off. The app asks twice first (understand, then type "lock").
  if (path === '/api/e2ee/allow' && method === 'POST') {
    if (user.role !== 'owner') return err(403, 'Only the workspace owner can change this.');
    if (body.on && body.confirm !== 'lock') return err(400, 'Type lock to confirm.');
    await q("INSERT OR REPLACE INTO settings (key,value) VALUES ('allow_locked',?)", body.on ? '1' : '0').run();
    return json({ on: !!body.on });
  }

  // Lock approvals
  const lm = path.match(/^\/api\/channels\/([^/]+)\/lock\/(approve|decline|accept)$/);
  if (lm && method === 'POST') {
    const ch = await q('SELECT * FROM channels WHERE id=?', lm[1]).first();
    if (!ch || ch.locked !== 2) return err(404, 'Nothing is waiting for approval here.');
    const action = lm[2];
    if (ch.kind === 'channel') {
      if (action === 'accept') return err(400, 'An admin approves locking a channel.');
      if (!isAdmin(user)) return err(403, 'Only an admin or the owner can approve locking a channel.');
      // Two people: the approver can't be the person who asked, unless nobody else could ever approve it.
      if (user.id === ch.lock_by && action === 'approve') {
        const others = (await adminIds(env)).filter((a) => a !== user.id);
        if (others.length) return err(403, 'Another admin or the owner needs to approve this. You asked for it.');
      }
      if (action === 'decline') {
        const who = await userName(env, ch.lock_by);
        await removeConversation(env, x, ch);
        if (ch.lock_by !== user.id) await x.broadcast(env, { type: 'lock_declined', name: ch.name, by: user.id, kind: 'channel' }, [ch.lock_by]);
        return json({ ok: true, removed: true, requester: who });
      }
      const self = user.id === ch.lock_by;
      await systemNote(env, x, ch, user.id, self ? `${user.name} approved locking this channel (the only admin in the workspace). It's locked now.` : `${user.name} approved locking this channel. It's locked now.`);
      return json(await finishLock(env, x, ch, user.id));
    }
    // DM: everyone in it accepts
    if (!(await x.isMember(env, ch.id, user.id))) return err(403, "You're not in this conversation.");
    if (action === 'approve') return err(400, 'Accept or decline instead.');
    if (action === 'decline') {
      await removeConversation(env, x, ch);
      await x.broadcast(env, { type: 'lock_declined', by: user.id, kind: 'dm' }, [ch.lock_by]);
      return json({ ok: true, removed: true });
    }
    const acc = new Set(JSON.parse(ch.lock_accepts || '[]')); acc.add(user.id);
    await env.DB.prepare('UPDATE channels SET lock_accepts=? WHERE id=?').bind(JSON.stringify([...acc]), ch.id).run();
    const mem = await x.channelMembers(env, ch.id);
    await systemNote(env, x, ch, user.id, `${user.name} accepted locking this conversation.`);
    if (mem.every((u) => acc.has(u))) {
      await systemNote(env, x, ch, user.id, "Everyone accepted. This conversation is locked now.");
      return json(await finishLock(env, x, ch, user.id));
    }
    const out = await q('SELECT * FROM channels WHERE id=?', ch.id).first();
    await x.broadcast(env, { type: 'channel_updated', channel: out }, mem);
    return json(out);
  }
  if (path === '/api/e2ee/requests' && method === 'GET') {
    if (!isAdmin(user)) return json([]);
    const r = await q("SELECT c.id, c.name, c.lock_by, c.created_at, (SELECT COUNT(*) FROM members m WHERE m.channel_id=c.id) members FROM channels c WHERE c.kind='channel' AND c.locked=2 ORDER BY c.created_at").all();
    return json(r.results);
  }

  // ---- identity: the person's signing key (made from their recovery key) and their devices
  if (path === '/api/e2ee/me' && method === 'GET') {
    const [idr, devs] = await env.DB.batch([
      q('SELECT master_pub, created_at FROM e2ee_identity WHERE user_id=?', user.id),
      q('SELECT device_id, curve, ed, sig, label, created_at, last_seen FROM e2ee_devices WHERE user_id=? ORDER BY created_at', user.id),
    ]);
    const device = new URL(req.url).searchParams.get('device') || '';
    const otk = devId(device) ? (await q('SELECT COUNT(*) n FROM e2ee_otk WHERE user_id=? AND device_id=?', user.id, device).first()).n : 0;
    if (devId(device)) await q('UPDATE e2ee_devices SET last_seen=? WHERE user_id=? AND device_id=?', now(), user.id, device).run();
    return json({ identity: idr.results[0] || null, devices: devs.results, otk_count: otk, allowed: await lockedAllowed(env) });
  }
  if (path === '/api/e2ee/identity' && method === 'POST') {
    if (!key64(body.master_pub)) return err(400, 'Bad key');
    const have = await q('SELECT master_pub FROM e2ee_identity WHERE user_id=?', user.id).first();
    if (have && !body.replace) return err(409, 'This account already has a recovery key.');
    const stmts = [q('INSERT OR REPLACE INTO e2ee_identity (user_id, master_pub, created_at) VALUES (?,?,?)', user.id, body.master_pub, now())];
    if (have) {
      // Starting over: old devices and the old backup can't be used with the new key.
      stmts.push(q('DELETE FROM e2ee_devices WHERE user_id=?', user.id), q('DELETE FROM e2ee_otk WHERE user_id=?', user.id),
        q('DELETE FROM e2ee_backup WHERE user_id=?', user.id), q('DELETE FROM e2ee_inbox WHERE user_id=?', user.id));
    }
    await env.DB.batch(stmts);
    if (have) await x.broadcast(env, { type: 'e2ee_identity', user_id: user.id }, await x.audience(env, user.id));
    return json({ ok: true });
  }
  if (path === '/api/e2ee/devices' && method === 'POST') {
    const d = body;
    if (!devId(d.device_id) || !key64(d.curve) || !key64(d.ed)) return err(400, 'Bad device');
    const n = (await q('SELECT COUNT(*) n FROM e2ee_devices WHERE user_id=?', user.id).first()).n;
    const exists = await q('SELECT 1 FROM e2ee_devices WHERE user_id=? AND device_id=?', user.id, d.device_id).first();
    if (!exists && n >= 20) return err(400, 'Too many devices. Remove an old one first.');
    if (exists) {
      // Keys of a device never change; only its signature (after approval) and label can.
      const ok = await q('SELECT 1 FROM e2ee_devices WHERE user_id=? AND device_id=? AND curve=? AND ed=?', user.id, d.device_id, d.curve, d.ed).first();
      if (!ok) return err(409, 'That device is already set up with other keys.');
    }
    const sig = typeof d.sig === 'string' && d.sig.length <= 100 ? d.sig : '';
    const fb = d.fallback && key64(d.fallback.key) ? JSON.stringify({ id: String(d.fallback.id).slice(0, 20), key: d.fallback.key }) : null;
    await q(`INSERT INTO e2ee_devices (user_id, device_id, curve, ed, sig, fallback, label, created_at, last_seen) VALUES (?,?,?,?,?,?,?,?,?)
      ON CONFLICT(user_id, device_id) DO UPDATE SET sig=CASE WHEN excluded.sig<>'' THEN excluded.sig ELSE sig END, fallback=COALESCE(excluded.fallback, fallback), label=excluded.label, last_seen=excluded.last_seen`,
      user.id, d.device_id, d.curve, d.ed, sig, fb, String(d.label || '').slice(0, 60), now(), now()).run();
    await putOtks(env, user.id, d.device_id, d.otks);
    if (sig) await x.broadcast(env, { type: 'e2ee_devices', user_id: user.id }, await x.audience(env, user.id));
    return json({ ok: true });
  }
  // Another of my devices vouches for a new one (cross-device approval).
  const sm = path.match(/^\/api\/e2ee\/devices\/([^/]+)\/sig$/);
  if (sm && method === 'POST') {
    if (typeof body.sig !== 'string' || body.sig.length > 100) return err(400, 'Bad signature');
    await q('UPDATE e2ee_devices SET sig=? WHERE user_id=? AND device_id=?', body.sig, user.id, sm[1]).run();
    await x.broadcast(env, { type: 'e2ee_devices', user_id: user.id }, await x.audience(env, user.id));
    return json({ ok: true });
  }
  const dm = path.match(/^\/api\/e2ee\/devices\/([^/]+)$/);
  if (dm && method === 'DELETE') {
    await env.DB.batch([q('DELETE FROM e2ee_devices WHERE user_id=? AND device_id=?', user.id, dm[1]), q('DELETE FROM e2ee_otk WHERE user_id=? AND device_id=?', user.id, dm[1]), q('DELETE FROM e2ee_inbox WHERE user_id=? AND device_id=?', user.id, dm[1])]);
    await x.broadcast(env, { type: 'e2ee_devices', user_id: user.id }, await x.audience(env, user.id));
    return json({ ok: true });
  }
  if (path === '/api/e2ee/otks' && method === 'POST') {
    if (!devId(body.device_id)) return err(400, 'Bad device');
    if (!(await q('SELECT 1 FROM e2ee_devices WHERE user_id=? AND device_id=?', user.id, body.device_id).first())) return err(404, 'Unknown device');
    await putOtks(env, user.id, body.device_id, body.otks);
    return json({ ok: true });
  }
  // A new device asks my other devices to approve it.
  if (path === '/api/e2ee/verify-request' && method === 'POST') {
    if (!devId(body.device_id)) return err(400, 'Bad device');
    await x.broadcast(env, { type: 'e2ee_verify', device_id: body.device_id }, [user.id]);
    return json({ ok: true });
  }

  // Public device keys of people I share a conversation with (and my own).
  if (path === '/api/e2ee/keys' && method === 'POST') {
    const ids = [...new Set((Array.isArray(body.user_ids) ? body.user_ids : []).map(String))].slice(0, 100);
    if (!ids.length) return json({});
    const ph = ids.map(() => '?').join(',');
    const [idr, devs] = await env.DB.batch([
      q(`SELECT user_id, master_pub FROM e2ee_identity WHERE user_id IN (${ph}) AND (user_id=? OR user_id IN (SELECT a.user_id FROM members a JOIN members b ON b.channel_id=a.channel_id WHERE b.user_id=?))`, ...ids, user.id, user.id),
      q(`SELECT user_id, device_id, curve, ed, sig FROM e2ee_devices WHERE user_id IN (${ph})`, ...ids),
    ]);
    const out = {};
    for (const r of idr.results) out[r.user_id] = { master_pub: r.master_pub, devices: [] };
    for (const d of devs.results) if (out[d.user_id]) out[d.user_id].devices.push({ device_id: d.device_id, curve: d.curve, ed: d.ed, sig: d.sig });
    return json(out);
  }
  // One one-time key per device, used up as it's handed out (or the device's fallback key when none are left).
  if (path === '/api/e2ee/claim' && method === 'POST') {
    const want = (Array.isArray(body.devices) ? body.devices : []).slice(0, 100).filter((d) => d && devId(d.device_id));
    const out = [];
    for (const d of want) {
      const r = await q('DELETE FROM e2ee_otk WHERE rowid = (SELECT rowid FROM e2ee_otk WHERE user_id=? AND device_id=? LIMIT 1) RETURNING key_id, key', String(d.user_id), d.device_id).first();
      if (r) { out.push({ user_id: d.user_id, device_id: d.device_id, key: r.key }); continue; }
      const f = await q('SELECT fallback FROM e2ee_devices WHERE user_id=? AND device_id=?', String(d.user_id), d.device_id).first();
      if (f?.fallback) out.push({ user_id: d.user_id, device_id: d.device_id, key: JSON.parse(f.fallback).key, fallback: true });
    }
    return json(out);
  }
  // Sealed key packages, device to device. Only the target device can open them.
  if (path === '/api/e2ee/send' && method === 'POST') {
    const list = (Array.isArray(body.messages) ? body.messages : []).slice(0, 200);
    if (!devId(body.device_id)) return err(400, 'Bad device');
    // Only to myself or to people I share a conversation with: nobody else can fill someone's inbox.
    const wanted = [...new Set(list.map((mm) => String(mm?.user_id || '')))].filter((u) => u && u !== user.id).slice(0, 100);
    const ok = new Set([user.id]);
    if (wanted.length) for (const r of (await q(`SELECT DISTINCT a.user_id FROM members a JOIN members b ON b.channel_id=a.channel_id WHERE b.user_id=? AND a.user_id IN (${wanted.map(() => '?').join(',')})`, user.id, ...wanted).all()).results) ok.add(r.user_id);
    const stmts = [], to = new Set();
    for (const mm of list) {
      if (!mm || !ok.has(String(mm.user_id)) || !devId(mm.device_id) || typeof mm.body !== 'string' || mm.body.length > 65536 || !key64(mm.sender_key)) continue;
      stmts.push(q('INSERT INTO e2ee_inbox (id, user_id, device_id, sender_user, sender_device, sender_key, body, created_at) VALUES (?,?,?,?,?,?,?,?)',
        uid('K'), String(mm.user_id), mm.device_id, user.id, body.device_id, mm.sender_key, mm.body, now()));
      to.add(String(mm.user_id));
    }
    if (stmts.length) await env.DB.batch(stmts);
    if (to.size) await x.broadcast(env, { type: 'e2ee_inbox' }, [...to]);
    return json({ sent: stmts.length });
  }
  if (path === '/api/e2ee/inbox' && method === 'GET') {
    const device = new URL(req.url).searchParams.get('device') || '';
    if (!devId(device)) return err(400, 'Bad device');
    const r = await q('SELECT id, sender_user, sender_device, sender_key, body, created_at FROM e2ee_inbox WHERE user_id=? AND device_id=? ORDER BY created_at LIMIT 200', user.id, device).all();
    return json(r.results);
  }
  if (path === '/api/e2ee/inbox/ack' && method === 'POST') {
    const ids = (Array.isArray(body.ids) ? body.ids : []).slice(0, 200).map(String);
    if (ids.length) await q(`DELETE FROM e2ee_inbox WHERE user_id=? AND id IN (${ids.map(() => '?').join(',')})`, user.id, ...ids).run();
    return json({ ok: true });
  }
  // Key backup: each conversation key, encrypted in the browser with a key made from the recovery key.
  if (path === '/api/e2ee/backup' && method === 'PUT') {
    const items = (Array.isArray(body.items) ? body.items : []).slice(0, 100).filter((i) => i && typeof i.session_id === 'string' && i.session_id.length <= 64 && typeof i.data === 'string' && i.data.length <= 4096);
    if (items.length) await env.DB.batch(items.map((i) => q('INSERT OR REPLACE INTO e2ee_backup (user_id, session_id, data, updated_at) VALUES (?,?,?,?)', user.id, i.session_id, i.data, now())));
    return json({ saved: items.length });
  }
  if (path === '/api/e2ee/backup' && method === 'GET') {
    const after = new URL(req.url).searchParams.get('after') || '';
    const r = await q('SELECT session_id, data FROM e2ee_backup WHERE user_id=? AND session_id>? ORDER BY session_id LIMIT 500', user.id, after).all();
    return json({ items: r.results, more: r.results.length === 500 });
  }
  return null;
}

async function putOtks(env, userId, deviceId, otks) {
  const list = Object.entries(otks && typeof otks === 'object' ? otks : {}).slice(0, 100).filter(([id, k]) => String(id).length <= 20 && key64(k));
  if (list.length) await env.DB.batch(list.map(([id, k]) => env.DB.prepare('INSERT OR IGNORE INTO e2ee_otk (user_id, device_id, key_id, key) VALUES (?,?,?,?)').bind(userId, deviceId, String(id), k)));
}

// Hourly tidy-up: sealed packages nobody picked up in 30 days (a device that's gone).
export async function e2eeHousekeeping(env) {
  await env.DB.prepare('DELETE FROM e2ee_inbox WHERE created_at < ?').bind(now() - INBOX_DAYS * 864e5).run();
}
