// Public demo mode (DEMO_MODE): off by default, and when on: one-click sign-in, blocked features, rate limits,
// nightly reset. Runs the real Worker in Node with a small stand-in for D1, R2 and the Workers runtime. Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { DatabaseSync } from 'node:sqlite';

// worker.js imports 'cloudflare:workers'; give Node an empty stand-in for it.
register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(s, c, next) { return s === 'cloudflare:workers' ? { url: 'data:text/javascript,export class DurableObject {} export class WorkerEntrypoint {}', shortCircuit: true } : next(s, c); }`));
const { default: worker } = await import('../src/worker.js');
const demo = await import('../src/demo.js');

function d1() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => ({ meta: { changes: db.prepare(sql).run(...args).changes } }),
  });
  // D1 runs a batch as one transaction.
  const batch = async (list) => { db.exec('BEGIN'); try { const out = []; for (const s of list) out.push(await s.all()); db.exec('COMMIT'); return out; } catch (e) { db.exec('ROLLBACK'); throw e; } };
  return { db, DB: { prepare: (sql) => stmt(sql), batch } };
}
function envFor(vars = {}) {
  const { db, DB } = d1();
  const r2 = new Map();
  const audio = readFileSync(new URL('../public/demo/voice-note.mp3', import.meta.url));
  return {
    db, r2,
    env: {
      DB, ...vars,
      FILES: {
        head: async (k) => (r2.has(k) ? { size: r2.get(k).length } : null),
        put: async (k, body) => { r2.set(k, new Uint8Array(await new Response(body).arrayBuffer())); },
        get: async () => null,
      },
      ASSETS: { fetch: async (req) => (String(req.url || req).endsWith('/demo/voice-note.mp3') ? new Response(audio) : new Response('<!doctype html><title>Yakyard</title>', { headers: { 'content-type': 'text/html' } })) },
      HUB: { idFromName: () => 'x', get: () => ({ fetch: async () => new Response('ok') }) },
    },
  };
}
const B = 'https://demo.example';
const call = (env, path, { method = 'GET', cookie = '', body, ip = '203.0.113.7' } = {}) =>
  worker.fetch(new Request(B + path, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { origin: B, cookie, 'cf-connecting-ip': ip, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) } }), env, {});
const cookieOf = (r) => (r.headers.get('set-cookie') || '').split(';')[0];
async function visitor(env, ip) {
  const r = await call(env, '/auth/demo', { method: 'POST', ip });
  assert.equal(r.status, 303);
  return cookieOf(r);
}

test('demo mode is off by default: wrangler.jsonc never sets it, and a normal install shows the normal sign-in', async () => {
  const cfg = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
  assert.ok(!/DEMO_MODE/.test(cfg));
  assert.equal(demo.demoOn({}), false);
  assert.equal(demo.demoOn({ DEMO_MODE: '0' }), false);
  const { env, db } = envFor();
  db.prepare("INSERT INTO users (id,email,name,role,active,created_at) VALUES ('U1','o@x.com','Owner','owner',1,0)").run();
  const page = await (await call(env, '/')).text();
  assert.match(page, /Sign in to Yakyard/);
  assert.doesNotMatch(page, /Try the demo/);
  // No demo sign-in, no seeding, no new accounts.
  const r = await call(env, '/auth/demo', { method: 'POST' });
  assert.equal(r.headers.get('set-cookie'), null);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM users').get().n, 1);
  // The nightly reset job does nothing either.
  assert.equal(await worker.scheduled({ cron: demo.DEMO_CRON, scheduledTime: Date.now() }, env), undefined);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM users').get().n, 1);
  // A fresh install still goes to setup.
  const fresh = envFor().env;
  assert.equal((await call(fresh, '/')).headers.get('location'), '/setup');
});

test('demo: the sign-in page has one button and the banner text; one click seeds and signs in a new member', async () => {
  const { env, db, r2 } = envFor({ DEMO_MODE: '1' });
  const page = await (await call(env, '/')).text();
  assert.match(page, /Try the demo/);
  assert.match(page, /This is a public demo\. Everyone sees what you post\. It resets every night\./);
  assert.doesNotMatch(page, /type="password"/);
  assert.equal((await call(env, '/setup')).status, 200);   // setup page is never offered: the demo page shows instead
  assert.doesNotMatch(await (await call(env, '/setup')).text(), /Setup code/);
  const ck = await visitor(env);
  assert.ok(r2.get(demo.VOICE_KEY)?.length > 10000, 'voice note audio copied to R2');
  const boot = await (await call(env, '/api/bootstrap', { cookie: ck })).json();
  assert.equal(boot.workspace.demo, true);
  assert.equal(boot.me.role, 'member');
  assert.match(boot.me.name, /^Visitor \d{4}$/);
  assert.deepEqual(boot.channels.filter((c) => c.kind === 'channel').map((c) => c.name).sort(), ['general', 'launch', 'random', 'support']);
  assert.ok(boot.channels.every((c) => c.unread > 0), 'every channel starts with unread messages');
  // Posting, a thread reply and a reaction work.
  const launch = boot.channels.find((c) => c.name === 'launch');
  const m = await (await call(env, `/api/channels/${launch.id}/messages`, { method: 'POST', cookie: ck, body: { text: 'Hello from the demo' } })).json();
  assert.equal(m.text, 'Hello from the demo');
  const reply = await call(env, `/api/channels/${launch.id}/messages`, { method: 'POST', cookie: ck, body: { text: 'In a thread', thread_id: m.id } });
  assert.equal(reply.status, 200);
  assert.equal((await call(env, `/api/messages/${m.id}/reactions`, { method: 'POST', cookie: ck, body: { emoji: '👍' } })).status, 200);
  // The seeded voice note plays for a member and carries its transcript.
  const msgs = await (await call(env, `/api/channels/${launch.id}/messages`, { cookie: ck })).json();
  const vn = msgs.messages.flatMap((x) => x.files).find((f) => f.voice);
  assert.equal(vn.t, 'done');
  assert.match(vn.transcript, /kiln/);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM voice_fts WHERE voice_fts MATCH ?').get('kiln').n, 1);
});

test('demo: uploads, transcripts, admin, Slack import, invites, push, locked conversations and passwords are off, with a plain message', async () => {
  const { env } = envFor({ DEMO_MODE: '1' });
  const ck = await visitor(env);
  const blocked = [
    ['POST', '/api/upload', 'File uploads are off in this demo.'],
    ['POST', '/api/upload/start', 'File uploads are off in this demo.'],
    ['POST', '/api/me/avatar', 'File uploads are off in this demo.'],
    ['POST', '/api/voice/transcribe', 'New voice notes are off in this demo.'],
    ['GET', '/api/admin/users', 'Admin settings are off in this demo.'],
    ['POST', '/api/settings', 'Admin settings are off in this demo.'],
    ['GET', '/api/slack/import', 'The Slack import is off in this demo.'],
    ['GET', '/slack/connect', 'The Slack import is off in this demo.'],
    ['POST', '/api/invite', 'Invites are off in this demo.'],
    ['POST', '/api/push/subscribe', 'Phone notifications are off in this demo.'],
    ['POST', '/api/e2ee/identity', 'Locked conversations are off in this demo.'],
    ['POST', '/api/channels/C1/lock/accept', 'Locked conversations are off in this demo.'],
    ['POST', '/api/me/password', 'Passwords are off in this demo.'],
  ];
  for (const [method, path, msg] of blocked) {
    const r = await call(env, path, { method, cookie: ck, body: method === 'GET' ? undefined : {} });
    assert.equal(r.status, 403, path);
    assert.equal((await r.json()).error, msg, path);
  }
  // Asking for a locked DM fails too (locked conversations are never turned on in the demo).
  const boot = await (await call(env, '/api/bootstrap', { cookie: ck })).json();
  const mira = boot.users.find((u) => u.name === 'Mira Okafor');
  const dm = await call(env, '/api/dm', { method: 'POST', cookie: ck, body: { user_ids: [mira.id], lock: true } });
  assert.equal(dm.status, 403);
  assert.equal(boot.workspace.locked, false);
});

test('demo: rate limits on sign-ins per network, posts and writes per visitor; read marks are free', async () => {
  const { env } = envFor({ DEMO_MODE: '1' });
  for (let i = 0; i < 5; i++) await visitor(env, '198.51.100.1');
  const sixth = await call(env, '/auth/demo', { method: 'POST', ip: '198.51.100.1' });
  assert.equal(sixth.headers.get('set-cookie'), null);
  assert.match(await sixth.text(), /The demo is busy right now/);
  const ck = await visitor(env, '198.51.100.2');
  const ch = (await (await call(env, '/api/bootstrap', { cookie: ck })).json()).channels.find((c) => c.name === 'random');
  for (let i = 0; i < 40; i++) await call(env, `/api/channels/${ch.id}/read`, { method: 'POST', cookie: ck, body: {} });
  let last;
  for (let i = 0; i < 31; i++) last = await call(env, `/api/channels/${ch.id}/messages`, { method: 'POST', cookie: ck, body: { text: 'hi ' + i } });
  assert.equal(last.status, 429);
  assert.match((await last.json()).error, /Slow down/);
  // Other writes have their own, higher cap.
  for (let i = 0; i < 89; i++) assert.notEqual((await call(env, '/api/me', { method: 'PATCH', cookie: ck, body: { status_text: 's' + i } })).status, 429);
  assert.equal((await call(env, '/api/me', { method: 'PATCH', cookie: ck, body: { status_text: 'x' } })).status, 429);
});

test('demo: the nightly reset runs as a background job, wipes visitors and their posts, and seeds the same team again', async () => {
  const { env, db } = envFor({ DEMO_MODE: '1' });
  const armed = [];
  env.JOBS = { idFromName: (n) => n, get: (n) => ({ arm: async (job) => armed.push([n, job]) }) };
  const ck = await visitor(env);
  const seeded = db.prepare('SELECT COUNT(*) n FROM messages').get().n;
  const ch = (await (await call(env, '/api/bootstrap', { cookie: ck })).json()).channels[0];
  await call(env, `/api/channels/${ch.id}/messages`, { method: 'POST', cookie: ck, body: { text: 'gone tomorrow' } });
  await worker.scheduled({ cron: demo.DEMO_CRON, scheduledTime: Date.now() }, env);
  assert.ok(armed.some(([n]) => n === 'demoreset:nightly'), 'reset armed as a job');
  await worker.scheduled({ cron: '*/5 * * * *', scheduledTime: Date.now() }, env);
  assert.equal(armed.filter(([n]) => n === 'demoreset:nightly').length, 1, 'only the nightly cron arms it');
  await demo.demoReset(env);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM messages').get().n, seeded);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM users WHERE email LIKE 'visitor-%'").get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM sessions').get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM messages WHERE text='gone tomorrow'").get().n, 0);
  assert.equal((await call(env, '/api/bootstrap', { cookie: ck })).status, 401, 'old demo sessions end');
  // Threads add up, and storage stays exact through a reset.
  for (const p of db.prepare('SELECT id, reply_count FROM messages WHERE thread_id IS NULL').all()) assert.equal(p.reply_count, db.prepare('SELECT COUNT(*) n FROM messages WHERE thread_id=?').get(p.id).n);
  assert.equal(+db.prepare("SELECT value FROM settings WHERE key='storage_bytes'").get().value, db.prepare('SELECT SUM(size) n FROM files').get().n);
});

test('demo seed copy follows the brand voice: no em dashes, no exclamation marks, made-up emails only', () => {
  const src = readFileSync(new URL('../src/demo.js', import.meta.url), 'utf8');
  assert.ok(demo.seedStatements(envFor().env).length > 50);
  assert.doesNotMatch(src, /[—–]/);
  const strings = [...src.matchAll(/'([^'\\]|\\.)*'|"([^"\\]|\\.)*"/g)].map((m) => m[0]).filter((s) => / /.test(s));
  assert.ok(strings.every((s) => !s.includes('!')), strings.find((s) => s.includes('!')));
  assert.ok(![...src.matchAll(/[\w.-]+@[\w.-]+/g)].some((m) => !m[0].endsWith('demo.invalid')));
});
