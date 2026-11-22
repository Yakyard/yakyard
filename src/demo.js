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
// A small lamp studio getting its spring range out on Thursday. People: [name, title, role, color, city, region,
// country, time zone, lat, lon, status emoji, status text]. Team clocks (TEAM_LOCATION) show their local time.
const P = {
  mira: ['Mira Okafor', 'Founder', 'owner', '#2b1bd6', 'Lisbon', 'Lisbon', 'PT', 'Europe/Lisbon', 38.7, -9.1, '', ''],
  tomas: ['Tomás Reyes', 'Workshop and shipping', 'member', '#a24a06', 'Lisbon', 'Lisbon', 'PT', 'Europe/Lisbon', 38.7, -9.1, '🔥', 'At the kiln'],
  priya: ['Priya Nair', 'Design and photos', 'member', '#8a1f5c', 'Berlin', 'Berlin', 'DE', 'Europe/Berlin', 52.5, 13.4, '', ''],
  jonah: ['Jonah Pike', 'Shop and website', 'member', '#16606b', 'Mexico City', 'Mexico City', 'MX', 'America/Mexico_City', 19.4, -99.1, '', ''],
  elif: ['Elif Demir', 'Customer support', 'member', '#6b2fb3', 'Istanbul', 'Istanbul', 'TR', 'Europe/Istanbul', 41, 29, '🎧', 'On the support inbox'],
  sam: ['Sam Lindqvist', 'Wholesale', 'member', '#0f6e8c', 'Bangkok', 'Bangkok', 'TH', 'Asia/Bangkok', 13.8, 100.5, '', ''],
};
// Channels: topic, and whether a new visitor starts with it unread.
const C = {
  general: ['Announcements for everyone', 1],
  launch: ['Spring lamp launch, Thursday the 12th', 1],
  design: ['Photos, packaging and the look of things', 1],
  wholesale: ['Shops, samples and orders', 0],
  support: ['Customer questions and fixes', 0],
  random: ['Anything not about work', 0],
};
const TRANSCRIPT = "Quick update from the workshop. The second batch came out of the kiln this morning, and the glaze finally looks right. I'll post photos after lunch. Can someone check that the big lamp fits the new shipping box before Thursday?";
const VOICE = { dur: 14.9, wave: [4, 78, 68, 32, 43, 35, 4, 4, 92, 57, 39, 42, 32, 49, 46, 21, 39, 58, 49, 42, 47, 29, 56, 4, 52, 66, 62, 63, 36, 48, 18, 4, 56, 100, 66, 39, 33, 51, 38, 43, 46, 42, 58, 24, 23, 53, 13, 4] };
// Files made for the demo (public/demo), copied to file storage on the first reset: a diagram, a price list, an order sheet.
export const DEMO_FILES = {
  voice: { key: VOICE_KEY, name: 'Voice note.mp3', type: 'audio/mpeg' },
  box: { key: 'demo/packaging-pebble-large.png', name: 'Pebble large in the new box.png', type: 'image/png' },
  prices: { key: 'demo/spring-price-list.pdf', name: 'Spring price list.pdf', type: 'application/pdf' },
  orders: { key: 'demo/spring-orders.csv', name: 'Spring window orders.csv', type: 'text/csv' },
};
// [id, channel, person, minutes ago, text, { re: parent id, react: { emoji: [people] }, pin, voice, file, here }]
// `here` marks an @here message: every new visitor gets a mention for it, so Activity and the badges have something.
const M = [
  ['g0', 'general', 'mira', 7150, 'Welcome to the new studio chat. One channel for each part of the work, DMs for everything else. Tell me if something is missing.', { react: { '👋': ['tomas', 'priya', 'jonah', 'elif', 'sam'] } }],
  ['g1', 'general', 'mira', 2900, 'Morning all. The spring launch date is set: Thursday the 12th. The checklist is in <#Cdemolaunch|launch>.', { react: { '🎉': ['tomas', 'priya', 'sam'], '👍': ['jonah', 'elif'] } }],
  ['g2', 'general', 'elif', 2860, 'The support inbox is under 20 open tickets. First time since January.', { react: { '🙌': ['mira', 'jonah', 'priya', 'sam'] } }],
  ['g2a', 'general', 'mira', 2850, "That's a big drop. What changed?", { re: 'g2' }],
  ['g2b', 'general', 'elif', 2840, 'Saved replies for the five questions we get most. Happy to share them.', { re: 'g2' }],
  ['g2c', 'general', 'jonah', 2820, "Please do. I'll link them from the help page.", { re: 'g2', react: { '👍': ['elif'] } }],
  ['g3', 'general', 'sam', 1160, 'Two new shops want the full range for their spring windows. Samples go out Monday. Details in <#Cdemowholesale|wholesale>.', { react: { '🔥': ['mira', 'tomas'] } }],
  ['g4', 'general', 'mira', 95, "<!here> Team lunch Friday at 12:30. Tell <@Udemotomas> if you can't make it.", { here: 1, react: { '🍜': ['priya', 'jonah', 'elif'] } }],
  ['g5', 'general', 'mira', 20, 'Trying the demo? Say hi below, reply in a thread or react to something. The voice note is in <#Cdemolaunch|launch>.', {}],

  ['l0', 'launch', 'mira', 5600, "Starting this channel for the spring launch. Everything about Thursday goes here, so the rest of you can mute it if you're busy.", {}],
  ['l0b', 'launch', 'jonah', 4300, "First draft of the launch page is up. Three lamps at the top, the rest below. I'm not sold on the headline yet.", { react: { '👀': ['mira', 'priya'] } }],
  ['l0c', 'launch', 'priya', 4280, 'Use the Pebble in Moss for the top photo. It looks better on screen than Sand.', { re: 'l0b' }],
  ['l0d', 'launch', 'jonah', 4260, 'Done. Headline is now "Lamps for long evenings". Better?', { re: 'l0b' }],
  ['l0e', 'launch', 'mira', 4200, 'Much better. Keep it.', { re: 'l0b', react: { '🙌': ['jonah'] } }],
  ['l1', 'launch', 'mira', 1500, 'Launch checklist, round one:\n- Product photos (Priya)\n- Shop pages and prices (Jonah)\n- Packaging test (Tomás)\n- Email to the waitlist (Sam)\nShout if anything is missing.', { pin: 1, react: { '✅': ['priya', 'jonah', 'tomas'] } }],
  ['l1a', 'launch', 'priya', 1480, 'Photos are shot. Editing the last six today.', { re: 'l1' }],
  ['l1b', 'launch', 'jonah', 1430, 'Shop pages are up as drafts. Prices need a last look from <@Udemomira>.', { re: 'l1' }],
  ['l1c', 'launch', 'mira', 1400, 'On it after lunch.', { re: 'l1', react: { '🙏': ['jonah'] } }],
  ['l2', 'launch', 'sam', 600, 'Waitlist email is drafted. 1,240 people on the list so far.', { react: { '👀': ['mira'] } }],
  ['l3', 'launch', 'tomas', 70, '', { voice: 1, react: { '🔥': ['priya', 'mira'] } }],
  ['l3a', 'launch', 'jonah', 60, "I'll try the big lamp in the box this afternoon.", { re: 'l3' }],
  ['l3b', 'launch', 'tomas', 45, 'Already did. It fits, diagram is in <#Cdemodesign|design>.', { re: 'l3' }],
  ['l4', 'launch', 'priya', 55, 'The glaze looks great in the photos too. Edits coming in an hour.', { react: { '❤️': ['tomas'] } }],
  ['l5', 'launch', 'mira', 30, '<!here> Last run-through tomorrow at 10:00 Lisbon time. Fifteen minutes, cameras optional.', { here: 1, react: { '👍': ['tomas', 'jonah', 'sam'] } }],

  ['d1', 'design', 'priya', 6900, 'Mood for the spring photos: warm paper, raw clay, one strong color per shot. No props with logos on them.', { react: { '❤️': ['mira'] } }],
  ['d2', 'design', 'priya', 3100, 'Glaze names for the shop, final unless someone hates them: Sand, Moss, Ink, Clay.', { react: { '👍': ['mira', 'jonah', 'sam'] } }],
  ['d3', 'design', 'tomas', 2600, 'Pebble large in the new box. 20 mm each side, 35 on top once the shade insert is in. Tight, but it fits.', { file: 'box', react: { '🙌': ['priya', 'mira'] } }],
  ['d3a', 'design', 'jonah', 2580, 'So we keep this box and skip the bigger size?', { re: 'd3' }],
  ['d3b', 'design', 'tomas', 2570, 'Yes. It saves about a dollar a lamp on shipping too.', { re: 'd3' }],
  ['d3c', 'design', 'mira', 2560, 'Good. Order 400.', { re: 'd3', react: { '👍': ['tomas'] } }],
  ['d4', 'design', 'priya', 900, 'Hero shot question: matte or gloss? React with a thumbs up for matte, a heart for gloss. Counting tonight.', { react: { '👍': ['mira', 'tomas'], '❤️': ['sam'] } }],

  ['w1', 'wholesale', 'sam', 5200, 'The spring price list is final. Pinning it here so nobody quotes the old prices.', { file: 'prices', pin: 1, react: { '✅': ['mira', 'jonah'] } }],
  ['w2', 'wholesale', 'sam', 3000, 'Opening orders stay at $400 minimum. Two shops asked, and both were fine with it.', {}],
  ['w3', 'wholesale', 'sam', 1100, 'Orders so far for the spring windows. Hollis Street wants theirs before launch, the other two after.', { file: 'orders', react: { '🔥': ['mira', 'tomas'] } }],
  ['w3a', 'wholesale', 'tomas', 1080, "Four large Pebbles for Hollis is fine. I'll pack them Friday.", { re: 'w3' }],
  ['w3b', 'wholesale', 'sam', 1070, "Thanks. I'll send them the tracking.", { re: 'w3' }],
  ['w4', 'wholesale', 'sam', 240, 'A shop in Melbourne asked if the wall light comes in Moss. Not this season, right?', {}],
  ['w4a', 'wholesale', 'priya', 230, 'Not this season. Maybe in the autumn.', { re: 'w4' }],

  ['s1', 'support', 'elif', 1700, 'A customer in Lyon asks if the lamps work on 230 V. I think yes, but can someone confirm?', {}],
  ['s1a', 'support', 'tomas', 1690, 'Yes. The fittings are rated 110 to 240 V. Only the plug changes.', { re: 's1' }],
  ['s1b', 'support', 'elif', 1680, 'Thanks, sent.', { re: 's1' }],
  ['s2', 'support', 'elif', 400, 'Saved replies for anyone covering the inbox this week: shipping times, returns, bulb types, care, custom orders. Ask me if one is missing.', { react: { '🙏': ['sam', 'jonah'] } }],
  ['s3', 'support', 'elif', 150, "Two people asked if the shades are washable. Spot clean only. I've added it to the care page.", { react: { '👍': ['jonah'] } }],

  ['r0', 'random', 'priya', 3500, 'Studio cat update: she has taken over the glaze shelf.', { react: { '😂': ['tomas', 'elif'], '❤️': ['mira'] } }],
  ['r1', 'random', 'jonah', 2000, 'There is a sourdough starter in the fridge with a label that says Gerald. Is Gerald ours?', { react: { '😂': ['priya', 'sam', 'elif'] } }],
  ['r1a', 'random', 'priya', 1990, "Gerald is mine. Please don't feed him.", { re: 'r1', react: { '😂': ['jonah'] } }],
  ['r2', 'random', 'sam', 300, 'Best lunch spot near the new studio? Go.', {}],
  ['r2a', 'random', 'tomas', 290, 'The bifana place on the corner. Cash only.', { re: 'r2' }],
  ['r2b', 'random', 'elif', 280, 'Seconded.', { re: 'r2' }],
];

// Each visitor gets a first name, and their own DMs from the team (wiped with everything else at night).
const NAMES = ['Alex', 'Robin', 'Noor', 'Kai', 'Luca', 'Ines', 'Wren', 'Theo', 'Zara', 'Milo', 'Ada', 'Juno', 'Rafa', 'Lena', 'Omar', 'Yuki', 'Nico', 'Sasha', 'Iris', 'Jules'];
export const visitorName = (r = Math.random()) => NAMES[Math.floor(r * NAMES.length) % NAMES.length];
// [with, minutes ago, text]. {name} is the visitor's first name, {me} mentions them. `read` DMs start read.
const DMS = [
  { with: ['mira'], msgs: [
    ['mira', 12, "Hi {name}, welcome in. I'm Mira, I run the studio. We make ceramic lamps, and the spring range goes out Thursday."],
    ['mira', 12, 'Start with <#Cdemolaunch|launch>. The checklist is pinned at the top, and Tomás left a voice note with the transcript under it.'],
    ['mira', 11, 'Reply in a thread, react to anything. Nothing breaks, and it all resets tonight.'],
  ] },
  { with: ['jonah', 'mira', 'sam'], msgs: [
    ['jonah', 55, 'Making a small group for launch morning so <#Cdemolaunch|launch> stays readable.'],
    ['sam', 52, 'Good. The waitlist email goes out at 9:00, the shop opens at 10:00.'],
    ['jonah', 50, "{me}, you're on refresh duty with me. If the shop page breaks, shout here."],
    ['mira', 48, "I'll bring pastries."],
  ] },
  { with: ['tomas'], msgs: [
    ['tomas', 25, "Hey {name}, Tomás here. I'm in the workshop most days, so you'll mostly get voice notes from me."],
    ['tomas', 24, 'If you want to help: the packaging diagram is in <#Cdemodesign|design>. Tell me in the thread if something looks off.'],
  ] },
  { with: ['priya'], msgs: [
    ['priya', 40, "Hi, I'm Priya, I do the photos. I'm stuck between matte and gloss for the hero shot. Could you vote with a reaction on my post in <#Cdemodesign|design>?"],
  ] },
  { with: ['elif'], read: 1, msgs: [
    ['elif', 180, 'Welcome. A tip from support: search reads voice notes too. Type "kiln" in the search bar at the top and you get the one Tomás sent.'],
  ] },
];

const uidOf = (k) => 'Udemo' + k, cidOf = (k) => 'Cdemo' + k, midOf = (k) => 'Mdemo' + k;
// Tables a visitor can write to. Children before parents, so foreign keys never block a delete.
const WIPE = ['reactions', 'mentions', 'pins', 'saved', 'reminders', 'scheduled', 'sections', 'sessions', 'invites', 'credentials', 'signins',
  'oauth_states', 'pending_members', 'push_subs', 'slack_imports', 'slack_channels', 'e2ee_identity', 'e2ee_devices', 'e2ee_otk', 'e2ee_inbox',
  'e2ee_backup', 'voice_fts', 'files', 'messages', 'members', 'channels', 'users', 'login_attempts'];

// Bump when the seed changes: the next demo sign-in after a deploy then wipes and seeds again.
export const SEED_VERSION = '2';
// Visitors have made-up emails starting with "visitor-". Other visitors stay out of member lists, counts, pickers and
// team clocks, so a visitor sees the six teammates, not a pile of strangers.
export const VISITOR_LIKE = 'visitor-%';
export const isVisitor = (u) => /^visitor-/.test(u?.email || '');

export function seedStatements(env, t = Date.now(), sizes = {}) {
  const q = (sql, ...a) => env.DB.prepare(sql).bind(...a);
  const at = (min) => t - min * 60e3;
  const out = [...WIPE.map((x) => env.DB.prepare(`DELETE FROM ${x}`)), env.DB.prepare("DELETE FROM settings WHERE key <> 'storage_bytes'")];
  for (const [k, [name, title, role, color, city, region, country, tz, lat, lon, se, st]] of Object.entries(P)) {
    out.push(q(`INSERT INTO users (id,email,name,title,avatar,color,role,active,created_at,share_location,city,region,country,tz,lat,lon,loc_at,status_emoji,status_text)
      VALUES (?,?,?,?,'',?,?,1,?,1,?,?,?,?,?,?,?,?,?)`, uidOf(k), k + '@demo.invalid', name, title, color, role, at(60 * 24 * 90), city, region, country, tz, lat, lon, t, se, st));
  }
  const last = {};
  for (const [, ch, , ago, , o] of M) if (!o.re) last[ch] = Math.max(last[ch] || 0, at(ago));
  for (const [k, [topic]] of Object.entries(C)) {
    out.push(q("INSERT INTO channels (id,kind,name,topic,private,archived,created_by,created_at,last_ts) VALUES (?,'channel',?,?,0,0,?,?,?)", cidOf(k), k, topic, uidOf('mira'), at(60 * 24 * 90), last[k] || 0));
    for (const p of Object.keys(P)) out.push(q('INSERT INTO members (channel_id,user_id,last_read,joined_at) VALUES (?,?,?,?)', cidOf(k), uidOf(p), t, at(60 * 24 * 90)));
  }
  const replies = {};
  for (const [id, , who, ago, , o] of M) if (o.re) (replies[o.re] ||= []).push([who, at(ago)]);
  for (const [id, ch, who, ago, text, o] of M) {
    const rs = replies[id] || [], files = [];
    const f = o.voice ? DEMO_FILES.voice : o.file ? DEMO_FILES[o.file] : null;
    if (f) {
      const size = sizes[f.key] || 0;
      if (o.voice) {
        files.push({ ...f, size, voice: VOICE, t: 'done', transcript: TRANSCRIPT });
        out.push(q("INSERT INTO files (key,uploader,channel_id,created_at,voice,transcript,t_status,size) VALUES (?,?,?,?,?,?,'done',?)", f.key, uidOf(who), cidOf(ch), at(ago), JSON.stringify(VOICE), TRANSCRIPT, size));
        out.push(q('INSERT INTO voice_fts (text, message_id, file_key) VALUES (?,?,?)', TRANSCRIPT, midOf(id), f.key));
      } else {
        files.push({ ...f, size });
        out.push(q('INSERT INTO files (key,uploader,channel_id,created_at,size) VALUES (?,?,?,?,?)', f.key, uidOf(who), cidOf(ch), at(ago), size));
      }
    }
    const ru = [...new Set(rs.map(([w]) => uidOf(w)).reverse())].slice(0, 5);
    out.push(q('INSERT INTO messages (id,channel_id,user_id,ts,thread_id,text,files,reply_count,last_reply_ts,reply_users) VALUES (?,?,?,?,?,?,?,?,?,?)',
      midOf(id), cidOf(ch), uidOf(who), at(ago), o.re ? midOf(o.re) : null, text, JSON.stringify(files), rs.length, rs.length ? Math.max(...rs.map(([, ts]) => ts)) : 0, JSON.stringify(ru)));
    for (const [emoji, people] of Object.entries(o.react || {})) for (const p of people) out.push(q('INSERT INTO reactions (message_id,user_id,emoji) VALUES (?,?,?)', midOf(id), uidOf(p), emoji));
    if (o.pin) out.push(q('INSERT INTO pins (channel_id,message_id,user_id,created_at) VALUES (?,?,?,?)', cidOf(ch), midOf(id), uidOf(who), at(ago)));
  }
  out.push(q("INSERT INTO settings (key,value) VALUES ('setup_done',?), ('demo_seeded',?), ('demo_seed_v',?)", String(t), String(t), SEED_VERSION));
  return out;
}

// A new visitor: in every channel (some read, some not), a mention for each @here, and their own DMs from the team.
export function visitorStatements(env, v, t = Date.now()) {
  const q = (sql, ...a) => env.DB.prepare(sql).bind(...a);
  const at = (min) => t - min * 60e3;
  const first = v.name.split(' ')[0];
  const out = [q("INSERT OR IGNORE INTO members (channel_id,user_id,last_read,joined_at) SELECT id,?,0,? FROM channels WHERE kind='channel' AND private=0 AND archived=0", v.id, t)];
  const read = Object.entries(C).filter(([, [, unread]]) => !unread).map(([k]) => cidOf(k));
  out.push(q(`UPDATE members SET last_read=? WHERE user_id=? AND channel_id IN (${read.map(() => '?').join(',')})`, t, v.id, ...read));
  // @here messages still in place (a visitor may have deleted one) mention the visitor too.
  for (const [id, ch, , , , o] of M) if (o.here) out.push(q('INSERT OR IGNORE INTO mentions (message_id,user_id,channel_id,ts) SELECT id,?,channel_id,ts FROM messages WHERE id=? AND deleted=0', v.id, midOf(id)));
  DMS.forEach((dm, i) => {
    const people = dm.with.map(uidOf), ids = [v.id, ...people].sort(), cid = 'D' + v.id.slice(1, 13) + i;
    const lastTs = Math.max(...dm.msgs.map(([, ago]) => at(ago)));
    out.push(q("INSERT INTO channels (id,kind,name,dm_key,private,created_by,created_at,last_ts) VALUES (?,'dm','',?,1,?,?,?)", cid, ids.join(','), people[0], at(240), lastTs));
    for (const u of ids) out.push(q('INSERT INTO members (channel_id,user_id,last_read,joined_at) VALUES (?,?,?,?)', cid, u, u === v.id && !dm.read ? 0 : t, at(240)));
    dm.msgs.forEach(([who, ago, text], j) => {
      const mid = 'M' + v.id.slice(1, 13) + i + 'x' + j;
      out.push(q("INSERT INTO messages (id,channel_id,user_id,ts,text,files) VALUES (?,?,?,?,?,'[]')", mid, cid, uidOf(who), at(ago) + j, text.replaceAll('{name}', first).replaceAll('{me}', `<@${v.id}>`)));
      out.push(q('INSERT INTO mentions (message_id,user_id,channel_id,ts) VALUES (?,?,?,?)', mid, v.id, cid, at(ago) + j));
    });
  });
  return out;
}

// Wipes the workspace and seeds it again. Puts the demo files in file storage first if they aren't there yet.
export async function demoReset(env, t = Date.now()) {
  const sizes = {};
  for (const f of Object.values(DEMO_FILES)) {
    let head = await env.FILES.head(f.key);
    if (!head) {
      const r = await env.ASSETS.fetch('https://assets.local/' + f.key);
      if (r.ok) { await env.FILES.put(f.key, r.body, { httpMetadata: { contentType: f.type }, customMetadata: { name: f.name } }); head = await env.FILES.head(f.key); }
    }
    sizes[f.key] = head?.size || 0;
  }
  await env.DB.batch(seedStatements(env, t, sizes));
  return null;
}
export async function ensureSeeded(env) {
  const v = await env.DB.prepare("SELECT value FROM settings WHERE key='demo_seed_v'").first();
  if (v?.value !== SEED_VERSION) await demoReset(env);
}
