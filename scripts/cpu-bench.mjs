// Local CPU benchmark that approximates Cloudflare, cold starts included. Run: npm run cpu-bench
// It bundles the Worker the way `wrangler deploy` does, then runs each request or job in a fresh Node process
// (same V8 engine as Workers) as the very first thing that process does, so the CPU includes compiling the code
// that path needs, like the first request on a new Cloudflare isolate. Database time is subtracted, because on
// Cloudflare D1 runs elsewhere and its time is not your CPU. Each path is then run 5 more times warm.
// Fails when any path's cold CPU goes over BUDGET (7 ms: 3 ms of headroom under the free plan's 10 ms).
// It is an estimate: Cloudflare's machines and workerd differ from this computer, so confirm with
// scripts/cpu-check.mjs on the real thing.
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomBytes, pbkdf2Sync, createECDH, generateKeyPairSync } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const OUT = join(root, '.wrangler', 'cpu-bench');
const BUDGET = +(process.env.CPU_BUDGET || 7);

// ---------------------------------------------------------------- the stand-ins for Cloudflare
function d1(db) {
  let dbMs = 0, trips = 0, inBatch = false;
  const timed = (f) => { if (!inBatch) trips++; const t = process.cpuUsage(); try { return f(); } finally { const d = process.cpuUsage(t); dbMs += (d.user + d.system) / 1000; } };
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    first: async (col) => { const r = timed(() => db.prepare(sql).get(...args)) ?? null; return col && r ? r[col] : r; },
    all: async () => ({ results: timed(() => db.prepare(sql).all(...args)), meta: {} }),
    run: async () => { const r = timed(() => db.prepare(sql).run(...args)); return { meta: { changes: Number(r.changes) } }; },
    raw: async () => timed(() => db.prepare(sql).all(...args).map((r) => Object.values(r))),
  });
  const batch = async (list) => { trips++; inBatch = true; try { const out = []; for (const s of list) out.push(await s.all()); return out; } finally { inBatch = false; } };
  return { DB: { prepare: (sql) => stmt(sql), batch }, dbMs: () => dbMs, trips: () => trips };
}
function r2() {
  const m = new Map();
  const obj = (k, v) => v && { key: k, size: v.bytes.byteLength, uploaded: v.uploaded, httpMetadata: v.http || {}, customMetadata: v.custom || {}, range: undefined,
    body: new Response(v.bytes).body, arrayBuffer: async () => v.bytes.buffer.slice(0), text: async () => new TextDecoder().decode(v.bytes), json: async () => JSON.parse(new TextDecoder().decode(v.bytes)),
    writeHttpMetadata: (h) => { if (v.http?.contentType) h.set('content-type', v.http.contentType); } };
  return {
    get: async (k) => obj(k, m.get(k)), head: async (k) => obj(k, m.get(k)),
    put: async (k, b, o = {}) => { const bytes = b == null ? new Uint8Array() : typeof b === 'string' ? new TextEncoder().encode(b) : b instanceof ReadableStream ? new Uint8Array(await new Response(b).arrayBuffer()) : new Uint8Array(b.buffer ? b.buffer : b); m.set(k, { bytes, uploaded: new Date(), http: o.httpMetadata, custom: o.customMetadata }); return obj(k, m.get(k)); },
    delete: async (k) => [].concat(k).forEach((x) => m.delete(x)),
    list: async ({ prefix = '' } = {}) => ({ objects: [...m.keys()].filter((k) => k.startsWith(prefix)).map((k) => obj(k, m.get(k))), truncated: false }),
  };
}
const ctxStub = () => { const waits = []; return { waits, waitUntil: (p) => waits.push(Promise.resolve(p).catch(() => {})), passThroughOnException() {} }; };
const sha = (s) => createHash('sha256').update(s).digest('hex');
const kdf = (pw, salt) => pbkdf2Sync(pw, Buffer.from(salt, 'base64'), 600000, 32, 'sha256').toString('base64');

// A database with a lived-in workspace: 3 people, 60 messages with reactions, files, voice notes and threads.
function seed(db, setup) {
  db.exec(readFileSync(join(root, 'schema.sql'), 'utf8'));
  // The browser's 600,000-round stretching happens here, before any timing: on Cloudflare it runs in the browser.
  if (setup) { const newSalt = randomBytes(16).toString('base64'); return { newSalt, newKey: kdf('benchpassword1', newSalt) }; }
  const now = Date.now(), salt = randomBytes(16).toString('base64'), key = kdf('benchpassword1', salt);
  const keyHash = 'c1:' + createHash('sha256').update(Buffer.concat([Buffer.from(salt, 'base64'), Buffer.from(key, 'base64')])).digest('base64');
  db.exec(`INSERT INTO settings (key,value) VALUES ('setup_done','1'),('app_url','https://bench.example')`);
  for (const [id, email, role] of [['Uowner00000000001', 'owner@example.com', 'owner'], ['Ubob0000000000002', 'bob@example.com', 'member'], ['Usam0000000000003', 'sam@example.com', 'member']])
    db.prepare("INSERT INTO users (id,email,name,role,active,created_at,color) VALUES (?,?,?,?,1,0,'#2b1bd6')").run(id, email, email.split('@')[0], role);
  db.prepare('INSERT INTO credentials (user_id,hash,salt,updated_at) VALUES (?,?,?,0)').run('Uowner00000000001', keyHash, salt);
  db.prepare('INSERT INTO sessions (id,user_id,created_at,expires_at) VALUES (?,?,?,?)').run(sha('sess_bench'), 'Uowner00000000001', now, now + 864e5);
  db.prepare("INSERT INTO channels (id,kind,name,private,created_at,last_ts) VALUES ('Cgeneral000000001','channel','general',0,0,?)").run(now);
  for (const u of ['Uowner00000000001', 'Ubob0000000000002', 'Usam0000000000003']) db.prepare("INSERT INTO members (channel_id,user_id,last_read,joined_at) VALUES ('Cgeneral000000001',?,0,0)").run(u);
  const file = (i) => JSON.stringify([{ key: `2026-11/F${i}/photo.png`, name: 'photo.png', size: 1234, type: 'image/png' }]);
  for (let i = 0; i < 60; i++) {
    const id = 'M' + String(i).padStart(16, '0');
    db.prepare('INSERT INTO messages (id,channel_id,user_id,ts,thread_id,text,files,reply_count,reply_users) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(id, 'Cgeneral000000001', i % 2 ? 'Ubob0000000000002' : 'Uowner00000000001', now - (60 - i) * 60e3, null, `Message ${i}: *launch* plan for <@Ubob0000000000002> https://example.com/page-${i}`, i % 5 ? '[]' : file(i), i % 7 ? 0 : 3, i % 7 ? '[]' : '["Ubob0000000000002"]');
    if (i % 3 === 0) db.prepare("INSERT INTO reactions (message_id,user_id,emoji) VALUES (?,?,'👍'),(?,?,'🎉')").run(id, 'Ubob0000000000002', id, 'Usam0000000000003');
    if (i % 5 === 0) db.prepare("INSERT INTO files (key,uploader,channel_id,created_at,size) VALUES (?,?,'Cgeneral000000001',0,1234)").run(`2026-11/F${i}/photo.png`, 'Uowner00000000001');
  }
  db.prepare("INSERT INTO scheduled (id,user_id,channel_id,text,files,send_at,created_at) VALUES ('Qbench00000000001','Uowner00000000001','Cgeneral000000001','Scheduled hello','[]',1,0)").run();
  db.prepare("INSERT INTO reminders (id,user_id,text,due_at) VALUES ('Rbench00000000001','Uowner00000000001','Call Sam',1)").run();
  return { salt, key };
}

// ---------------------------------------------------------------- one path, in this process
const SID = 'sess_bench', B = 'https://bench.example';
const req = (method, path, body, json = true) => new Request(B + path, { method, headers: { cookie: 'yy_session=' + SID, origin: B, ...(json && body ? { 'content-type': 'application/json' } : {}) }, body: body && json ? JSON.stringify(body) : body });
const PATHS = {
  'GET /setup': { setup: true, run: (w, env, s, ctx) => w.fetch(new Request(B + '/setup'), env, ctx) },
  'POST /setup': { setup: true, run: (w, env, s, ctx) => { const f = new URLSearchParams({ token: 'x'.repeat(30), name: 'Owner', email: 'owner@example.com', salt: s.newSalt, key: s.newKey, len: '14' }); return w.fetch(new Request(B + '/setup', { method: 'POST', headers: { origin: B, 'content-type': 'application/x-www-form-urlencoded' }, body: f }), env, ctx); } },
  'POST /auth/salt': { run: (w, env, s, ctx) => w.fetch(new Request(B + '/auth/salt', { method: 'POST', headers: { origin: B, 'content-type': 'application/json' }, body: JSON.stringify({ email: 'owner@example.com' }) }), env, ctx) },
  'POST /auth/login': { run: (w, env, s, ctx) => w.fetch(new Request(B + '/auth/login', { method: 'POST', headers: { origin: B, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ email: 'owner@example.com', key: s.key }) }), env, ctx) },
  'GET / (app shell)': { run: (w, env, s, ctx) => w.fetch(req('GET', '/'), env, ctx) },
  'GET /api/bootstrap': { run: (w, env, s, ctx) => w.fetch(req('GET', '/api/bootstrap'), env, ctx) },
  'GET /api/channels/:id/messages': { run: (w, env, s, ctx) => w.fetch(req('GET', '/api/channels/Cgeneral000000001/messages'), env, ctx) },
  'POST /api/channels/:id/messages': { run: (w, env, s, ctx) => w.fetch(req('POST', '/api/channels/Cgeneral000000001/messages', { text: `Hey <@Ubob0000000000002>, *bold* and a link https://example.com ${Math.random()}` }), env, ctx) },
  'POST reply in thread': { run: (w, env, s, ctx) => w.fetch(req('POST', '/api/channels/Cgeneral000000001/messages', { text: 'A reply', thread_id: 'M0000000000000000' }), env, ctx) },
  'PATCH /api/messages/:id': { run: (w, env, s, ctx) => w.fetch(req('PATCH', '/api/messages/M0000000000000001', { text: 'Edited ' + Math.random() }), env, ctx) },
  'POST /api/messages/:id/reactions': { run: (w, env, s, ctx) => w.fetch(req('POST', '/api/messages/M0000000000000002/reactions', { emoji: '🔥' }), env, ctx) },
  'GET /api/messages/:id/thread': { run: (w, env, s, ctx) => w.fetch(req('GET', '/api/messages/M0000000000000000/thread'), env, ctx) },
  'GET /api/search': { run: (w, env, s, ctx) => w.fetch(req('GET', '/api/search?q=launch%20from:@bob%20in:%23general'), env, ctx) },
  'POST /api/channels/:id/read': { run: (w, env, s, ctx) => w.fetch(req('POST', '/api/channels/Cgeneral000000001/read', { ts: Date.now() }), env, ctx) },
  'GET /files/:key': { run: (w, env, s, ctx) => w.fetch(req('GET', '/files/' + encodeURIComponent('2026-11/F0/photo.png')), env, ctx) },
  'GET /files/:key?w=880': { run: (w, env, s, ctx) => w.fetch(req('GET', '/files/' + encodeURIComponent('2026-11/F0/photo.png') + '?w=880'), env, ctx) },
  'POST /api/upload': { run: (w, env, s, ctx) => { const f = new FormData(); f.append('file', new Blob([randomBytes(200000)], { type: 'image/png' }), 'pic.png'); return w.fetch(new Request(B + '/api/upload', { method: 'POST', headers: { cookie: 'yy_session=' + SID, origin: B }, body: f }), env, ctx); } },
  'GET /api/admin/people': { run: (w, env, s, ctx) => w.fetch(req('GET', '/api/admin/people'), env, ctx) },
  'GET /api/later': { run: (w, env, s, ctx) => w.fetch(req('GET', '/api/later'), env, ctx) },
  'job: scheduled message': { job: { kind: 'sched', id: 'Qbench00000000001' } },
  'job: reminder': { job: { kind: 'rem', id: 'Rbench00000000001' } },
  'job: one push': { job: { kind: 'push', id: 'P1' }, push: true },
  'job: notification fan-out': { job: { kind: 'fanout', id: 'M0000000000000003' }, fanout: true },
  'cron: sweep': { cron: true },
};

async function one(name) {
  const p = PATHS[name];
  const db = new DatabaseSync(':memory:');
  const s = seed(db, p.setup);
  const shim = d1(db);
  const files = r2();
  await files.put('2026-11/F0/photo.png', new Uint8Array(randomBytes(300000)), { httpMetadata: { contentType: 'image/png' }, customMetadata: { name: 'photo.png' } });
  const pushes = [];
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jobs = [];
  const env = {
    DB: shim.DB, FILES: files, SETUP_TOKEN: 'x'.repeat(30), WORKSPACE_NAME: 'Bench', VAPID_PUBLIC: 'x', VAPID_SUBJECT: 'mailto:a@b.c',
    VAPID_PRIVATE: JSON.stringify({ ...privateKey.export({ format: 'jwk' }), key_ops: ['sign'], ext: true }), PUSH_TEST_URL: 'http://localhost:1/',
    ASSETS: { fetch: async (r) => { const u = new URL(r.url); const f = join(root, 'public', u.pathname === '/' ? 'index.html' : u.pathname); return new Response(existsSync(f) ? readFileSync(f) : 'x', { headers: { 'content-type': u.pathname === '/' ? 'text/html' : 'application/octet-stream' } }); } },
    HUB: { idFromName: (n) => n, get: () => ({ fetch: async () => new Response('[]') }) },
    JOBS: { idFromName: (n) => n, get: (n) => ({ arm: async (job, at) => jobs.push({ n, job, at }) }) },
    IMAGES: { input: () => ({ transform: () => ({ output: async () => ({ response: () => new Response(new Uint8Array(20000)) }) }) }) },
    AI: { run: async () => ({ text: 'hello' }) },
  };
  globalThis.fetch = async (u) => { pushes.push(String(u)); return new Response(null, { status: 201 }); };   // push services and the hub, never the network
  // Node loads its own Request, Response, URL and WebCrypto code on first use; workerd has them built in.
  // Use each once here so that loading is not counted as the Worker's CPU.
  { const r = new Request('https://x.dev/a?b=1', { method: 'POST', headers: { a: 'b' }, body: JSON.stringify({ a: 1 }) }); await r.json(); await new Response(new Uint8Array(3)).arrayBuffer(); await new Response('x').text();
    const f = new FormData(); f.append('a', new Blob(['x']), 'a.txt'); await new Request('https://x.dev', { method: 'POST', body: f }).formData(); await new Request('https://x.dev', { method: 'POST', body: new URLSearchParams({ a: 'b' }) }).formData();
    await crypto.subtle.digest('SHA-256', new Uint8Array(1));
    { const e = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']); const raw = await crypto.subtle.exportKey('raw', e.publicKey); const pk = await crypto.subtle.importKey('raw', raw, { name: 'ECDH', namedCurve: 'P-256' }, false, []); await crypto.subtle.deriveBits({ name: 'ECDH', public: pk }, e.privateKey, 256);
      const h = await crypto.subtle.importKey('raw', new Uint8Array(32), 'HKDF', false, ['deriveBits']); await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(16), info: new Uint8Array(1) }, h, 128);
      const a = await crypto.subtle.importKey('raw', new Uint8Array(16), 'AES-GCM', false, ['encrypt']); await crypto.subtle.encrypt({ name: 'AES-GCM', iv: new Uint8Array(12) }, a, new Uint8Array(4));
      const sk = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']); const j = await crypto.subtle.exportKey('jwk', sk.privateKey); const k2 = await crypto.subtle.importKey('jwk', j, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']); await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, k2, new Uint8Array(1));
      const p = await crypto.subtle.importKey('raw', new Uint8Array(8), 'PBKDF2', false, ['deriveBits']); await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new Uint8Array(16), iterations: 1 }, p, 256); } const k = await crypto.subtle.importKey('raw', new Uint8Array(32), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']); await crypto.subtle.sign('HMAC', k, new Uint8Array(1));
    new Intl.DateTimeFormat('en-GB', { hour: '2-digit', timeZone: 'UTC' }).format(new Date()); new TextEncoder().encode('x'); new TextDecoder().decode(new Uint8Array(1)); new Headers({ a: 'b' }); new URL('https://x.dev'); btoa('x'); atob('eA=='); new Response(null, { status: 302, headers: { location: '/' } }); structuredClone({ a: 1 }); }
  // Module load: on Cloudflare this happens when the isolate starts, outside the request's CPU, but it is reported.
  let t = process.cpuUsage();
  const mod = await import(join(OUT, 'worker.mjs'));
  let d = process.cpuUsage(t); const initMs = (d.user + d.system) / 1000;
  const w = mod.default;
  const subs = [];
  if (p.push) for (let i = 0; i < 1; i++) { const e = createECDH('prime256v1'); e.generateKeys(); subs.push({ endpoint: `https://fcm.googleapis.com/fcm/send/b${i}`, user_id: 'Ubob0000000000002', p256dh: e.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') }); }
  const fanoutData = { ch: { id: 'Cgeneral000000001', kind: 'channel', name: 'general' }, sender: { id: 'Uowner00000000001', name: 'owner' }, members: ['Uowner00000000001', 'Ubob0000000000002', 'Usam0000000000003'], direct: ['Ubob0000000000002'], wide: false, followers: [], at: Date.now() };
  if (p.fanout) for (let i = 0; i < 3; i++) db.prepare("INSERT INTO push_subs (endpoint,user_id,p256dh,auth,created_at) VALUES (?,?,'k','a',0)").run('https://fcm.googleapis.com/fcm/send/f' + i, 'Ubob0000000000002');
  const payload = { title: 'Owner in #general', body: 'Hello there, this is the push text', tag: 'C1', data: { url: '/#/c/C1', id: 'M1' } };
  const runOnce = async () => {
    const ctx = ctxStub();
    const db0 = shim.dbMs(), n0 = shim.trips(); const t0 = process.cpuUsage();
    if (p.job || p.cron) {
      const storage = new Map(); let alarm = 0;
      const st = { get: async (k) => storage.get(k), put: async (k, v) => storage.set(k, v), deleteAll: async () => storage.clear(), setAlarm: async (a) => (alarm = a) };
      if (p.cron) await w.scheduled({ scheduledTime: Date.UTC(2026, 10, 21, 10, 2), cron: '*/5 * * * *' }, env, ctx);
      else {
        const job = new mod.Job({ storage: st, waitUntil: ctx.waitUntil }, env);
        await job.arm({ ...p.job, data: p.push ? { subs, payload, vapid: 'vapid t=e30.e30.sig, k=key' } : p.fanout ? fanoutData : undefined }, 0);
        await job.alarm();
      }
    } else {
      const r = await p.run(w, env, s, ctx); await r.arrayBuffer();
    }
    await Promise.all(ctx.waits);
    const dd = process.cpuUsage(t0);
    runOnce.trips = shim.trips() - n0;
    return (dd.user + dd.system) / 1000 - (shim.dbMs() - db0);
  };
  if (process.env.BENCH_PREWARM) { const q = PATHS[process.env.BENCH_PREWARM]; const c = ctxStub(); const r = await q.run(w, env, s, c); await r.arrayBuffer(); await Promise.all(c.waits); }
  let sess;
  if (process.env.BENCH_PROFILE) { const { Session } = await import('node:inspector/promises'); sess = new Session(); sess.connect(); await sess.post('Profiler.enable'); await sess.post('Profiler.setSamplingInterval', { interval: 20 }); await sess.post('Profiler.start'); }
  const cold = await runOnce(); const coldTrips = runOnce.trips;
  if (sess) { const { profile } = await sess.post('Profiler.stop'); writeFileSync(process.env.BENCH_PROFILE, JSON.stringify(profile)); }
  const warm = [];
  for (let i = 0; i < 5; i++) {
    if (p.job && !p.push) db.exec("INSERT OR REPLACE INTO scheduled (id,user_id,channel_id,text,files,send_at,created_at) VALUES ('Qbench00000000001','Uowner00000000001','Cgeneral000000001','Scheduled hello','[]',1,0); UPDATE reminders SET done=0");
    if (p.setup && name === 'POST /setup') { db.exec('DELETE FROM credentials; DELETE FROM sessions; DELETE FROM members; DELETE FROM users; DELETE FROM channels; DELETE FROM sections'); db.exec("DELETE FROM settings WHERE key='setup_done'"); }
    warm.push(await runOnce());
  }
  return { name, initMs, cold, trips: coldTrips, warm: Math.max(...warm), median: warm.sort((a, b) => a - b)[2] };
}

// ---------------------------------------------------------------- orchestration
if (process.argv[2] === '--one') {
  const r = await one(process.argv[3]);
  process.stdout.write('\nRESULT ' + JSON.stringify(r));
} else {
  mkdirSync(OUT, { recursive: true });
  execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['wrangler', 'deploy', '--dry-run', '--config', 'wrangler.jsonc', '--outdir', OUT], { cwd: root, stdio: 'ignore', shell: process.platform === 'win32' });
  // The bundle imports the Workers runtime for DurableObject; a two-line stand-in is enough here.
  const src = readFileSync(join(OUT, 'worker.js'), 'utf8').replace(/import\s*\{[^}]*\}\s*from\s*"cloudflare:workers";/, 'class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } } class WorkerEntrypoint { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }');
  writeFileSync(join(OUT, 'worker.mjs'), src);
  const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const rows = [];
  for (const name of Object.keys(PATHS).filter((n) => !only.length || only.some((o) => n.includes(o)))) {
    const runs = [];
    for (let i = 0; i < 5; i++) {   // five fresh processes; the median cold start is reported
      const r = spawnSync(process.execPath, ['--no-warnings', fileURLToPath(import.meta.url), '--one', name], { cwd: root, encoding: 'utf8' });
      if (r.status !== 0) { console.error(name, r.stderr.slice(-800)); process.exit(1); }
      runs.push(JSON.parse(r.stdout.split('\nRESULT ').pop()));
    }
    runs.sort((a, b) => a.cold - b.cold);
    rows.push({ ...runs[2], coldMax: runs[4].cold });
  }
  console.log(`CPU per request, this computer, database time excluded (budget ${BUDGET} ms cold):\n`);
  // Each database round trip also costs some CPU on Cloudflare (the binding encodes the query and decodes the
  // answer), which this computer can't measure, so the count is shown: fewer is better.
  console.log('  cold   cold max   warm max   db trips   path');
  for (const r of rows) console.log(`${r.cold.toFixed(1).padStart(6)}  ${r.coldMax.toFixed(1).padStart(9)}  ${r.warm.toFixed(1).padStart(9)}  ${String(r.trips).padStart(9)}   ${r.name}${r.cold > BUDGET ? '   <-- over' : ''}`);
  console.log(`\nModule load (isolate start, not request CPU on Cloudflare): ${rows[0].initMs.toFixed(1)} ms`);
  const over = rows.filter((r) => r.cold > BUDGET);
  writeFileSync(join(OUT, 'report.json'), JSON.stringify(rows, null, 2));
  if (over.length) { console.log('\nOver budget: ' + over.map((r) => r.name).join(', ')); process.exit(1); }
}
