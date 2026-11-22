// Locked conversations in the app: the screens, the two-step approvals, and the glue between the
// conversation view and the encryption library (packages/yakyard-lock, copied to /lock/ by scripts/lock-sync.mjs).
// Loaded only when a workspace uses locked conversations.
import { createLock, encryptFile, decryptFile } from '/lock/lock.js';
import { openStore, wipe } from '/lock/store-idb.js';
import init, * as W from '/lock/yakyard-crypto.js';

let X = null;          // helpers from app.js: api, S, h, svg, modal, closeModal, toast, user, rerender, chanLabel, I, esc, fmt
let L = null;          // the lock engine
let ready = null;      // promise: engine loaded
let st = null;         // last status from the engine
const plain = new Map();   // message id -> { enc, res }
const busy = new Set();
const blobs = new Map();   // file key -> blob URL
const rx = new Map();      // reaction ciphertext -> { emoji, ok }

// ---------------------------------------------------------------- words (one place, so they stay consistent)
export const COPY = {
  lockedLine: 'Locked. Only the people here can read it.',
  whatsDifferent: "What's different here?",
  searchHere: 'Search here',
  searchDeviceOnly: 'Searching this device only',
  pushText: 'New message in a locked conversation',
  noTranscript: "No transcript in locked conversations. The audio plays as usual.",
  previewsOff: 'Link previews are off in locked conversations.',
  scheduleOff: "Scheduled messages don't work in locked conversations.",
  unlocking: 'Unlocking…',
  missing: "Can't open this message on this device yet. It opens once one of your devices that has it is online, or after you add your recovery key.",
  early: 'Sent before you joined, so it stays hidden from you.',
  bad: "This message didn't pass the safety check, so it isn't shown.",
  notReady: 'Set up locked conversations on this device first.',
};
const WORKS = [
  ['Messages', 'threads, edits and reactions'],
  ['Photos and files', 'up to 100 MB each'],
  ['Voice notes', 'record and play as usual'],
  ['Mentions', 'people still get a notification'],
];
const DIFFERENT = (kind) => [
  ['Search', 'only finds messages already on this device'],
  ['Phone notifications', 'say "New message", not what it says'],
  ['Voice notes', 'no transcripts'],
  ['Link previews', 'off'],
  ['Scheduled messages', 'off'],
  ['Slack import', "can't add old Slack messages here"],
  ['Calls', "work as usual, but they aren't part of the lock"],
  ['Lost devices', 'if you lose every device and your recovery key, these messages are gone for good. Nobody, not even the admin, can get them back'],
  ['Unlocking', "can't be unlocked later. To stop, start a new normal conversation"],
  kind === 'channel' ? ['Approval', 'an admin has to approve it before anyone can post'] : ['Approval', 'everyone in it has to accept before it locks'],
];
const SEEN = 'The server still sees who is in it, who writes and when, and how big files are. It never sees what anyone says.';

// ---------------------------------------------------------------- start
export function setup(helpers) {
  X = helpers;
  ready = (async () => {
    // The library and its WebAssembly are checked against the release manifest before they run.
    const man = await fetch('/lock/manifest.json', { cache: 'no-cache' }).then((r) => r.json());
    const bytes = new Uint8Array(await (await fetch('/lock/yakyard-crypto_bg.wasm')).arrayBuffer());
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
    if (hash !== man.files['yakyard-crypto_bg.wasm']) throw new Error('The locking code on this server does not match its own manifest.');
    await init({ module_or_path: bytes });
    checkCode(man).catch(() => {});
    const store = await openStore(X.S.me.id);
    L = createLock({ api: X.api, store, wasm: W, me: X.S.me.id, label: deviceLabel() });
    L.store = store;
    st = await L.load();
    if (st.hasDevice) { L.processInbox().catch(() => {}); L.topUpKeys().catch(() => {}); }
    return L;
  })();
  ready.catch((e) => console.warn('locked conversations', e));
  return ready;
}
function deviceLabel() {
  const ua = navigator.userAgent;
  const os = /iPhone|iPad/.test(ua) ? 'iPhone or iPad' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'Linux';
  const br = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  return `${br} on ${os}`;
}
// "Security code": a short fingerprint of the locking code this server sends. If it changes without an
// update you expected, someone changed it. Release notes list the code of each version (docs/E2EE-HASHES.md).
// Same as securityCode in scripts/lock-sync.mjs: SHA-256 over "name:hash" lines, first 64 bits.
export async function securityCode(man) {
  const text = Object.keys(man.files).sort().map((k) => `${k}:${man.files[k]}\n`).join('');
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return [...d.slice(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase().match(/.{4}/g).join('-');
}
async function checkCode(man) {
  const code = await securityCode(man), was = localStorage.getItem('yy-lock-code');
  localStorage.setItem('yy-lock-code', code);
  if (was && was !== code) {
    const { h } = X;
    X.modal('Yakyard was updated', h('div', { class: 'lk' },
      h('p', {}, 'The code that locks your conversations changed with this update.'),
      h('p', {}, 'Security code: ', h('b', { class: 'lk-code' }, code), h('br'), h('small', {}, `Before: ${was}. Version ${man.version}.`)),
      h('p', {}, "If you didn't expect an update, ask your admin, or check the code against the Yakyard release notes before you keep using locked conversations.")),
    [['OK']]);
  }
}
export async function engine() { await ready; return L; }
export const isLocked = (ch) => !!ch && ch.locked === 1;
export const isPending = (ch) => !!ch && ch.locked === 2;

// ---------------------------------------------------------------- device setup
// Returns true when this device can read and send in locked conversations; shows the right screen otherwise.
export async function ensureReady() {
  await ready;
  st = await L.status();
  if (st.ready) return true;
  if (!st.identity) return createKeyFlow();
  return deviceFlow();
}
function createKeyFlow(replace) {
  const { h } = X;
  return new Promise((resolve) => {
    let idn;
    X.modal(replace ? 'Start over with a new recovery key' : 'Set up locked conversations', h('div', { class: 'lk' },
      h('p', {}, 'First, you get a recovery key. It lets you read your locked conversations on a new phone or computer.'),
      h('p', {}, 'You see it once. Have a password manager or a pen ready.')),
    [['Not now', () => { resolve(false); }], ['Show my recovery key', async () => { idn = await L.createIdentity({ replace: !!replace }); showKey(idn, resolve); return true; }]]);
  });
}
function showKey(idn, resolve) {
  const { h } = X;
  const key = idn.recoveryKey, last4 = key.replace(/ /g, '').slice(-4);
  const input = h('input', { class: 'input lk-last4', maxlength: 4, autocomplete: 'off', spellcheck: 'false', 'aria-describedby': 'lk-last4-hint', inputmode: 'text' });
  const copy = h('button', { class: 'btn', type: 'button', onclick: () => navigator.clipboard?.writeText(key).then(() => { copy.textContent = 'Copied'; X.toast('Recovery key copied'); }, () => X.toast("Couldn't copy. Select the key and copy it yourself.")) }, 'Copy');
  const dl = h('button', { class: 'btn', type: 'button', onclick: () => {
    const text = `Yakyard recovery key for ${X.S.me.email} at ${location.host}\n\n${key}\n\nKeep this somewhere safe. It opens your locked conversations on a new device.\nAnyone with this key and your sign-in can read them.\n`;
    const a = h('a', { href: URL.createObjectURL(new Blob([text], { type: 'text/plain' })), download: 'Yakyard recovery key.txt' }); document.body.append(a); a.click(); a.remove();
  } }, 'Download');
  X.modal('Save your recovery key', h('div', { class: 'lk' },
    h('p', {}, 'This key opens your locked conversations on a new phone or computer. Save it in a password manager or write it down.'),
    h('div', { class: 'lk-key', role: 'group', 'aria-label': 'Your recovery key' }, h('code', { tabindex: '0', 'aria-label': 'Recovery key: ' + key.split('').join(' ') }, key)),
    h('div', { class: 'lk-keybtns' }, copy, dl),
    h('p', { class: 'lk-warn', role: 'note' }, h('b', {}, 'You only see this once. '), 'If you lose every device and this key, your locked messages are gone for good. Nobody can get them back, not even your admin.'),
    h('label', { class: 'field' }, h('span', {}, 'To check you saved it, type its last 4 characters'), input, h('small', { id: 'lk-last4-hint' }, 'Letters or numbers, as shown at the end of the key.'))),
  [['Cancel', () => { resolve(false); }], ['I saved it, continue', async () => {
    if (input.value.trim().toUpperCase() !== last4) { input.setAttribute('aria-invalid', 'true'); throw new Error("That doesn't match the end of your key. Look at the key again."); }
    await idn.commit(); st = await L.status();
    X.toast('Locked conversations are set up on this device');
    resolve(true);
  }]]);
}
function deviceFlow() {
  const { h } = X;
  return new Promise((resolve) => {
    const input = h('input', { class: 'input lk-keyin', autocomplete: 'off', spellcheck: 'false', placeholder: 'XXXX XXXX XXXX …' });
    X.modal('Open locked conversations on this device', h('div', { class: 'lk' },
      h('p', {}, "You set up locked conversations on another device. To read them here, use your recovery key, or approve this device from one you've used before."),
      h('label', { class: 'field' }, h('span', {}, 'Recovery key'), input),
      h('p', {}, h('button', { class: 'linkish', type: 'button', onclick: () => approveFlow(resolve) }, 'Approve from another device instead')),
      h('p', {}, h('button', { class: 'linkish', type: 'button', onclick: () => startOverFlow(resolve) }, 'I lost my recovery key and my other devices'))),
    [['Not now', () => resolve(false)], ['Open', async () => {
      try { const n = await L.restore(input.value); st = await L.status(); X.toast(n ? 'Done. Your locked conversations open on this device.' : 'Done. This device is ready.'); forgetPlain(); resolve(true); }
      catch (e) { throw new Error(e.message === 'wrong_key' ? "That's not your recovery key. Check it and try again." : e.message === 'bad_key' ? "That doesn't look like a recovery key. It has 53 letters and numbers." : "That didn't go through. Try again."); }
    }]]);
  });
}
async function approveFlow(resolve) {
  const { h } = X;
  const code = await L.requestApproval();
  X.modal('Approve from another device', h('div', { class: 'lk' },
    h('p', {}, 'Open Yakyard on a phone or computer where your locked conversations already work. It asks you to approve this device.'),
    h('p', {}, 'Check that it shows this code:'),
    h('div', { class: 'lk-key' }, h('code', { 'aria-label': 'Code: ' + code }, code)),
    h('p', { class: 'lk-muted', role: 'status', id: 'lk-wait' }, 'Waiting for your other device…')),
  [['Cancel', () => resolve(false)]]);
  const t = setInterval(async () => {
    await L.processInbox().catch(() => {});
    if (L.hasRecovery()) { clearInterval(t); st = await L.status(); forgetPlain(); X.closeModal(); X.toast('Approved. Your locked conversations open on this device.'); resolve(true); }
    if (!document.getElementById('lk-wait')) clearInterval(t);
  }, 2500);
}
function startOverFlow(resolve) {
  const { h } = X;
  const box = h('input', { type: 'checkbox' });
  X.modal('Start over?', h('div', { class: 'lk' },
    h('p', {}, 'You get a new recovery key. Locked messages from before stay unreadable for you, on every device. Nobody can bring them back.'),
    h('p', {}, 'People you talk to see a notice that your safety code changed.'),
    h('label', { class: 'check' }, box, h('span', {}, 'I understand my old locked messages are gone'))),
  [['Cancel', () => resolve(false)], ['Start over', async () => { if (!box.checked) throw new Error('Tick the box first.'); resolve(await createKeyFlow(true)); return true; }, 'danger']]);
}
// Another of my devices asks to be approved (event from the server).
export async function onVerifyRequest(deviceId) {
  await ready;
  if (!L.hasRecovery() || deviceId === L.myDeviceId()) return;
  const code = await L.deviceCodeFor(deviceId);
  if (!code) return;
  const { h } = X;
  X.modal('Is this you?', h('div', { class: 'lk' },
    h('p', {}, 'A new device wants to open your locked conversations. Only approve it if the code below matches the one on that device.'),
    h('div', { class: 'lk-key' }, h('code', { 'aria-label': 'Code: ' + code }, code))),
  [["It's not me", async () => { await L.removeDevice(deviceId); X.toast('Device removed. Change your password to be safe.'); }, 'danger'], ['Codes match, approve', async () => { await L.approveDevice(deviceId, code); X.toast('Approved'); }]]);
}

// ---------------------------------------------------------------- two-step locking
// Step 1: what changes, with "I understand". Step 2: type the name (or "lock") to confirm.
export function confirmLock({ kind, name, accept }) {
  const { h } = X;
  return new Promise((resolve) => {
    const box = h('input', { type: 'checkbox', id: 'lk-understand' });
    const item = (ok) => ([t, d]) => h('li', { class: ok ? 'ok' : 'no' }, h('span', { class: 'lk-ico', 'aria-hidden': 'true' }, ok ? '✓' : '✕'), h('span', {}, h('b', {}, t), ': ', d));
    const m = X.modal(accept ? 'Lock this conversation?' : kind === 'channel' ? 'Lock this channel?' : 'Lock this conversation?', h('div', { class: 'lk' },
      h('p', {}, 'Locked messages are scrambled on your device before they leave it. Only the people in it can read them, not the server and not your admin.'),
      h('div', { class: 'lk-cols' },
        h('section', {}, h('h3', {}, 'Works'), h('ul', { class: 'lk-list', 'aria-label': 'Works in locked conversations' }, ...WORKS.map(item(true)))),
        h('section', {}, h('h3', {}, "Doesn't work, or works differently"), h('ul', { class: 'lk-list', 'aria-label': "Doesn't work in locked conversations" }, ...DIFFERENT(kind).map(item(false))))),
      h('p', { class: 'lk-muted' }, SEEN),
      h('label', { class: 'check lk-understand' }, box, h('span', {}, 'I understand what changes here'))),
    [['Cancel', () => resolve(false)], ['Continue', async () => {
      if (!box.checked) { box.focus(); throw new Error('Tick "I understand" first.'); }
      typeToConfirm({ kind, name, accept }, resolve); return true;
    }]]);
    readFromTop(m);
  });
}
// Long lists: start reading at the top (the first field would otherwise scroll the list away).
function readFromTop(m) {
  setTimeout(() => { const b = m.querySelector('.modal-body'); if (b) b.scrollTop = 0; const t = m.querySelector('h2'); t.setAttribute('tabindex', '-1'); t.focus(); }, 40);
}
function typeToConfirm({ kind, name, accept }, resolve) {
  const { h } = X;
  const word = kind === 'channel' && name ? name : 'lock';
  const input = h('input', { class: 'input', autocomplete: 'off', spellcheck: 'false', 'aria-describedby': 'lk-type-hint' });
  X.modal('Confirm', h('div', { class: 'lk' },
    h('p', {}, accept ? 'Locking happens once everyone here accepts. It can\'t be undone.' : kind === 'channel' ? "An admin approves it next. Then it's locked for good." : "The others accept it next. Then it's locked for good."),
    h('label', { class: 'field' }, h('span', {}, `Type ${word} to confirm`), input, h('small', { id: 'lk-type-hint' }, word === 'lock' ? 'Four letters: l, o, c, k.' : 'The channel name, exactly.'))),
  [['Cancel', () => resolve(false)], [accept ? 'Accept and lock' : kind === 'channel' ? 'Ask to lock it' : 'Ask to lock it', async () => {
    if (input.value.trim().toLowerCase() !== word.toLowerCase()) { input.setAttribute('aria-invalid', 'true'); throw new Error(`Type ${word} exactly.`); }
    resolve(true);
  }]]);
}
// Owner: turning the workspace setting on takes the same two steps.
export function confirmAllow() {
  const { h } = X;
  return new Promise((resolve) => {
    const box = h('input', { type: 'checkbox' });
    const m = X.modal('Allow locked conversations?', h('div', { class: 'lk' },
      h('p', {}, 'People can then lock DMs and private channels. Locked messages are scrambled on people\'s devices. You, as the owner, can\'t read them, and neither can the server.'),
      h('ul', { class: 'lk-list' }, ...DIFFERENT('channel').slice(0, 9).map(([t, d]) => h('li', { class: 'no' }, h('span', { class: 'lk-ico', 'aria-hidden': 'true' }, '✕'), h('span', {}, h('b', {}, t), ': ', d)))),
      h('p', {}, 'An admin approves every locked channel. Both sides accept every locked DM.'),
      h('label', { class: 'check' }, box, h('span', {}, 'I understand what changes'))),
    [['Cancel', () => resolve(false)], ['Continue', async () => {
      if (!box.checked) throw new Error('Tick "I understand" first.');
      const input = h('input', { class: 'input', autocomplete: 'off' });
      X.modal('Confirm', h('div', { class: 'lk' }, h('label', { class: 'field' }, h('span', {}, 'Type lock to turn it on'), input)),
        [['Cancel', () => resolve(false)], ['Turn on', async () => { if (input.value.trim().toLowerCase() !== 'lock') throw new Error('Type lock exactly.'); resolve(true); }]]);
      return true;
    }]]);
    readFromTop(m);
  });
}
export function explain(ch) {
  const { h } = X;
  const kind = ch.kind === 'dm' ? 'dm' : 'channel';
  const item = (ok) => ([t, d]) => h('li', { class: ok ? 'ok' : 'no' }, h('span', { class: 'lk-ico', 'aria-hidden': 'true' }, ok ? '✓' : '✕'), h('span', {}, h('b', {}, t), ': ', d));
  X.modal("What's different here", h('div', { class: 'lk' },
    h('p', {}, 'This conversation is locked. Messages are scrambled on each device. Only the people in it can read them.'),
    h('div', { class: 'lk-cols' },
      h('section', {}, h('h3', {}, 'Works'), h('ul', { class: 'lk-list' }, ...WORKS.map(item(true)))),
      h('section', {}, h('h3', {}, "Doesn't work, or works differently"), h('ul', { class: 'lk-list' }, ...DIFFERENT(kind).slice(0, 9).map(item(false))))),
    h('p', { class: 'lk-muted' }, SEEN),
    h('p', {}, h('button', { class: 'linkish', type: 'button', onclick: () => devicesPanel() }, 'Your devices and recovery key'))),
  [['Close']]);
}

// ---------------------------------------------------------------- banners in the conversation
export function banner(ch) {
  const { h, svg, I } = X;
  if (isPending(ch)) return pendingBanner(ch);
  if (!isLocked(ch)) return null;
  const warn = h('span', { class: 'lk-warnline', hidden: true });
  ready.then(async () => {
    const w = L.warnings();
    const members = X.S.members.get(ch.id) || [];
    const changed = [...w.keys()].filter((u) => members.includes(u));
    if (changed.length) { warn.hidden = false; warn.replaceChildren(`${changed.map((u) => X.user(u).name).join(', ')} set up locked conversations again, so their safety code changed. `, h('button', { class: 'linkish', onclick: async () => { for (const u of changed) await L.acceptNewSafetyCode(u); warn.hidden = true; X.toast('OK. New messages reach them again.'); } }, 'Trust the new code')); }
  });
  return h('div', { class: 'lk-banner', role: 'note' },
    h('span', { class: 'lk-badge', 'aria-hidden': 'true' }, svg(I.lockSolid || I.lock, 14)),
    h('span', { class: 'lk-text' }, COPY.lockedLine),
    h('button', { class: 'linkish', onclick: () => explain(ch) }, COPY.whatsDifferent),
    h('button', { class: 'linkish', onclick: () => localSearch(ch) }, COPY.searchHere), warn);
}
function pendingBanner(ch) {
  const { h } = X;
  const accepts = JSON.parse(ch.lock_accepts || '[]');
  if (ch.kind === 'channel') {
    return h('div', { class: 'lk-banner lk-wait', role: 'status' }, h('span', { class: 'lk-text' }, 'Waiting for an admin to approve locking. Nobody can post until then.'),
      h('button', { class: 'linkish', onclick: () => explain(ch) }, COPY.whatsDifferent));
  }
  const waitingFor = (ch.members || []).filter((u) => !accepts.includes(u));
  if (!waitingFor.includes(X.S.me.id)) {
    return h('div', { class: 'lk-banner lk-wait', role: 'status' }, h('span', { class: 'lk-text' }, `Waiting for ${waitingFor.map((u) => X.user(u).name).join(', ')} to accept locking. Nobody can post until then.`));
  }
  return h('div', { class: 'lk-banner lk-wait ask', role: 'region', 'aria-label': 'Request to lock this conversation' },
    h('span', { class: 'lk-text' }, `${X.user(ch.lock_by).name} wants to lock this conversation.`),
    h('button', { class: 'btn sm', onclick: async () => { if (!confirm('Decline? The locked conversation is removed. Your normal conversation stays.')) return; await X.api(`/api/channels/${ch.id}/lock/decline`, { method: 'POST', body: {} }); } }, 'Decline'),
    h('button', { class: 'btn sm primary', onclick: async () => {
      if (!(await confirmLock({ kind: 'dm', accept: true }))) return;
      if (!(await ensureReady())) return;
      const out = await X.api(`/api/channels/${ch.id}/lock/accept`, { method: 'POST', body: {} });
      Object.assign(ch, out); X.refresh(ch.id);
    } }, 'Review and accept'));
}

// ---------------------------------------------------------------- reading
// Fill a message in place: text, files and reactions from the encrypted parts. Async work re-renders when done.
export function fill(m) {
  if (!m.enc || m.deleted) return m;
  const hit = plain.get(m.id);
  if (hit && hit.enc === m.enc) apply(m, hit.res);
  else {
    m._lock = 'pending'; m.text = '';
    if (!busy.has(m.id)) {
      busy.add(m.id);
      openMsg(m).then((res) => { plain.set(m.id, { enc: m.enc, res }); busy.delete(m.id); X.rerender(m); }, () => busy.delete(m.id));
    }
  }
  fillReactions(m);
  return m;
}
function apply(m, res) {
  m._lock = res.ok ? 'ok' : res.reason;
  m.text = res.ok ? String(res.data.t || '') : '';
  if (res.ok) {
    const secret = Array.isArray(res.data.f) ? res.data.f : [];
    m.files = secret.map((f) => {
      const o = { ...f, type: safeType(f.type), name: String(f.name || 'file').slice(0, 200), enc: 1, t: f.voice ? 'locked' : undefined };
      if (blobs.has(f.key)) o.url = blobs.get(f.key); else { o.opening = true; openFile(m, f); }
      return o;
    });
  } else m.files = [];
}
async function openMsg(m) {
  await ready;
  if (!st?.hasDevice) return { ok: false, reason: 'setup' };
  const res = await L.decrypt(m.channel_id, m.user_id, m.enc, m.id);
  if (res.ok) L.store.msgPut(m.id, m.channel_id, m.ts, { t: res.data.t || '', u: m.user_id, th: m.thread_id || null }).catch(() => {});
  return res;
}
const opening = new Set();
const SAFE = /^(image\/(png|jpeg|gif|webp|avif|heic|heif)|audio\/(webm|ogg|mp4|mpeg|aac|wav|x-m4a)|video\/(mp4|webm|quicktime))$/;
export const safeType = (t) => (SAFE.test(String(t || '').toLowerCase()) ? String(t).toLowerCase() : 'application/octet-stream');
async function openFile(m, f) {
  if (opening.has(f.key)) return; opening.add(f.key);
  try {
    const r = await fetch('/files/' + encodeURIComponent(f.key), { credentials: 'same-origin' });
    if (!r.ok) throw new Error('gone');
    const data = await decryptFile(new Uint8Array(await r.arrayBuffer()), f);
    // The type comes from the sender. Only types the page shows inline keep it; anything else (HTML, SVG, PDF…)
    // becomes a plain download, so a file can never run as a page of this site.
    blobs.set(f.key, URL.createObjectURL(new Blob([data], { type: safeType(f.type) })));
    plain.delete(m.id); X.rerender(m);
  } catch { blobs.set(f.key, ''); }
  finally { opening.delete(f.key); }
}
function fillReactions(m) {
  if (!m.reactions?.length || m._rxFor === JSON.stringify(m.reactions)) return;
  const agg = new Map(); let pend = false;
  for (const r of m.reactions) {
    if (!String(r.emoji).startsWith('e2:')) continue;
    const hit = rx.get(r.emoji + '|' + m.id);
    if (!hit) {
      pend = true;
      const k = r.emoji + '|' + m.id;
      if (!busy.has(k)) { busy.add(k); ready.then(() => L.decrypt(m.channel_id, r.users[0], r.emoji.slice(3), 'r:' + m.id)).then((res) => { rx.set(k, res.ok && res.data.m === m.id && typeof res.data.r === 'string' ? { emoji: res.data.r.slice(0, 32), ok: true } : { ok: false }); busy.delete(k); m._rxFor = null; X.rerender(m); }, () => busy.delete(k)); }
      continue;
    }
    if (!hit.ok) continue;
    const a = agg.get(hit.emoji) || { emoji: hit.emoji, users: [], ct: {} };
    for (const u of r.users) { a.users.push(u); a.ct[u] = r.emoji; }
    agg.set(hit.emoji, a);
  }
  m._rx = [...agg.values()];
  if (!pend) m._rxFor = JSON.stringify(m.reactions);
}
export const reactions = (m) => (m.enc ? m._rx || [] : m.reactions);

// ---------------------------------------------------------------- writing
async function readyOrSetup() { if (!(await ensureReady())) throw new Error(COPY.notReady); }
function mentionsOf(text) { return { mentions: [...new Set([...text.matchAll(/<@(U[a-z0-9]+)>/gi)].map((x) => x[1]))], mention_all: /<!(channel|here|everyone)>/.test(text) }; }
export async function send(cid, { text, files, threadId, alsoChannel }) {
  await readyOrSetup();
  const r = await L.encryptFor(cid, { t: text, f: files.map((f) => f.secret) });
  if (r.changed?.length) X.toast(`${r.changed.map((u) => X.user(u).name).join(', ')} changed their safety code. Open the conversation banner to trust it.`);
  else if (r.missing?.length) X.toast(`${r.missing.map((u) => X.user(u).name).join(', ')} hasn't set up locked conversations yet. They can read it after they do.`);
  return X.api(`/api/channels/${cid}/messages`, { method: 'POST', body: { enc: r.enc, files: files.map((f) => f.server), thread_id: threadId || null, also_channel: !!alsoChannel, ...mentionsOf(text) } });
}
export async function edit(m, text) {
  await readyOrSetup();
  const secret = (m.files || []).map(({ url, opening: o, enc: e, t, ...f }) => f);
  const r = await L.encryptFor(m.channel_id, { t: text, f: secret });
  plain.delete(m.id);
  return X.api(`/api/messages/${m.id}`, { method: 'PATCH', body: { enc: r.enc } });
}
export async function react(m, emoji) {
  await readyOrSetup();
  const mine = (m._rx || []).find((r) => r.emoji === emoji && r.users.includes(X.S.me.id));
  let value;
  if (mine) value = mine.ct[X.S.me.id];
  else value = 'e2:' + (await L.encryptFor(m.channel_id, { r: emoji, m: m.id })).enc;
  m._rxFor = null;
  return X.api(`/api/messages/${m.id}/reactions`, { method: 'POST', body: { emoji: value } });
}
// A file for a locked conversation: encrypted here, uploaded as an anonymous blob.
export async function upload(file, extra = {}) {
  await readyOrSetup();
  if (file.size > 100 * 1024 * 1024) throw new Error('Files in locked conversations can be up to 100 MB.');
  const e = await encryptFile(file);
  const fd = new FormData(); fd.append('file', new File([e.data], 'locked.bin', { type: 'application/octet-stream' }));
  const meta = await X.api('/api/upload', { method: 'POST', body: fd });
  const server = { key: meta.key, name: 'locked', size: meta.size, type: 'application/octet-stream' };
  const secret = { key: meta.key, k: e.k, iv: e.iv, name: file.name, type: file.type || 'application/octet-stream', size: file.size, ...extra };
  return { server, secret, key: meta.key, name: file.name, size: file.size, type: file.type };
}

// ---------------------------------------------------------------- search on this device
export async function localSearch(ch) {
  const { h } = X;
  await ready;
  const q = h('input', { class: 'input', type: 'search', placeholder: 'Search this conversation…', 'aria-describedby': 'lk-dev-only' });
  const list = h('div', { class: 'lk-results', role: 'list' });
  const run = async () => {
    const v = q.value.trim().toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
    if (v.length < 2) return list.replaceChildren();
    const all = await L.store.msgAll(ch.id);
    const hits = all.filter((r) => String(r.text?.t || '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').includes(v)).sort((a, b) => b.ts - a.ts).slice(0, 50);
    list.replaceChildren(...(hits.length ? hits.map((r) => h('button', { class: 'fitem', role: 'listitem', onclick: () => { X.closeModal(); X.jumpTo({ id: r.id, channel_id: ch.id, ts: r.ts, thread_id: r.text?.th || null }); } },
      h('div', { class: 'fctx' }, h('b', {}, X.user(r.text?.u).name), ' · ', new Date(r.ts).toLocaleString()), h('div', { class: 'text', html: X.fmt(r.text?.t || '') }))) : [h('div', { class: 'empty-row' }, 'Nothing found on this device. Older messages show up here once you scroll back to them.')]));
  };
  let t; q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(run, 200); });
  X.modal('Search here', h('div', { class: 'lk' }, q, h('p', { class: 'lk-muted', id: 'lk-dev-only' }, COPY.searchDeviceOnly + '. The server can\'t search locked messages.'), list), [['Close']]);
}

// ---------------------------------------------------------------- devices panel (from the "what's different" dialog and Preferences)
export async function devicesPanel() {
  const { h } = X;
  await ready;
  const s = await L.status();
  const mine = L.myDeviceId();
  const rows = s.devices.map((d) => h('li', { class: 'lk-dev' }, h('span', { class: 'grow' }, h('b', {}, d.label || 'Device'), d.device_id === mine ? ' (this one)' : '', h('br'), h('small', {}, d.sig ? 'Approved' : 'Waiting for approval', d.last_seen ? ' · last used ' + new Date(d.last_seen).toLocaleDateString() : '')),
    d.device_id !== mine ? h('button', { class: 'btn sm', onclick: async () => { await L.removeDevice(d.device_id); X.toast('Removed'); devicesPanel(); } }, 'Remove') : ''));
  X.modal('Your devices', h('div', { class: 'lk' },
    s.identity ? h('ul', { class: 'lk-devs' }, ...rows) : h('p', {}, "You haven't set up locked conversations yet."),
    s.ready ? '' : h('p', {}, h('button', { class: 'btn', onclick: () => ensureReady() }, s.identity ? 'Open locked conversations on this device' : 'Set up locked conversations')),
    h('p', { class: 'lk-muted' }, 'Your recovery key opens locked conversations on new devices. If you lose every device and the key, locked messages are gone for good.')),
  [['Close']]);
}

// ---------------------------------------------------------------- admin
export function adminCard(A) {
  const { h } = X;
  const owner = X.S.me.role === 'owner';
  const card = h('section', { class: 'card lk-admin' }, h('h3', {}, 'Locked conversations'));
  const on = !!X.S.workspace.locked;
  card.append(h('p', {}, on ? 'On. People can lock DMs and private channels. You approve each locked channel.' : 'Off. Turn it on to let people lock DMs and private channels.'));
  if (owner) card.append(h('button', { class: 'btn', onclick: async () => {
    if (!on && !(await confirmAllow())) return;
    if (on && !confirm('Turn off? Conversations that are already locked stay locked. Nobody can lock new ones.')) return;
    await X.api('/api/e2ee/allow', { method: 'POST', body: { on: !on, confirm: on ? '' : 'lock' } });
    X.S.workspace.locked = !on; X.toast(on ? 'Locked conversations are off' : 'Locked conversations are on'); X.reopenAdmin();
  } }, on ? 'Turn off' : 'Turn on…'));
  else if (!on) card.append(h('p', { class: 'lk-muted' }, 'Only the owner can turn this on.'));
  const list = h('ul', { class: 'lk-reqs', 'aria-label': 'Waiting for approval' });
  card.append(list);
  X.api('/api/e2ee/requests').then((reqs) => {
    if (!reqs.length) return;
    list.before(h('h4', {}, 'Waiting for approval'));
    list.replaceChildren(...reqs.map((r) => h('li', {}, h('span', { class: 'grow' }, h('b', {}, '#' + r.name), ` · asked by ${X.user(r.lock_by).name} · ${r.members} ${r.members === 1 ? 'person' : 'people'}`),
      h('button', { class: 'btn sm', onclick: async () => { await X.api(`/api/channels/${r.id}/lock/decline`, { method: 'POST', body: {} }); X.toast('Declined. The channel was removed.'); X.reopenAdmin(); } }, 'Decline'),
      h('button', { class: 'btn sm primary', onclick: async () => {
        if (!(await confirmLock({ kind: 'channel', name: r.name }))) return;
        await X.api(`/api/channels/${r.id}/lock/approve`, { method: 'POST', body: {} }); X.toast(`#${r.name} is locked`); X.reopenAdmin();
      } }, 'Review and approve'))));
  }).catch(() => {});
  return card;
}

// ---------------------------------------------------------------- events, sign-out
export function onEvent(ev) {
  if (ev.type === 'e2ee_inbox') ready.then(() => L.processInbox()).then((n) => { if (n) { for (const [id, v] of plain) if (!v.res.ok) plain.delete(id); X.rerender(); } }).catch(() => {});
  if (ev.type === 'e2ee_verify') onVerifyRequest(ev.device_id);
  if (ev.type === 'e2ee_devices' || ev.type === 'e2ee_identity') ready.then(() => L.forgetCaches());
}
function forgetPlain() { for (const [id, v] of plain) if (!v.res.ok) plain.delete(id); X.rerender(); }
export async function signOutWipe(userId) { try { L?.store?.close(); } catch {} await wipe(userId); localStorage.removeItem('yy-lock-code'); }
