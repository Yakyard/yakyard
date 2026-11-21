// "Bring my Slack history": each person connects their own Slack account (read only)
// and Yakyard copies their DMs, group DMs and private channels in the background.
// Message ids use the same scheme as the earlier imports, so nothing is ever doubled.

// The Slack workspace people may import from (SLACK_TEAM_ID). Empty = any workspace the user picks.
const teamOf = (env) => env.SLACK_TEAM_ID || '';
const SCOPES = 'im:history,im:read,mpim:history,mpim:read,groups:history,groups:read,channels:read,users:read,files:read,reactions:read';
const now = () => Date.now();
const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const err = (s, m) => json({ error: m }, s);
const rid = (p = '') => p + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
const KEEP = new Set([undefined, null, 'thread_broadcast', 'bot_message', 'file_share', 'me_message']);
const FETCH_BUDGET = 40;      // external calls per slice (stays under Workers limits)
const TIME_BUDGET = 15000;    // ms per slice (stays inside background time limits)

async function sha1hex(s) {
  const b = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
const msgId = async (cid, ts) => 'M' + (await sha1hex(cid + ts)).slice(0, 16);
const tsMs = (ts) => Math.round(parseFloat(ts) * 1000);

// ---- token encryption (AES-GCM with a worker secret)
async function key(env) {
  const raw = Uint8Array.from(atob(env.TOKEN_KEY || ''), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
async function seal(env, text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(env), new TextEncoder().encode(text)));
  return btoa(String.fromCharCode(...iv, ...ct));
}
async function open(env, b64) {
  const all = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: all.slice(0, 12) }, await key(env), all.slice(12));
  return new TextDecoder().decode(pt);
}

async function clientSecret(env) {
  if (env.SLACK_CLIENT_SECRET) return env.SLACK_CLIENT_SECRET;
  const r = await env.DB.prepare("SELECT value FROM settings WHERE key='slack_client_secret'").first();
  return r ? open(env, r.value).catch(() => '') : '';
}

// ---------------------------------------------------------------- web routes
export async function slackRoutes(req, env, user, ctx) {
  const url = new URL(req.url);
  const redirect = `${url.origin}/slack/callback`;
  if (url.pathname === '/slack/connect') {
    if (!env.SLACK_CLIENT_ID || !(await clientSecret(env))) return Response.redirect(`${url.origin}/#/import?e=setup`, 302);
    const state = rid('st');
    await env.DB.prepare('INSERT INTO oauth_states (state,user_id,created_at) VALUES (?,?,?)').bind(state, user.id, now()).run();
    const q = new URLSearchParams({ client_id: env.SLACK_CLIENT_ID, user_scope: SCOPES, redirect_uri: redirect, state, ...(teamOf(env) ? { team: teamOf(env) } : {}) });
    return Response.redirect('https://slack.com/oauth/v2/authorize?' + q, 302);
  }
  if (url.pathname === '/slack/callback') {
    const back = (e) => Response.redirect(`${url.origin}/#/import${e ? '?e=' + encodeURIComponent(e) : ''}`, 302);
    const state = url.searchParams.get('state') || '', code = url.searchParams.get('code') || '';
    if (url.searchParams.get('error')) return back('cancelled');
    const st = await env.DB.prepare('SELECT * FROM oauth_states WHERE state=?').bind(state).first();
    await env.DB.prepare('DELETE FROM oauth_states WHERE state=? OR created_at < ?').bind(state, now() - 3600e3).run();
    if (!st || st.user_id !== user.id || now() - st.created_at > 15 * 60e3) return back('expired');
    const body = new URLSearchParams({ client_id: env.SLACK_CLIENT_ID, client_secret: await clientSecret(env), code, redirect_uri: redirect });
    const r = await fetch((env.SLACK_API || 'https://slack.com/api') + '/oauth.v2.access', { method: 'POST', body }).then((x) => x.json()).catch(() => ({}));
    const au = r.authed_user || {};
    if (!r.ok || !au.access_token) return back('slack');
    if (teamOf(env) && r.team?.id !== teamOf(env)) return back('workspace');
    // The Slack account must be this person's own.
    const owner = await env.DB.prepare('SELECT id FROM users WHERE slack_id=?').bind(au.id).first();
    if (owner && owner.id !== user.id) {
      await fetch('https://slack.com/api/auth.revoke', { headers: { authorization: 'Bearer ' + au.access_token } }).catch(() => {});
      return back('other');
    }
    if (!owner) {
      if (user.slack_id && user.slack_id !== au.id) return back('other');
      await env.DB.prepare('UPDATE users SET slack_id=? WHERE id=?').bind(au.id, user.id).run();
    }
    const tok = await seal(env, au.access_token);
    const fresh = JSON.stringify({ phase: 'users', cursor: '', convs: [], i: 0, threads: [], files: [], touched: [] });
    await env.DB.prepare(`INSERT INTO slack_imports (user_id,status,token_enc,slack_user,state,msgs,files,convs_total,convs_done,error,started_at,updated_at,finished_at,lock_until)
      VALUES (?,?,?,?,?,0,0,0,0,'',?,?,0,0)
      ON CONFLICT(user_id) DO UPDATE SET status='running', token_enc=excluded.token_enc, slack_user=excluded.slack_user, state=excluded.state, msgs=0, files=0, convs_total=0, convs_done=0, error='', started_at=excluded.started_at, updated_at=excluded.updated_at, finished_at=0, lock_until=0`)
      .bind(user.id, 'running', tok, au.id, fresh, now(), now()).run();
    ctx?.waitUntil?.(runSlice(env, user.id).catch((e) => console.log('import slice', e)));
    return back('');
  }
  return new Response('Not found', { status: 404 });
}

// ---------------------------------------------------------------- API
export async function slackApi(req, env, user, path, method, body, ctx) {
  if (path === '/api/slack/import' && method === 'GET') {
    let job = await env.DB.prepare('SELECT user_id,status,msgs,files,convs_total,convs_done,error,started_at,finished_at,state FROM slack_imports WHERE user_id=?').bind(user.id).first();
    if (job?.status === 'running') ctx?.waitUntil?.(runSlice(env, user.id).catch((e) => console.log('import slice', e)));
    const ready = !!(env.SLACK_CLIENT_ID && (env.SLACK_CLIENT_SECRET || (await env.DB.prepare("SELECT 1 FROM settings WHERE key='slack_client_secret'").first())));
    if (job) { const s = JSON.parse(job.state || '{}'); job.phase = s.phase; delete job.state; }
    return json({ ready, job: job || null });
  }
  if (path === '/api/slack/admin' && method === 'GET') {
    if (!['owner', 'admin'].includes(user.role)) return err(403, 'Admins only');
    const ready = !!(env.SLACK_CLIENT_ID && (env.SLACK_CLIENT_SECRET || (await env.DB.prepare("SELECT 1 FROM settings WHERE key='slack_client_secret'").first())));
    const r = await env.DB.prepare('SELECT s.user_id, u.name, s.status, s.msgs, s.files, s.convs_done, s.convs_total, s.finished_at FROM slack_imports s JOIN users u ON u.id=s.user_id ORDER BY s.started_at DESC').all();
    return json({ ready, imports: r.results });
  }
  if (path === '/api/slack/secret' && method === 'POST') {
    if (user.role !== 'owner') return err(403, 'Only the owner can do this');
    const v = String(body.secret || '').trim();
    if (!/^[a-f0-9]{32}$/i.test(v)) return err(400, "That doesn't look like the Client Secret. It's 32 letters and numbers.");
    await env.DB.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('slack_client_secret',?)").bind(await seal(env, v)).run();
    return json({ ok: true });
  }
  return null;
}

// ---------------------------------------------------------------- the copier
export async function runImports(env) {
  const r = await env.DB.prepare("SELECT user_id FROM slack_imports WHERE status='running' ORDER BY updated_at LIMIT 2").all();
  for (const j of r.results) await runSlice(env, j.user_id).catch((e) => console.log('import slice', e));
}

async function runSlice(env, userId) {
  // one worker at a time per person
  const lock = await env.DB.prepare("UPDATE slack_imports SET lock_until=? WHERE user_id=? AND status='running' AND lock_until < ?").bind(now() + 30e3, userId, now()).run();
  if (!lock.meta?.changes) return;
  const job = await env.DB.prepare('SELECT * FROM slack_imports WHERE user_id=?').bind(userId).first();
  const user = await env.DB.prepare('SELECT * FROM users WHERE id=?').bind(userId).first();
  const S = JSON.parse(job.state);
  const ctx = { env, user, S, calls: 0, t0: now(), token: await open(env, job.token_enc), msgs: 0, files: 0, userMap: new Map() };
  // Save after every step, so a batch that gets cut off never loses or repeats work.
  const save = async (final) => {
    const done = S.phase === 'done';
    await env.DB.prepare(`UPDATE slack_imports SET state=?, msgs=msgs+?, files=files+?, convs_total=?, convs_done=?, updated_at=?, lock_until=?
      ${done ? ", status='done', finished_at=" + now() + ", token_enc=''" : ''} WHERE user_id=?`)
      .bind(JSON.stringify(S), ctx.msgs, ctx.files, S.convs.length, Math.min(S.i, S.convs.length), now(), final ? 0 : now() + 30e3, userId).run();
    ctx.msgs = 0; ctx.files = 0;
  };
  try {
    while (ctx.calls < FETCH_BUDGET && now() - ctx.t0 < TIME_BUDGET) {
      const more = await step(ctx);
      await save(false);
      if (!more) break;
    }
    await save(true);
    const done = S.phase === 'done';
    if (done) {
      await fetch('https://slack.com/api/auth.revoke', { headers: { authorization: 'Bearer ' + ctx.token } }).catch(() => {});
      try { await env.HUB.get(env.HUB.idFromName('workspace')).fetch('https://hub/broadcast', { method: 'POST', body: JSON.stringify({ event: { type: 'import_done' }, to: [userId] }) }); } catch {}
    }
  } catch (e) {
    const msg = String(e?.message || e).slice(0, 300);
    const fatal = /invalid_auth|token_revoked|account_inactive|not_authed/.test(msg);
    await env.DB.prepare(`UPDATE slack_imports SET state=?, msgs=msgs+?, files=files+?, lock_until=?, error=?, updated_at=? ${fatal ? ", status='error', token_enc=''" : ''} WHERE user_id=?`)
      .bind(JSON.stringify(S), ctx.msgs, ctx.files, /ratelimited/.test(msg) ? now() + 60e3 : 0, msg, now(), userId).run();
  }
}

async function slack(ctx, method, params = {}) {
  ctx.calls++;
  const r = await fetch(`${ctx.env.SLACK_API || 'https://slack.com/api'}/${method}?` + new URLSearchParams(params), { headers: { authorization: 'Bearer ' + ctx.token } });
  if (r.status === 429) throw new Error('ratelimited');
  const j = await r.json();
  if (!j.ok) throw new Error(`${method}: ${j.error}`);
  return j;
}

// Slack user id -> Yakyard user id. Unknown people (outside contacts, apps) get the same placeholders as before.
async function mapUser(ctx, sid, hint = {}) {
  if (!sid) return ctx.user.id;
  if (ctx.userMap.has(sid)) return ctx.userMap.get(sid);
  const { env } = ctx;
  let u = await env.DB.prepare('SELECT id FROM users WHERE slack_id=?').bind(sid).first();
  if (!u) u = await env.DB.prepare('SELECT id FROM users WHERE email=?').bind(sid.toLowerCase() + '@bot.local').first();
  if (!u) {
    let name = hint.name || '';
    if (!name && /^U/.test(sid) && ctx.calls < FETCH_BUDGET) {
      try { const x = await slack(ctx, 'users.info', { user: sid }); name = x.user?.real_name || x.user?.profile?.real_name || x.user?.name || ''; } catch {}
    }
    const id = 'U' + (await sha1hex(sid)).slice(0, 16);
    await env.DB.prepare("INSERT OR IGNORE INTO users (id,email,name,role,active,created_at,color,slack_id) VALUES (?,?,?,'member',1,?,?,NULL)")
      .bind(id, sid.toLowerCase() + '@bot.local', name || 'Slack user', now(), '#dde6e1').run();
    u = { id };
  }
  ctx.userMap.set(sid, u.id);
  return u.id;
}

async function step(ctx) {
  const { env, S } = ctx;
  if (S.phase === 'users') {
    // Known Slack people are matched by slack_id; this pass only fills names for outside contacts.
    S.phase = 'list'; S.cursor = '';
    return true;
  }
  if (S.phase === 'list') {
    const j = await slack(ctx, 'conversations.list', { types: 'im,mpim,private_channel', limit: '200', exclude_archived: 'false', ...(S.cursor ? { cursor: S.cursor } : {}) });
    for (const c of j.channels || []) S.convs.push({ id: c.id, im: !!c.is_im, mpim: !!c.is_mpim, user: c.user || '', name: c.name || '', archived: !!c.is_archived });
    S.cursor = j.response_metadata?.next_cursor || '';
    if (!S.cursor) { S.phase = 'conv'; S.i = 0; S.hcursor = ''; S.cid = ''; }
    return true;
  }
  if (S.phase === 'conv') {
    if (S.i >= S.convs.length) { S.phase = 'files'; return true; }
    try { return await convStep(ctx); }
    catch (e) {
      // Conversations Slack won't open for this person (deleted, left, no access): skip them, keep going.
      if (/channel_not_found|not_in_channel|missing_scope|method_not_supported_for_channel_type|is_archived|thread_not_found/.test(String(e.message))) {
        S.skipped = (S.skipped || 0) + 1; S.threads = []; S.rcursor = ''; S.hcursor = ''; S.cid = ''; S.i++;
        return true;
      }
      throw e;
    }
  }
  return stepTail(ctx);
}

async function convStep(ctx) {
  const { S } = ctx;
  {
    const c = S.convs[S.i];
    if (!S.cid) {
      S.cid = await ensureChannel(ctx, c);
      if (!S.cid) { S.i++; S.cid = ''; return true; }
      if (!S.touched.includes(S.cid)) S.touched.push(S.cid);
      S.hcursor = '';
    }
    if (S.threads.length) {
      const t = S.threads[0];
      const j = await slack(ctx, 'conversations.replies', { channel: c.id, ts: t, limit: '200', ...(S.rcursor ? { cursor: S.rcursor } : {}) });
      await saveMessages(ctx, S.cid, (j.messages || []).filter((m) => m.ts !== t));
      S.rcursor = j.response_metadata?.next_cursor || '';
      if (!S.rcursor) S.threads.shift();
      return true;
    }
    if (S.hcursor === 'done') { S.i++; S.cid = ''; S.hcursor = ''; return true; }
    const j = await slack(ctx, 'conversations.history', { channel: c.id, limit: '200', ...(S.hcursor ? { cursor: S.hcursor } : {}) });
    const list = j.messages || [];
    await saveMessages(ctx, S.cid, list);
    for (const m of list) if (m.reply_count > 0 && m.thread_ts === m.ts) S.threads.push(m.ts);
    S.hcursor = j.response_metadata?.next_cursor || 'done';
    return true;
  }
}

async function stepTail(ctx) {
  const { env, S } = ctx;
  if (S.phase === 'files') {
    if (!S.files.length) { await finish(ctx); S.phase = 'done'; return false; }
    const f = S.files.shift();
    ctx.calls++;
    try {
      const r = await fetch(f.url, { headers: { authorization: 'Bearer ' + ctx.token } });
      const type = r.headers.get('content-type') || '';
      if (r.ok && !/text\/html/.test(type)) {
        await env.FILES.put(f.key, await r.arrayBuffer(), { httpMetadata: { contentType: f.type || type } });
        ctx.files++;
      }
    } catch (e) {}
    return true;
  }
  return false;
}

async function ensureChannel(ctx, c) {
  const { env, user } = ctx;
  if (c.im || c.mpim) {
    let sids = [];
    if (c.im) sids = [c.user];
    else {
      const j = await slack(ctx, 'conversations.members', { channel: c.id, limit: '200' });
      sids = j.members || [];
    }
    const ids = [user.id];
    for (const s of sids) ids.push(await mapUser(ctx, s));
    const uniq = [...new Set(ids)].sort();
    const key = uniq.join(',');
    let ch = await env.DB.prepare('SELECT id FROM channels WHERE dm_key=?').bind(key).first();
    if (!ch) {
      const id = rid('D');
      await env.DB.prepare("INSERT INTO channels (id,kind,name,dm_key,private,created_by,created_at,last_ts) VALUES (?,'dm','',?,1,?,?,0)").bind(id, key, user.id, now()).run();
      ch = { id };
    }
    await env.DB.batch(uniq.map((u) => env.DB.prepare('INSERT OR IGNORE INTO members (channel_id,user_id,last_read,joined_at) VALUES (?,?,?,?)').bind(ch.id, u, now(), now())));
    return ch.id;
  }
  // private channel: match by name, else create it private
  // Only ever match another private channel, so private messages can never land in a public one.
  let name = (c.name || '').toLowerCase();
  let ch = await env.DB.prepare("SELECT id FROM channels WHERE kind='channel' AND private=1 AND name=?").bind(name).first();
  if (!ch && (await env.DB.prepare("SELECT 1 FROM channels WHERE kind='channel' AND name=?").bind(name).first())) name = name + '-private';
  if (!ch) ch = await env.DB.prepare("SELECT id FROM channels WHERE kind='channel' AND private=1 AND name=?").bind(name).first();
  if (!ch) {
    const id = rid('C');
    await env.DB.prepare("INSERT INTO channels (id,kind,name,private,archived,created_by,created_at,last_ts) VALUES (?,'channel',?,1,?,?,?,0)").bind(id, name, c.archived ? 1 : 0, user.id, now()).run();
    ch = { id };
  }
  await env.DB.prepare('INSERT OR IGNORE INTO members (channel_id,user_id,last_read,joined_at) VALUES (?,?,?,?)').bind(ch.id, user.id, now(), now()).run();
  // Other members join when they sign in (same rule as the first import).
  try {
    const j = await slack(ctx, 'conversations.members', { channel: c.id, limit: '200' });
    for (const s of j.members || []) {
      const u = await mapUser(ctx, s);
      if (u !== user.id) await env.DB.prepare('INSERT OR IGNORE INTO pending_members (channel_id,user_id) SELECT ?, ? WHERE NOT EXISTS (SELECT 1 FROM members WHERE channel_id=? AND user_id=?)').bind(ch.id, u, ch.id, u).run();
    }
  } catch (e) {}
  return ch.id;
}

function emojiOf(name) { return ':' + name + ':'; }

async function saveMessages(ctx, cid, list) {
  const { env, S } = ctx;
  const stmts = [];
  for (const m of list) {
    if (!KEEP.has(m.subtype)) continue;
    const id = await msgId(cid, m.ts);
    const author = await mapUser(ctx, m.user || m.bot_id, { name: m.username || m.bot_profile?.name || '' });
    let text = m.text || '';
    for (const sid of new Set([...text.matchAll(/<@([UW][A-Z0-9]+)(\|[^>]*)?>/g)].map((x) => x[1]))) {
      const to = await mapUser(ctx, sid);
      text = text.replace(new RegExp(`<@${sid}(\\|[^>]*)?>`, 'g'), `<@${to}>`);
    }
    const files = [];
    for (const f of m.files || []) {
      if (f.mode === 'tombstone' || f.mode === 'hidden_by_limit') continue;
      const url = f.url_private_download || f.url_private; if (!url) continue;
      const ym = new Date(tsMs(m.ts)).toISOString().slice(0, 7);
      const k = `slack/${ym}/${f.id}/` + String(f.name || f.id).replace(/[^A-Za-z0-9 ._()\-]/g, '_');
      files.push({ key: k, name: f.name || f.id, size: f.size || 0, type: f.mimetype || 'application/octet-stream' });
      const have = await env.DB.prepare('SELECT 1 FROM files WHERE key=?').bind(k).first();
      if (!have && (f.size || 0) < 90e6) { S.files.push({ url, key: k, type: f.mimetype || '' }); stmts.push(env.DB.prepare('INSERT OR IGNORE INTO files (key,uploader,channel_id,created_at) VALUES (?,?,?,?)').bind(k, author, cid, tsMs(m.ts))); }
    }
    const thread = m.thread_ts && m.thread_ts !== m.ts ? await msgId(cid, m.thread_ts) : null;
    stmts.push(env.DB.prepare(`INSERT OR IGNORE INTO messages (id,channel_id,user_id,ts,thread_id,text,files,edited_ts,source,also_channel) VALUES (?,?,?,?,?,?,?,?,'slack',?)`)
      .bind(id, cid, author, tsMs(m.ts), thread, text, JSON.stringify(files), m.edited ? tsMs(m.edited.ts) : null, m.subtype === 'thread_broadcast' ? 1 : 0));
    for (const r of m.reactions || []) for (const u of r.users || []) stmts.push(env.DB.prepare('INSERT OR IGNORE INTO reactions (message_id,user_id,emoji) VALUES (?,?,?)').bind(id, await mapUser(ctx, u), emojiOf(r.name)));
    ctx.msgs++;
  }
  for (let i = 0; i < stmts.length; i += 80) await env.DB.batch(stmts.slice(i, i + 80));
}

async function finish(ctx) {
  const { env, S, user } = ctx;
  for (const cid of S.touched) {
    await env.DB.prepare(`UPDATE messages SET reply_count=(SELECT COUNT(*) FROM messages r WHERE r.thread_id=messages.id AND r.deleted=0),
        last_reply_ts=COALESCE((SELECT MAX(ts) FROM messages r WHERE r.thread_id=messages.id),0)
      WHERE channel_id=? AND thread_id IS NULL AND id IN (SELECT DISTINCT thread_id FROM messages WHERE channel_id=? AND thread_id IS NOT NULL)`).bind(cid, cid).run();
    const parents = await env.DB.prepare('SELECT id FROM messages WHERE channel_id=? AND reply_count>0').bind(cid).all();
    for (const p of parents.results) {
      const ru = (await env.DB.prepare('SELECT user_id FROM messages WHERE thread_id=? GROUP BY user_id ORDER BY MAX(ts) DESC LIMIT 5').bind(p.id).all()).results.map((x) => x.user_id);
      await env.DB.prepare('UPDATE messages SET reply_users=? WHERE id=?').bind(JSON.stringify(ru), p.id).run();
    }
    const last = (await env.DB.prepare('SELECT MAX(ts) t FROM messages WHERE channel_id=? AND thread_id IS NULL').bind(cid).first())?.t || 0;
    await env.DB.prepare('UPDATE channels SET last_ts=MAX(last_ts,?) WHERE id=?').bind(last, cid).run();
    // Nothing shows as unread for the person importing.
    await env.DB.prepare('UPDATE members SET last_read=MAX(last_read,?) WHERE channel_id=? AND user_id=?').bind(last, cid, user.id).run();
    // Same rule as the first import: conversations quiet for 180+ days are archived (DMs come back when someone writes).
    if (last && last < now() - 180 * 864e5) await env.DB.prepare("UPDATE channels SET archived=1 WHERE id=? AND kind='dm'").bind(cid).run();
  }
}
