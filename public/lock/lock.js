// yakyard-lock: end-to-end encryption for Yakyard's locked conversations.
// Copyright 2026 QVINTA Ltd. Licensed under the Apache License, Version 2.0 (see ../LICENSE).
//
// Design (details and threat model in ../README.md and docs/E2EE.md in Yakyard):
// - Every browser or phone is a "device" with its own Olm account (vodozemac, Curve25519 + Ed25519).
// - Each person has one signing key, made from their recovery key. It signs each of their devices, so
//   nobody (the server included) can slip an extra device into someone's account without that key.
// - Messages in a conversation are encrypted with a Megolm session per sending device. Its key travels to
//   every member's signed devices inside Olm (device-to-device) messages that the server only relays.
// - When someone leaves or is removed, or a device disappears, the next message starts a new Megolm
//   session that the removed person never gets. New members get the current key from that point on.
// - Every Megolm key a device holds is backed up to the server, encrypted with a key made from the
//   recovery key, so a new device set up with the recovery key can read older messages.
// - Files are encrypted with a fresh AES-256-GCM key each; the key rides inside the encrypted message.
//
// This module has no DOM code. The app passes in `api` (fetch JSON), `store` (encrypted storage on the
// device, see store-idb.js) and the initialised `wasm` module (dist/yakyard-crypto.js).

const enc = new TextEncoder(), dec = new TextDecoder();
const subtle = globalThis.crypto.subtle;
export const b64 = (bytes) => { let s = ''; const b = new Uint8Array(bytes); for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };
export const unb64 = (s) => Uint8Array.from(atob(String(s).replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const rand = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));
const sha256 = async (data) => new Uint8Array(await subtle.digest('SHA-256', typeof data === 'string' ? enc.encode(data) : data));

const ROTATE_AFTER_MSGS = 100;
const ROTATE_AFTER_MS = 7 * 864e5;
const OTK_TARGET = 50, OTK_LOW = 20;
const owners = (rec) => rec.owners || (rec.user ? [{ user: rec.user, curve: rec.curve }] : []);

// ---------------------------------------------------------------- recovery key
// 32 random bytes plus one checksum byte, written in Crockford base32 (no I, L, O, U), in groups of four.
const ALPHA = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export async function encodeRecoveryKey(bytes) {
  const all = new Uint8Array(33); all.set(bytes); all[32] = (await sha256(bytes))[0];
  let bits = 0, val = 0, out = '';
  for (const x of all) { val = (val << 8) | x; bits += 8; while (bits >= 5) { out += ALPHA[(val >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits) out += ALPHA[(val << (5 - bits)) & 31];
  return out.match(/.{1,4}/g).join(' ');
}
export async function decodeRecoveryKey(text) {
  const s = String(text || '').toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (s.length !== 53 || /[^0-9A-HJKMNP-TV-Z]/.test(s)) return null;
  let bits = 0, val = 0; const out = [];
  for (const ch of s) { val = ((val << 5) | ALPHA.indexOf(ch)) & 0xffffff; bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; } }
  const bytes = Uint8Array.from(out.slice(0, 32));
  if (out.length < 33 || (await sha256(bytes))[0] !== out[32]) return null;
  return bytes;
}
async function hkdf(secret, info, usage) {
  const base = await subtle.importKey('raw', secret, 'HKDF', false, ['deriveBits', 'deriveKey']);
  const params = { name: 'HKDF', hash: 'SHA-256', salt: enc.encode('yakyard-lock'), info: enc.encode(info) };
  if (usage === 'bits') return new Uint8Array(await subtle.deriveBits(params, base, 256));
  return subtle.deriveKey(params, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
export async function deriveFromRecovery(wasm, bytes) {
  const seed = await hkdf(bytes, 'yakyard-lock signing v1', 'bits');
  const signing = wasm.SigningKey.from_seed(seed);
  seed.fill(0);
  return { signing, masterPub: signing.public_key(), backupKey: await hkdf(bytes, 'yakyard-lock backup v1', 'key') };
}

// ---------------------------------------------------------------- short codes people compare
const digits = (bytes, n) => { let out = ''; for (let i = 0; out.length < n; i++) out += String(((bytes[2 * i] << 8) | bytes[2 * i + 1]) % 10000).padStart(4, '0'); return out.slice(0, n).match(/.{4}/g).join(' '); };
// A new device's code: 20 digits, far too many for anyone to fake by trying keys.
export async function deviceCode(curve, ed) { return digits(await sha256(`yy-device:${curve}:${ed}`), 20); }
// A person's safety code (their signing key). Same idea, for checking a teammate in person.
export async function safetyCode(masterPub) { return digits(await sha256(`yy-person:${masterPub}`), 20); }
export const deviceStatement = (userId, d) => `yy-dev:v1:${userId}:${d.device_id}:${d.curve}:${d.ed}`;

// ---------------------------------------------------------------- files
export async function encryptFile(data) {
  const raw = rand(32), iv = rand(12);
  const key = await subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt']);
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, key, data instanceof ArrayBuffer || ArrayBuffer.isView(data) ? data : await data.arrayBuffer());
  return { data: new Uint8Array(ct), k: b64(raw), iv: b64(iv) };
}
export async function decryptFile(data, meta) {
  const key = await subtle.importKey('raw', unb64(meta.k), 'AES-GCM', false, ['decrypt']);
  return new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: unb64(meta.iv) }, key, data));
}

// ---------------------------------------------------------------- the engine
export function createLock({ api, store, wasm, me, label = '' }) {
  const W = wasm;
  let device = null;          // { id, pickle, signed }
  let account = null;         // W.Account
  let master = null;          // { signing, masterPub, backupKey } once this device holds the recovery key
  const keyCache = new Map(); // user id -> { at, data }
  const inCache = new Map();  // session id -> { igs, rec }
  const warnings = new Map(); // user id -> { old, new } when someone's signing key changed
  let chain = Promise.resolve(), lastPull = 0;
  // One change at a time, across tabs too (Web Locks), so two tabs never fork the device's Olm state.
  const serial = (fn) => {
    const run = () => (globalThis.navigator?.locks ? navigator.locks.request('yakyard-lock:' + me, fn) : fn());
    const p = chain.then(run, run); chain = p.catch(() => {}); return p;
  };

  const saveAccount = async () => { device.pickle = account.pickle(); await store.put('device', device); };

  async function load() {
    device = await store.get('device');
    if (device) account = W.Account.from_pickle(device.pickle);
    const rk = await store.get('rk');
    if (rk) master = await deriveFromRecovery(W, unb64(rk));
    return status();
  }
  async function status() {
    const r = await api('/api/e2ee/me' + (device ? '?device=' + device.id : ''));
    const mine = device && r.devices.find((d) => d.device_id === device.id);
    return {
      allowed: r.allowed, identity: r.identity, devices: r.devices, otkCount: r.otk_count,
      hasDevice: !!device, ready: !!(device && mine && mine.sig && r.identity && master && master.masterPub === r.identity.master_pub),
      readyWithoutBackup: !!(device && mine && mine.sig && r.identity),
      deviceId: device?.id || null,
    };
  }
  function newDevice() {
    account = new W.Account();
    account.generate_fallback_key();
    device = { id: 'D' + b64(rand(12)).replace(/[+/=]/g, '').slice(0, 14), pickle: account.pickle(), label };
  }
  function deviceRecord() { return { device_id: device.id, curve: account.curve25519(), ed: account.ed25519() }; }
  async function publishDevice(sig) {
    const fb = JSON.parse(account.fallback_key()), [fid, fkey] = Object.entries(fb)[0] || [];
    account.generate_one_time_keys(OTK_TARGET);
    const otks = JSON.parse(account.one_time_keys());
    await api('/api/e2ee/devices', { method: 'POST', body: { ...deviceRecord(), sig: sig || '', label: device.label, fallback: fid ? { id: fid, key: fkey } : null, otks } });
    account.mark_keys_as_published();
    await saveAccount();
  }

  // First time: make the recovery key. Nothing is uploaded until commit(), which the app calls only
  // after the person shows they saved the key.
  async function createIdentity({ replace = false } = {}) {
    const rkBytes = rand(32);
    const text = await encodeRecoveryKey(rkBytes);
    return {
      recoveryKey: text,
      commit: () => serial(async () => {
        const m = await deriveFromRecovery(W, rkBytes);
        if (!device || replace) newDevice();
        await api('/api/e2ee/identity', { method: 'POST', body: { master_pub: m.masterPub, replace } });
        master = m;
        await store.put('rk', b64(rkBytes));
        await store.put('pins', { ...((await store.get('pins')) || {}), [me]: m.masterPub });
        await publishDevice(m.signing.sign(deviceStatement(me, deviceRecord())));
        // Keys this device already had (from before) go into the new backup.
        for (const k of await store.keys('in:')) { const rec = await store.get(k); if (rec) await backup(k.slice(3), rec); }
        await flushBackup();
        keyCache.delete(me);
      }),
    };
  }
  // A new device with the recovery key: check it against the account, vouch for this device, load the backup.
  function restore(text) {
    return serial(async () => {
      const bytes = await decodeRecoveryKey(text);
      if (!bytes) throw new Error('bad_key');
      const r = await api('/api/e2ee/me');
      if (!r.identity) throw new Error('no_identity');
      const m = await deriveFromRecovery(W, bytes);
      if (m.masterPub !== r.identity.master_pub) throw new Error('wrong_key');
      if (!device) newDevice();
      master = m;
      await store.put('rk', b64(bytes));
      await store.put('pins', { ...((await store.get('pins')) || {}), [me]: m.masterPub });
      await publishDevice(m.signing.sign(deviceStatement(me, deviceRecord())));
      keyCache.delete(me);
      return restoreBackup();
    });
  }
  // A new device without the recovery key: publish it unsigned and ask my other devices to approve it.
  function requestApproval() {
    return serial(async () => {
      if (!device) newDevice();
      await publishDevice('');
      await api('/api/e2ee/verify-request', { method: 'POST', body: { device_id: device.id } });
      return deviceCode(account.curve25519(), account.ed25519());
    });
  }
  // On a device that holds the recovery key: approve another of my devices after the person compared codes.
  function approveDevice(deviceId, code) {
    return serial(async () => {
      if (!master) throw new Error('no_master');
      const r = await api('/api/e2ee/me');
      const d = r.devices.find((x) => x.device_id === deviceId);
      if (!d) throw new Error('no_device');
      if ((await deviceCode(d.curve, d.ed)) !== code) throw new Error('code_mismatch');
      await api(`/api/e2ee/devices/${deviceId}/sig`, { method: 'POST', body: { sig: master.signing.sign(deviceStatement(me, d)) } });
      keyCache.delete(me);
      // Hand over the recovery secret, sealed for that device only. With it, it reads the backup.
      const rk = await store.get('rk');
      await sendToDevices([{ user_id: me, ...d }], () => ({ type: 'secrets', rk }));
    });
  }
  async function deviceCodeFor(deviceId) {
    const r = await api('/api/e2ee/me');
    const d = r.devices.find((x) => x.device_id === deviceId);
    return d ? deviceCode(d.curve, d.ed) : null;
  }
  function removeDevice(deviceId) { return api(`/api/e2ee/devices/${deviceId}`, { method: 'DELETE' }).then(() => keyCache.delete(me)); }

  async function topUpKeys() {
    if (!device) return;
    const s = await status();
    if (s.otkCount >= OTK_LOW || !s.devices.some((d) => d.device_id === device.id)) return;
    await serial(async () => {
      account.generate_one_time_keys(OTK_TARGET - s.otkCount);
      await api('/api/e2ee/otks', { method: 'POST', body: { device_id: device.id, otks: JSON.parse(account.one_time_keys()) } });
      account.mark_keys_as_published();
      await saveAccount();
    });
  }

  // ---- who can receive keys: only devices signed by the person's signing key, which this device pinned
  async function keysFor(userIds, fresh) {
    const want = [...new Set(userIds)].filter((u) => fresh || !keyCache.has(u) || Date.now() - keyCache.get(u).at > 60e3);
    if (want.length) {
      const data = await api('/api/e2ee/keys', { method: 'POST', body: { user_ids: want } });
      const pins = (await store.get('pins')) || {};
      let pinsChanged = false;
      for (const u of want) {
        const d = data[u];
        if (!d) { keyCache.set(u, { at: Date.now(), devices: [], master: null }); continue; }
        if (!pins[u]) { pins[u] = d.master_pub; pinsChanged = true; }
        if (pins[u] !== d.master_pub) warnings.set(u, { old: pins[u], new: d.master_pub }); else warnings.delete(u);
        const devices = pins[u] === d.master_pub ? d.devices.filter((x) => x.sig && W.ed25519_verify(d.master_pub, deviceStatement(u, x), x.sig)) : [];
        keyCache.set(u, { at: Date.now(), devices, master: d.master_pub });
      }
      if (pinsChanged) await store.put('pins', pins);
    }
    const out = {};
    for (const u of userIds) out[u] = keyCache.get(u) || { devices: [], master: null };
    return out;
  }
  async function acceptNewSafetyCode(userId) {
    const w = warnings.get(userId); if (!w) return;
    const pins = (await store.get('pins')) || {}; pins[userId] = w.new; await store.put('pins', pins);
    warnings.delete(userId); keyCache.delete(userId);
  }

  // ---- Olm, device to device
  async function olmSessions(curve) { return ((await store.get('olm:' + curve)) || []).map((p) => W.Session.from_pickle(p)); }
  async function saveOlm(curve, sessions) { await store.put('olm:' + curve, sessions.slice(-3).map((s) => s.pickle())); }
  async function sendToDevices(targets, payloadFor) {
    const need = [];
    for (const t of targets) if (!((await store.get('olm:' + t.curve)) || []).length) need.push({ user_id: t.user_id, device_id: t.device_id });
    const claimed = need.length ? await api('/api/e2ee/claim', { method: 'POST', body: { devices: need } }) : [];
    const messages = [];
    for (const t of targets) {
      let sessions = await olmSessions(t.curve);
      if (!sessions.length) {
        const c = claimed.find((x) => x.user_id === t.user_id && x.device_id === t.device_id);
        if (!c) continue; // that device has no keys left to start with; it gets the key on a later message
        sessions = [account.create_outbound_session(t.curve, c.key)];
      }
      const s = sessions[sessions.length - 1];
      const payload = { ...payloadFor(t), from: me, from_dev: device.id, from_ed: account.ed25519(), to: t.user_id, to_dev: t.device_id, to_curve: t.curve };
      messages.push({ user_id: t.user_id, device_id: t.device_id, sender_key: account.curve25519(), body: s.encrypt(JSON.stringify(payload)) });
      await saveOlm(t.curve, sessions);
    }
    for (let i = 0; i < messages.length; i += 200) await api('/api/e2ee/send', { method: 'POST', body: { device_id: device.id, messages: messages.slice(i, i + 200) } });
    return messages.length;
  }
  async function openOlm(row) {
    const [t, body] = [Number(row.body.slice(0, row.body.indexOf(':'))), row.body.slice(row.body.indexOf(':') + 1)];
    const sessions = await olmSessions(row.sender_key);
    for (const s of sessions) { try { const p = s.decrypt(t, body); await saveOlm(row.sender_key, sessions); return p; } catch {} }
    if (t !== 0) throw new Error('no_session');
    const s = account.create_inbound_session(row.sender_key, body);
    const p = W.Session.take_plaintext();
    await saveAccount();
    await saveOlm(row.sender_key, [...sessions, s]);
    return p;
  }
  // Read sealed packages for this device: conversation keys from teammates, and secrets from my own devices.
  function processInbox() {
    if (!device) return Promise.resolve(0);
    return serial(async () => {
      let n = 0;
      for (;;) {
        const rows = await api('/api/e2ee/inbox?device=' + device.id);
        if (!rows.length) break;
        for (const row of rows) {
          try {
            const p = JSON.parse(await openOlm(row));
            if (p.to !== me || p.to_dev !== device.id || p.from !== row.sender_user || p.to_curve !== account.curve25519()) continue;
            // The sender's device must be one of theirs, signed by their pinned signing key.
            const k = (await keysFor([p.from], true))[p.from];
            const sender = k.devices.find((d) => d.curve === row.sender_key && d.device_id === row.sender_device && d.ed === p.from_ed);
            if (p.type === 'room_key' && sender && typeof p.cid === 'string') {
              const igs = new W.InboundGroupSession(p.key);
              if (igs.session_id() !== p.sid) continue;
              // Several people can hold (and pass on) the same session key. Each one who sent it is noted as a
              // possible owner; a message only opens if its sender is one of them AND the sender named inside the
              // signed Megolm payload is that same person. Re-sending someone else's key can't make their messages yours.
              const have = await store.get('in:' + p.sid);
              const owner = { user: p.from, curve: row.sender_key };
              if (!have) { const rec = { pickle: igs.pickle(), cid: p.cid, owners: [owner] }; await store.put('in:' + p.sid, rec); await backup(p.sid, rec); n++; }
              else if (have.cid === p.cid && !owners(have).some((o) => o.user === owner.user && o.curve === owner.curve)) { have.owners = [...owners(have), owner].slice(0, 20); await store.put('in:' + p.sid, have); inCache.delete(p.sid); }
              igs.free();
            } else if (p.type === 'secrets' && p.from === me && sender && p.rk) {
              const m = await deriveFromRecovery(W, unb64(p.rk));
              if (m.masterPub !== k.master) continue;
              master = m; await store.put('rk', p.rk);
              await restoreBackup(true);
              n++;
            }
          } catch (e) { /* a package we can't open is dropped; the sender's next message brings a fresh key */ }
        }
        await api('/api/e2ee/inbox/ack', { method: 'POST', body: { ids: rows.map((r) => r.id) } });
        if (rows.length < 200) break;
      }
      await flushBackup();
      return n;
    });
  }

  // ---- key backup, encrypted with a key made from the recovery key
  let pending = [];
  async function backup(sid, rec) {
    if (!master) return;
    const igs = W.InboundGroupSession.from_pickle(rec.pickle);
    const iv = rand(12), plain = enc.encode(JSON.stringify({ sid, cid: rec.cid, owners: owners(rec), key: igs.export_at_first_known_index() }));
    igs.free();
    const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(`${me}:${sid}`) }, master.backupKey, plain));
    const all = new Uint8Array(12 + ct.length); all.set(iv); all.set(ct, 12);
    pending.push({ session_id: sid, data: b64(all) });
  }
  async function flushBackup() {
    while (pending.length) { const items = pending.splice(0, 100); await api('/api/e2ee/backup', { method: 'PUT', body: { items } }); }
  }
  async function restoreBackup(inside) {
    if (!master) return 0;
    let after = '', n = 0;
    for (;;) {
      const r = await api('/api/e2ee/backup?after=' + encodeURIComponent(after));
      for (const it of r.items) {
        after = it.session_id;
        try {
          const all = unb64(it.data);
          const plain = await subtle.decrypt({ name: 'AES-GCM', iv: all.subarray(0, 12), additionalData: enc.encode(`${me}:${it.session_id}`) }, master.backupKey, all.subarray(12));
          const o = JSON.parse(dec.decode(plain));
          const igs = W.InboundGroupSession.import(o.key);
          if (igs.session_id() !== it.session_id) { igs.free(); continue; }
          const have = await store.get('in:' + it.session_id);
          if (!have || W.InboundGroupSession.from_pickle(have.pickle).first_known_index() > igs.first_known_index()) {
            await store.put('in:' + it.session_id, { pickle: igs.pickle(), cid: o.cid, owners: o.owners || [{ user: o.user, curve: o.curve }] }); n++;
            inCache.delete(it.session_id);
          }
          igs.free();
        } catch {}
      }
      if (!r.more) break;
    }
    return n;
  }

  // ---- messages
  async function recipients(cid) {
    const members = await api(`/api/channels/${cid}/members`);
    const keys = await keysFor(members);
    const out = [];
    for (const u of members) for (const d of keys[u].devices) if (!(u === me && d.device_id === device.id)) out.push({ user_id: u, ...d });
    return { members, out, missing: members.filter((u) => !keys[u].devices.length && u !== me), changed: members.filter((u) => warnings.has(u)) };
  }
  // Encrypt something for everyone in the conversation. Shares (or rotates) this device's conversation key first.
  function encryptFor(cid, content) {
    return serial(async () => {
      if (!device || !master) throw new Error('not_ready');
      const { out: targets, missing, changed } = await recipients(cid);
      const ids = new Set(targets.map((t) => `${t.user_id}|${t.device_id}|${t.curve}`));
      let out = await store.get('out:' + cid), gs;
      const stale = !out || out.n >= ROTATE_AFTER_MSGS || Date.now() - out.at > ROTATE_AFTER_MS || out.shared.some((s) => !ids.has(s));
      if (stale) {
        gs = new W.GroupSession();
        out = { pickle: gs.pickle(), sid: gs.session_id(), shared: [], at: Date.now(), n: 0 };
        const igs = new W.InboundGroupSession(gs.session_key());
        const rec = { pickle: igs.pickle(), cid, owners: [{ user: me, curve: account.curve25519() }] };
        igs.free();
        await store.put('in:' + out.sid, rec); await backup(out.sid, rec);
      } else gs = W.GroupSession.from_pickle(out.pickle);
      const fresh = targets.filter((t) => !out.shared.includes(`${t.user_id}|${t.device_id}|${t.curve}`));
      if (fresh.length) {
        const key = gs.session_key();
        await sendToDevices(fresh, () => ({ type: 'room_key', cid, sid: out.sid, key }));
        out.shared = [...new Set([...out.shared.filter((s) => ids.has(s)), ...fresh.map((t) => `${t.user_id}|${t.device_id}|${t.curve}`)])];
      }
      const ct = gs.encrypt(JSON.stringify({ ...content, cid, u: me }));
      out.n += 1; out.pickle = gs.pickle(); gs.free();
      await store.put('out:' + cid, out);
      await flushBackup();
      return { enc: JSON.stringify({ v: 1, s: out.sid, c: ct }), missing, changed };
    });
  }
  async function inbound(sid) {
    if (inCache.has(sid)) return inCache.get(sid);
    const rec = await store.get('in:' + sid);
    if (!rec) return null;
    const v = { igs: W.InboundGroupSession.from_pickle(rec.pickle), rec };
    inCache.set(sid, v);
    return v;
  }
  // Open one encrypted item. `kind` keeps a reaction from being replayed as a message and the other way round.
  async function decrypt(cid, senderId, envelope, ref) {
    let e; try { e = JSON.parse(envelope); } catch { return { ok: false, reason: 'bad' }; }
    if (!e || e.v !== 1 || typeof e.s !== 'string' || typeof e.c !== 'string') return { ok: false, reason: 'bad' };
    let s = await inbound(e.s);
    if (!s) { await processInbox(); s = await inbound(e.s); }
    // Another of my devices may have backed this key up since: look again, at most every 30 seconds.
    if (!s && master && Date.now() - lastPull > 30e3) { lastPull = Date.now(); await serial(() => restoreBackup()); s = await inbound(e.s); }
    if (!s) return { ok: false, reason: 'missing' };
    if (s.rec.cid !== cid || !owners(s.rec).some((o) => o.user === senderId)) return { ok: false, reason: 'bad' };
    let r; try { r = s.igs.decrypt(e.c); } catch (er) { return { ok: false, reason: /index/i.test(String(er?.message || er)) ? 'early' : 'bad' }; }
    const i = r.indexOf(':'), index = Number(r.slice(0, i));
    let data; try { data = JSON.parse(r.slice(i + 1)); } catch { return { ok: false, reason: 'bad' }; }
    if (data.cid !== cid || data.u !== senderId) return { ok: false, reason: 'bad' };
    // The same encrypted piece showing up as a second message means the server copied it.
    if (ref) {
      const seen = (await store.get('seen:' + e.s)) || {};
      if (seen[index] && seen[index] !== ref) return { ok: false, reason: 'bad' };
      if (!seen[index]) { seen[index] = ref; await store.put('seen:' + e.s, seen); }
    }
    return { ok: true, data };
  }

  return {
    load, status, createIdentity, restore, requestApproval, approveDevice, deviceCodeFor, removeDevice, topUpKeys,
    processInbox, encryptFor, decrypt, keysFor, acceptNewSafetyCode, restoreBackup,
    warnings: () => new Map(warnings),
    hasRecovery: () => !!master,
    myDeviceId: () => device?.id || null,
    safetyCodeFor: async (userId) => { const k = (await keysFor([userId]))[userId]; return k.master ? safetyCode(k.master) : null; },
    forgetCaches: () => { keyCache.clear(); },
  };
}
