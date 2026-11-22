// yakyard-lock: encrypted storage on the device (IndexedDB).
// Copyright 2026 QVINTA Ltd. Licensed under the Apache License, Version 2.0 (see ../LICENSE).
//
// Everything is sealed with an AES-256-GCM key that the browser generates as non-extractable: page code
// (including a malicious script) can ask the browser to use it, but can never read its bytes, so a copy of
// the IndexedDB files alone doesn't reveal device keys or cached messages. One database per person.

const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder(), dec = new TextDecoder();
const req = (r) => new Promise((ok, no) => { r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });

export const dbName = (userId) => 'yakyard-lock-' + userId;

export async function openStore(userId) {
  const open = indexedDB.open(dbName(userId), 1);
  open.onupgradeneeded = () => {
    const db = open.result;
    db.createObjectStore('meta');
    db.createObjectStore('kv');
    db.createObjectStore('msgs', { keyPath: 'id' }).createIndex('cid', 'cid');
  };
  const db = await req(open);
  const tx = (store, mode = 'readonly') => db.transaction(store, mode).objectStore(store);
  let wrap = await req(tx('meta').get('wrap'));
  if (!wrap) {
    wrap = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    await req(tx('meta', 'readwrite').put(wrap, 'wrap'));
  }
  const seal = async (v, aad) => {
    const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
    const ct = await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(aad) }, wrap, enc.encode(JSON.stringify(v)));
    return { iv, ct };
  };
  const open_ = async (row, aad) => (row ? JSON.parse(dec.decode(await subtle.decrypt({ name: 'AES-GCM', iv: row.iv, additionalData: enc.encode(aad) }, wrap, row.ct))) : null);
  return {
    async get(k) { try { return await open_(await req(tx('kv').get(k)), k); } catch { return null; } },
    async put(k, v) { const row = await seal(v, k); await req(tx('kv', 'readwrite').put(row, k)); },
    async del(k) { await req(tx('kv', 'readwrite').delete(k)); },
    async keys(prefix) { return (await req(tx('kv').getAllKeys(IDBKeyRange.bound(prefix, prefix + '￿')))).map(String); },
    // Words of locked messages this device has read, for search on this device only.
    async msgPut(id, cid, ts, text) { const row = await seal({ text }, 'm:' + id); await req(tx('msgs', 'readwrite').put({ id, cid, ts, ...row })); },
    async msgAll(cid) {
      const rows = await req(cid ? tx('msgs').index('cid').getAll(cid) : tx('msgs').getAll());
      const out = [];
      for (const r of rows) { try { out.push({ id: r.id, cid: r.cid, ts: r.ts, text: (await open_(r, 'm:' + r.id)).text }); } catch {} }
      return out;
    },
    close() { db.close(); },
  };
}

export function wipe(userId) {
  return new Promise((ok) => { const r = indexedDB.deleteDatabase(dbName(userId)); r.onsuccess = r.onerror = r.onblocked = () => ok(); });
}

// Plain in-memory store with the same shape, for tests.
export function memoryStore() {
  const kv = new Map(), msgs = new Map();
  const clone = (v) => (v == null ? null : JSON.parse(JSON.stringify(v)));
  return {
    get: async (k) => clone(kv.get(k)), put: async (k, v) => { kv.set(k, clone(v)); }, del: async (k) => { kv.delete(k); },
    keys: async (p) => [...kv.keys()].filter((k) => k.startsWith(p)),
    msgPut: async (id, cid, ts, text) => { msgs.set(id, { id, cid, ts, text }); },
    msgAll: async (cid) => [...msgs.values()].filter((m) => !cid || m.cid === cid),
    dump: () => kv,
  };
}
