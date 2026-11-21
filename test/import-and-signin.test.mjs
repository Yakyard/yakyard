// Self-check for the Slack import placeholder merge. Run: npm test
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
