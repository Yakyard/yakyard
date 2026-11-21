// Proves on real Cloudflare that every route and every background job stays under the free plan's 10 ms of CPU.
// It deploys nothing by itself. Steps (see docs/SETUP.md, "Check the CPU limit"):
//   node scripts/cpu-check.mjs prepare        writes wrangler.cpu-check.jsonc (a copy of wrangler.jsonc named
//                                             yakyard-cpu-check, with limits.cpu_ms = 10 and its own database and
//                                             bucket) and .cpu-check-secrets.json (setup code and push keys)
//   npx wrangler deploy --config wrangler.cpu-check.jsonc
//   npx wrangler d1 execute DB --remote --config wrangler.cpu-check.jsonc --file schema.sql
//   npx wrangler secret bulk .cpu-check-secrets.json --config wrangler.cpu-check.jsonc
//   node scripts/cpu-check.mjs run https://yakyard-cpu-check.<you>.workers.dev
//   npx wrangler delete --config wrangler.cpu-check.jsonc   (then delete its database and bucket, see SETUP)
// `run` follows the Worker's live logs (wrangler tail) while it uses every part of the app, waits for the jobs and
// one cron run, then prints CPU per route. Any invocation over 10 ms fails with "exceededCpu" (the cpu_ms limit
// applies the free plan's limit on any account), and the run exits with an error.
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes, pbkdf2Sync, generateKeyPairSync, createECDH } from 'node:crypto';
import { root } from './wrangler.mjs';

const CONFIG = 'wrangler.cpu-check.jsonc', SECRETS = '.cpu-check-secrets.json', LIMIT = 10, TARGET = 7, PACE = 400;
const stripJsonc = (t) => t.replace(/("(?:[^"\\]|\\.)*")|\/\/[^\n]*/g, (m, str) => str || '');

export function checkConfig(jsonc) {
  const c = JSON.parse(stripJsonc(jsonc).replace(/,(\s*[}\]])/g, '$1'));
  c.name = 'yakyard-cpu-check';
  c.limits = { cpu_ms: LIMIT };
  c.d1_databases = [{ binding: 'DB', database_name: 'yakyard-cpu-check' }];
  c.r2_buckets = [{ binding: 'FILES', bucket_name: 'yakyard-cpu-check' }];
  c.observability = { enabled: true };
  c.vars = { ...c.vars, WORKSPACE_NAME: 'CPU check', OWNER_EMAILS: 'cpu@example.com', TEAM_LOCATION: '1' };
  delete c.$schema;
  return '// Made by `node scripts/cpu-check.mjs prepare`. Temporary: delete the Worker after the check.\n' + JSON.stringify(c, null, 2) + '\n';
}

function prepare() {
  writeFileSync(join(root, CONFIG), checkConfig(readFileSync(join(root, 'wrangler.jsonc'), 'utf8')));
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = privateKey.export({ format: 'jwk' }), pub = publicKey.export({ format: 'jwk' });
  const raw = Buffer.concat([Buffer.from([4]), Buffer.from(pub.x, 'base64url'), Buffer.from(pub.y, 'base64url')]).toString('base64url');
  const cfg = readFileSync(join(root, CONFIG), 'utf8').replace(/"VAPID_PUBLIC": "[^"]*"/, `"VAPID_PUBLIC": "${raw}"`).replace(/"VAPID_SUBJECT": "[^"]*"/, '"VAPID_SUBJECT": "mailto:cpu@example.com"');
  writeFileSync(join(root, CONFIG), cfg);
  writeFileSync(join(root, SECRETS), JSON.stringify({ SETUP_TOKEN: randomBytes(24).toString('hex'), VAPID_PRIVATE: JSON.stringify({ ...jwk, key_ops: ['sign'], ext: true }) }, null, 2));
  console.log(`Wrote ${CONFIG} and ${SECRETS}. Next:\n  npx wrangler deploy --config ${CONFIG}\n  npx wrangler d1 execute DB --remote --config ${CONFIG} --file schema.sql\n  npx wrangler secret bulk ${SECRETS} --config ${CONFIG}\n  node scripts/cpu-check.mjs run https://yakyard-cpu-check.<your-subdomain>.workers.dev`);
}

// Pulls whole JSON objects out of wrangler tail's output, however it breaks the lines.
export function jsonStream(onObject) {
  let buf = '', depth = 0, inStr = false, esc = false, start = -1;
  return (chunk) => {
    buf += chunk;
    for (let i = buf.length - chunk.length; i < buf.length; i++) {
      const ch = buf[i];
      if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
      if (ch === '"') inStr = true;
      else if (ch === '{') { if (depth++ === 0) start = i; }
      else if (ch === '}' && depth > 0 && --depth === 0) { try { onObject(JSON.parse(buf.slice(start, i + 1))); } catch {} buf = buf.slice(i + 1); i = -1; }
    }
    if (depth === 0) buf = '';
  };
}
// One name per kind of invocation, ids taken out, so the report groups them.
export function eventName(e) {
  const req = e.event?.request;
  if (req) {
    const u = new URL(req.url);
    return `${req.method} ${u.pathname.replace(/\/(C|D|U|M|F|Q|R|P)[0-9a-f]{16}\b/g, '/:id').replace(/\/(files)\/.+/, '/$1/:key').replace(/\/join\/.+/, '/join/:token')}`;
  }
  if (e.event?.cron) return `cron ${e.event.cron}`;
  if (e.event?.scheduledTime || /alarm/i.test(e.eventType || '')) return `alarm ${e.entrypoint || e.scriptName || ''}`.trim();
  if (e.event?.rpcMethod) return `rpc ${e.entrypoint || ''}.${e.event.rpcMethod}`;
  if (e.event?.getWebSocketEvent || /websocket/i.test(e.eventType || '')) return 'websocket';
  return e.eventType || 'other';
}
export function report(events) {
  const by = new Map();
  for (const e of events) {
    const k = eventName(e), r = by.get(k) || { n: 0, cpu: [], outcomes: {} };
    r.n++; if (typeof e.cpuTime === 'number') r.cpu.push(e.cpuTime);
    r.outcomes[e.outcome] = (r.outcomes[e.outcome] || 0) + 1;
    by.set(k, r);
  }
  const rows = [...by].sort((a, b) => Math.max(0, ...b[1].cpu) - Math.max(0, ...a[1].cpu));
  const bad = rows.filter(([, r]) => r.outcomes.exceededCpu || r.cpu.some((c) => c > LIMIT));
  return { rows: rows.map(([k, r]) => ({ name: k, count: r.n, maxCpuMs: r.cpu.length ? Math.max(...r.cpu) : null, outcomes: r.outcomes })), bad: bad.map(([k]) => k) };
}

async function run(base) {
  if (!base) throw new Error('Give the address: node scripts/cpu-check.mjs run https://yakyard-cpu-check.<you>.workers.dev');
  base = base.replace(/\/$/, '');
  const secrets = JSON.parse(readFileSync(join(root, SECRETS), 'utf8'));
  const events = [];
  const tail = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['wrangler', 'tail', '--format', 'json', '--config', CONFIG], { cwd: root, shell: process.platform === 'win32' });
  tail.stdout.setEncoding('utf8').on('data', jsonStream((o) => events.push(o)));
  tail.stderr.on('data', () => {});
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  await sleep(8000);   // tail connects
  const statuses = [];
  const jar = {};
  const call = async (method, path, body, opts = {}) => {
    const headers = { origin: base, ...(jar[opts.as || 'owner'] ? { cookie: jar[opts.as || 'owner'] } : {}), ...(opts.headers || {}) };
    let payload = body;
    if (body && !(body instanceof FormData) && !(body instanceof URLSearchParams) && typeof body !== 'string') { payload = JSON.stringify(body); headers['content-type'] = 'application/json'; }
    await sleep(PACE);   // wrangler tail drops events when they come too fast
    const r = await fetch(base + path, { method, headers, body: payload, redirect: 'manual' });
    const set = r.headers.get('set-cookie'); if (set && /yy_session=([^;]+)/.test(set) && !/yy_session=;/.test(set)) jar[opts.as || 'owner'] = 'yy_session=' + set.match(/yy_session=([^;]+)/)[1];
    statuses.push([method, path.split('?')[0], r.status]);
    const text = await r.text();
    try { return JSON.parse(text); } catch { return text; }
  };
  const kdf = (pw, salt, it = 600000) => pbkdf2Sync(pw, Buffer.from(salt, 'base64'), it, 32, 'sha256').toString('base64');
  const signUp = async (path, extra, as) => {
    const salt = randomBytes(16).toString('base64'), pw = 'cpucheckpassword1';
    return call('POST', path, new URLSearchParams({ ...extra, salt, key: kdf(pw, salt), len: String(pw.length) }), { as });
  };
  const signIn = async (email, as) => {
    const s = await call('POST', '/auth/salt', { email }, { as });
    return call('POST', '/auth/login', new URLSearchParams({ email, key: kdf('cpucheckpassword1', s.salt, s.iter) }), { as });
  };
  console.log('Using every part of the app…');
  await call('GET', '/'); await call('GET', '/setup');
  await signUp('/setup', { token: secrets.SETUP_TOKEN, name: 'CPU Owner', email: 'cpu@example.com' });
  await signIn('cpu@example.com');
  const boot = await call('GET', '/api/bootstrap');
  const gen = boot.channels.find((c) => c.name === 'general').id;
  for (const p of ['/api/prefs', '/api/later', '/api/threads', '/api/mentions', '/api/activity/reactions', '/api/files', '/api/settings', '/api/team/places', '/api/ice', '/api/admin/people', '/api/admin/channels', '/api/admin/stats', '/api/channels', '/api/slack/import', '/api/slack/admin']) await call('GET', p);
  const ch = await call('POST', '/api/channels', { name: 'cpu-' + Date.now().toString(36), topic: 'CPU check' });
  const ids = [];
  for (let i = 0; i < 25; i++) ids.push((await call('POST', `/api/channels/${gen}/messages`, { text: `Message ${i} with *bold*, a link https://example.com and <@${boot.me.id}>` })).id);
  const reply = await call('POST', `/api/channels/${gen}/messages`, { text: 'A reply', thread_id: ids[0] });
  await call('POST', `/api/messages/${ids[1]}/reactions`, { emoji: '👍' });
  await call('PATCH', `/api/messages/${ids[2]}`, { text: 'Edited' });
  await call('DELETE', `/api/messages/${reply.id}`);
  await call('POST', `/api/messages/${ids[3]}/save`, {});
  await call('GET', `/api/channels/${gen}/messages`); await call('GET', `/api/messages/${ids[0]}/thread`);
  await call('GET', '/api/search?q=message'); await call('GET', '/api/search?q=from:@cpu in:#general has:link');
  await call('POST', `/api/channels/${gen}/read`, { ts: Date.now() });
  await call('PATCH', '/api/me', { title: 'Checker', status_text: 'Measuring', status_emoji: '📏' });
  await call('GET', '/api/unfurl?url=' + encodeURIComponent('https://example.com/'));
  for (let i = 0; i < 2; i++) await call('GET', '/api/img?u=' + encodeURIComponent('https://www.google.com/favicon.ico'));   // second one from R2
  // People: an invite, a member who signs up and signs in
  const inv = await call('POST', '/api/invite', { email: 'member@example.com', name: 'Member' });
  await call('GET', new URL(inv.link).pathname, null, { as: 'member' });
  await signUp(new URL(inv.link).pathname, { name: 'Member' }, 'member');
  await signIn('member@example.com', 'member');
  await call('GET', '/api/bootstrap', null, { as: 'member' });
  // Files: a small file, a picture with a preview (Images), a voice note with a transcript (Workers AI)
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFklEQVR4nGP8z8DAwMDAxMDAwMAAAAPoAQPcJwV8AAAAAElFTkSuQmCC', 'base64');
  const fd = (name, type, bytes, extra = {}) => { const f = new FormData(); f.append('file', new Blob([bytes], { type }), name); for (const [k, v] of Object.entries(extra)) f.append(k, v); return f; };
  const pic = await call('POST', '/api/upload', fd('dot.png', 'image/png', png));
  await call('POST', `/api/channels/${gen}/messages`, { text: '', files: [pic] });
  await call('GET', '/files/' + encodeURIComponent(pic.key) + '?w=96'); await call('GET', '/files/' + encodeURIComponent(pic.key) + '?w=96');
  const wav = Buffer.alloc(44 + 16000 * 2); wav.write('RIFF', 0); wav.writeUInt32LE(36 + 32000, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(32000, 40);
  const vn = await call('POST', '/api/upload', fd('voice.wav', 'audio/wav', wav, { voice: '1', dur: '1', wave: '[10,40,80,40,10]' }));
  await call('POST', '/api/voice/transcribe', { key: vn.key });
  await call('POST', `/api/channels/${gen}/messages`, { text: '', files: [vn] });
  // Background jobs: a scheduled message, a reminder, push batches (fake devices; encryption and signing still run)
  for (let i = 0; i < 9; i++) {
    const dev = createECDH('prime256v1'); dev.generateKeys();   // a real device key, so the encryption runs for real
    await call('POST', '/api/push/subscribe', { endpoint: `https://fcm.googleapis.com/fcm/send/cpu-check-${i}`, keys: { p256dh: dev.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') } }, { as: 'member' });
  }
  await call('POST', `/api/channels/${gen}/messages`, { text: `<@${(await call('GET', '/api/bootstrap', null, { as: 'member' })).me.id}> push fan-out` });
  await call('POST', '/api/push/test', {}, { as: 'member' });
  await call('POST', '/api/scheduled', { channel_id: gen, text: 'Scheduled by the CPU check', send_at: Date.now() + 40e3 });
  await call('POST', '/api/reminders', { text: 'Reminder from the CPU check', due_at: Date.now() + 20e3 });
  await call('POST', '/auth/logout', '', { as: 'member' });
  // Jobs finish within a minute. The cron runs every 5 minutes, but a new or changed cron trigger can take up to
  // 15 minutes to start, so the check waits for one cron event, at most 16 minutes (--quick skips this).
  const quick = process.argv.includes('--quick');
  console.log(quick ? 'Waiting 90 seconds for the jobs…' : 'Waiting for the jobs and one cron run (up to 16 minutes)…');
  await sleep(90e3);
  for (let t = 0; !quick && t < 15 * 60e3 && !events.some((e) => eventName(e).startsWith('cron')); t += 15e3) await sleep(15e3);
  await sleep(10e3);   // last tail events
  tail.kill();
  const { rows, bad } = report(events);
  console.log('\nCPU per invocation on Cloudflare (limit ' + LIMIT + ' ms):');
  for (const r of rows) console.log(`  ${(r.maxCpuMs == null ? '  n/a' : r.maxCpuMs.toFixed(1).padStart(5)) + ' ms'}  x${String(r.count).padEnd(4)} ${r.name}  ${JSON.stringify(r.outcomes)}`);
  const http5 = statuses.filter(([, , s]) => s >= 500);
  if (http5.length) console.log('\nServer errors seen by the client:', http5);
  writeFileSync(join(root, 'cpu-check-report.json'), JSON.stringify({ at: new Date().toISOString(), base, rows, bad, statuses, events: events.length, raw: events.map((e) => ({ name: eventName(e), cpuTime: e.cpuTime, wallTime: e.wallTime, outcome: e.outcome, t: e.eventTimestamp })) }, null, 2));
  const sent = statuses.length, seen = events.filter((e) => e.event?.request).length;
  console.log(`\nRequests sent: ${sent}, seen in the live log: ${seen}${seen < sent ? ' (the live log dropped some; their CPU is unknown)' : ''}.`);
  const near = rows.filter((r) => r.maxCpuMs != null && r.maxCpuMs > TARGET && r.maxCpuMs <= LIMIT).map((r) => r.name);
  if (near.length) console.log(`Within 3 ms of the limit (over ${TARGET} ms): ${near.join(', ')}`);
  const missing = ['alarm', 'cron'].filter((k) => !rows.some((r) => r.name.startsWith(k)) && (k !== 'cron' || !quick));
  if (missing.length) console.log('\nNo ' + missing.join(' or ') + ' events were seen. Check that wrangler tail was connected.');
  if (bad.length || http5.length) { console.log('\nOver the limit or failing: ' + [...bad, ...http5.map((x) => x.join(' '))].join(', ')); process.exit(1); }
  console.log(`\nAll ${events.length} invocations stayed under ${LIMIT} ms. Full report: cpu-check-report.json`);
}

if (process.argv[1] && process.argv[1].endsWith('cpu-check.mjs')) {
  const cmd = process.argv[2];
  if (cmd === 'prepare') prepare();
  else if (cmd === 'run') run(process.argv[3]).catch((e) => { console.error(e.message || e); process.exit(1); });
  else console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).join('\n'));
}
