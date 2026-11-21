// Unit checks (Slack import merge, sign-in throttling, migrations, background jobs, quotas, backups). Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { mergePlaceholder } from '../src/slackimport.js';

// Just enough of the D1 API on top of node:sqlite.
function d1() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => db.prepare(sql).run(...args),
  });
  return { db, DB: { prepare: (sql) => stmt(sql), batch: async (list) => { for (const s of list) await s.run(); } } };
}
const sha = async (s) => [...new Uint8Array(await crypto.subtle.digest('SHA-1', new TextEncoder().encode(s)))].map((x) => x.toString(16).padStart(2, '0')).join('');

test('placeholder DM merges into the real person and both halves end up in one DM', async () => {
  const { db, DB } = d1();
  const ph = 'U' + (await sha('UBOB')).slice(0, 16);
  const user = (id, email) => db.prepare("INSERT INTO users (id,email,name,role,active,created_at) VALUES (?,?,?,'member',1,0)").run(id, email, id);
  user('alice', 'alice@x.com'); user('bob', 'bob@x.com'); user(ph, 'ubob@bot.local');
  const dm = (id, key, a, b) => { db.prepare("INSERT INTO channels (id,kind,name,dm_key,private,created_at,last_ts) VALUES (?,'dm','',?,1,0,?)").run(id, key, 5); for (const u of [a, b]) db.prepare('INSERT INTO members (channel_id,user_id,last_read,joined_at) VALUES (?,?,0,0)').run(id, u); };
  dm('D1', ['alice', ph].sort().join(','), 'alice', ph);   // Alice's import, before Bob joined
  dm('D2', 'alice,bob', 'alice', 'bob');                   // Bob's own DM with Alice
  db.prepare("INSERT INTO messages (id,channel_id,user_id,ts,text) VALUES ('M1','D1',?,1,'hi <@' || ? || '>')").run(ph, ph);
  await mergePlaceholder({ DB }, 'UBOB', 'bob');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM users WHERE id=?').get(ph).n, 0);
  const m = db.prepare("SELECT * FROM messages WHERE id='M1'").get();
  assert.equal(m.user_id, 'bob'); assert.equal(m.channel_id, 'D2'); assert.equal(m.text, 'hi <@bob>');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM channels WHERE id='D1'").get().n, 0);
});

test('IPv6 sign-in throttling groups a whole /64', async () => {
  const { v6 } = await import('../src/features.js');
  const net = (a) => v6(a).slice(0, 4).join(':');
  assert.equal(net('2001:db8::1'), net('2001:db8::2'));
  assert.equal(net('2001:db8:0:0:1::1'), '2001:db8:0:0');
  assert.deepEqual(v6('1:2:3:4:5:6:7:8'), ['1', '2', '3', '4', '5', '6', '7', '8']);
});

test('migrations add only the columns an old database is missing', async () => {
  const { missingColumns, schemaColumns } = await import('../scripts/migrate.mjs');
  const sql = readFileSync(new URL('../schema.sql', import.meta.url), 'utf8');
  const cols = schemaColumns(sql);
  assert.ok(cols.users.some((c) => c.name === 'share_location'));
  assert.ok(!cols.members.some((c) => c.name === 'PRIMARY'));
  const have = Object.fromEntries(Object.entries(cols).map(([t, c]) => [t, c.map((x) => x.name)]));
  assert.deepEqual(missingColumns(sql, have), []);
  have.users = have.users.filter((n) => n !== 'share_location');
  have.files = have.files.filter((n) => n !== 'size');
  delete have.signins;   // a table the old database doesn't have: schema.sql creates it whole
  assert.deepEqual(missingColumns(sql, have).sort(), ['ALTER TABLE files ADD COLUMN size INTEGER NOT NULL DEFAULT 0', 'ALTER TABLE users ADD COLUMN share_location INTEGER NOT NULL DEFAULT 0']);
  // And the ALTERs really run on an old database.
  const db = new DatabaseSync(':memory:');
  db.exec("CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL, created_at INTEGER NOT NULL); CREATE TABLE files (key TEXT PRIMARY KEY);");
  const real = { users: db.prepare('PRAGMA table_info(users)').all().map((r) => r.name), files: ['key'] };
  for (const a of missingColumns(sql, real)) db.exec(a);
  db.exec(sql);
  assert.ok(db.prepare('PRAGMA table_info(users)').all().some((r) => r.name === 'share_location'));
});

// Background jobs: each runs in its own Durable Object alarm. These check the parts that decide what runs, once.
function fakeStorage() {
  const m = new Map(); let alarm = null;
  return { m, get alarm() { return alarm; }, get: async (k) => structuredClone(m.get(k)), put: async (k, v) => { m.set(k, structuredClone(v)); }, deleteAll: async () => { m.clear(); alarm = null; }, setAlarm: async (t) => { alarm = t; } };
}
function seed(db) {
  db.exec("INSERT INTO users (id,email,name,created_at) VALUES ('u1','a@b.c','A',0); INSERT INTO channels (id,name,created_at) VALUES ('c1','general',0); INSERT INTO members (channel_id,user_id,joined_at) VALUES ('c1','u1',0)");
}

test('a scheduled message is sent once, even when two runs race, and waits if moved later', async () => {
  const { sendScheduled } = await import('../src/features.js');
  const { db, DB } = d1(); seed(db);
  db.prepare("INSERT INTO scheduled (id,user_id,channel_id,text,send_at,created_at) VALUES ('s1','u1','c1','hi',1,0)").run();
  const sent = []; const post = async (env, ctx, u, ch, m) => { sent.push(m.text); return new Response('{}'); };
  const r = await Promise.all([sendScheduled({ DB }, {}, 's1', post), sendScheduled({ DB }, {}, 's1', post)]);
  assert.deepEqual(r, [null, null]);
  assert.deepEqual(sent, ['hi']);
  const later = Date.now() + 3600e3;
  db.prepare("INSERT INTO scheduled (id,user_id,channel_id,text,send_at,created_at) VALUES ('s2','u1','c1','later',?,0)").run(later);
  assert.equal(await sendScheduled({ DB }, {}, 's2', post), later);   // not due: the job sleeps until then
  assert.equal(sent.length, 1);
});

test('a reminder is claimed once and arrives as a DM from the bot', async () => {
  const { sendReminder } = await import('../src/features.js');
  const { db, DB } = d1(); seed(db);
  db.prepare("INSERT INTO reminders (id,user_id,text,due_at) VALUES ('r1','u1','call Sam',1)").run();
  const got = []; const post = async (env, ctx, u, ch, m) => got.push([u.email, ch.kind, m.text]);
  await Promise.all([sendReminder({ DB }, {}, 'r1', post), sendReminder({ DB }, {}, 'r1', post)]);
  assert.equal(got.length, 1);
  assert.deepEqual(got[0].slice(0, 2), ['yakyard@bot.local', 'dm']);
  assert.match(got[0][2], /^Reminder: call Sam/);
});

test('pushes go out 4 to a job, one job per batch', async () => {
  const { pushToUsers, PUSHES_PER_JOB } = await import('../src/features.js');
  const { db, DB } = d1();
  for (let i = 0; i < 10; i++) db.prepare("INSERT INTO push_subs (endpoint,user_id,p256dh,auth,created_at) VALUES (?,?,'k','a',0)").run('https://fcm.googleapis.com/' + i, i < 9 ? 'u1' : 'u2');
  const armed = [];
  const JOBS = { idFromName: (n) => n, get: (n) => ({ arm: async (job, at) => armed.push({ n, job, at }) }) };
  assert.equal(await pushToUsers({ DB, JOBS }, ['u1'], { title: 't' }), 9);
  assert.equal(PUSHES_PER_JOB, 4);
  assert.deepEqual(armed.map((a) => a.job.data.subs.length), [4, 4, 1]);
  assert.ok(armed.every((a) => a.n.startsWith('push:') && a.job.kind === 'push'));
});

test('a job runs from its alarm, sleeps until it is due again, retries with backoff, then gives up', async () => {
  const { jobArm, jobAlarm, JOB_TRIES } = await import('../src/features.js');
  const st = fakeStorage();
  await jobArm(st, { kind: 'import', id: 'u1' }, 0);
  assert.ok(st.alarm <= Date.now());
  let runs = 0;
  await jobAlarm(st, async () => { runs++; return 9e15; });          // wants to run again later
  assert.equal(st.alarm, 9e15); assert.equal(runs, 1);
  await jobAlarm(st, async () => null);                                  // done: everything cleared
  assert.equal(st.m.size, 0); assert.equal(st.alarm, null);
  await jobArm(st, { kind: 'voice', id: 'k' }, 0);
  const t0 = Date.now();
  for (let i = 1; i < JOB_TRIES; i++) {
    await jobAlarm(st, async () => { throw new Error('boom'); });
    assert.ok(st.alarm >= t0 + 15e3 * 2 ** i, 'backs off');
  }
  await jobAlarm(st, async () => { throw new Error('boom'); });
  assert.equal(st.m.size, 0, 'gives up after ' + JOB_TRIES + ' tries');
  // A newer arm() that lands while a run is going wins over what the run decided.
  await jobArm(st, { kind: 'sched', id: 's' }, 0);
  const t2 = Date.now() + 1e9;
  await jobAlarm(st, async () => { await jobArm(st, { kind: 'sched', id: 's' }, t2); return null; });
  assert.equal(st.alarm, t2); assert.equal(st.m.get('job').id, 's');
});

test('the 5-minute sweep re-arms only overdue work, and the hourly tidy-up', async () => {
  const { sweep } = await import('../src/features.js');
  const { db, DB } = d1(); seed(db);
  const t = Date.UTC(2026, 10, 21, 10, 2);   // minute 2: the hourly job is due too
  db.prepare("INSERT INTO scheduled (id,user_id,channel_id,text,send_at,created_at) VALUES ('old','u1','c1','x',?,0), ('soon','u1','c1','x',?,0)").run(t - 5 * 60e3, t + 60e3);
  db.prepare("INSERT INTO reminders (id,user_id,text,due_at) VALUES ('r','u1','x',?)").run(t - 120e3);
  db.prepare("INSERT INTO files (key,uploader,channel_id,created_at,voice,t_status,t_at) VALUES ('v1','u1','c1',0,'{}','pending',?), ('v2','u1','c1',0,'{}','pending',?)").run(t - 120e3, t + 864e5);
  const armed = [];
  const JOBS = { idFromName: (n) => n, get: (n) => ({ arm: async () => armed.push(n) }) };
  await sweep({ DB, JOBS }, t);
  assert.deepEqual(armed.sort(), ['house:hourly', 'rem:r', 'sched:old', 'voice:v1']);
});

test('Workers AI errors are told apart by code, not wording', async () => {
  const { aiErrorKind } = await import('../src/voice.js');
  assert.equal(aiErrorKind(new Error('3036: Account limited: you have used up your daily free allocation of 10,000 neurons.')), 'quota');
  assert.equal(aiErrorKind(new Error('InferenceUpstreamError: 3036: whatever the words say next year')), 'quota');
  assert.equal(aiErrorKind(Object.assign(new Error('limited'), { code: 3036, status: 429 })), 'quota');
  assert.equal(aiErrorKind(new Error('4006: daily free allocation')), 'quota');
  assert.equal(aiErrorKind(new Error('3040: Capacity temporarily exceeded')), 'busy');
  assert.equal(aiErrorKind(Object.assign(new Error('Too many'), { status: 429 })), 'busy');
  assert.equal(aiErrorKind(new Error('you have used up your neurons')), 'other');   // wording alone is not enough
  assert.equal(aiErrorKind(new Error('5007: No such model')), 'other');
  assert.equal(aiErrorKind('network down'), 'other');
});

test('D1 free-plan errors become the plain database messages', async () => {
  const { dbQuotaError, QUOTA_MSG } = await import('../src/features.js');
  const read = new Error("D1_ERROR: Your account has exceeded D1's free tier daily row read limit. Upgrade to a paid plan or wait until tomorrow (midnight UTC) to continue.");
  const write = new Error("Your account has exceeded D1's free tier daily row write limit. Upgrade to a paid plan or wait until tomorrow (midnight UTC) to continue. See https://developers.cloudflare.com/d1/platform/limits/ for more details.");
  assert.equal(dbQuotaError(read), 'daily'); assert.equal(dbQuotaError(write), 'daily');
  assert.equal(dbQuotaError(new Error('D1_ERROR: Exceeded maximum DB size.')), 'full');
  assert.equal(dbQuotaError(new Error('3036: daily free allocation')), null);   // a Workers AI limit is not the database
  assert.equal(dbQuotaError(new Error('SQLITE_CONSTRAINT: UNIQUE constraint failed')), null);
  assert.match(QUOTA_MSG.daily, /free database allowance.*midnight UTC/);
  assert.match(QUOTA_MSG.full, /database is full/);
});

test('storage in use stays exact through uploads, size changes and deletes', async () => {
  const { db } = d1(); seed(db);
  const used = () => +db.prepare("SELECT value FROM settings WHERE key='storage_bytes'").get().value;
  db.prepare("INSERT INTO files (key,uploader,created_at,size) VALUES ('a','u1',0,100), ('b','u1',0,50)").run();
  db.prepare("UPDATE files SET size=70 WHERE key='b'").run();
  db.prepare("DELETE FROM files WHERE key='a'").run();
  assert.equal(used(), 70);
  // An older database: the first migration counts what is already there.
  const old = new DatabaseSync(':memory:');
  old.exec("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE files (key TEXT PRIMARY KEY, uploader TEXT, channel_id TEXT, created_at INTEGER, voice TEXT, t_status TEXT, size INTEGER NOT NULL DEFAULT 0); INSERT INTO files (key,uploader,created_at,size) VALUES ('x','u',0,1234)");
  old.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  assert.equal(+old.prepare("SELECT value FROM settings WHERE key='storage_bytes'").get().value, 1234);
});

test('an older install moves its wrangler.toml settings into wrangler.jsonc', async () => {
  const { fromToml } = await import('../scripts/settings.mjs');
  const jsonc = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
  const out = fromToml('[[d1_databases]]\nbinding = "DB"\ndatabase_name = "team"\ndatabase_id = "1234-abcd"\n\n[vars]\nWORKSPACE_NAME = "Acme \\"Yard\\""\nTEAM_LOCATION = "1"\nNOT_A_SETTING = "x"\n', jsonc);
  assert.match(out, /"database_name": "team", "database_id": "1234-abcd"/);
  assert.match(out, /"WORKSPACE_NAME": "Acme \\"Yard\\""/);
  assert.match(out, /"TEAM_LOCATION": "1"/);
  assert.doesNotMatch(out, /NOT_A_SETTING/);
});

test('backups copy real tables parent first, copy standalone search tables, rebuild the others', async () => {
  const { plan, order, q } = await import('../scripts/backup.mjs');
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  const p = plan(db.prepare('SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY rowid').all());
  assert.deepEqual(p.ftsCopy, ['voice_fts']); assert.deepEqual(p.ftsRebuild, ['messages_fts']);
  assert.ok(!p.tables.some((t) => t.startsWith('messages_fts') || t.startsWith('voice_fts')));
  const fks = Object.fromEntries(p.tables.map((t) => [t, db.prepare(`PRAGMA foreign_key_list(${t})`).all().map((r) => r.table)]));
  const o = order(p.tables, fks);
  assert.ok(o.indexOf('users') < o.indexOf('credentials') && o.indexOf('channels') < o.indexOf('members'));
  assert.equal(q("it's"), "'it''s'"); assert.equal(q(null), 'NULL'); assert.equal(q(5), '5'); assert.equal(q([1, 255]), "X'01ff'");
});

test('the R2 cache serves fresh copies, drops expired ones, and keeps under its cap oldest first', async () => {
  const { cacheGet, cachePut, cacheCleanup } = await import('../src/cache.js');
  const store = new Map(); let clock = Date.now() - 10000;
  const FILES = {
    get: async (k) => { const o = store.get(k); return o && { ...o, body: { cancel: async () => {} } }; },
    put: async (k, body, opt) => { store.set(k, { key: k, size: typeof body === 'string' ? body.length : body.byteLength, uploaded: new Date(clock), customMetadata: opt.customMetadata, httpMetadata: opt.httpMetadata }); },
    list: async ({ prefix }) => ({ objects: [...store.values()].filter((o) => o.key.startsWith(prefix)), truncated: false }),
    delete: async (keys) => keys.forEach((k) => store.delete(k)),
  };
  const env = { FILES, IMG_CACHE_MB: '1' };
  await cachePut(env, 'img/a', new ArrayBuffer(600 * 1024), 60e3, 'image/png');
  assert.ok(await cacheGet(env, 'img/a'), 'fresh copy served');
  clock += 1000; await cachePut(env, 'img/b', new ArrayBuffer(600 * 1024), 3600e3, 'image/png');
  clock += 1000; await cachePut(env, 'unfurl/c', '{}', 10, 'application/json');
  assert.equal(await cacheGet(env, 'unfurl/c'), null, 'expired copy not served');
  const gone = await cacheCleanup(env, Date.now());
  assert.equal(gone, 2);   // the expired one, and the oldest picture to fit 1 MB
  assert.deepEqual([...store.keys()], ['cache/img/b']);
});

test('the CPU check reads wrangler tail output however it is split, and flags anything over 10 ms', async () => {
  const { jsonStream, eventName, report, checkConfig } = await import('../scripts/cpu-check.mjs');
  const got = []; const feed = jsonStream((o) => got.push(o));
  const a = { outcome: 'ok', cpuTime: 3.2, event: { request: { method: 'POST', url: 'https://x.dev/api/channels/C0123456789abcdef/messages' } } };
  const b = { outcome: 'exceededCpu', cpuTime: 11, eventType: 'alarm', entrypoint: 'Job', event: { scheduledTime: 1 } };
  const text = JSON.stringify(a, null, 2) + '\n' + JSON.stringify({ ...b, logs: ['a } in a string {'] });
  feed(text.slice(0, 50)); feed(text.slice(50, 51)); feed(text.slice(51));
  assert.equal(got.length, 2);
  assert.equal(eventName(got[0]), 'POST /api/channels/:id/messages');
  assert.equal(eventName(got[1]), 'alarm Job');
  const r = report(got);
  assert.deepEqual(r.bad, ['alarm Job']);
  const cfg = JSON.parse(checkConfig(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8')).replace(/^\/\/.*\n/, ''));
  assert.equal(cfg.limits.cpu_ms, 10); assert.equal(cfg.name, 'yakyard-cpu-check'); assert.equal(cfg.d1_databases[0].database_name, 'yakyard-cpu-check');
});
