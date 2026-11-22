// Unit tests for yakyard-lock, against a small in-memory stand-in for the Yakyard server.
// Run: node --test packages/yakyard-lock/test/
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import * as W from '../dist/yakyard-crypto.js';
import { createLock, encodeRecoveryKey, decodeRecoveryKey, encryptFile, decryptFile, deviceCode, b64 } from '../src/lock.js';
import { memoryStore } from '../src/store-idb.js';

const here = dirname(fileURLToPath(import.meta.url));
W.initSync({ module: readFileSync(join(here, '../dist/yakyard-crypto_bg.wasm')) });

// The server: stores public keys, relays sealed packages, keeps the backup. Same rules as src/e2ee.js.
function fakeServer() {
  const S = { identity: {}, devices: {}, otk: {}, inbox: [], backup: {}, members: {}, log: [] };
  const handle = (userId, path, opts = {}) => {
    const body = opts.body ? JSON.parse(JSON.stringify(opts.body)) : {};
    const m = opts.method || 'GET';
    const u = new URL('http://x' + path);
    S.log.push({ userId, path: u.pathname, body });
    const devs = (uid) => (S.devices[uid] ||= {});
    if (u.pathname === '/api/e2ee/me') {
      const d = u.searchParams.get('device');
      return { identity: S.identity[userId] || null, devices: Object.values(devs(userId)), otk_count: (S.otk[userId + '|' + d] || []).length, allowed: true };
    }
    if (u.pathname === '/api/e2ee/identity') {
      if (S.identity[userId] && !body.replace) throw new Error('409');
      if (body.replace) { S.devices[userId] = {}; for (const k of Object.keys(S.backup)) if (k.startsWith(userId + '|')) delete S.backup[k]; }
      S.identity[userId] = { master_pub: body.master_pub }; return { ok: true };
    }
    if (u.pathname === '/api/e2ee/devices' && m === 'POST') {
      const old = devs(userId)[body.device_id];
      devs(userId)[body.device_id] = { device_id: body.device_id, curve: body.curve, ed: body.ed, sig: body.sig || old?.sig || '', fallback: body.fallback || old?.fallback };
      const k = userId + '|' + body.device_id; S.otk[k] = [...(S.otk[k] || []), ...Object.values(body.otks || {})];
      return { ok: true };
    }
    const sig = u.pathname.match(/^\/api\/e2ee\/devices\/([^/]+)\/sig$/);
    if (sig) { devs(userId)[sig[1]].sig = body.sig; return { ok: true }; }
    if (u.pathname === '/api/e2ee/otks') { const k = userId + '|' + body.device_id; S.otk[k] = [...(S.otk[k] || []), ...Object.values(body.otks)]; return { ok: true }; }
    if (u.pathname === '/api/e2ee/verify-request') return { ok: true };
    if (u.pathname === '/api/e2ee/keys') {
      const out = {};
      for (const id of body.user_ids) if (S.identity[id]) out[id] = { master_pub: S.identity[id].master_pub, devices: Object.values(devs(id)).map(({ fallback, ...d }) => d) };
      return out;
    }
    if (u.pathname === '/api/e2ee/claim') {
      return body.devices.map((d) => { const k = d.user_id + '|' + d.device_id; const key = (S.otk[k] || []).shift() || devs(d.user_id)[d.device_id]?.fallback?.key; return key ? { ...d, key } : null; }).filter(Boolean);
    }
    if (u.pathname === '/api/e2ee/send') {
      for (const x of body.messages) S.inbox.push({ id: 'K' + S.inbox.length + Math.random(), user_id: x.user_id, device_id: x.device_id, sender_user: userId, sender_device: body.device_id, sender_key: x.sender_key, body: x.body });
      return { sent: body.messages.length };
    }
    if (u.pathname === '/api/e2ee/inbox') return S.inbox.filter((r) => r.user_id === userId && r.device_id === u.searchParams.get('device')).slice(0, 200);
    if (u.pathname === '/api/e2ee/inbox/ack') { S.inbox = S.inbox.filter((r) => !(r.user_id === userId && body.ids.includes(r.id))); return { ok: true }; }
    if (u.pathname === '/api/e2ee/backup' && m === 'PUT') { for (const i of body.items) S.backup[userId + '|' + i.session_id] = i.data; return { saved: body.items.length }; }
    if (u.pathname === '/api/e2ee/backup') {
      const after = u.searchParams.get('after') || '';
      const items = Object.entries(S.backup).filter(([k]) => k.startsWith(userId + '|')).map(([k, data]) => ({ session_id: k.split('|')[1], data })).filter((i) => i.session_id > after).sort((a, b) => (a.session_id < b.session_id ? -1 : 1));
      return { items, more: false };
    }
    const mem = u.pathname.match(/^\/api\/channels\/([^/]+)\/members$/);
    if (mem) { if (!S.members[mem[1]].includes(userId)) throw new Error('403'); return S.members[mem[1]]; }
    throw new Error('unhandled ' + path);
  };
  return { S, apiFor: (userId) => async (path, opts) => handle(userId, path, opts) };
}

async function person(server, id) {
  const store = memoryStore();
  const lock = createLock({ api: server.apiFor(id), store, wasm: W, me: id, label: 'test' });
  await lock.load();
  return { id, store, lock };
}
async function setUp(server, id) {
  const p = await person(server, id);
  const idn = await p.lock.createIdentity();
  await idn.commit();
  p.recoveryKey = idn.recoveryKey;
  return p;
}
const send = async (p, cid, text) => (await p.lock.encryptFor(cid, { t: text })).enc;
const read = async (p, cid, from, envelope, ref) => p.lock.decrypt(cid, from, envelope, ref);

test('recovery key: round trip, typo caught by checksum, look-alike letters accepted', async () => {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(32));
  const text = await encodeRecoveryKey(bytes);
  assert.equal(text.replace(/ /g, '').length, 53);
  assert.match(text, /^([0-9A-Z]{4} ){12}[0-9A-Z]{5}$/, 'twelve groups of four, then one of five: never a lone last character');
  assert.deepEqual(await decodeRecoveryKey(text.replace(/(.{4}) (.{4})/g, '$1$2 ')), bytes, 'old spacing still works');
  assert.deepEqual(await decodeRecoveryKey(text), bytes);
  assert.deepEqual(await decodeRecoveryKey(text.toLowerCase().replace(/ /g, '-')), bytes);
  const typo = text.slice(0, 5) + (text[5] === 'A' ? 'B' : 'A') + text.slice(6);
  assert.equal(await decodeRecoveryKey(typo), null);
  assert.equal(await decodeRecoveryKey('hello'), null);
});

test('files: encrypt and decrypt, wrong key fails', async () => {
  const data = new TextEncoder().encode('a photo');
  const e = await encryptFile(data);
  assert.notDeepEqual(e.data.slice(0, 7), data);
  assert.equal(new TextDecoder().decode(await decryptFile(e.data, e)), 'a photo');
  await assert.rejects(decryptFile(e.data, { ...e, k: b64(new Uint8Array(32)) }));
});

test('olm refuses the all-zero (identity) public key', () => {
  const a = new W.Account();
  const zero = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  assert.throws(() => a.create_outbound_session(zero, zero));
  const b = new W.Account(); b.generate_one_time_keys(1);
  assert.throws(() => a.create_outbound_session(zero, Object.values(JSON.parse(b.one_time_keys()))[0]));
});

test('two people: message encrypts, decrypts, and the server only ever sees ciphertext', async () => {
  const server = fakeServer();
  const ana = await setUp(server, 'UA'), ben = await setUp(server, 'UB');
  server.S.members.C1 = ['UA', 'UB'];
  const env = await send(ana, 'C1', 'the plan is in the blue folder');
  assert.ok(!env.includes('blue folder'));
  assert.ok(!JSON.stringify(server.S).includes('blue folder'), 'plaintext reached the server');
  const r = await read(ben, 'C1', 'UA', env, 'M1');
  assert.equal(r.ok, true); assert.equal(r.data.t, 'the plan is in the blue folder');
  // The sender reads their own message too.
  assert.equal((await read(ana, 'C1', 'UA', env, 'M1')).data.t, 'the plan is in the blue folder');
  // Same ciphertext claimed by another person, another conversation or a second message id: refused.
  assert.equal((await read(ben, 'C1', 'UB', env, 'M1')).ok, false);
  assert.equal((await read(ben, 'C2', 'UA', env, 'M1')).ok, false);
  assert.equal((await read(ben, 'C1', 'UA', env, 'M2')).ok, false);
});

test('removing a member rotates the key: they cannot read new messages', async () => {
  const server = fakeServer();
  const ana = await setUp(server, 'UA'), ben = await setUp(server, 'UB'), cal = await setUp(server, 'UC');
  server.S.members.C1 = ['UA', 'UB', 'UC'];
  const e1 = await send(ana, 'C1', 'before');
  assert.equal((await read(cal, 'C1', 'UA', e1, 'M1')).data.t, 'before');
  server.S.members.C1 = ['UA', 'UB'];          // Cal is removed
  const e2 = await send(ana, 'C1', 'after');
  assert.notEqual(JSON.parse(e1).s, JSON.parse(e2).s, 'a new session after removal');
  assert.equal((await read(ben, 'C1', 'UA', e2, 'M2')).data.t, 'after');
  const c = await read(cal, 'C1', 'UA', e2, 'M2');
  assert.equal(c.ok, false); assert.equal(c.reason, 'missing');
  // And nothing was sealed for Cal's device after the removal.
  const sentToCal = server.S.log.filter((l) => l.path === '/api/e2ee/send').flatMap((l) => l.body.messages).filter((m) => m.user_id === 'UC').length;
  await send(ana, 'C1', 'later still');
  assert.equal(server.S.log.filter((l) => l.path === '/api/e2ee/send').flatMap((l) => l.body.messages).filter((m) => m.user_id === 'UC').length, sentToCal);
});

test('a new member reads from when they joined, not before', async () => {
  const server = fakeServer();
  const ana = await setUp(server, 'UA'), ben = await setUp(server, 'UB');
  server.S.members.C1 = ['UA'];
  const e1 = await send(ana, 'C1', 'private note');
  server.S.members.C1 = ['UA', 'UB'];
  const e2 = await send(ana, 'C1', 'welcome');
  assert.equal(JSON.parse(e1).s, JSON.parse(e2).s, 'adding someone keeps the session');
  assert.equal((await read(ben, 'C1', 'UA', e2, 'M2')).data.t, 'welcome');
  assert.equal((await read(ben, 'C1', 'UA', e1, 'M1')).ok, false);
});

test('a new device without the recovery key cannot read old messages; with it, it can', async () => {
  const server = fakeServer();
  const ana = await setUp(server, 'UA'), ben = await setUp(server, 'UB');
  server.S.members.C1 = ['UA', 'UB'];
  const old = await send(ana, 'C1', 'old secret');
  assert.equal((await read(ben, 'C1', 'UA', old, 'M1')).data.t, 'old secret'); // Ben's phone reads it, and backs the key up
  // Ben's second device, nothing restored: it isn't signed, so it gets no keys and can't read.
  const ben2 = await person(server, 'UB');
  await ben2.lock.requestApproval();
  assert.equal((await read(ben2, 'C1', 'UA', old, 'M1')).ok, false);
  const later = await send(ana, 'C1', 'still secret');
  assert.equal((await read(ben2, 'C1', 'UA', later, 'M2')).ok, false, 'an unapproved device gets no keys');
  // Wrong recovery key is refused; the right one loads the backup.
  await assert.rejects(ben2.lock.restore(ana.recoveryKey), /wrong_key/);
  await ben2.lock.restore(ben.recoveryKey);
  assert.equal((await read(ben2, 'C1', 'UA', old, 'M1')).data.t, 'old secret');
  assert.equal((await read(ben2, 'C1', 'UA', later, 'M2')).data.t, 'still secret');
});

test('approving a new device from an existing one, after comparing codes', async () => {
  const server = fakeServer();
  const ana = await setUp(server, 'UA'), ben = await setUp(server, 'UB');
  server.S.members.C1 = ['UA', 'UB'];
  const old = await send(ana, 'C1', 'from last week');
  await ben.lock.processInbox();
  const ben2 = await person(server, 'UB');
  const code = await ben2.lock.requestApproval();
  const id2 = ben2.lock.myDeviceId();
  await assert.rejects(ben.lock.approveDevice(id2, '0000 0000 0000 0000 0000'), /code_mismatch/);
  await ben.lock.approveDevice(id2, code);
  await ben2.lock.processInbox();
  assert.equal(ben2.lock.hasRecovery(), true);
  assert.equal((await read(ben2, 'C1', 'UA', old, 'M1')).data.t, 'from last week');
  const fresh = await send(ana, 'C1', 'hello both devices');
  assert.equal((await read(ben2, 'C1', 'UA', fresh, 'M2')).data.t, 'hello both devices');
  assert.equal((await read(ben, 'C1', 'UA', fresh, 'M2')).data.t, 'hello both devices');
});

test('a device the server adds without a valid signature gets nothing', async () => {
  const server = fakeServer();
  const ana = await setUp(server, 'UA'), ben = await setUp(server, 'UB');
  server.S.members.C1 = ['UA', 'UB'];
  // The server invents a device for Ben with a made-up signature.
  const evil = new W.Account(); evil.generate_one_time_keys(2);
  server.S.devices.UB.EVILDEVICE01 = { device_id: 'EVILDEVICE01', curve: evil.curve25519(), ed: evil.ed25519(), sig: 'A'.repeat(86) };
  server.S.otk['UB|EVILDEVICE01'] = Object.values(JSON.parse(evil.one_time_keys()));
  await send(ana, 'C1', 'not for the server');
  assert.ok(!server.S.inbox.some((r) => r.device_id === 'EVILDEVICE01'));
});

test('a changed signing key stops key sharing with that person until accepted', async () => {
  const server = fakeServer();
  const ana = await setUp(server, 'UA'), ben = await setUp(server, 'UB');
  server.S.members.C1 = ['UA', 'UB'];
  await send(ana, 'C1', 'one');
  // Ben (or the server pretending) starts over with a new key.
  const ben2 = await person(server, 'UB');
  await (await ben2.lock.createIdentity({ replace: true })).commit();
  ana.lock.forgetCaches();
  const r = await ana.lock.encryptFor('C1', { t: 'two' });
  assert.deepEqual(r.changed, ['UB']);
  assert.equal((await read(ben2, 'C1', 'UA', r.enc, 'M2')).ok, false);
  await ana.lock.acceptNewSafetyCode('UB');
  const r3 = await ana.lock.encryptFor('C1', { t: 'three' });
  assert.equal((await read(ben2, 'C1', 'UA', r3.enc, 'M3')).data.t, 'three');
});

test('device codes are 20 digits and differ per device', async () => {
  const a = new W.Account(), b = new W.Account();
  const ca = await deviceCode(a.curve25519(), a.ed25519()), cb = await deviceCode(b.curve25519(), b.ed25519());
  assert.match(ca, /^\d{4}( \d{4}){4}$/); assert.notEqual(ca, cb);
});

test('a message only opens as its real sender: the server cannot relabel who wrote it', async () => {
  const server = fakeServer();
  const ana = await setUp(server, 'UA'), mal = await setUp(server, 'UM'), ben = await setUp(server, 'UB');
  server.S.members.C1 = ['UA', 'UM', 'UB'];
  const fromAna = await send(ana, 'C1', 'from ana');
  const fromMal = await send(mal, 'C1', 'pretending');
  assert.equal((await read(ben, 'C1', 'UA', fromAna, 'M1')).data.t, 'from ana');
  assert.equal((await read(ben, 'C1', 'UM', fromAna, 'M2')).ok, false, "Ana's words shown as Mallory's");
  assert.equal((await read(ben, 'C1', 'UA', fromMal, 'M3')).ok, false, "Mallory's words shown as Ana's");
  assert.equal((await read(ben, 'C1', 'UM', fromMal, 'M4')).data.t, 'pretending');
});
