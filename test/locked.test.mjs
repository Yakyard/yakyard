// Locked conversations, server side: the two-step approvals, the owner setting, key relay rules,
// silent notifications and the Slack import guard. Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { e2eeApi, startLockedChannel, openLockedDm } from '../src/e2ee.js';
import { sendPushes } from '../src/features.js';

function env() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => db.prepare(sql).run(...args),
  });
  const DB = { prepare: (sql) => stmt(sql), batch: async (list) => { const out = []; for (const s of list) out.push(await s.all()); return out; } };
  const events = [];
  const x = {
    broadcast: async (e, ev, to) => { events.push({ ev, to }); },
    isMember: async (e, c, u) => !!db.prepare('SELECT 1 FROM members WHERE channel_id=? AND user_id=?').get(c, u),
    channelMembers: async (e, c) => db.prepare('SELECT user_id FROM members WHERE channel_id=?').all(c).map((r) => r.user_id),
    audience: async () => [],
  };
  const add = (id, role) => db.prepare("INSERT INTO users (id,email,name,role,active,created_at) VALUES (?,?,?,?,1,0)").run(id, id + '@x.com', id, role);
  add('owner', 'owner'); add('ada', 'admin'); add('ben', 'member'); add('cara', 'member');
  const call = async (user, method, path, body = {}) => {
    const u = db.prepare('SELECT * FROM users WHERE id=?').get(user);
    const r = await e2eeApi({ env: { DB }, user: u, path: path.split('?')[0], method, body, req: new Request('http://x' + path), x });
    return { status: r.status, body: await r.json() };
  };
  return { db, DB, x, events, call, user: (id) => db.prepare('SELECT * FROM users WHERE id=?').get(id) };
}
const channel = (t, by, members) => {
  t.db.prepare("INSERT INTO channels (id,kind,name,private,created_by,created_at) VALUES ('C1','channel','secret-plans',1,?,0)").run(by);
  for (const m of members) t.db.prepare("INSERT INTO members (channel_id,user_id,joined_at) VALUES ('C1',?,0)").run(m);
  return t.db.prepare("SELECT * FROM channels WHERE id='C1'").get();
};
const notes = (t, cid) => t.db.prepare("SELECT user_id, text FROM messages WHERE channel_id=? AND source='system' ORDER BY rowid").all(cid);

test('owner setting: off by default, only the owner, and only with the typed confirmation', async () => {
  const t = env();
  assert.equal((await t.call('owner', 'GET', '/api/e2ee/me')).body.allowed, false);
  assert.equal((await t.call('ada', 'POST', '/api/e2ee/allow', { on: true, confirm: 'lock' })).status, 403);
  assert.equal((await t.call('owner', 'POST', '/api/e2ee/allow', { on: true })).status, 400);
  assert.equal((await t.call('owner', 'POST', '/api/e2ee/allow', { on: true, confirm: 'lock' })).status, 200);
  assert.equal((await t.call('ben', 'GET', '/api/e2ee/me')).body.allowed, true);
});

test('channel: a member asks, posting waits, an admin (another person) approves, all recorded', async () => {
  const t = env();
  const ch = channel(t, 'ben', ['ben', 'cara']);
  await startLockedChannel({ DB: t.DB }, t.x, t.user('ben'), ch);
  assert.equal(t.db.prepare("SELECT locked FROM channels WHERE id='C1'").get().locked, 2);
  assert.ok(t.events.some((e) => e.ev.type === 'lock_request' && e.to.includes('owner') && e.to.includes('ada') && !e.to.includes('ben')));
  assert.equal((await t.call('ben', 'POST', '/api/channels/C1/lock/approve')).status, 403, 'a member cannot approve');
  assert.equal((await t.call('cara', 'POST', '/api/channels/C1/lock/accept')).status, 400, 'channels are not accepted by members');
  const r = await t.call('ada', 'POST', '/api/channels/C1/lock/approve');
  assert.equal(r.status, 200); assert.equal(r.body.locked, 1);
  const n = notes(t, 'C1');
  assert.match(n[0].text, /ben asked to lock this channel/); assert.equal(n[0].user_id, 'ben');
  assert.match(n[1].text, /ada approved locking/); assert.equal(n[1].user_id, 'ada');
  assert.equal((await t.call('owner', 'POST', '/api/channels/C1/lock/approve')).status, 404, 'nothing waiting any more');
});

test('channel: an admin who asked needs a different admin, unless they are the only one', async () => {
  const t = env();
  const ch = channel(t, 'ada', ['ada', 'ben']);
  await startLockedChannel({ DB: t.DB }, t.x, t.user('ada'), ch);
  assert.equal((await t.call('ada', 'POST', '/api/channels/C1/lock/approve')).status, 403);
  assert.equal((await t.call('owner', 'POST', '/api/channels/C1/lock/approve')).status, 200);
  // Only one admin in the workspace: their typed confirmation is the second step, and the note says so.
  const t2 = env();
  t2.db.prepare("UPDATE users SET role='member' WHERE id='ada'").run();
  const ch2 = channel(t2, 'owner', ['owner', 'ben']);
  await startLockedChannel({ DB: t2.DB }, t2.x, t2.user('owner'), ch2);
  const r = await t2.call('owner', 'POST', '/api/channels/C1/lock/approve');
  assert.equal(r.status, 200);
  assert.match(notes(t2, 'C1').pop().text, /the only admin/);
});

test('channel: declining removes the waiting channel and tells the person who asked', async () => {
  const t = env();
  const ch = channel(t, 'ben', ['ben']);
  await startLockedChannel({ DB: t.DB }, t.x, t.user('ben'), ch);
  const r = await t.call('owner', 'POST', '/api/channels/C1/lock/decline');
  assert.equal(r.status, 200);
  assert.equal(t.db.prepare("SELECT COUNT(*) n FROM channels WHERE id='C1'").get().n, 0);
  assert.ok(t.events.some((e) => e.ev.type === 'lock_declined' && e.to.includes('ben')));
});

test('DM: everyone in it accepts before it locks; declining removes it; a stranger cannot accept', async () => {
  const t = env();
  const ch = await openLockedDm({ DB: t.DB }, t.x, t.user('ben'), ['ben', 'cara']);
  assert.equal(ch.locked, 2); assert.match(ch.dm_key, /^L:/);
  assert.deepEqual(JSON.parse(ch.lock_accepts), ['ben']);
  assert.equal((await t.call('owner', 'POST', `/api/channels/${ch.id}/lock/accept`)).status, 403, 'not in it');
  assert.equal((await t.call('cara', 'POST', `/api/channels/${ch.id}/lock/approve`)).status, 400, 'DMs are accepted, not approved');
  const r = await t.call('cara', 'POST', `/api/channels/${ch.id}/lock/accept`);
  assert.equal(r.body.locked, 1);
  assert.deepEqual(notes(t, ch.id).map((n) => n.user_id), ['ben', 'cara', 'cara']);
  // Same people again: the same locked DM, not a new one. The normal DM is separate.
  assert.equal((await openLockedDm({ DB: t.DB }, t.x, t.user('cara'), ['ben', 'cara'])).id, ch.id);
  const t2 = env();
  const c2 = await openLockedDm({ DB: t2.DB }, t2.x, t2.user('ben'), ['ben', 'cara']);
  assert.equal((await t2.call('cara', 'POST', `/api/channels/${c2.id}/lock/decline`)).status, 200);
  assert.equal(t2.db.prepare('SELECT COUNT(*) n FROM channels WHERE id=?').get(c2.id).n, 0);
});

test('group DM locks only when the last person accepts', async () => {
  const t = env();
  const ch = await openLockedDm({ DB: t.DB }, t.x, t.user('ben'), ['ben', 'cara', 'ada']);
  assert.equal((await t.call('cara', 'POST', `/api/channels/${ch.id}/lock/accept`)).body.locked, 2);
  assert.equal((await t.call('ada', 'POST', `/api/channels/${ch.id}/lock/accept`)).body.locked, 1);
  assert.deepEqual(JSON.parse(t.db.prepare('SELECT lock_accepts FROM channels WHERE id=?').get(ch.id).lock_accepts).sort(), ['ada', 'ben', 'cara'], 'accepting twice or at once keeps everyone');
});

test('key relay: sealed packages only, to the device asked for; inbox is per device; backup is per person', async () => {
  const t = env();
  const k = 'A'.repeat(43);
  assert.equal((await t.call('ben', 'POST', '/api/e2ee/identity', { master_pub: k })).status, 200);
  assert.equal((await t.call('ben', 'POST', '/api/e2ee/identity', { master_pub: 'B'.repeat(43) })).status, 409, 'no silent replacement');
  await t.call('ben', 'POST', '/api/e2ee/devices', { device_id: 'DBEN0000001', curve: k, ed: k, sig: 's', otks: { a: k, b: k.replace('A', 'C') }, fallback: { id: 'f', key: k } });
  assert.equal((await t.call('ben', 'POST', '/api/e2ee/devices', { device_id: 'DBEN0000001', curve: 'D'.repeat(43), ed: k })).status, 409, 'device keys never change');
  const claim = async () => (await t.call('cara', 'POST', '/api/e2ee/claim', { devices: [{ user_id: 'ben', device_id: 'DBEN0000001' }] })).body;
  assert.deepEqual(await claim(), [], 'strangers cannot use up one-time keys');
  assert.equal((await t.call('cara', 'POST', '/api/e2ee/send', { device_id: 'DCARA000001', messages: [{ user_id: 'ben', device_id: 'DBEN0000001', sender_key: k, body: '0:sealed' }] })).body.sent, 0, 'strangers cannot send');
  t.db.prepare("INSERT INTO channels (id,kind,created_at) VALUES ('D8','dm',0)").run();
  for (const u of ['ben', 'cara']) t.db.prepare("INSERT INTO members (channel_id,user_id,joined_at) VALUES ('D8',?,0)").run(u);
  const c1 = await claim(), c2 = await claim(), c3 = await claim();
  assert.notEqual(c1[0].key, c2[0].key, 'each one-time key is handed out once'); assert.equal(c3[0].fallback, true);
  await t.call('cara', 'POST', '/api/e2ee/send', { device_id: 'DCARA000001', messages: [{ user_id: 'ben', device_id: 'DBEN0000001', sender_key: k, body: '0:sealed' }] });
  assert.equal((await t.call('ben', 'GET', '/api/e2ee/inbox?device=DOTHER00001')).body.length, 0);
  const inbox = (await t.call('ben', 'GET', '/api/e2ee/inbox?device=DBEN0000001')).body;
  assert.equal(inbox.length, 1); assert.equal(inbox[0].sender_user, 'cara');
  await t.call('cara', 'POST', '/api/e2ee/inbox/ack', { ids: [inbox[0].id] });
  assert.equal((await t.call('ben', 'GET', '/api/e2ee/inbox?device=DBEN0000001')).body.length, 1, 'only the owner of an inbox can clear it');
  await t.call('ben', 'PUT', '/api/e2ee/backup', { items: [{ session_id: 's1', data: 'x' }] });
  assert.equal((await t.call('cara', 'GET', '/api/e2ee/backup')).body.items.length, 0);
  assert.equal((await t.call('ben', 'GET', '/api/e2ee/backup')).body.items.length, 1);
  // Public keys: only of people you share a conversation with.
  assert.deepEqual((await t.call('ada', 'POST', '/api/e2ee/keys', { user_ids: ['ben'] })).body, {});
  assert.equal((await t.call('cara', 'POST', '/api/e2ee/keys', { user_ids: ['ben'] })).body.ben.devices.length, 1);
});

test('phone notifications for a locked conversation never carry the message', async () => {
  const armed = [];
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  db.prepare("INSERT INTO users (id,email,name,role,active,created_at,notify_level) VALUES ('u1','a@x.com','Ann','member',1,0,'all'),('u2','b@x.com','Bo','member',1,0,'all')").run();
  db.prepare("INSERT INTO push_subs (endpoint,user_id,p256dh,auth,created_at) VALUES ('https://fcm.googleapis.com/x','u2','p','a',0)").run();
  const stmt = (sql, args = []) => ({ bind: (...a) => stmt(sql, a), first: async () => db.prepare(sql).get(...args) ?? null, all: async () => ({ results: db.prepare(sql).all(...args) }), run: async () => db.prepare(sql).run(...args) });
  const e = {
    DB: { prepare: (sql) => stmt(sql) },
    HUB: { idFromName: () => 'h', get: () => ({ fetch: async () => new Response('[]') }) },
    JOBS: { idFromName: (n) => n, get: () => ({ arm: async (job) => { armed.push(job); } }) },
  };
  await sendPushes(e, { msg: { id: 'M1', text: '', files: [] }, ch: { id: 'D1', kind: 'dm', name: '', locked: 1 }, sender: { id: 'u1', name: 'Ann' }, members: ['u1', 'u2'], direct: [], wide: false, followers: [] });
  assert.equal(armed.length, 1);
  assert.equal(armed[0].data.payload.body, 'New message in a locked conversation');
  assert.equal(armed[0].data.payload.title, 'Yakyard');
  assert.ok(!JSON.stringify(armed[0].data.payload).includes('Ann'));
});

test('Slack import never writes into a locked conversation', async () => {
  const src = readFileSync(new URL('../src/slackimport.js', import.meta.url), 'utf8');
  const sql = src.match(/INSERT OR IGNORE INTO messages \(id,channel_id[^`]+/)[0];
  assert.match(sql, /locked<>0/);
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  db.prepare("INSERT INTO channels (id,kind,name,created_at,locked) VALUES ('L1','channel','l',0,1),('N1','channel','n',0,0)").run();
  for (const cid of ['L1', 'N1']) db.prepare(sql).run('M' + cid, cid, 'u', 1, null, 'from slack', '[]', null, 0, cid);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM messages WHERE channel_id='L1'").get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM messages WHERE channel_id='N1'").get().n, 1);
  assert.match(src, /map\.private === 1 && !map\.locked/);
});

test('public/lock matches packages/yakyard-lock (release manifest is current)', async () => {
  const { manifest } = await import('../scripts/lock-sync.mjs');
  const man = manifest();
  assert.deepEqual(JSON.parse(readFileSync(new URL('../public/lock/manifest.json', import.meta.url), 'utf8')), man);
});

test('docs/E2EE-HASHES.md lists this release and its security code', async () => {
  const { manifest, securityCode } = await import('../scripts/lock-sync.mjs');
  const doc = readFileSync(new URL('../docs/E2EE-HASHES.md', import.meta.url), 'utf8');
  const man = manifest();
  assert.ok(doc.includes(securityCode(man)), 'run npm run lock:sync');
  for (const h of Object.values(man.files)) assert.ok(doc.includes(h));
});
