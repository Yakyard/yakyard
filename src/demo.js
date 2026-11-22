// Public demo mode (DEMO_MODE = "1"). Off by default: nothing in this file runs for a normal install.
// A visitor clicks "Try the demo" and becomes a member of a seeded, made-up team. Uploads, new transcripts, admin,
// Slack import, invites, phone notifications and locked conversations are off. Writes are rate limited, and a
// nightly job (cron, then the usual background job) wipes everything and seeds it again. Each step is one small
// database batch, so it stays far under the free plan's 10 ms of CPU.

export const demoOn = (env) => env.DEMO_MODE === '1';
export const DEMO_CRON = '0 3 * * *';   // must match the second cron in wrangler.demo.jsonc
export const VOICE_KEY = 'demo/voice-note.mp3';

const json = (data, status) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const off = (what) => json({ error: `${what} off in this demo.` }, 403);

// What a demo visitor can't do, checked once per request before any handler runs.
const BLOCKED = [
  [(p) => p === '/api/upload' || p.startsWith('/api/upload/') || p === '/api/me/avatar', 'File uploads are'],
  [(p) => p === '/api/voice/transcribe', 'New voice notes are'],
  [(p, m) => p.startsWith('/api/admin/') || (p === '/api/settings' && m !== 'GET'), 'Admin settings are'],
  [(p) => p.startsWith('/slack/') || p.startsWith('/api/slack/'), 'The Slack import is'],
  [(p) => p === '/api/invite', 'Invites are'],
  [(p) => p.startsWith('/api/push/'), 'Phone notifications are'],
  [(p) => p.startsWith('/api/e2ee/') || /^\/api\/channels\/[^/]+\/lock\//.test(p), 'Locked conversations are'],
  [(p) => p === '/api/me/password', 'Passwords are'],
];
const WRITES_PER_15_MIN = 120, POSTS_PER_15_MIN = 30;
const isPost = (p, m) => m === 'POST' && (/^\/api\/channels\/[^/]+\/messages$/.test(p) || p === '/api/scheduled' || p === '/api/dm');

export async function demoGuard(env, user, path, method, bump) {
  for (const [hit, what] of BLOCKED) if (hit(path, method)) return off(what);
  if (method === 'GET' || method === 'HEAD' || !path.startsWith('/api/') || path.endsWith('/read')) return null;
  const slow = json({ error: 'Slow down a little. You can post again in a few minutes.' }, 429);
  if ((await bump(env, 'dw:' + user.id)) > WRITES_PER_15_MIN) return slow;
  if (isPost(path, method) && (await bump(env, 'dp:' + user.id)) > POSTS_PER_15_MIN) return slow;
  return null;
}

// ---------------------------------------------------------------- seed data (made-up people, no real brands)
const P = {
  mira: ['Mira Okafor', 'Founder', 'owner', '#2b1bd6'],
  tomas: ['Tomás Reyes', 'Workshop and shipping', 'member', '#a24a06'],
  priya: ['Priya Nair', 'Design and photos', 'member', '#8a1f5c'],
  jonah: ['Jonah Pike', 'Shop and website', 'member', '#16606b'],
  elif: ['Elif Demir', 'Customer support', 'member', '#6b2fb3'],
  sam: ['Sam Lindqvist', 'Wholesale', 'member', '#0f6e8c'],
};
const C = {
  general: 'Announcements for everyone',
  launch: 'Spring lamp launch, Thursday the 12th',
  support: 'Customer questions and fixes',
  random: 'Anything not about work',
};
const TRANSCRIPT = "Quick update from the workshop. The second batch came out of the kiln this morning, and the glaze finally looks right. I'll post photos after lunch. Can someone check that the big lamp fits the new shipping box before Thursday?";
const VOICE = { dur: 14.9, wave: [4, 78, 68, 32, 43, 35, 4, 4, 92, 57, 39, 42, 32, 49, 46, 21, 39, 58, 49, 42, 47, 29, 56, 4, 52, 66, 62, 63, 36, 48, 18, 4, 56, 100, 66, 39, 33, 51, 38, 43, 46, 42, 58, 24, 23, 53, 13, 4] };
// [id, channel, person, minutes ago, text, { re: parent id, react: { emoji: [people] }, pin, voice }]
const M = [
  ['g1', 'general', 'mira', 2900, 'Morning all. The spring launch date is set: Thursday the 12th. The checklist is in <#Cdemolaunch|launch>.', { react: { '🎉': ['tomas', 'priya', 'sam'], '👍': ['jonah', 'elif'] } }],
  ['g2', 'general', 'elif', 2860, 'The support inbox is under 20 open tickets. First time since January.', { react: { '🙌': ['mira', 'jonah', 'priya', 'sam'] } }],
  ['g2a', 'general', 'mira', 2850, "That's a big drop. What changed?", { re: 'g2' }],
  ['g2b', 'general', 'elif', 2840, 'Saved replies for the five questions we get most. Happy to share them.', { re: 'g2' }],
  ['g2c', 'general', 'jonah', 2820, "Please do. I'll link them from the help page.", { re: 'g2', react: { '👍': ['elif'] } }],
  ['g3', 'general', 'sam', 1160, 'Two new shops want the full range for their spring windows. Samples go out Monday.', { react: { '🔥': ['mira', 'tomas'] } }],
  ['g4', 'general', 'mira', 95, 'Team lunch Friday at 12:30. Tell <@Udemotomas> if you can\'t make it.', { react: { '🍜': ['priya', 'jonah', 'elif'] } }],
  ['g5', 'general', 'mira', 20, 'Trying the demo? Say hi below, reply in a thread or react to something. The voice note is in <#Cdemolaunch|launch>.', {}],
  ['l1', 'launch', 'mira', 1500, 'Launch checklist, round one:\n- Product photos (Priya)\n- Shop pages and prices (Jonah)\n- Packaging test (Tomás)\n- Email to the waitlist (Sam)\nShout if anything is missing.', { pin: 1, react: { '✅': ['priya', 'jonah', 'tomas'] } }],
  ['l1a', 'launch', 'priya', 1480, 'Photos are shot. Editing the last six today.', { re: 'l1' }],
  ['l1b', 'launch', 'jonah', 1430, 'Shop pages are up as drafts. Prices need a last look from <@Udemomira>.', { re: 'l1' }],
  ['l1c', 'launch', 'mira', 1400, 'On it after lunch.', { re: 'l1', react: { '🙏': ['jonah'] } }],
  ['l2', 'launch', 'sam', 600, 'Waitlist email is drafted. 1,240 people on the list so far.', { react: { '👀': ['mira'] } }],
  ['l3', 'launch', 'tomas', 70, '', { voice: 1, react: { '🔥': ['priya', 'mira'] } }],
  ['l3a', 'launch', 'jonah', 60, "I'll try the big lamp in the box this afternoon.", { re: 'l3' }],
  ['l4', 'launch', 'priya', 55, 'The glaze looks great in the photos too. Edits coming in an hour.', { react: { '❤️': ['tomas'] } }],
  ['s1', 'support', 'elif', 1700, 'A customer in Lyon asks if the lamps work on 230 V. I think yes, but can someone confirm?', {}],
  ['s1a', 'support', 'tomas', 1690, 'Yes. The fittings are rated 110 to 240 V. Only the plug changes.', { re: 's1' }],
  ['s1b', 'support', 'elif', 1680, 'Thanks, sent.', { re: 's1' }],
  ['s2', 'support', 'elif', 400, 'Saved replies for anyone covering the inbox this week: shipping times, returns, bulb types, care, custom orders. Ask me if one is missing.', { react: { '🙏': ['sam', 'jonah'] } }],
  ['r1', 'random', 'jonah', 2000, 'There is a sourdough starter in the fridge with a label that says Gerald. Is Gerald ours?', { react: { '😂': ['priya', 'sam', 'elif'] } }],
  ['r1a', 'random', 'priya', 1990, "Gerald is mine. Please don't feed him.", { re: 'r1', react: { '😂': ['jonah'] } }],
  ['r2', 'random', 'sam', 300, 'Best lunch spot near the new studio? Go.', {}],
];

const uidOf = (k) => 'Udemo' + k, cidOf = (k) => 'Cdemo' + k, midOf = (k) => 'Mdemo' + k;
// Tables a visitor can write to. Children before parents, so foreign keys never block a delete.
const WIPE = ['reactions', 'mentions', 'pins', 'saved', 'reminders', 'scheduled', 'sections', 'sessions', 'invites', 'credentials', 'signins',
  'oauth_states', 'pending_members', 'push_subs', 'slack_imports', 'slack_channels', 'e2ee_identity', 'e2ee_devices', 'e2ee_otk', 'e2ee_inbox',
  'e2ee_backup', 'voice_fts', 'files', 'messages', 'members', 'channels', 'users', 'login_attempts'];

export function seedStatements(env, t = Date.now(), voiceSize = 0) {
  const q = (sql, ...a) => env.DB.prepare(sql).bind(...a);
  const at = (min) => t - min * 60e3;
  const out = [...WIPE.map((x) => env.DB.prepare(`DELETE FROM ${x}`)), env.DB.prepare("DELETE FROM settings WHERE key <> 'storage_bytes'")];
  for (const [k, [name, title, role, color]] of Object.entries(P)) {
    out.push(q('INSERT INTO users (id,email,name,title,avatar,color,role,active,created_at) VALUES (?,?,?,?,\'\',?,?,1,?)', uidOf(k), k + '@demo.invalid', name, title, color, role, at(60 * 24 * 90)));
  }
  const last = {};
  for (const [, ch, , ago, , o] of M) if (!o.re) last[ch] = Math.max(last[ch] || 0, at(ago));
  for (const [k, topic] of Object.entries(C)) {
    out.push(q("INSERT INTO channels (id,kind,name,topic,private,archived,created_by,created_at,last_ts) VALUES (?,'channel',?,?,0,0,?,?,?)", cidOf(k), k, topic, uidOf('mira'), at(60 * 24 * 90), last[k] || 0));
    for (const p of Object.keys(P)) out.push(q('INSERT INTO members (channel_id,user_id,last_read,joined_at) VALUES (?,?,?,?)', cidOf(k), uidOf(p), t, at(60 * 24 * 90)));
  }
  const replies = {};
  for (const [id, , who, ago, , o] of M) if (o.re) (replies[o.re] ||= []).push([who, at(ago)]);
  for (const [id, ch, who, ago, text, o] of M) {
    const rs = replies[id] || [], files = [];
    if (o.voice) {
      files.push({ key: VOICE_KEY, name: 'Voice note.mp3', size: voiceSize, type: 'audio/mpeg', voice: VOICE, t: 'done', transcript: TRANSCRIPT });
      out.push(q("INSERT INTO files (key,uploader,channel_id,created_at,voice,transcript,t_status,size) VALUES (?,?,?,?,?,?,'done',?)", VOICE_KEY, uidOf(who), cidOf(ch), at(ago), JSON.stringify(VOICE), TRANSCRIPT, voiceSize));
      out.push(q('INSERT INTO voice_fts (text, message_id, file_key) VALUES (?,?,?)', TRANSCRIPT, midOf(id), VOICE_KEY));
    }
    const ru = [...new Set(rs.map(([w]) => uidOf(w)).reverse())].slice(0, 5);
    out.push(q('INSERT INTO messages (id,channel_id,user_id,ts,thread_id,text,files,reply_count,last_reply_ts,reply_users) VALUES (?,?,?,?,?,?,?,?,?,?)',
      midOf(id), cidOf(ch), uidOf(who), at(ago), o.re ? midOf(o.re) : null, text, JSON.stringify(files), rs.length, rs.length ? Math.max(...rs.map(([, ts]) => ts)) : 0, JSON.stringify(ru)));
    for (const [emoji, people] of Object.entries(o.react || {})) for (const p of people) out.push(q('INSERT INTO reactions (message_id,user_id,emoji) VALUES (?,?,?)', midOf(id), uidOf(p), emoji));
    if (o.pin) out.push(q('INSERT INTO pins (channel_id,message_id,user_id,created_at) VALUES (?,?,?,?)', cidOf(ch), midOf(id), uidOf('mira'), at(ago)));
  }
  out.push(q("INSERT INTO settings (key,value) VALUES ('setup_done',?), ('demo_seeded',?)", String(t), String(t)));
  return out;
}

// Wipes the workspace and seeds it again. Puts the voice note's audio in R2 first if it isn't there yet.
export async function demoReset(env, t = Date.now()) {
  let head = await env.FILES.head(VOICE_KEY);
  if (!head) {
    const r = await env.ASSETS.fetch('https://assets.local/' + VOICE_KEY);
    if (r.ok) { await env.FILES.put(VOICE_KEY, r.body, { httpMetadata: { contentType: 'audio/mpeg' }, customMetadata: { name: 'Voice note.mp3' } }); head = await env.FILES.head(VOICE_KEY); }
  }
  await env.DB.batch(seedStatements(env, t, head?.size || 0));
  return null;
}
export async function ensureSeeded(env) {
  if (!(await env.DB.prepare("SELECT 1 FROM settings WHERE key='demo_seeded'").first())) await demoReset(env);
}
