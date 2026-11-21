// Yakyard client. Plain JS, no build step.
const APP_VERSION = document.querySelector('meta[name="yakyard-version"]')?.content || 'dev';

// ------------------------------------------------------------------ state
const S = {
  me: null, workspace: { name: '' },
  users: new Map(), channels: new Map(), sections: [],
  online: new Set(),
  current: null,          // channel id
  thread: null,           // parent message id
  msgs: new Map(),        // channel id -> { list: [], hasMore, loaded }
  threads: new Map(),     // parent id -> { parent, replies }
  members: new Map(),     // channel id -> [user ids]
  typing: new Map(),      // key channel|thread -> Map(user -> expiry)
  drafts: new Map(),
  view: 'home',
};
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  return el;
};
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const svg = (d, size = 16) => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 20 20'); s.style.width = s.style.height = size + 'px'; const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', d); s.append(p); return s; };
const I = {
  copy: 'M7 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-1v-1.5h1a.5.5 0 0 0 .5-.5V4a.5.5 0 0 0-.5-.5H7a.5.5 0 0 0-.5.5v1H5V4a2 2 0 0 1 2-2zM5 5h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zm0 1.5a.5.5 0 0 0-.5.5v9c0 .3.2.5.5.5h7a.5.5 0 0 0 .5-.5V7a.5.5 0 0 0-.5-.5H5z',
  caret: 'M5.7 7.3a1 1 0 0 1 1.4 0L10 10.2l2.9-2.9a1 1 0 1 1 1.4 1.4l-3.6 3.6a1 1 0 0 1-1.4 0L5.7 8.7a1 1 0 0 1 0-1.4z',
  lock: 'M10 2a4 4 0 0 1 4 4v2h.5A1.5 1.5 0 0 1 16 9.5v7a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 4 16.5v-7A1.5 1.5 0 0 1 5.5 8H6V6a4 4 0 0 1 4-4zm0 1.5A2.5 2.5 0 0 0 7.5 6v2h5V6A2.5 2.5 0 0 0 10 3.5z',
  dots: 'M4 8.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zm6 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zm6 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3z',
  thread: 'M4 4h12a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H9l-4 3v-3H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm2 4v1.5h8V8H6zm0 3v1.5h5V11H6z',
  smile: 'M10 2a8 8 0 1 1 0 16 8 8 0 0 1 0-16zm0 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM6.9 11.2a.8.8 0 0 1 1.1.2 2.4 2.4 0 0 0 4 0 .8.8 0 1 1 1.3.9 4 4 0 0 1-6.6 0 .8.8 0 0 1 .2-1.1zM7.5 7a1 1 0 1 1 0 2 1 1 0 0 1 0-2zm5 0a1 1 0 1 1 0 2 1 1 0 0 1 0-2z',
  close: 'M5.3 5.3a1 1 0 0 1 1.4 0L10 8.6l3.3-3.3a1 1 0 1 1 1.4 1.4L11.4 10l3.3 3.3a1 1 0 0 1-1.4 1.4L10 11.4l-3.3 3.3a1 1 0 0 1-1.4-1.4L8.6 10 5.3 6.7a1 1 0 0 1 0-1.4z',
  plus: 'M10 3a1 1 0 0 1 1 1v5h5a1 1 0 1 1 0 2h-5v5a1 1 0 1 1-2 0v-5H4a1 1 0 1 1 0-2h5V4a1 1 0 0 1 1-1z',
  send: 'M2.7 2.4a1 1 0 0 1 1.1-.1l14 7a1 1 0 0 1 0 1.8l-14 7A1 1 0 0 1 2.4 17l1.9-7-1.9-7a1 1 0 0 1 .3-.6zM5.6 10.8l-1.2 4.4 9.9-5-9.9-5 1.2 4.4H10v1.2H5.6z',
  at: 'M10 2a8 8 0 0 1 8 8v.8c0 1.8-1.3 3.2-3 3.2-1 0-1.9-.5-2.4-1.3A3.5 3.5 0 1 1 13.5 10v.8c0 .9.7 1.7 1.5 1.7s1.5-.8 1.5-1.7V10a6.5 6.5 0 1 0-3.3 5.7.8.8 0 1 1 .8 1.3A8 8 0 1 1 10 2zm0 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4z',
  attach: 'M13.3 3.2a3 3 0 0 1 4.2 4.2l-7.4 7.4a4.5 4.5 0 0 1-6.4-6.4l6.3-6.3a.8.8 0 1 1 1.1 1.1L4.8 9.5a3 3 0 0 0 4.2 4.2l7.4-7.4a1.5 1.5 0 0 0-2.1-2.1l-7.1 7.1a.5.5 0 1 0 .7.7l6-6a.8.8 0 1 1 1.1 1.1l-6 6a2 2 0 0 1-2.9-2.9l7.2-7z',
  bookmark: 'M5.5 2.5h9A1.5 1.5 0 0 1 16 4v14l-6-3.6L4 18V4a1.5 1.5 0 0 1 1.5-1.5zm0 1.5v11.4l4.5-2.7 4.5 2.7V4h-9z',
  pin: 'M7 2.5h6v1.5l-1 .8v4.4l2.8 2.3v1.5h-4.1V18L10 19l-.7-1v-5h-4.1v-1.5L8 9.2V4.8L7 4V2.5z',
  clock: 'M10 2a8 8 0 1 1 0 16 8 8 0 0 1 0-16zm0 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM9.3 5.5h1.4v4.2l3 1.8-.7 1.2-3.7-2.2v-5z',
  bell: 'M10 2a5 5 0 0 1 5 5v3.4l1.6 2.7A1 1 0 0 1 15.8 15H4.2a1 1 0 0 1-.9-1.5L5 10.4V7a5 5 0 0 1 5-5zm2 14a2 2 0 0 1-4 0h4z',
  file: 'M5 2h6.6L16 6.4V17a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zm1 1.5v13h8.5V7.5H10.5v-4H6z',
  moon: 'M8.4 2.3a7.5 7.5 0 1 0 9.3 9.3A6 6 0 0 1 8.4 2.3z',
  edit: 'M14.3 2.3a1 1 0 0 1 1.4 0l2 2a1 1 0 0 1 0 1.4l-9.5 9.5a1 1 0 0 1-.5.3l-3.5.8a.6.6 0 0 1-.7-.7l.8-3.5a1 1 0 0 1 .3-.5l9.7-9.3z',
};

// ------------------------------------------------------------------ api
async function api(path, opts = {}) {
  const hd = opts.body && !(opts.body instanceof FormData) ? { 'content-type': 'application/json' } : {};
  if (api.bm) hd['x-d1-bookmark'] = api.bm;
  const res = await fetch(path, {
    method: opts.method || 'GET',
    headers: hd,
    body: opts.body instanceof FormData ? opts.body : opts.body ? JSON.stringify(opts.body) : undefined,
    credentials: 'same-origin',
  });
  const bm = res.headers.get('x-d1-bookmark'); if (bm) api.bm = bm;
  if (res.status === 401) { try { localStorage.removeItem('pw-boot'); await caches?.delete('yakyard-shell'); } catch {} location.href = '/'; throw new Error('signed out'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 3000);
}

// ------------------------------------------------------------------ people
const user = (id) => S.users.get(id) || { id, name: 'Unknown', color: '#8a898a' };
function avatar(u, cls = 'av', size) {
  const el = h('span', { class: `avatar ${cls}`, title: u.name });
  if (u.avatar) el.style.backgroundImage = `url("${(u.avatar.startsWith('/files/') ? u.avatar + '?w=96' : u.avatar).replace(/"/g, '')}")`;
  else { el.style.background = avatarColor(u); el.style.color = '#3c4049'; el.textContent = (u.name || '?').trim()[0] || '?'; if (size) el.style.fontSize = size; }
  return el;
}
// Soft tones with dark letters: calm, still easy to tell people apart.
const PALETTE = ['#dde6e1', '#e9e0d6', '#dce3ec', '#ebdfe3', '#e3e0ec', '#e2e8d6', '#ece3d3', '#d8e6e7'];
function avatarColor(u) { let h = 0; for (const c of String(u.id || u.name || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0; return PALETTE[h % PALETTE.length]; }
function dmOthers(ch) { return (ch.members || []).filter((u) => u !== S.me.id); }
function chanLabel(ch) {
  if (ch.kind !== 'dm') return ch.name;
  const others = dmOthers(ch);
  if (!others.length) return user(S.me.id).name + ' (you)';
  return others.map((u) => user(u).name).join(', ');
}

// ------------------------------------------------------------------ text formatting (Slack mrkdwn)
function fmt(text) {
  if (!text) return '';
  // Links and code are cut out first and rebuilt safely, so nothing in a message can become markup.
  const slots = [];
  const slot = (html) => { slots.push(html); return `\u0001${slots.length - 1}\u0001`; };
  const safeUrl = (u) => /^https?:\/\//i.test(u) ? esc(u) : null;
  const link = (u, label) => { const href = safeUrl(u); return href ? slot(`<a href="${href}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`) : esc(label); };
  text = String(text).replace(/\u0001/g, '');
  text = text.replace(/```([\s\S]*?)```/g, (_, code) => slot(`<pre>${esc(code.replace(/^\n/, ''))}</pre>`));
  text = text.replace(/`([^`\n]+)`/g, (_, code) => slot(`<code>${esc(code)}</code>`));
  text = text.replace(/<(https?:\/\/[^|>\s]+)\|([^>]+)>/g, (_, u, t) => link(u, t));
  text = text.replace(/<(https?:\/\/[^>\s]+)>/g, (_, u) => link(u, u));
  text = text.replace(/(^|[\s(])(https?:\/\/[^\s<>]+[^\s<>.,;:!?)\]'"])/g, (_, pre, u) => pre + link(u, u));
  let out = esc(text);
  out = out.replace(/&lt;@(U[a-z0-9]+)&gt;/gi, (_, id) => `<span class="mention${id === S.me.id ? ' me' : ''}" data-user="${esc(id)}">@${esc(user(id).name)}</span>`);
  out = out.replace(/&lt;!(channel|here|everyone)&gt;/g, '<span class="mention me">@$1</span>');
  out = out.replace(/&lt;#(C[a-z0-9]+)(?:\|([^&]*))?&gt;/gi, (_, id, n) => `<a href="#/c/${esc(id)}">#${esc(S.channels.get(id)?.name || n || 'channel')}</a>`);
  // Bold / italic / strike, forgiving like Slack: "*Whats *up" and "*Whats*up" both bold "Whats".
  const mark = (ch, tag) => { const e = ch === '*' ? '\\*' : ch; out = out.replace(new RegExp(`(^|[^\\w${e}])${e}(?=\\S)([^${e}\\n]*?\\S)(\\s*)${e}(?!${e})(?=\\w|[^\\w]|$)`, 'g'), `$1<${tag}>$2</${tag}>$3`); };
  out = out.replace(/\*\*(?=\S)([^*\n]*?\S)\s*\*\*/g, '<b>$1</b>');
  mark('*', 'b'); mark('_', 'i'); mark('~', 's');
  out = out.replace(/(^|[^\w*])\*(\S)\*(?!\*)/g, '$1<b>$2</b>');
  out = out.replace(/(^|\n)&gt; ?([^\n]*)/g, '$1<blockquote>$2</blockquote>');
  out = out.replace(/:([a-z0-9_+-]+):/g, (m, n) => EMOJI_NAMES[n] || (S.emoji?.[n] ? `<img class="cemoji" src="${esc(S.emoji[n])}" alt=":${n}:" title=":${n}:">` : m));
  out = out.replace(/\u0001(\d+)\u0001/g, (_, i) => slots[i]);
  return out;
}

// ------------------------------------------------------------------ time
const pad = (n) => String(n).padStart(2, '0');
const timeStr = (ts) => new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
function dayStr(ts) {
  const d = new Date(ts), t = new Date();
  const y = new Date(); y.setDate(t.getDate() - 1);
  if (d.toDateString() === t.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  const opts = { weekday: 'long', month: 'long', day: 'numeric' };
  if (d.getFullYear() !== t.getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString([], opts).replace(/(\d+)$/, (n) => n + ordinal(+n));
}
function ordinal(n) { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return s[(v - 20) % 10] || s[v] || s[0]; }
function ago(ts) {
  const s = (Date.now() - ts) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + ' min ago';
  if (s < 86400) return 'today at ' + timeStr(ts);
  return dayStr(ts) + ' at ' + timeStr(ts);
}
const sizeStr = (b) => (b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(0) + ' KB' : (b / 1048576).toFixed(1) + ' MB');

// ------------------------------------------------------------------ sidebar
function sortedChannels(list) {
  return list.sort((a, b) => chanLabel(a).localeCompare(chanLabel(b)));
}
function chanRow(ch) {
  const unread = ch.unread > 0 && !ch.muted && ch.id !== S.current;
  const row = h('button', {
    class: `chan${unread ? ' unread' : ''}${ch.id === S.current ? ' active' : ''}${ch.muted ? ' muted' : ''}`,
    'data-id': ch.id, onclick: () => go(ch.id),
    oncontextmenu: (e) => { e.preventDefault(); chanMenu(ch, e.clientX, e.clientY); },
  });
  if (ch.kind === 'dm') {
    const others = dmOthers(ch);
    if (others.length > 1) row.append(h('span', { class: 'group-count' }, others.length));
    else {
      const u = user(others[0] || S.me.id);
      const av = avatar(u, 'av', '11px');
      av.append(presenceDot(u));
      row.append(av);
    }
    row.append(h('span', { class: 'label' }, chanLabel(ch)));
    if (others.length === 1) { const st = statusOf(user(others[0])); if (st) row.append(h('span', { class: 'row-status', title: st.text || '' }, emojiNode(st.emoji || '💬'))); }
    if (others.length === 1 && user(others[0]).role === 'guest') row.append(h('span', { class: 'sub' }, 'guest'));
  } else {
    row.append(h('span', { class: 'glyph' }, ch.private ? svg(I.lock, 15) : '#'), h('span', { class: 'label' }, ch.name));
  }
  if (S.huddles?.[ch.id]?.length) row.append(h('span', { class: 'huddle-dot', title: 'Pop-in happening now' }, wave()));
  if (ch.id !== S.current && (S.drafts.get(ch.id) || '').trim() && !(ch.mentions > 0)) row.append(h('span', { class: 'draft-ico', title: 'Draft' }, svg(I.edit, 12)));
  if (ch.mentions > 0 && ch.id !== S.current) row.append(h('span', { class: 'badge' }, ch.mentions));
  else if (ch.kind === 'dm') row.append(h('span', { class: 'row-x', role: 'button', title: 'Close conversation', onclick: (e) => { e.stopPropagation(); closeDM(ch); } }, svg(I.close, 12)));
  return row;
}
function renderSidebar() {
  const list = $('#side-list');
  const scroll = list.scrollTop;
  list.replaceChildren();
  $('#ws-name').textContent = S.workspace.name;
  const all = [...S.channels.values()];
  const dmView = S.view === 'dms';

  if (!dmView) {
    list.append(
      navRow(I.thread, 'Threads', () => { S.threadUnread = 0; openThreadsView(); }, 'threads', S.threadUnread),
      navRow(I.at, 'Mentions & reactions', () => openActivity(), 'activity'),
      navRow(I.bookmark, 'Later', () => openLater(), 'later', S.saved?.size || 0, true),
      navRow(I.file, 'Files', () => openFiles(), 'files'),
    );
    const nb = notifBanner(); if (nb) list.prepend(nb);
    const ib = importCard(); if (ib) list.prepend(ib);
    const starred = all.filter((c) => c.starred);
    if (starred.length) list.append(sectionBlock({ id: '__starred', name: 'Pinned' }, sortedChannels(starred)));
    for (const s of S.sections) {
      const chans = all.filter((c) => c.section_id === s.id && !c.starred);
      list.append(sectionBlock(s, sortedChannels(chans)));
    }
    const inSection = new Set(S.sections.map((s) => s.id));
    const looseChannels = all.filter((c) => c.kind === 'channel' && !c.starred && !inSection.has(c.section_id));
    list.append(sectionBlock({ id: '__channels', name: 'Channels' }, sortedChannels(looseChannels), addRow('Add channels', (e) => addChannelMenu(e))));
  }
  const inSection = new Set(S.sections.map((s) => s.id));
  const dms = all.filter((c) => c.kind === 'dm' && !c.starred && (!c.hidden || c.id === S.current || c.unread) && (dmView || !inSection.has(c.section_id)))
    .sort((a, b) => b.last_ts - a.last_ts);
  if (dmView) {
    const cut = Date.now() - 45 * 864e5;
    const recent = dms.filter((c) => c.last_ts >= cut || c.unread || c.id === S.current), older = dms.filter((c) => !recent.includes(c));
    list.append(sectionBlock({ id: '__dms', name: 'Last 45 days' }, recent, addRow('Add colleagues', () => composeDM())));
    if (older.length) list.append(sectionBlock({ id: '__dms_old', name: `Older (${older.length})`, collapsed: 1 }, older));
    const hiddenN = all.filter((c) => c.kind === 'dm' && c.hidden).length;
    if (hiddenN) list.append(h('button', { class: 'side-note', onclick: showHiddenDMs }, `${hiddenN} closed conversation${hiddenN > 1 ? 's' : ''}`));
  } else {
    const recentDms = dms.filter((c, i) => i < 10 || c.unread || c.id === S.current);
    list.append(sectionBlock({ id: '__dms', name: 'Direct messages' }, recentDms, addRow('Add colleagues', () => composeDM())));
  }
  if (!isStandalone() && !localStorage.getItem('pw-installed') && !platform().phone)
    list.append(h('button', { class: 'get-app', onclick: () => (installEvt ? installEvt.prompt() : installApp()) }, svg('M10 3v8.2l3-3 1 1L10 13.9 6 9.2l1-1 3 3V3h0zM4 15h12v1.5H4z', 16), 'Get the desktop app'));
  list.scrollTop = scroll;
  updateTitle();
}
function navRow(icon, label, onclick, view, count, quiet) {
  return h('button', { class: 'nav-row' + (view && location.hash.startsWith('#/' + view) ? ' active' : '') + (count && !quiet ? ' unread' : ''), 'data-view': view, onclick }, h('span', { class: 'glyph', style: { width: '20px', display: 'inline-flex', justifyContent: 'center' } }, svg(icon, 16)), label, count ? h('span', { class: 'badge nav-badge' + (quiet ? ' quiet' : '') }, count) : '');
}
function addRow(label, onclick) {
  return h('button', { class: 'chan add-row', onclick }, h('span', { class: 'glyph' }, '+'), h('span', { class: 'label' }, label));
}
function sectionBlock(s, chans, extra) {
  const saved = localStorage.getItem('sec:' + s.id);
  const collapsed = saved === null ? s.collapsed === 1 : saved === '1';
  const block = h('div', { class: 'section' + (collapsed ? ' collapsed' : '') });
  const head = h('button', {
    class: 'section-head',
    onclick: (e) => { if (e.target.closest('.more')) return; const c = !block.classList.contains('collapsed'); block.classList.toggle('collapsed', c); localStorage.setItem('sec:' + s.id, c ? '1' : '0'); },
  }, h('span', { class: 'caret' }, svg(I.caret, 12)), h('span', {}, s.name));
  if (!s.id.startsWith('__')) {
    head.append(h('span', { class: 'more icon-btn', role: 'button', onclick: (e) => { e.stopPropagation(); sectionMenu(s, e.clientX, e.clientY); } }, svg(I.dots, 14)));
  }
  block.append(head, ...chans.map(chanRow));
  if (extra) block.append(extra);
  return block;
}
function updateTitle() {
  const unreadDMs = [...S.channels.values()].reduce((n, c) => n + (c.id !== S.current ? c.mentions || 0 : 0), 0);
  const ch = S.channels.get(S.current);
  document.title = (unreadDMs ? `(${unreadDMs}) ` : '') + (ch ? (ch.kind === 'dm' ? chanLabel(ch) : '#' + ch.name) + ' - ' : '') + 'Yakyard';
  const badge = $('#activity-badge');
  badge.hidden = !unreadDMs; badge.textContent = unreadDMs;
  const tb = $('#tab-badge'); if (tb) { tb.hidden = !unreadDMs; tb.textContent = unreadDMs; }
  iconBadge(unreadDMs);
}

// ------------------------------------------------------------------ routing
function go(id, threadId) {
  location.hash = threadId ? `#/c/${id}/t/${threadId}` : `#/c/${id}`;
}
async function route() {
  railActive(location.hash.startsWith('#/admin') ? 'admin' : location.hash.startsWith('#/team') ? 'team' : location.hash.startsWith('#/activity') ? 'activity' : S.view === 'dms' ? 'dms' : 'home');
  const lm = location.hash.match(/^#\/m\/([\w]+)/);
  if (lm) { try { const r = await api(`/api/messages/${lm[1]}/thread`); jumpTo(r.parent); } catch { toast('That message is not available'); } return; }
  if (location.hash.startsWith('#/admin')) return openAdmin();
  if (location.hash.startsWith('#/team')) return openTeam();
  if (location.hash.startsWith('#/activity')) return openActivity();
  if (location.hash.startsWith('#/threads')) return openThreadsView();
  if (location.hash.startsWith('#/later')) return openLater();
  if (location.hash.startsWith('#/files')) return openFiles();
  if (location.hash.startsWith('#/prefs')) return openPrefs();
  if (location.hash.startsWith('#/import')) return openImport();
  if (location.hash.startsWith('#/search')) return searchMessages(decodeURIComponent(location.hash.split('/')[2] || ''));
  const m = location.hash.match(/^#\/c\/([^/]+)(?:\/t\/([^/]+))?/);
  if (!m) {
    // Phone: no conversation in the address means "show the list", the one you came from (Home or DMs).
    if (window.innerWidth <= 760) { showList(); return; }
    // Computer: reopen the last conversation, not #general.
    const last = localStorage.getItem('pw-last');
    const first = (last && S.channels.get(last)) || [...S.channels.values()].find((c) => c.name === 'general') || [...S.channels.values()][0];
    if (first) history.replaceState(null, '', `#/c/${first.id}`), route(); else renderEmpty();
    return;
  }
  const [, id, tid] = m;
  if (!S.channels.has(id) && !route.retried) {
    // A conversation made since the app loaded (a new DM, an added channel): refresh once.
    route.retried = true; try { await bootstrap(); renderSidebar(); } finally { route.retried = false; }
  }
  if (!S.channels.has(id)) {
    // A public channel the user hasn't joined: preview it.
    try {
      const list = await api('/api/channels');
      const c = list.find((x) => x.id === id);
      if (!c) return toast('Channel not found');
      S.preview = { ...c, kind: 'channel', unread: 0, mentions: 0 };
    } catch { return; }
  } else S.preview = null;
  if (S.current !== id) await openChannel(id);
  if (tid) openThread(tid); else closeThread(false);
  setMobileView(tid ? 'thread' : 'main');
}
function setMobileView(v) {
  const app = $('#app');
  app.classList.toggle('view-main', v === 'main');
  app.classList.toggle('view-thread', v === 'thread');
  document.body.classList.toggle('in-convo', v === 'thread' || (v === 'main' && !!S.current));
}

// ------------------------------------------------------------------ channel view
function renderEmpty() { $('#main').replaceChildren($('#empty-main') || h('div', { class: 'empty-main' }, 'Pick a channel')); }

async function openChannel(id) {
  saveDraft(); if (S.holdRead && S.holdRead !== id) S.holdRead = null;
  S.current = id; try { localStorage.setItem('pw-last', id); } catch {}
  const oc = S.channels.get(id); if (oc && window.innerWidth <= 760) S.view = oc.kind === 'dm' ? (S.view === 'dms' ? 'dms' : S.view) : S.view;
  const ch = S.channels.get(id) || S.preview;
  const lastRead = ch.last_read || 0;
  S.openedLastRead = lastRead;
  renderSidebar();
  const main = $('#main');
  const head = channelHeader(ch);
  const msgs = h('div', { class: 'msgs', id: 'msgs' }, h('div', { class: 'msgs-inner', id: 'msgs-inner' }));
  const footer = S.channels.has(id) ? composer({ channelId: id }) : joinBar(ch);
  main.replaceChildren(head, msgs, footer);
  const jump = h('button', { class: 'jump', hidden: true, onclick: () => { msgs.scrollTo({ top: msgs.scrollHeight, behavior: 'smooth' }); } }, svg(I.caret, 14), h('span', {}, 'Jump to latest'));
  main.append(jump);
  if (window.ResizeObserver) new ResizeObserver(() => main.style.setProperty('--comp-h', footer.offsetHeight + 'px')).observe(footer);
  msgs.addEventListener('scroll', () => {
    if (msgs.scrollHeight - msgs.scrollTop - msgs.clientHeight > 300) msgs._stick = false;
    if (msgs.scrollTop < 200 && !msgs._stick) loadOlder();
    const far = msgs.scrollHeight - msgs.scrollTop - msgs.clientHeight > 600;
    if (msgs.scrollHeight - msgs.scrollTop - msgs.clientHeight < 200) loadNewer();
    jump.hidden = !far; if (!far) jump.classList.remove('has-new');
  }, { passive: true });
  $('#msgs-inner').classList.add('enter');
  stickBottom(msgs);
  if (!S.msgs.has(id) || !S.msgs.get(id).loaded) {
    const f = S.focus && S.focus.cid === id ? S.focus : null;
    const cached = !f && msgCacheGet(id);
    S.msgs.set(id, { list: cached || [], hasMore: true, loaded: false });
    if (cached) renderMessages(true);
    try {
      const r = await api(`/api/channels/${id}/messages` + (f ? `?around=${f.ts}` : ''));
      const st = S.msgs.get(id);
      if (f) st.hasNewer = !!r.has_newer;
      st.list = r.messages; st.hasMore = r.has_more; st.loaded = true;
      if (!f) msgCachePut(id, r.messages);
    } catch (e) { toast(e.message); }
  }
  if (S.current !== id) return;
  renderMessages(!S.focus || S.focus.cid !== id);
  focusMessage();
  loadMembers(id);
  markRead(id);
  if (window.innerWidth > 760) $('#main .composer .ce')?.focus();
}
function channelHeader(ch) {
  const title = h('button', { class: 'ch-title', onclick: () => channelDetails(ch) });
  if (ch.kind === 'dm') {
    const others = dmOthers(ch);
    if (others.length === 1) title.append(avatar(user(others[0]), 'av', '12px'));
    title.append(h('span', { class: 'name' }, chanLabel(ch)));
    const o = others.length === 1 && user(others[0]);
    if (o && o.tz) {
      const p = clockPlaces.find((x) => x.people.includes(o.id)), unit = localStorage.getItem('pw-unit') || 'C';
      const t = p && p.temp != null ? (unit === 'F' ? Math.round(p.temp * 9 / 5 + 32) : Math.round(p.temp)) + '°' : '';
      title.append(h('span', { class: 'local-t', title: o.city || '' }, [`${localTime(o.tz)} local`, o.city, t].filter(Boolean).join(' · ')));
    }
  } else {
    title.append(h('span', { class: 'hash' }, ch.private ? svg(I.lock, 16) : '#'), h('span', { class: 'name' }, ch.name));
  }
  title.append(svg(I.caret, 14));
  const pile = h('button', { class: 'member-pile', id: 'member-pile', onclick: () => channelDetails(ch, 'members') }, h('span', { class: 'stack' }), h('span', { class: 'n' }, ''));
  return h('div', {},
    h('div', { class: 'ch-head' }, title, h('div', { class: 'ch-topic', title: ch.topic || '' }, ch.topic || ''),
      h('div', { class: 'ch-actions' }, S.channels.has(ch.id) ? pinsButton(ch) : null, S.channels.has(ch.id) ? huddleButton(ch.id) : null, ch.kind === 'channel' ? pile : null)),
    h('div', { class: 'tabs' }, h('button', { class: 'tab active' }, svg(I.thread, 14), 'Messages')),
  );
}
async function loadMembers(id) {
  try {
    const ids = S.channels.has(id) ? await api(`/api/channels/${id}/members`) : [];
    S.members.set(id, ids);
    const pile = $('#member-pile');
    if (pile && S.current === id) {
      const stack = $('.stack', pile);
      stack.replaceChildren(...ids.slice(0, 3).map((u) => avatar(user(u), '', '10px')));
      $('.n', pile).textContent = ids.length;
    }
  } catch {}
}
function joinBar(ch) {
  return h('div', { class: 'composer-wrap' },
    h('div', { style: { textAlign: 'center', padding: '16px', background: '#f8f8f8', borderRadius: '8px', border: '1px solid #e2e2e2' } },
      h('div', { style: { fontWeight: 900, marginBottom: '8px' } }, `#${ch.name}`),
      h('button', { class: 'btn primary', onclick: async () => {
        const c = await api(`/api/channels/${ch.id}/join`, { method: 'POST', body: {} });
        S.channels.set(c.id, c); S.current = null; S.msgs.delete(c.id); route();
      } }, 'Join channel')));
}

// Last 40 messages of recent conversations, kept on the device so they open instantly.
function msgCacheGet(id) { try { return JSON.parse(localStorage.getItem('pw-m-' + id) || 'null'); } catch { return null; } }
function msgCachePut(id, list) {
  try {
    localStorage.setItem('pw-m-' + id, JSON.stringify(list.slice(-40)));
    const idx = JSON.parse(localStorage.getItem('pw-m-idx') || '[]').filter((x) => x !== id); idx.unshift(id);
    idx.slice(25).forEach((x) => localStorage.removeItem('pw-m-' + x));
    localStorage.setItem('pw-m-idx', JSON.stringify(idx.slice(0, 25)));
  } catch {}
}
addEventListener('visibilitychange', () => { if (document.hidden) for (const [id, st] of S.msgs) if (st.loaded && !st.hasNewer && st.list.length) msgCachePut(id, st.list); });
// Open at the newest message and stay there while pictures and previews load, until you scroll up.
function stickBottom(box) {
  box._stick = true;
  const inner = box.querySelector('#msgs-inner');
  const pin = () => { if (box._stick) box.scrollTop = box.scrollHeight; };
  const off = () => { box._stick = box.scrollHeight - box.scrollTop - box.clientHeight < 40; };
  box.addEventListener('wheel', () => setTimeout(off, 60), { passive: true });
  box.addEventListener('touchmove', () => setTimeout(off, 60), { passive: true });
  box.addEventListener('keydown', () => setTimeout(off, 60));
  if (window.ResizeObserver && inner) { new ResizeObserver(pin).observe(inner); new ResizeObserver(pin).observe(box); }
  box.addEventListener('load', pin, true);
}
function renderMessages(scrollBottom) {
  const st = S.msgs.get(S.current);
  const inner = $('#msgs-inner');
  const box = $('#msgs');
  if (!inner || !st) return;
  const prevH = box.scrollHeight, prevTop = box.scrollTop;
  const nearBottom = box._stick || box.scrollHeight - box.scrollTop - box.clientHeight < 120;
  inner.replaceChildren();
  const ch = S.channels.get(S.current) || S.preview;
  if (!st.hasMore) inner.append(channelIntro(ch));
  else inner.append(h('button', { class: 'load-more', onclick: loadOlder }, 'Load older messages'));
  let lastDay = '', prev = null, newShown = false;
  for (const m of st.list) {
    const day = new Date(m.ts).toDateString();
    if (day !== lastDay) { inner.append(h('div', { class: 'day' }, h('span', {}, dayStr(m.ts)))); lastDay = day; prev = null; }
    if (!newShown && S.openedLastRead && m.ts > S.openedLastRead && m.user_id !== S.me.id) {
      inner.append(h('div', { class: 'new-line' }, h('span', {}, 'New'))); newShown = true; prev = null;
    }
    const cont = prev && prev.user_id === m.user_id && m.ts - prev.ts < 5 * 60e3 && !prev.deleted && !m.deleted && prev.reply_count === 0 && m.source !== 'huddle' && prev.source !== 'huddle' && !m.also_channel && !S.saved?.has(m.id) && !m.pinned_by;
    inner.append(messageEl(m, { cont, inThread: false }));
    prev = m;
  }
  if (S.typing?.size) renderTyping();
  if (scrollBottom || nearBottom) box.scrollTop = box.scrollHeight;
  else box.scrollTop = prevTop + (box.scrollHeight - prevH) * 0;
}
function channelIntro(ch) {
  if (ch.kind === 'dm') {
    const others = dmOthers(ch);
    return h('div', { class: 'chan-intro' }, h('h2', {}, chanLabel(ch)),
      h('p', {}, others.length ? `This is the very beginning of your direct message history with ${chanLabel(ch)}.` : 'This is your space. Draft messages, list your to-dos, or keep links and files handy.'));
  }
  return h('div', { class: 'chan-intro' }, h('h2', {}, (ch.private ? '' : '# ') + ch.name),
    h('p', {}, `This is the very beginning of #${ch.name}.`), ch.topic ? h('p', { class: 'intro-topic' }, ch.topic) : '');
}
async function loadNewer() {
  const id = S.current, st = S.msgs.get(id);
  if (!st || !st.hasNewer || st.loadingNew || !st.list.length) return;
  st.loadingNew = true;
  try {
    const r = await api(`/api/channels/${id}/messages?after=${st.list[st.list.length - 1].ts}`);
    st.list = [...st.list, ...r.messages]; st.hasNewer = !!r.has_newer;
    if (S.current === id) renderMessages(false);
  } finally { st.loadingNew = false; }
}
async function loadOlder() {
  const id = S.current;
  const st = S.msgs.get(id);
  if (!st || !st.hasMore || st.loading || !st.list.length) return;
  st.loading = true;
  const box = $('#msgs');
  const before = box.scrollHeight;
  try {
    const r = await api(`/api/channels/${id}/messages?before=${st.list[0].ts}`);
    st.list = [...r.messages, ...st.list]; st.hasMore = r.has_more;
    if (S.current === id) { renderMessages(false); box.scrollTop = box.scrollHeight - before + box.scrollTop; }
  } finally { st.loading = false; }
}

function messageEl(m, { cont, inThread, isParent }) {
  const u = user(m.user_id);
  const fresh = m._freshAt && Date.now() - m._freshAt < 700;
  const el = h('div', { class: `msg${cont ? ' cont' : ''}${m.deleted ? ' deleted' : ''}${fresh ? ' fresh' : ''}${m.user_id === S.me?.id ? ' mine' : ''}${m._sending ? ' sending' : ''}`, 'data-id': m.id });
  el.append(avatar(u, 'av', '15px'));
  el.firstChild.addEventListener('click', () => profile(u));
  if (cont) el.append(h('span', { class: 'cont-time', title: new Date(m.ts).toLocaleString() }, timeStr(m.ts).replace(/\s?[AP]M$/i, '')));
  const meta = h('div', { class: 'meta' }, h('span', { class: 'who', title: u.tz ? `${localTime(u.tz)} for ${u.name.split(' ')[0]}${u.city ? ' in ' + u.city : ''}` : '', onclick: () => profile(u) }, u.name));
  if (u.role === 'guest') meta.append(h('span', { class: 'tag' }, 'GUEST'));
  const st = statusOf(u); if (st) meta.append(h('span', { class: 'm-status', title: st.text || '' }, emojiNode(st.emoji || '💬')));
  meta.append(h('a', { class: 'time', title: new Date(m.ts).toLocaleString(), href: `#/c/${m.channel_id}${m.thread_id ? '/t/' + m.thread_id : ''}` }, timeStr(m.ts)));
  const body = h('div', { class: 'body' }, meta);
  const flags = [];
  if (S.saved?.has(m.id)) flags.push(h('span', { class: 'flag saved' }, svg(I.bookmark, 12), 'Saved for later'));
  if (m.pinned_by) flags.push(h('span', { class: 'flag pinned' }, svg(I.pin, 12), `Pinned by ${m.pinned_by === S.me.id ? 'you' : user(m.pinned_by).name}`));
  if (flags.length) { el.classList.add(S.saved?.has(m.id) ? 'is-saved' : 'is-pinned'); el.prepend(h('div', { class: 'flags' }, ...flags)); }
  if (m.also_channel && m.thread_id && !inThread) body.append(h('button', { class: 'also-note', onclick: () => go(m.channel_id, m.thread_id) }, 'replied to a thread'));
  if (m.deleted) body.append(h('div', { class: 'text' }, 'This message was deleted.'));
  else if (m.source === 'huddle') body.append(huddleCardEl(m));
  else {
    const text = h('div', { class: 'text', html: fmt(m.text) });
    if (m.edited_ts) text.append(' ', h('span', { class: 'edited' }, '(edited)'));
    body.append(text);
    if (m.files?.length) body.append(filesEl(m.files));
    const link = firstLink(m.text);
    if (link) body.append(unfurlEl(link));
    if (m.reactions?.length) body.append(reactionsEl(m));
    if (!inThread && m.reply_count > 0) body.append(repliesEl(m));
    const bar = hoverBar(m, inThread);
    if (m.user_id === S.me?.id && document.body.classList.contains('bubbles') && (m.text || '').trim()) { text.append(bar); text.classList.add('has-bar'); }
    else el.append(bar);
    el.addEventListener('mouseenter', () => {
      const box = el.closest('.msgs, .thread-msgs, #thread-inner')?.getBoundingClientRect(); if (!box) return;
      el.classList.toggle('bar-in', el.getBoundingClientRect().top - box.top < 30);
      text.classList.toggle('bar-above', text.getBoundingClientRect().left - box.left < 260);
    });
  }
  el.append(body);
  $$('.mention[data-user]', body).forEach((s) => s.addEventListener('click', () => profile(user(s.dataset.user))));
  if (!m.deleted && m.source !== 'huddle') longPress(el, () => msgSheet(m, inThread));
  return el;
}
// link previews (server side adapted from tldraw/cloudflare-workers-unfurl, MIT)
const unfurls = new Map();
function firstLink(text) {
  const m = (text || '').match(/<(https?:\/\/[^|>\s]+)(?:\|[^>]*)?>|(https?:\/\/[^\s<>]+[^\s<>.,;:!?)\]'"])/);
  const u = m && (m[1] || m[2]);
  if (!u) return null;
  try { if (new URL(u).host === location.host) return null; } catch { return null; }
  return u;
}
function unfurlEl(url) {
  const box = h('div', { class: 'unfurl', hidden: true });
  const fill = (d) => {
    if (!d || !(d.title || d.image)) return;
    const dec = (t) => { const x = document.createElement('textarea'); x.innerHTML = String(t || ''); return x.value; };
    d = { ...d, title: dec(d.title), description: dec(d.description), site_name: dec(d.site_name) };
    let host = ''; try { host = new URL(url).hostname.replace(/^www\./, ''); } catch {}
    box.replaceChildren(
      h('div', { class: 'uf-site' }, d.favicon ? h('img', { src: d.favicon, alt: '', onerror: (e) => e.target.remove() }) : '', host),
      d.title ? h('a', { class: 'uf-title', href: url, target: '_blank', rel: 'noopener' }, d.title) : '',
      d.description ? h('div', { class: 'uf-desc' }, d.description.length > 220 ? d.description.slice(0, 217) + '…' : d.description) : '',
      d.image ? h('a', { href: url, target: '_blank', rel: 'noopener' }, h('img', { class: 'uf-img', src: d.image, alt: '', loading: 'lazy', onerror: (e) => e.target.remove() })) : '');
    box.hidden = false;
  };
  if (unfurls.has(url)) { const v = unfurls.get(url); v instanceof Promise ? v.then(fill) : fill(v); }
  else {
    const pr = api('/api/unfurl?url=' + encodeURIComponent(url)).catch(() => ({}));
    unfurls.set(url, pr); pr.then((d) => { unfurls.set(url, d); fill(d); });
  }
  return box;
}
// ---------------------------------------------------------------- voice notes
const VI = {
  mic: 'M10 2a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3zm0 1.5A1.5 1.5 0 0 0 8.5 5v5a1.5 1.5 0 0 0 3 0V5A1.5 1.5 0 0 0 10 3.5zM5 9.3a.8.8 0 0 1 .8.8 4.2 4.2 0 0 0 8.4 0 .8.8 0 0 1 1.6 0 5.8 5.8 0 0 1-5.05 5.75V17.5h2.05a.75.75 0 0 1 0 1.5h-5.6a.75.75 0 0 1 0-1.5h2.05v-1.65A5.8 5.8 0 0 1 4.2 10.1a.8.8 0 0 1 .8-.8z',
  play: 'M6.5 4.3v11.4a.8.8 0 0 0 1.2.7l9-5.7a.8.8 0 0 0 0-1.4l-9-5.7a.8.8 0 0 0-1.2.7z',
  pause: 'M5.5 4h3.2v12H5.5zM11.3 4h3.2v12h-3.2z',
  trash: 'M8 2h4a1 1 0 0 1 1 1v1h3.2a.75.75 0 0 1 0 1.5h-1l-.8 10.9a2 2 0 0 1-2 1.8H7.6a2 2 0 0 1-2-1.8L4.8 5.5h-1a.75.75 0 0 1 0-1.5H7V3a1 1 0 0 1 1-1zm.5 2h3v-.5h-3zM6.3 5.5l.8 10.8c0 .3.2.4.5.4h4.8c.3 0 .5-.1.5-.4l.8-10.8z',
};
const clockDur = (s) => { s = Math.max(0, Math.round(s || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const VP = new Map(); // key -> player, kept across re-renders so a note keeps playing when its transcript arrives
let vpNow = null;
function fakeWave(seed, n = 48) {
  let x = 0; for (const c of String(seed)) x = (x * 31 + c.charCodeAt(0)) >>> 0;
  return Array.from({ length: n }, () => { x = (x * 1103515245 + 12345) >>> 0; return 18 + (x % 70); });
}
function voiceEl(f) {
  let p = VP.get(f.key);
  if (!p) p = makePlayer(f);
  p.setTranscript(f);
  return p.node;
}
function makePlayer(f) {
  const url = f.url || '/files/' + encodeURIComponent(f.key);
  const wave = (f.voice?.wave?.length ? f.voice.wave : fakeWave(f.key)).slice(0, 64);
  const audio = new Audio(); audio.preload = 'none'; audio.src = url;
  let dur = +f.voice?.dur || 0;
  const rates = [1, 1.5, 2];
  const btn = h('button', { class: 'vn-play', title: 'Play', 'aria-label': 'Play voice note' }, svg(VI.play, 16));
  const bars = wave.map((v) => h('i', { style: { height: Math.max(12, v) + '%' } }));
  const waveEl = h('div', { class: 'vn-wave', role: 'slider', 'aria-label': 'Seek', tabindex: '0' }, ...bars);
  const time = h('span', { class: 'vn-time' }, dur ? clockDur(dur) : '');
  const speed = h('button', { class: 'vn-speed', title: 'Playback speed' }, '1×');
  const tBox = h('div', { class: 'vn-t' });
  const node = h('div', { class: 'voice', 'data-key': f.key }, h('div', { class: 'vn-row' }, btn, waveEl, time, speed), tBox);
  const total = () => (isFinite(audio.duration) && audio.duration > 0 ? audio.duration : dur);
  const paint = () => {
    const d = total(), at = audio.currentTime || 0, k = d ? at / d : 0, on = Math.round(k * bars.length);
    bars.forEach((b, i) => b.classList.toggle('on', i < on));
    time.textContent = audio.paused && !at ? (d ? clockDur(d) : '') : clockDur(at) + (d ? ' / ' + clockDur(d) : '');
  };
  const setIcon = () => { btn.replaceChildren(svg(audio.paused ? VI.play : VI.pause, 16)); btn.title = audio.paused ? 'Play' : 'Pause'; node.classList.toggle('playing', !audio.paused); };
  btn.onclick = () => {
    if (audio.paused) { if (vpNow && vpNow !== audio) vpNow.pause(); vpNow = audio; audio.play().catch((e) => toast('Could not play. ' + (e.message || ''))); }
    else audio.pause();
  };
  speed.onclick = () => { const r = rates[(rates.indexOf(audio.playbackRate) + 1) % rates.length]; audio.playbackRate = r; speed.textContent = r + '×'; };
  const seek = (clientX) => {
    const r = waveEl.getBoundingClientRect(), k = Math.min(1, Math.max(0, (clientX - r.left) / r.width)), d = total();
    if (!d) { btn.onclick(); return; }
    audio.currentTime = k * d; paint();
  };
  waveEl.addEventListener('pointerdown', (e) => { seek(e.clientX); const mv = (ev) => seek(ev.clientX); const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); }; addEventListener('pointermove', mv); addEventListener('pointerup', up); });
  waveEl.onkeydown = (e) => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { audio.currentTime = Math.max(0, (audio.currentTime || 0) + (e.key === 'ArrowRight' ? 5 : -5)); paint(); e.preventDefault(); } if (e.key === ' ' || e.key === 'Enter') { btn.onclick(); e.preventDefault(); } };
  audio.addEventListener('play', setIcon); audio.addEventListener('pause', setIcon);
  audio.addEventListener('timeupdate', paint); audio.addEventListener('loadedmetadata', paint);
  audio.addEventListener('ended', () => { audio.currentTime = 0; paint(); setIcon(); });
  let last = null;
  const p = {
    node,
    setTranscript(nf) {
      if (!nf.voice) { tBox.hidden = true; return; }
      const sig = (nf.t || '') + '|' + (nf.transcript || '');
      if (sig === last) return; last = sig;
      if (nf.voice?.dur) dur = +nf.voice.dur;
      tBox.hidden = false;
      if (nf.t === 'done' && nf.transcript) {
        const txt = h('div', { class: 'vn-text clamp' }, nf.transcript);
        const more = h('button', { class: 'vn-link', hidden: true, onclick: () => { const c = txt.classList.toggle('clamp'); more.textContent = c ? 'Show more' : 'Show less'; } }, 'Show more');
        const copy = h('button', { class: 'vn-link', onclick: () => navigator.clipboard?.writeText(nf.transcript).then(() => toast('Transcript copied'), () => toast('Could not copy')) }, 'Copy');
        tBox.replaceChildren(h('div', { class: 'vn-label' }, 'Transcript'), txt, h('div', { class: 'vn-acts' }, more, copy));
        requestAnimationFrame(() => { more.hidden = txt.scrollHeight <= txt.clientHeight + 2; });
      } else if (nf.t === 'done') {
        tBox.replaceChildren(h('div', { class: 'vn-muted' }, 'No speech heard'));
      } else if (nf.t === 'failed') {
        tBox.replaceChildren(h('div', { class: 'vn-muted' }, 'No transcript yet. ', h('button', { class: 'vn-link', onclick: (e) => { e.target.disabled = true; tBox.replaceChildren(h('div', { class: 'vn-muted vn-wait' }, 'Transcribing…')); last = null; api('/api/voice/transcribe', { method: 'POST', body: { key: nf.key, retry: true } }).catch((er) => toast(er.message)); } }, 'Try again')));
      } else {
        tBox.replaceChildren(h('div', { class: 'vn-muted vn-wait' }, 'Transcribing…'));
      }
    },
  };
  VP.set(f.key, p);
  return p;
}

// Recorder: one at a time. English transcript happens on the server after upload.
const REC_MAX = 15 * 60;
function pickMime() {
  for (const t of ['audio/webm;codecs=opus', 'audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus']) if (window.MediaRecorder?.isTypeSupported?.(t)) return t;
  return '';
}
async function startRecorder(onTick) {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) throw new Error('This browser cannot record audio');
  const mic = localStorage.getItem('pw-mic');
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1, ...(mic ? { deviceId: { ideal: mic } } : {}) } });
  const mime = pickMime();
  const rec = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), audioBitsPerSecond: 32000 });
  const chunks = []; rec.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
  const ac = new (window.AudioContext || window.webkitAudioContext)();
  const an = ac.createAnalyser(); an.fftSize = 1024; ac.createMediaStreamSource(stream).connect(an);
  const buf = new Uint8Array(an.fftSize), levels = [];
  let ms = 0, lastT = performance.now(), paused = false, raf = 0;
  const loop = () => {
    const t = performance.now();
    if (!paused) {
      ms += t - lastT;
      an.getByteTimeDomainData(buf);
      let sum = 0; for (const v of buf) sum += ((v - 128) / 128) ** 2;
      const lvl = Math.min(1, Math.sqrt(sum / buf.length) * 3.2);
      if (!levels.length || ms / 100 > levels.length) levels.push(lvl);
      onTick(ms / 1000, levels);
    }
    lastT = t; raf = requestAnimationFrame(loop);
  };
  rec.start(1000); raf = requestAnimationFrame(loop);
  const cleanup = () => { cancelAnimationFrame(raf); stream.getTracks().forEach((x) => x.stop()); ac.close().catch(() => {}); };
  return {
    get secs() { return ms / 1000; },
    get paused() { return paused; },
    pause() { if (rec.state === 'recording') { rec.pause(); paused = true; } },
    resume() { if (rec.state === 'paused') { rec.resume(); paused = false; lastT = performance.now(); } },
    cancel() { try { rec.stop(); } catch {} cleanup(); },
    stop() {
      return new Promise((res) => {
        rec.onstop = () => {
          cleanup();
          const type = (rec.mimeType || mime || 'audio/webm').split(';')[0];
          const n = 48, wave = [];
          for (let i = 0; i < n; i++) { const a = Math.floor(i * levels.length / n), b = Math.max(a + 1, Math.floor((i + 1) * levels.length / n)); let m = 0; for (let j = a; j < b && j < levels.length; j++) m = Math.max(m, levels[j]); wave.push(m); }
          const top = Math.max(0.05, ...wave);
          res({ blob: new Blob(chunks, { type }), type, dur: ms / 1000, wave: wave.map((v) => Math.round(12 + 88 * (v / top))) });
        };
        try { rec.requestData(); } catch {}
        rec.stop();
      });
    },
  };
}

function filesEl(files) {
  const box = h('div', { class: 'files' });
  for (const f of files) {
    const url = f.url || '/files/' + encodeURIComponent(f.key);
    if (f.voice || /^audio\//.test(f.type)) { box.append(voiceEl(f)); continue; }
    if (/^image\//.test(f.type)) {
      const thumb = !f.url && /\.(png|jpe?g|webp|heic|heif)$/i.test(f.key || '') ? url + '?w=880' : url;
      box.append(h('img', { class: 'file-img', src: thumb, alt: f.name, loading: 'lazy', decoding: 'async', onclick: () => lightbox(url),
        onerror: (e) => e.target.replaceWith(h('div', { class: 'file-card gone' }, h('span', { class: 'file-ico', style: { background: '#c4c8d0' } }, 'IMG'), h('div', {}, h('div', { class: 'fname' }, f.name), h('div', { class: 'fmeta' }, 'No longer available')))) }));
    } else if (/^video\/(mp4|quicktime|webm)/.test(f.type)) {
      box.append(h('video', { class: 'file-video', src: url, controls: true, preload: 'metadata', playsinline: true }));
    } else {
      const ext = (f.name.split('.').pop() || 'file').slice(0, 4);
      box.append(h('a', { class: 'file-card', href: url, target: '_blank', rel: 'noopener' },
        h('span', { class: 'file-ico', style: { background: fileColor(ext) } }, ext),
        h('div', {}, h('div', { class: 'fname' }, f.name), h('div', { class: 'fmeta' }, (f.size ? sizeStr(f.size) + ' · ' : '') + ext.toUpperCase()))));
    }
  }
  return box;
}
const fileColor = (ext) => ({ pdf: '#b4534f', xls: '#3d7a5c', xlsx: '#3d7a5c', csv: '#3d7a5c', numbers: '#3d7a5c', doc: '#4f5f73', docx: '#4f5f73', pages: '#4f5f73', ppt: '#a8693a', pptx: '#a8693a', key: '#a8693a', zip: '#6b707b', mp4: '#5d5a73', mov: '#5d5a73' }[ext.toLowerCase()] || '#6b707b');
function lightbox(src) {
  const lb = h('div', { class: 'lightbox', onclick: () => lb.remove() }, h('img', { src }));
  document.body.append(lb);
}
function reactionsEl(m) {
  const box = h('div', { class: 'reactions' });
  for (const r of m.reactions) {
    const mine = r.users.includes(S.me.id);
    const popping = S.pop && S.pop.id === m.id && S.pop.emoji === r.emoji && Date.now() - S.pop.at < 900;
    const b = h('button', {
      class: 'react' + (mine ? ' mine' : '') + (popping ? ' pop' : ''), 'aria-label': r.users.map((u) => user(u).name).join(', ') + ' reacted with ' + emojiName(r.emoji),
      onclick: () => { hideReactTip(); react(m, r.emoji); },
      onmouseenter: (e) => showReactTip(e.currentTarget, r), onmouseleave: hideReactTip,
    }, h('span', { class: 'e' }, emojiNode(r.emoji)), r.users.length);
    longPress(b, () => { showReactTip(b, r); setTimeout(hideReactTip, 2600); });
    box.append(b);
  }
  if (m.reactions.length) box.append(h('button', { class: 'react add', title: 'Add reaction', onclick: (e) => emojiPicker(e.currentTarget, (em) => react(m, em)) }, svg(I.smile, 16), h('b', {}, '+')));
  return box;
}
function emojiNode(e) {
  const n = e.replace(/^:|:$/g, '').replace(/::skin-tone-\d$/, '');
  if (EMOJI_NAMES[n]) return EMOJI_NAMES[n];
  if (S.emoji?.[n]) return h('img', { class: 'cemoji', src: S.emoji[n], alt: e, title: ':' + n + ':' });
  return e;
}
// Enter key: send (computer default, like Slack) or new line (phone default). Changeable in settings.
function enterSends() { const v = localStorage.getItem('pw-enter'); return v ? v === 'send' : !matchMedia('(pointer: coarse)').matches; }
function shortWhen(ts) {
  const d = new Date(ts), now = new Date(), t = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return 'Today ' + t;
  if (new Date(now - 864e5).toDateString() === d.toDateString()) return 'Yesterday';
  if (now - d < 6 * 864e5) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) });
}
function repliesEl(m) {
  return h('button', { class: 'replies', title: 'Last reply ' + ago(m.last_reply_ts), onclick: () => go(m.channel_id, m.id) },
    h('span', { class: 'ravs' }, ...(m.reply_users || []).slice(0, 3).map((u) => avatar(user(u), '', '9px'))),
    h('span', { class: 'count' }, m.reply_count === 1 ? '1 reply' : `${m.reply_count} replies`),
    h('span', { class: 'last' }, shortWhen(m.last_reply_ts)), h('span', { class: 'view' }, 'View thread'),
    svg(I.caret, 12));
}
function hoverBar(m, inThread) {
  const bar = h('div', { class: 'hover-bar' });
  const quick = [...new Set([...recentEmoji(), '✅', '👀', '🙌'])].slice(0, 3);
  for (const e of quick) bar.append(h('button', { class: 'hb-emo', title: emojiName(e), onclick: () => react(m, e) }, emojiNode(e)));
  bar.append(h('button', { title: 'Add reaction', onclick: (ev) => emojiPicker(ev.currentTarget, (em) => react(m, em)) }, svg(I.smile, 18)));
  if (!inThread) bar.append(h('button', { title: 'Reply in thread', onclick: () => go(m.channel_id, m.thread_id || m.id) }, svg(I.thread, 18)));
  bar.append(h('button', { title: S.saved?.has(m.id) ? 'Remove from Later' : 'Save for later', class: S.saved?.has(m.id) ? 'on' : '', onclick: () => toggleSave(m) }, svg(I.bookmark, 17)));
  bar.append(h('button', { title: 'More actions', onclick: (ev) => msgMenu(m, ev.currentTarget) }, svg(I.dots, 18)));
  return bar;
}
// Phones: press and hold a message for actions, like Slack mobile.
function longPress(el, fn) {
  let t = null, x = 0, y = 0;
  el.addEventListener('touchstart', (e) => { if (e._lp) return; e._lp = true; x = e.touches[0].clientX; y = e.touches[0].clientY; el.classList.add('pressing'); t = setTimeout(() => { t = null; el.classList.remove('pressing'); navigator.vibrate?.(8); fn(); }, 430); }, { passive: true });
  el.addEventListener('contextmenu', (e) => { if (matchMedia('(pointer: coarse)').matches) e.preventDefault(); });
  el.addEventListener('touchmove', (e) => { if (t && (Math.abs(e.touches[0].clientX - x) > 8 || Math.abs(e.touches[0].clientY - y) > 8)) { clearTimeout(t); t = null; el.classList.remove('pressing'); } }, { passive: true });
  el.addEventListener('touchend', () => { if (t) clearTimeout(t); t = null; el.classList.remove('pressing'); });
}
function msgSheet(m, inThread) {
  closeSheet();
  const close = () => closeSheet();
  const act = (label, icon, fn, cls = '') => h('button', { class: 'sheet-act ' + cls, onclick: async () => { await closeSheet(); fn(); } }, svg(icon, 18), label);
  const acts = [];
  if (!inThread) acts.push(act('Reply in thread', I.thread, () => go(m.channel_id, m.id)));
  acts.push(act(S.saved?.has(m.id) ? 'Remove from Later' : 'Save for later', I.bookmark, () => toggleSave(m)));
  acts.push(act('Remind me', I.clock, () => remindMenu(m)));
  if (S.me.role !== 'guest') acts.push(act(m.pinned_by ? 'Unpin from channel' : 'Pin to channel', I.pin, () => togglePin(m)));
  acts.push(act('Copy text', I.copy || I.edit, () => { navigator.clipboard?.writeText(m.text).then(() => toast('Copied'), () => toast('Could not copy')); }));
  acts.push(act('Copy link', I.attach || I.at, () => { navigator.clipboard?.writeText(`${location.origin}/#/c/${m.channel_id}${m.thread_id ? '/t/' + m.thread_id : ''}`).then(() => toast('Link copied'), () => toast('Could not copy')); }));
  if (m.user_id === S.me.id) acts.push(act('Edit message', I.edit, () => editMessage(m)));
  if (m.user_id === S.me.id || isAdmin()) acts.push(act('Delete message', I.close, () => deleteMessage(m), 'danger'));
  const sheet = h('div', { class: 'sheet-wrap', onclick: (e) => { if (e.target.classList.contains('sheet-wrap')) close(); } },
    h('div', { class: 'sheet' }, h('i', { class: 'grab' }),
      h('div', { class: 'sheet-emoji' }, ...[...new Set([...recentEmoji(), '👍', '❤️', '😂', '✅', '👀', '🙌'])].slice(0, 6).map((e) => h('button', { onclick: () => { close(); react(m, e); } }, e)),
        h('button', { class: 'more', onclick: async () => { await closeSheet(); emojiPicker(document.body, (em) => react(m, em)); } }, svg(I.smile, 22))),
      ...acts));
  document.body.append(sheet); pushOverlay();
}
function closeSheet() { const was = $$('.sheet-wrap').length; $$('.sheet-wrap').forEach((x) => x.remove()); return was ? popOverlay() : Promise.resolve(); }
async function react(m, emoji) {
  S.pop = { id: m.id, emoji, at: Date.now() };
  try { applyMessage(await api(`/api/messages/${m.id}/reactions`, { method: 'POST', body: { emoji } })); } catch (e) { toast(e.message); }
}
function msgMenu(m, anchor) {
  const r = anchor.getBoundingClientRect();
  const items = [['Copy link', () => { navigator.clipboard?.writeText(`${location.origin}/#/m/${m.id}`).then(() => toast('Link copied'), () => toast('Could not copy')); }],
    ['Copy text', () => { navigator.clipboard?.writeText(m.text).then(() => toast('Copied'), () => toast('Could not copy')); }],
    [S.saved?.has(m.id) ? 'Remove from Later' : 'Save for later', () => toggleSave(m)],
    ['Remind me about this…', () => remindMenu(m, r)],
    ...(S.me.role !== 'guest' ? [[m.pinned_by ? 'Unpin from channel' : 'Pin to channel', () => togglePin(m)]] : []),
    ['—'],
    ['Mark unread', async () => { S.holdRead = m.channel_id; await api(`/api/channels/${m.channel_id}/read`, { method: 'POST', body: { ts: m.ts - 1, force: true } }); const c = S.channels.get(m.channel_id); if (c) { c.last_read = m.ts - 1; c.unread = Math.max(1, c.unread || 0); } renderSidebar(); toast('Marked unread'); }]];
  if (m.user_id === S.me.id) items.push(['—'], ['Edit message', () => editMessage(m)], ['Delete message…', () => deleteMessage(m), 'danger']);
  else if (['owner', 'admin'].includes(S.me.role)) items.push(['—'], ['Delete message…', () => deleteMessage(m), 'danger']);
  menu(items, r.right - 230, r.bottom + 4, r.top); anchor.closest('.msg')?.classList.add('menu-open');
}
function editMessage(m) {
  const el = $$(`.msg[data-id="${m.id}"]`).pop();
  if (!el) return;
  const textEl = $('.text', el);
  // Same rich box as when writing: no symbols shown. Mentions show as @Name and go back to real mentions on save.
  const names = new Map();
  let md = String(m.text || '').replace(/<@(U\w+)>/g, (_, id) => { const n = '@' + user(id).name; names.set(n, id); return n; });
  const ed = h('div', { class: 'ce ce-edit input', contenteditable: 'true', role: 'textbox', 'aria-label': 'Edit message' });
  ed.innerHTML = mdToHtml(md);
  const done = () => { box.remove(); S.pendingRedraw = false; rerender(m); };
  const save = async () => {
    let text = htmlToMd(ed).replace(/\s+$/, '');
    for (const [n, id] of names) text = text.split(n).join(`<@${id}>`);
    try { const saved = await api(`/api/messages/${m.id}`, { method: 'PATCH', body: { text } }); box.remove(); S.pendingRedraw = false; applyMessage(saved); rerender(saved); } catch (e) { toast(e.message); }
  };
  const fb = (t, c, label, st) => h('button', { title: t, onmousedown: (e) => e.preventDefault(), onclick: () => { ed.focus(); document.execCommand(c); }, style: st }, label);
  const box = h('div', { class: 'edit-wrap' }, h('div', { class: 'fmt-bar edit-bar' }, fb('Bold', 'bold', 'B', { fontWeight: 900 }), fb('Italic', 'italic', 'I', { fontStyle: 'italic', fontFamily: 'Georgia, serif' }), fb('Strikethrough', 'strikeThrough', 'S', { textDecoration: 'line-through' })), ed,
    h('div', { style: { display: 'flex', gap: '8px', marginTop: '6px', justifyContent: 'flex-end' } },
      h('button', { class: 'btn', onclick: () => done() }, 'Cancel'), h('button', { class: 'btn primary', onclick: save }, 'Save')));
  ed.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); save(); }
    if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); document.execCommand('insertLineBreak'); }
    if (mod && e.key.toLowerCase() === 'b') { e.preventDefault(); document.execCommand('bold'); }
    if (mod && e.key.toLowerCase() === 'i') { e.preventDefault(); document.execCommand('italic'); }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(); }
  });
  ed.addEventListener('paste', (e) => { e.preventDefault(); document.execCommand('insertText', false, e.clipboardData?.getData('text/plain') || ''); });
  textEl.replaceWith(box); ed.focus(); box.scrollIntoView({ block: 'nearest' });
  const r = document.createRange(); r.selectNodeContents(ed); r.collapse(false); const sl = getSelection(); sl.removeAllRanges(); sl.addRange(r);
}
function deleteMessage(m) {
  modal('Delete message', h('p', {}, 'Are you sure you want to delete this message? This cannot be undone.'), [
    ['Cancel'], ['Delete', async () => { applyMessage(await api(`/api/messages/${m.id}`, { method: 'DELETE' })); }, 'danger'],
  ]);
}

// ------------------------------------------------------------------ threads
async function openThread(id) {
  S.thread = id;
  $('#app').classList.add('has-thread');
  const pane = $('#thread');
  pane.hidden = false;
  const ch = S.channels.get(S.current) || S.preview;
  pane.replaceChildren(
    h('div', { class: 'thread-head' }, h('button', { class: 'icon-btn th-back', title: 'Back', onclick: () => closeThread(true) }, svg('M11.7 4.3a1 1 0 0 1 0 1.4L7.4 10l4.3 4.3a1 1 0 0 1-1.4 1.4l-5-5a1 1 0 0 1 0-1.4l5-5a1 1 0 0 1 1.4 0z', 18)), h('h3', {}, 'Thread'), h('span', { class: 'sub' }, ch.kind === 'dm' ? chanLabel(ch) : '# ' + ch.name),
      h('button', { class: 'icon-btn', title: 'Close', onclick: () => closeThread(true) }, svg(I.close, 18))),
    h('div', { class: 'msgs', id: 'thread-msgs' }, h('div', { class: 'msgs-inner', id: 'thread-inner' })),
    S.channels.has(S.current) ? composer({ channelId: S.current, threadId: id }) : '',
  );
  if (S.threadBar) pane.append(S.threadBar);
  try {
    const r = await api(`/api/messages/${id}/thread`);
    S.threads.set(id, r);
    if (S.thread === id) { renderThread(true); focusMessage(); }
  } catch (e) { toast(e.message); closeThread(true); }
  if (window.innerWidth > 760) $('#thread .composer .ce')?.focus();
}
function renderThread(scroll) {
  const t = S.threads.get(S.thread);
  const inner = $('#thread-inner');
  if (!t || !inner) return;
  inner.replaceChildren(messageEl(t.parent, { cont: false, inThread: true, isParent: true }));
  if (t.replies.length) inner.append(h('div', { class: 'reply-sep' }, t.replies.length === 1 ? '1 reply' : `${t.replies.length} replies`));
  let prev = null;
  for (const r of t.replies) {
    const cont = prev && prev.user_id === r.user_id && r.ts - prev.ts < 5 * 60e3;
    inner.append(messageEl(r, { cont, inThread: true }));
    prev = r;
  }
  const box = $('#thread-msgs');
  if (scroll || box.scrollHeight - box.scrollTop - box.clientHeight < 120) box.scrollTop = box.scrollHeight;
}
function closeThread(updateHash) {
  S.thread = null;
  $('#thread').hidden = true;
  $('#app').classList.remove('has-thread');
  if (updateHash && S.current) location.hash = `#/c/${S.current}`;
}

// ------------------------------------------------------------------ composer
function composer({ channelId, threadId }) {
  const ch = S.channels.get(channelId);
  const key = channelId + (threadId ? '|' + threadId : '');
  const placeholder = threadId ? 'Reply…' : ch.kind === 'dm' ? `Message ${chanLabel(ch)}` : `Message #${ch.name}`;
  // Rich box: what you see is what gets sent. Bold looks bold, lists look like lists. No symbols to type.
  const ed = h('div', { class: 'ce', contenteditable: 'true', role: 'textbox', 'aria-multiline': 'true', 'aria-label': placeholder, 'data-placeholder': placeholder, spellcheck: 'true' });
  ed.innerHTML = mdToHtml(S.drafts.get(key) || '');
  const pending = [];
  const pendingBox = h('div', { class: 'pending-files' });
  const send = h('button', { class: 'send', title: 'Send (press and hold to send later)', onclick: () => { if (send._held) { send._held = false; return; } submit(); } }, svg(I.send, 16));
  longPress(send, () => { send._held = true; setTimeout(() => (send._held = false), 600); scheduleMenu(send, (at) => submit(at)); });
  const typing = h('div', { class: 'typing', 'data-key': key });
  const fileInput = h('input', { type: 'file', multiple: true, hidden: true, onchange: () => { addFiles([...fileInput.files]); fileInput.value = ''; } });
  const mentionMap = new Map(); // "@Name" -> id
  const keep = (e) => e.preventDefault(); // keep the text selection when clicking a toolbar button
  const cmd = (c, v) => { ed.focus(); document.execCommand(c, false, v); sync(); markBar(); };
  const sel = () => window.getSelection();
  const inEd = (n) => n && (n === ed || ed.contains(n));
  function wrapWith(tag) {
    ed.focus();
    const s = sel(); if (!s.rangeCount || !inEd(s.anchorNode)) return;
    const r = s.getRangeAt(0);
    const el = document.createElement(tag);
    if (r.collapsed) { el.textContent = '​'; r.insertNode(el); const nr = document.createRange(); nr.setStart(el.firstChild, 1); nr.collapse(true); s.removeAllRanges(); s.addRange(nr); }
    else { el.append(r.extractContents()); r.insertNode(el); const nr = document.createRange(); nr.selectNodeContents(el); s.removeAllRanges(); s.addRange(nr); }
    sync();
  }
  const inlineCode = () => { const c = closest('code'); if (c) unwrap(c); else wrapWith('code'); };
  const codeBlock = () => { const c = closest('pre'); if (c) unwrap(c); else wrapWith('pre'); };
  const quote = () => { const q = closest('blockquote'); if (q) unwrap(q); else cmd('formatBlock', 'blockquote'); };
  function addLink() {
    const s = sel(); const r = s.rangeCount ? s.getRangeAt(0).cloneRange() : null;
    const url = prompt('Link address (https://…)'); if (!url) return;
    const href = /^https?:\/\//i.test(url) ? url : 'https://' + url;
    ed.focus(); if (r) { s.removeAllRanges(); s.addRange(r); }
    if (r && !r.collapsed) cmd('createLink', href);
    else { const a = document.createElement('a'); a.href = href; a.textContent = url; (r || document.createRange()).insertNode(a); const nr = document.createRange(); nr.setStartAfter(a); nr.collapse(true); s.removeAllRanges(); s.addRange(nr); sync(); }
  }
  function closest(tag) { let n = sel().anchorNode; while (n && n !== ed) { if (n.nodeName === tag.toUpperCase()) return n; n = n.parentNode; } return null; }
  function unwrap(el) { const p = el.parentNode; while (el.firstChild) p.insertBefore(el.firstChild, el); p.removeChild(el); sync(); }
  const fmtBar = h('div', { class: 'fmt-bar' },
    h('button', { title: 'Bold (Ctrl+B)', onmousedown: keep, onclick: () => cmd('bold'), style: { fontWeight: 900 } }, 'B'),
    h('button', { title: 'Italic (Ctrl+I)', onmousedown: keep, onclick: () => cmd('italic'), style: { fontStyle: 'italic', fontFamily: 'Georgia, serif' } }, 'I'),
    h('button', { title: 'Strikethrough', onmousedown: keep, onclick: () => cmd('strikeThrough'), style: { textDecoration: 'line-through' } }, 'S'),
    h('span', { class: 'sep' }),
    h('button', { title: 'Link', onmousedown: keep, onclick: () => addLink() }, svg('M8.5 11.5a3 3 0 0 0 4.2 0l3-3a3 3 0 0 0-4.2-4.2l-.9.9 1 1 .9-.9a1.6 1.6 0 0 1 2.3 2.3l-3 3a1.6 1.6 0 0 1-2.3 0l-1 1zm3-3a3 3 0 0 0-4.2 0l-3 3a3 3 0 0 0 4.2 4.2l.9-.9-1-1-.9.9a1.6 1.6 0 0 1-2.3-2.3l3-3a1.6 1.6 0 0 1 2.3 0l1-1z', 15)),
    h('button', { title: 'Bulleted list', onmousedown: keep, onclick: () => cmd('insertUnorderedList') }, svg('M4 5a1.3 1.3 0 1 1 0 2.6A1.3 1.3 0 0 1 4 5zm4 .6h9v1.4H8V5.6zM4 12.4A1.3 1.3 0 1 1 4 15a1.3 1.3 0 0 1 0-2.6zm4 .6h9v1.4H8V13z', 15)),
    h('button', { title: 'Numbered list', onmousedown: keep, onclick: () => cmd('insertOrderedList') }, svg('M3.5 4h1.4v4.5H3.8V5.2h-.6V4.4zM8 5.6h9V7H8V5.6zM3 15.5v-.9l1.6-1.6c.3-.3.4-.5.4-.7 0-.3-.2-.5-.5-.5s-.5.2-.6.5H3c0-.9.7-1.5 1.6-1.5.9 0 1.5.6 1.5 1.4 0 .5-.2.9-.7 1.3l-.8.8h1.6v1.2H3zM8 13h9v1.4H8V13z', 15)),
    h('span', { class: 'sep' }),
    h('button', { title: 'Quote', onmousedown: keep, onclick: () => quote() }, svg('M4 5h5v5.2C9 13 7.7 14.6 5.2 15l-.4-1.2c1.3-.4 2-1.2 2.1-2.5H4V5zm7 0h5v5.2c0 2.8-1.3 4.4-3.8 4.8l-.4-1.2c1.3-.4 2-1.2 2.1-2.5H11V5z', 14)),
    h('button', { title: 'Code', onmousedown: keep, onclick: () => inlineCode(), style: { fontFamily: 'monospace' } }, svg('M7.3 5.3 8.4 6.4 4.8 10l3.6 3.6-1.1 1.1L2.6 10l4.7-4.7zm5.4 0L17.4 10l-4.7 4.7-1.1-1.1L15.2 10l-3.6-3.6 1.1-1.1z', 15)),
    h('button', { title: 'Code block', onmousedown: keep, onclick: () => codeBlock(), style: { fontFamily: 'monospace', fontSize: '11px' } }, svg('M7 3.5v1.3c-1 0-1.3.4-1.3 1.3v2.4c0 .9-.4 1.4-1.1 1.6.7.2 1.1.7 1.1 1.6v2.4c0 .9.3 1.3 1.3 1.3v1.3c-1.8 0-2.6-.8-2.6-2.5v-2.3c0-.8-.4-1.2-1.4-1.2V9.6c1 0 1.4-.4 1.4-1.2V6.1c0-1.7.8-2.6 2.6-2.6zm6 0c1.8 0 2.6.9 2.6 2.6v2.3c0 .8.4 1.2 1.4 1.2v1.3c-1 0-1.4.4-1.4 1.2v2.3c0 1.7-.8 2.5-2.6 2.5v-1.3c1 0 1.3-.4 1.3-1.3v-2.4c0-.9.4-1.4 1.1-1.6-.7-.2-1.1-.7-1.1-1.6V6.1c0-.9-.3-1.3-1.3-1.3V3.5z', 15)),
  );
  const also = threadId ? h('label', { class: 'also' }, h('input', { type: 'checkbox' }), ch.kind === 'dm' ? 'Also send as direct message' : `Also send to #${ch.name}`) : null;
  const sched = h('button', { class: 'sched', title: 'Schedule for later', onclick: (e) => scheduleMenu(e.currentTarget, (at) => submit(at)) }, svg(I.clock, 15));
  const foot = h('div', { class: 'comp-foot' },
    h('button', { class: 'plus', title: 'Attach files', onclick: () => fileInput.click() }, svg(I.plus, 16)),
    h('button', { title: 'Emoji', onmousedown: keep, onclick: (e) => { const r = saveRange(); emojiPicker(e.currentTarget, (em) => { restoreRange(r); insert(em + ' '); }); } }, svg(I.smile, 18)),
    h('button', { title: 'Mention someone', onmousedown: keep, onclick: () => { insert('@'); onInput(); } }, svg(I.at, 18)),
    h('button', { class: 'aa-btn', title: 'Formatting', onmousedown: keep, onclick: (e) => { const on = box.classList.toggle('show-fmt'); e.currentTarget.classList.toggle('on', on); ed.focus(); } }, h('b', {}, 'Aa')),
    also, h('button', { class: 'mic', title: 'Record a voice note', 'aria-label': 'Record a voice note', onclick: () => startVoice() }, svg(VI.mic, 18)), h('span', { class: 'send-group' }, send, sched), fileInput);
  const box = h('div', { class: 'composer' }, fmtBar, pendingBox, ed, foot);
  const root = h('div', { class: 'composer-wrap' }, typing, box, h('div', { class: 'comp-hint' }, ''));

  const saveRange = () => { const s = sel(); return s.rangeCount && inEd(s.anchorNode) ? s.getRangeAt(0).cloneRange() : null; };
  const restoreRange = (r) => { ed.focus(); if (r) { const s = sel(); s.removeAllRanges(); s.addRange(r); } };
  function insert(t) { ed.focus(); document.execCommand('insertText', false, t); sync(); }
  const isEmpty = () => !ed.textContent.replace(/[​\s]/g, '') && !ed.querySelector('img');
  function markBar() {
    // light up B / I / S while they are on
    const on = { 'Bold (Ctrl+B)': document.queryCommandState('bold'), 'Italic (Ctrl+I)': document.queryCommandState('italic'), Strikethrough: document.queryCommandState('strikeThrough') };
    for (const b of $$('button', fmtBar)) b.classList.toggle('on', !!on[b.title]);
  }
  function sync() {
    const ready = !isEmpty() || pending.some((p) => p.meta);
    send.classList.toggle('ready', !!ready);
    ed.classList.toggle('empty', isEmpty());
    $('.comp-hint', root).textContent = isEmpty() ? '' : enterSends() ? 'Enter sends · Shift + Enter for a new line' : 'Enter adds a new line · Ctrl + Enter sends';
    S.drafts.set(key, isEmpty() ? '' : htmlToMd(ed)); clearTimeout(sync.t); sync.t = setTimeout(saveDraft, 400);
  }
  async function addFiles(files) {
    for (const f of files) {
      const p = { file: f, meta: null };
      pending.push(p);
      const isImg = /^image\//.test(f.type);
      const chip = h('div', { class: 'pending uploading' }, isImg ? h('img', { src: URL.createObjectURL(f) }) : h('span', { class: 'file-ico' }, (f.name.split('.').pop() || '').slice(0, 4)),
        h('span', {}, f.name), h('button', { class: 'x', title: 'Remove', onclick: () => { p.cancelled = true; const i = pending.indexOf(p); if (i >= 0) pending.splice(i, 1); chip.remove(); sync(); } }, '×'));
      pendingBox.append(chip);
      try {
        if (f.size > 1024 * 1024 * 1024) throw new Error(`${f.name} is over 1 GB`);
        if (f.size > 90 * 1024 * 1024) p.meta = await uploadBig(f, chip, p);
        else { const fd = new FormData(); fd.append('file', f); p.meta = await api('/api/upload', { method: 'POST', body: fd }); }
        chip.classList.remove('uploading'); chip.querySelector('.up-pct')?.remove();
      }
      catch (e) { if (!p.cancelled) toast(e.message); const i = pending.indexOf(p); if (i >= 0) pending.splice(i, 1); chip.remove(); }
      sync();
    }
  }
  async function submit(sendAt) {
    if (pending.some((p) => !p.meta)) return toast('Still uploading…');
    let text = htmlToMd(ed).replace(/\s+$/, '');
    for (const [label, id] of [...mentionMap].sort((a, b) => b[0].length - a[0].length)) text = text.split(label).join(id.startsWith('C:') ? `<#${id.slice(2)}|${label.slice(1)}>` : `<@${id}>`);
    text = text.replace(/(^|\s)@(channel|here|everyone)\b/g, '$1<!$2>');
    const files = pending.map((p) => p.meta);
    if (!text.trim() && !files.length) return;
    const keepHtml = ed.innerHTML, keepChips = [...pendingBox.children], keepPending = pending.slice(), keepMentions = new Map(mentionMap);
    ed.innerHTML = ''; pending.length = 0; pendingBox.replaceChildren(); mentionMap.clear(); sync();
    const alsoOn = !!also?.querySelector('input').checked;
    try {
      if (sendAt) {
        await api('/api/scheduled', { method: 'POST', body: { channel_id: channelId, thread_id: threadId || null, text, files, also_channel: alsoOn, send_at: sendAt } });
        toast(`Scheduled for ${whenStr(sendAt)}. Find it in Later.`);
        if (also) also.querySelector('input').checked = false;
        return;
      }
      // Show it right away; swap in the real one when the server confirms.
      let tmp = null;
      if (!files.length) {
        tmp = { id: 'tmp' + Math.random().toString(36).slice(2), channel_id: channelId, user_id: S.me.id, text, ts: Date.now(), thread_id: threadId || null, also_channel: alsoOn ? 1 : 0, reactions: [], files: [], reply_count: 0, reply_users: [], _sending: true, _freshAt: Date.now() };
        applyMessage(tmp, true);
      }
      let m;
      try { m = await api(`/api/channels/${channelId}/messages`, { method: 'POST', body: { text, files, thread_id: threadId || null, also_channel: alsoOn } }); }
      catch (e) { if (tmp) dropMessage(tmp); throw e; }
      if (tmp) dropMessage(tmp, true);
      if (also) also.querySelector('input').checked = false;
      m._freshAt = tmp ? 0 : Date.now();
      applyMessage(m, true);
    } catch (e) {
      toast('Not sent. ' + e.message);
      ed.innerHTML = keepHtml; pending.push(...keepPending); pendingBox.replaceChildren(...keepChips); for (const [k, v] of keepMentions) mentionMap.set(k, v); sync();
    }
  }
  // Voice note: record, then send. The transcript shows up under it a few seconds later.
  let vrec = null;
  async function startVoice() {
    if (vrec) return;
    if (H.channel) return toast('Leave the pop-in to record a voice note');
    const dot = h('span', { class: 'rec-dot' });
    const clock = h('span', { class: 'rec-time' }, '0:00');
    const cv = h('canvas', { class: 'rec-wave', height: 32 });
    const pauseBtn = h('button', { class: 'rec-btn', title: 'Pause', 'aria-label': 'Pause' }, svg(VI.pause, 16));
    const sendBtn = h('button', { class: 'rec-send', title: 'Send voice note (Enter)', 'aria-label': 'Send voice note' }, svg(I.send, 16));
    const cancelBtn = h('button', { class: 'rec-btn', title: 'Delete (Esc)', 'aria-label': 'Delete recording' }, svg(VI.trash, 16));
    const bar = h('div', { class: 'rec-bar', tabindex: '-1' }, cancelBtn, dot, clock, cv, pauseBtn, sendBtn);
    const hideOthers = (on) => { for (const el of [fmtBar, pendingBox, ed, foot]) el.classList.toggle('rec-hide', on); box.classList.toggle('recording', on); };
    const draw = (secs, levels) => {
      clock.textContent = clockDur(secs);
      const w = cv.clientWidth; if (!w) return;
      if (cv.width !== w * 2) { cv.width = w * 2; cv.height = 64; }
      const g = cv.getContext('2d'), n = Math.floor(w / 5), from = Math.max(0, levels.length - n);
      g.clearRect(0, 0, cv.width, cv.height); g.fillStyle = getComputedStyle(cv).color;
      for (let i = from; i < levels.length; i++) { const x = (i - from) * 10, hh = Math.max(4, levels[i] * 60); g.fillRect(x, (64 - hh) / 2, 6, hh); }
      if (secs >= REC_MAX && !vrec.paused) { vrec.pause(); dot.classList.add('paused'); toast('15 minutes is the max. Send it or delete it.'); }
    };
    try { vrec = await startRecorder((t, l) => draw(t, l)); }
    catch (e) { vrec = null; return toast(/denied|allowed|NotAllowed/i.test(e.name + e.message) ? 'Microphone is blocked. Allow it in your browser settings.' : 'Could not record. ' + e.message); }
    box.append(bar); hideOthers(true); bar.focus();
    const done = () => { bar.remove(); hideOthers(false); vrec = null; ed.focus(); };
    cancelBtn.onclick = () => { vrec.cancel(); done(); };
    pauseBtn.onclick = () => { if (vrec.paused) { vrec.resume(); pauseBtn.replaceChildren(svg(VI.pause, 16)); pauseBtn.title = 'Pause'; dot.classList.remove('paused'); } else { vrec.pause(); pauseBtn.replaceChildren(svg(VI.mic, 16)); pauseBtn.title = 'Keep recording'; dot.classList.add('paused'); } };
    bar.onkeydown = (e) => { if (e.key === 'Escape') { e.preventDefault(); cancelBtn.onclick(); } else if (e.key === 'Enter') { e.preventDefault(); sendBtn.onclick(); } };
    sendBtn.onclick = async () => {
      if (vrec.secs < 0.7) { vrec.cancel(); done(); return toast('Too short. Tap the mic and talk.'); }
      bar.classList.add('sending'); sendBtn.disabled = pauseBtn.disabled = cancelBtn.disabled = true;
      const r = await vrec.stop();
      const ext = r.type.includes('mp4') ? 'm4a' : r.type.includes('ogg') ? 'ogg' : 'webm';
      const stamp = new Date().toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).replace(/[/:,]/g, ' ').replace(/\s+/g, ' ');
      const file = new File([r.blob], `Voice note ${stamp}.${ext}`, { type: r.type });
      const alsoOn = !!also?.querySelector('input').checked;
      try {
        const fd = new FormData(); fd.append('file', file); fd.append('voice', '1'); fd.append('dur', String(r.dur)); fd.append('wave', JSON.stringify(r.wave));
        const meta = await api('/api/upload', { method: 'POST', body: fd });
        api('/api/voice/transcribe', { method: 'POST', body: { key: meta.key } }).catch(() => {}); // the server keeps going; a safety job retries
        const m = await api(`/api/channels/${channelId}/messages`, { method: 'POST', body: { text: '', files: [meta], thread_id: threadId || null, also_channel: alsoOn } });
        if (also) also.querySelector('input').checked = false;
        m._freshAt = Date.now(); applyMessage(m, true);
        done();
      } catch (e) {
        toast('Voice note not sent. ' + e.message);
        // keep it so nothing is lost
        const a = h('a', { href: URL.createObjectURL(file), download: file.name }, 'Save the recording');
        bar.replaceChildren(h('span', { class: 'rec-fail' }, 'Not sent. '), a, h('button', { class: 'rec-btn', title: 'Close', onclick: done }, svg(I.close, 14)));
        bar.classList.remove('sending');
      }
    };
  }
  // @mention / #channel / :emoji autocomplete, reading the text just before the cursor
  let ac = null, acItems = [], acSel = 0, acKind = '', acLen = 0;
  function closeAc() { ac?.remove(); ac = null; acItems = []; }
  function textBeforeCaret() {
    const s = sel(); if (!s.rangeCount || !inEd(s.anchorNode)) return '';
    const r = s.getRangeAt(0).cloneRange(); r.collapse(true);
    const n = r.startContainer;
    return n.nodeType === 3 ? n.textContent.slice(0, r.startOffset) : '';
  }
  function onInput() {
    sync(); markBar();
    sendTyping(channelId, threadId);
    const before = textBeforeCaret().replace(/​/g, '');
    const m = before.match(/(^|\s)([@#:])([\w.\- ]{0,24})$/);
    if (!m || (m[2] === ':' && m[3].length < 2) || m[3].includes('  ')) return closeAc();
    acKind = m[2]; acLen = m[3].length + 1;
    const q = m[3].toLowerCase().trim();
    if (acKind === '@') {
      const ids = S.members.get(channelId) || [...S.users.keys()];
      acItems = [...S.users.values()].filter((u) => u.active && !/bot\.local$/.test(u.email || '') && (u.name.toLowerCase().includes(q) || (u.email || '').startsWith(q)))
        .sort((a, b) => (ids.includes(b.id) - ids.includes(a.id)) || a.name.localeCompare(b.name)).slice(0, 8)
        .map((u) => ({ label: u.name, sub: ids.includes(u.id) ? '' : 'not in channel', av: u, value: '@' + u.name, id: u.id }));
      if ('channel'.startsWith(q) && ch.kind === 'channel') acItems.push({ label: '@channel', sub: 'Notify everyone in this channel', value: '@channel' });
    } else if (acKind === '#') {
      acItems = [...S.channels.values()].filter((c) => c.kind === 'channel' && c.name.includes(q)).slice(0, 8).map((c) => ({ label: '# ' + c.name, value: '#' + c.name, chan: c }));
    } else {
      acItems = Object.entries(EMOJI_NAMES).filter(([n]) => n.startsWith(q)).slice(0, 8).map(([n, e]) => ({ label: `${e}  :${n}:`, value: e }));
    }
    if (!acItems.length) return closeAc();
    acSel = 0; drawAc();
  }
  function drawAc() {
    if (!ac) { ac = h('div', { class: 'ac' }); document.body.append(ac); }
    const r = box.getBoundingClientRect();
    ac.style.left = r.left + 'px'; ac.style.bottom = (window.innerHeight - r.top + 6) + 'px';
    ac.replaceChildren(...acItems.map((it, i) => h('div', { class: 'ac-item' + (i === acSel ? ' sel' : ''), onmousedown: (e) => { e.preventDefault(); acSel = i; pickAc(); } },
      it.av ? avatar(it.av, 'av', '10px') : null, h('span', {}, it.label), it.sub ? h('span', { class: 'ac-sub' }, it.sub) : null)));
  }
  function pickAc() {
    const it = acItems[acSel]; if (!it) return;
    const s = sel(); const r = s.getRangeAt(0);
    const n = r.startContainer, off = r.startOffset;
    if (n.nodeType === 3) { const rr = document.createRange(); rr.setStart(n, Math.max(0, off - acLen)); rr.setEnd(n, off); s.removeAllRanges(); s.addRange(rr); }
    document.execCommand('insertText', false, it.value + ' ');
    if (it.id) mentionMap.set(it.value, it.id);
    if (it.chan) mentionMap.set(it.value, 'C:' + it.chan.id);
    closeAc(); sync();
  }
  ed.addEventListener('input', onInput);
  ed.addEventListener('keyup', markBar); ed.addEventListener('mouseup', markBar);
  ed.addEventListener('blur', () => setTimeout(closeAc, 150));
  ed.addEventListener('keydown', (e) => {
    if (ac) {
      if (e.key === 'ArrowDown') { e.preventDefault(); acSel = (acSel + 1) % acItems.length; return drawAc(); }
      if (e.key === 'ArrowUp') { e.preventDefault(); acSel = (acSel - 1 + acItems.length) % acItems.length; return drawAc(); }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); return pickAc(); }
      if (e.key === 'Escape') { e.preventDefault(); return closeAc(); }
    }
    const inList = closest('li'), inPre = closest('pre');
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === 'Enter' && mod) { e.preventDefault(); submit(); return; }
    if (e.key === 'Enter' && inList && !e.isComposing) {
      // like Slack: Enter adds the next bullet; Enter on an empty bullet ends the list
      if (!inList.textContent.replace(/[\u200b\s]/g, '')) { e.preventDefault(); cmd(inList.parentNode.nodeName === 'OL' ? 'insertOrderedList' : 'insertUnorderedList'); }
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !inPre && (enterSends() || e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(); return; }
    if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); document.execCommand('insertLineBreak'); sync(); return; }
    if (mod && e.key.toLowerCase() === 'b') { e.preventDefault(); cmd('bold'); }
    if (mod && e.key.toLowerCase() === 'i') { e.preventDefault(); cmd('italic'); }
    if (mod && e.shiftKey && e.key.toLowerCase() === 'x') { e.preventDefault(); cmd('strikeThrough'); }
    if (mod && e.key.toLowerCase() === 'u') { e.preventDefault(); }
    if (e.key === 'ArrowUp' && isEmpty()) {
      const list = threadId ? S.threads.get(threadId)?.replies : S.msgs.get(channelId)?.list;
      const mine = [...(list || [])].reverse().find((m) => m.user_id === S.me.id && !m.deleted);
      if (mine) { e.preventDefault(); editMessage(mine); }
    }
  });
  // Paste: files become attachments; text comes in clean (no colors or fonts from other apps), basic bold/italic/links kept.
  ed.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData?.files || [])];
    if (files.length) { e.preventDefault(); addFiles(files); return; }
    const html = e.clipboardData?.getData('text/html'), txt = e.clipboardData?.getData('text/plain') || '';
    e.preventDefault();
    if (html) { const tmp = h('div', { html: html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '') }); document.execCommand('insertHTML', false, mdToHtml(htmlToMd(tmp))); }
    else document.execCommand('insertText', false, txt);
    sync();
  });
  root.addEventListener('dragover', (e) => { e.preventDefault(); box.style.borderColor = '#9aa3ad'; });
  root.addEventListener('dragleave', () => (box.style.borderColor = ''));
  root.addEventListener('drop', (e) => { e.preventDefault(); box.style.borderColor = ''; addFiles([...e.dataTransfer.files]); });
  setTimeout(sync);
  return root;
}

// ------------------------------------------------------------------ rich text <-> message text
// The message is stored as plain text with Slack-style marks (*bold*, _italic_, ~strike~, `code`, <url|text>),
// so search, notifications and the Slack history all keep working. People never see or type the marks.
function htmlToMd(root) {
  const out = [];
  const walk = (n, ctx) => {
    if (n.nodeType === 3) { out.push(n.textContent.replace(/​/g, '').replace(/ /g, ' ')); return; }
    if (n.nodeType !== 1) return;
    const t = n.nodeName, st = n.getAttribute('style') || '';
    const kids = () => n.childNodes.forEach((c) => walk(c, ctx));
    const wrapMd = (m) => {
      const start = out.length; kids(); const inner = out.splice(start).join('');
      const lead = inner.match(/^\s*/)[0], trail = inner.match(/\s*$/)[0], core = inner.trim();
      out.push(core ? lead + m + core + m + trail : inner);
    };
    if (t === 'BR') { out.push('\n'); return; }
    if (t === 'B' || t === 'STRONG' || /font-weight:\s*(bold|[6-9]00)/.test(st)) return wrapMd('*');
    if (t === 'I' || t === 'EM' || /font-style:\s*italic/.test(st)) return wrapMd('_');
    if (t === 'S' || t === 'STRIKE' || t === 'DEL' || /line-through/.test(st)) return wrapMd('~');
    if (t === 'CODE' && !ctx.pre) return wrapMd('`');
    if (t === 'A') { const start = out.length; kids(); const inner = out.splice(start).join(''); const href = n.getAttribute('href') || ''; out.push(/^https?:/i.test(href) ? (inner && inner !== href ? `<${href}|${inner}>` : href) : inner); return; }
    if (t === 'PRE') { const start = out.length; n.childNodes.forEach((c) => walk(c, { ...ctx, pre: true })); const inner = out.splice(start).join(''); nl(); out.push('```\n' + inner.replace(/\n+$/, '') + '\n```'); nl(); return; }
    if (t === 'UL' || t === 'OL') { let i = 0; nl(); n.childNodes.forEach((li) => { if (li.nodeName !== 'LI') return; i++; const start = out.length; li.childNodes.forEach((c) => walk(c, ctx)); const inner = out.splice(start).join('').trim(); out.push((t === 'OL' ? `${i}. ` : '• ') + inner + '\n'); }); return; }
    if (t === 'BLOCKQUOTE') { const start = out.length; kids(); const inner = out.splice(start).join('').replace(/\n+$/, ''); nl(); out.push(inner.split('\n').map((l) => '> ' + l).join('\n') + '\n'); return; }
    if (t === 'DIV' || t === 'P') { nl(); kids(); return; }
    if (t === 'IMG' && n.alt) { out.push(n.alt); return; }
    kids();
  };
  const nl = () => { const last = out.join('').slice(-1); if (out.length && last !== '\n' && last !== '') out.push('\n'); };
  root.childNodes.forEach((c) => walk(c, {}));
  return out.join('').replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '');
}
function mdToHtml(md) {
  if (!md) return '';
  let x = esc(md);
  x = x.replace(/```\n?([\s\S]*?)\n?```/g, (_, c) => `<pre>${c}</pre>`);
  x = x.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  x = x.replace(/&lt;(https?:\/\/[^|&]+)\|([^&]+)&gt;/g, '<a href="$1">$2</a>');
  x = x.replace(/(^|[^\w*])\*(?=\S)([^*\n]*?\S)\*(?!\*)/g, '$1<b>$2</b>');
  x = x.replace(/(^|[^\w_])_(?=\S)([^_\n]*?\S)_(?!_)/g, '$1<i>$2</i>');
  x = x.replace(/(^|[^\w~])~(?=\S)([^~\n]*?\S)~(?!~)/g, '$1<s>$2</s>');
  return x.replace(/\n/g, '<br>');
}
function saveDraft() { try { localStorage.setItem('pw-drafts', JSON.stringify([...S.drafts].filter(([, v]) => v && v.trim()))); } catch {} }
try { for (const [k, v] of JSON.parse(localStorage.getItem('pw-drafts') || '[]')) S.drafts.set(k, v); } catch {}

const lastTyping = new Map();
function sendTyping(channelId, threadId) {
  const k = channelId + '|' + (threadId || '');
  if (Date.now() - (lastTyping.get(k) || 0) < 3000 || !ws || ws.readyState !== 1) return;
  const to = S.members.get(channelId) || S.channels.get(channelId)?.members || [];
  if (!to.length) return;
  lastTyping.set(k, Date.now());
  ws.send(JSON.stringify({ type: 'typing', channel_id: channelId, thread_id: threadId || null, to }));
}
function renderTyping() {
  for (const el of $$('.typing')) {
    const map = S.typing.get(el.dataset.key);
    const names = map ? [...map.entries()].filter(([, exp]) => exp > Date.now()).map(([u]) => user(u).name.split(' ')[0]) : [];
    const label = !names.length ? '' : names.length === 1 ? `${names[0]} is typing` : names.length < 4 ? `${names.join(' and ')} are typing` : 'Several people are typing';
    if (el.dataset.label === label) continue;
    el.dataset.label = label;
    el.replaceChildren(...(label ? [h('span', { class: 'dots' }, h('i'), h('i'), h('i')), label] : []));
  }
  // Also show it where you look: a typing bubble at the bottom of the conversation, and dots on the sidebar row.
  const who = (k) => { const map = S.typing.get(k); return map ? [...map.entries()].filter(([u, exp]) => exp > Date.now() && u !== S.me?.id).map(([u]) => u) : []; };
  const inner = $('#msgs-inner'), box = $('#msgs');
  if (inner && S.current) {
    const ids = who(S.current);
    let b = $('.typing-bubble', inner);
    if (!ids.length) b?.remove();
    else if (!b || b.dataset.ids !== ids.join()) {
      const near = box && box.scrollHeight - box.scrollTop - box.clientHeight < 160;
      b?.remove();
      b = h('div', { class: 'typing-bubble', 'data-ids': ids.join() }, avatar(user(ids[0]), 'av', '12px'), h('span', { class: 'tb-dots' }, h('i'), h('i'), h('i')));
      inner.append(b);
      if (near && box) box.scrollTop = box.scrollHeight;
    } else if (b !== inner.lastElementChild) inner.append(b);
  }
  for (const row of $$('#sidebar .chan[data-id]')) {
    const on = who(row.dataset.id).length > 0 && row.dataset.id !== S.current;
    row.classList.toggle('is-typing', on);
  }
}
setInterval(renderTyping, 700);

// ------------------------------------------------------------------ updates
function applyMessage(m, mine) {
  // Update the message wherever it lives: channel list, open thread.
  const st = S.msgs.get(m.channel_id);
  if ((!m.thread_id || m.also_channel) && st) {
    const i = st.list.findIndex((x) => x.id === m.id);
    if (i >= 0) st.list[i] = m; else if (st.loaded && !st.hasNewer) st.list.push(m);
  }
  const t = S.threads.get(m.thread_id || m.id);
  if (t) {
    if (t.parent.id === m.id) t.parent = m;
    else {
      const i = t.replies.findIndex((x) => x.id === m.id);
      if (i >= 0) t.replies[i] = m; else t.replies.push(m);
    }
  }
  if (mine) {
    const ch = S.channels.get(m.channel_id);
    if (ch) { ch.last_ts = m.ts; ch.last_read = m.ts; }
  }
  rerender(m);
}
function dropMessage(m, quiet) {
  const st = S.msgs.get(m.channel_id); if (st) st.list = st.list.filter((x) => x.id !== m.id);
  const t = S.threads.get(m.thread_id); if (t) t.replies = t.replies.filter((x) => x.id !== m.id);
  if (!quiet) rerender(m);
}
function rerender(m) {
  const editing = (box) => box && box.querySelector('.msg .ce-edit');
  if (S.current && (!m || (m.channel_id === S.current && !m.thread_id) || (m.channel_id === S.current && m.thread_id))) {
    if (editing($('#msgs-inner'))) S.pendingRedraw = true; else renderMessages(false);
  }
  if (S.thread && (!m || m.thread_id === S.thread || m.id === S.thread)) {
    if (editing($('#thread-inner'))) S.pendingRedraw = true; else renderThread(false);
  }
}

let ws = null, wsRetry = 1000;
function connect() {
  ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
  ws.onopen = () => {
    wsRetry = 1000; sendVis();
    if (connect.wasDown) resync();
    if (H.channel) { for (const sid of [...H.peers.keys()]) dropPeer(sid); sendWS({ type: 'huddle_join', channel_id: H.channel }); }
  };
  ws.onclose = () => { connect.wasDown = true; setTimeout(connect, wsRetry); wsRetry = Math.min(wsRetry * 2, 15000); };
  ws.onmessage = (e) => handleEvent(JSON.parse(e.data));
}
setInterval(() => { if (ws?.readyState === 1) ws.send('{"type":"ping"}'); }, 30000);

async function resync() {
  await bootstrap();
  for (const id of [...S.msgs.keys()]) if (id !== S.current) S.msgs.delete(id);
  if (S.current) {
    const r = await api(`/api/channels/${S.current}/messages`);
    const st = S.msgs.get(S.current) || { list: [] };
    const known = new Set(st.list.map((m) => m.id));
    st.list = [...st.list.filter((m) => !r.messages.some((x) => x.id === m.id)), ...r.messages].sort((a, b) => a.ts - b.ts);
    S.msgs.set(S.current, st);
    renderMessages(!known.size);
  }
}

function handleEvent(ev) {
  if (String(ev.type).startsWith('huddle') && onHuddleEvent(ev)) return;
  if (ev.type === 'presence') { S.online = new Set(ev.online); renderSidebar(); drawMe(); return; }
  if (ev.type === 'typing') {
    const key = ev.channel_id + (ev.thread_id ? '|' + ev.thread_id : '');
    if (!S.typing.has(key)) S.typing.set(key, new Map());
    S.typing.get(key).set(ev.user_id, Date.now() + 4000);
    renderTyping(); return;
  }
  if (ev.type === 'message') {
    const m = ev.message;
    const k = m.channel_id + (m.thread_id ? '|' + m.thread_id : '');
    S.typing.get(k)?.delete(m.user_id); renderTyping();
    if (!S.users.has(m.user_id)) bootstrap().then(() => { renderSidebar(); rerender(); });
    let ch = S.channels.get(m.channel_id);
    if (!ch && ev.channel?.kind === 'dm') { bootstrap().then(renderSidebar); return; }
    if (!ch) return;
    if (ev.parent) applyMessage(ev.parent);
    m._freshAt = Date.now();
    applyMessage(m);
    if (m.channel_id === S.current && !m.thread_id && m.user_id !== S.me.id) { const j = $('.jump'); if (j && !j.hidden) { j.classList.add('has-new'); j.lastChild.textContent = 'New messages'; } }
    if (!m.thread_id) ch.last_ts = m.ts;
    const mine = m.user_id === S.me.id;
    const viewing = S.current === m.channel_id && document.visibilityState === 'visible' && document.hasFocus();
    if (!mine && !m.thread_id) {
      if (viewing) markRead(m.channel_id, m.ts);
      else ch.unread = (ch.unread || 0) + 1;
    }
    const mentioned = (ev.mentioned || []).includes(S.me.id);
    if (!mine && m.thread_id && (ev.followers || []).includes(S.me.id) && !mentioned && S.thread !== m.thread_id) {
      S.threadUnread = (S.threadUnread || 0) + 1; notify(m, ch);
    }
    if (!mine && mentioned && !(viewing && (!m.thread_id || S.thread === m.thread_id))) {
      if (!viewing) ch.mentions = (ch.mentions || 0) + 1;
      notify(m, ch);
    }
    renderSidebar();
    return;
  }
  if (ev.type === 'message_changed') { applyMessage(ev.message); return; }
  if (ev.type === 'import_done') { toast('Moving day is done. Your Slack is in Yakyard.'); pollImport(); bootstrap().then(() => { renderSidebar(); if (location.hash.startsWith('#/import')) openImport(); }); return; }
  if (ev.type === 'channel_removed') { S.channels.delete(ev.channel_id); S.msgs.delete(ev.channel_id); if (S.current === ev.channel_id) { S.current = null; closeThread(false); location.hash = '#/'; } renderSidebar(); return; }
  if (ev.type === 'read') { const c = S.channels.get(ev.channel_id); if (c) { c.last_read = Math.max(c.last_read || 0, ev.ts); if (ev.channel_id !== S.current || !document.hasFocus()) { c.unread = 0; c.mentions = 0; } renderSidebar(); } return; }
  if (['channel_created', 'channel_added', 'member_joined', 'channel_updated', 'user_updated'].includes(ev.type)) {
    if (ev.type === 'user_updated') S.users.set(ev.user.id, { ...(S.users.get(ev.user.id) || {}), ...ev.user });
    if (ev.type === 'channel_updated' && S.channels.has(ev.channel.id)) Object.assign(S.channels.get(ev.channel.id), ev.channel);
    if (ev.type === 'channel_added') bootstrap().then(renderSidebar);
    if (ev.type === 'member_joined' && ev.channel_id === S.current) loadMembers(S.current);
    renderSidebar();
  }
}

let readTimer = null;
function markRead(id, ts) {
  const ch = S.channels.get(id);
  if (!ch || S.holdRead === id) return;
  ch.unread = 0; ch.mentions = 0;
  const latest = ts || Math.max(ch.last_ts || 0, ...(S.msgs.get(id)?.list || []).map((m) => m.ts));
  ch.last_read = latest;
  renderSidebar();
  clearTimeout(readTimer);
  readTimer = setTimeout(() => api(`/api/channels/${id}/read`, { method: 'POST', body: { ts: latest } }).catch(() => {}), 400);
}
window.addEventListener('focus', () => { if (S.current) markRead(S.current); });

function notify(m, ch) {
  if (!('Notification' in window) || Notification.permission !== 'granted' || document.hasFocus()) return;
  if (inDnd(S.me) || S.me.notify_level === 'none') return;
  if (ch.muted && !(m.text || '').includes(`<@${S.me.id}>`)) return;
  const u = user(m.user_id);
  const n = new Notification(ch.kind === 'dm' ? u.name : `${u.name} in #${ch.name}`, {
    body: m.text.replace(/<@(U\w+)>/g, (_, id) => '@' + user(id).name).replace(/<[^>|]+\|([^>]+)>/g, '$1').slice(0, 180) || 'Sent a file',
    tag: m.thread_id || ch.id, icon: u.avatar || '/brand/icon-192.png',
  });
  n.onclick = () => { window.focus(); go(m.channel_id, m.thread_id || undefined); n.close(); };
}

// ------------------------------------------------------------------ menus, modals, pickers
function closePopups() { const was = $$('.emoji-pop.em-sheet').length; $$('.menu, .emoji-pop').forEach((m) => m.remove()); if (was) popOverlay(); $$('.msg.menu-open').forEach((m) => m.classList.remove('menu-open')); }
document.addEventListener('mousedown', (e) => { if (!e.target.closest('.menu, .emoji-pop')) closePopups(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closePopups(); if (!$('#overlay').hidden) closeModal(); } });
function menu(items, x, y, flipY) {
  closePopups();
  const m = h('div', { class: 'menu' });
  for (const [label, fn, cls] of items) {
    if (label === '—') { m.append(h('hr')); continue; }
    m.append(h('button', { class: cls || '', onclick: () => { closePopups(); fn(); } }, label));
  }
  m.style.left = '0px'; m.style.top = '0px';
  document.body.append(m);
  const w = m.offsetWidth, ht = m.offsetHeight;
  if (flipY != null && y + ht > innerHeight - 8) y = flipY - ht - 4;
  m.style.left = Math.max(8, Math.min(x, innerWidth - w - 8)) + 'px';
  m.style.top = Math.max(8, Math.min(y, innerHeight - ht - 8)) + 'px';
}
function modal(title, body, buttons = [['Close']]) {
  const ov = $('#overlay');
  const foot = h('div', { class: 'modal-foot' });
  buttons.forEach(([label, fn, kind], i) => {
    foot.append(h('button', {
      class: 'btn' + (kind === 'danger' ? ' danger' : fn && i === buttons.length - 1 ? ' primary' : ''),
      onclick: async (e) => { if (!fn) return closeModal(); e.currentTarget.disabled = true; try { const keep = await fn(); if (!keep) closeModal(); } catch (err) { toast(err.message); e.currentTarget.disabled = false; } },
    }, label));
  });
  modal.returnTo = document.activeElement;
  const m = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'modal-head' }, h('h2', {}, title), h('button', { class: 'icon-btn', onclick: closeModal, title: 'Close' }, svg(I.close, 18))),
    h('div', { class: 'modal-body' }, body), buttons.length ? foot : '');
  ov.replaceChildren(m); ov.hidden = false; pushOverlay();
  ov.onmousedown = (e) => { if (e.target === ov) closeModal(); };
  setTimeout(() => $('input, textarea', m)?.focus());
  return m;
}
function closeModal() { const was = !$('#overlay').hidden; $('#overlay').hidden = true; $('#overlay').replaceChildren(); try { modal.returnTo?.focus(); } catch {} if (was) popOverlay(); }
// Phone back button closes whatever is open on top (pop-up, sheet, emoji picker) instead of leaving the screen.
function pushOverlay() { if (!history.state?.overlay) history.pushState({ overlay: 1 }, '', location.href); }
function popOverlay() { if (!history.state?.overlay) return Promise.resolve(); return new Promise((ok) => { addEventListener('popstate', () => setTimeout(ok, 0), { once: true }); history.back(); setTimeout(ok, 400); }); }
addEventListener('popstate', () => { if (!$('#overlay').hidden) { $('#overlay').hidden = true; $('#overlay').replaceChildren(); } $$('.sheet-wrap').forEach((x) => x.remove()); $$('.menu, .emoji-pop').forEach((x) => x.remove()); $$('.msg.menu-open').forEach((x) => x.classList.remove('menu-open')); });
// Keep Tab inside an open dialog.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Tab' || $('#overlay').hidden) return;
  const f = $$('#overlay button, #overlay input, #overlay textarea, #overlay select, #overlay a[href]').filter((x) => !x.disabled && x.offsetParent);
  if (!f.length) return;
  if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
  else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
});

// Full emoji list (emoji-mart data, MIT). Loaded once, merged into EMOJI_NAMES so :names: work everywhere.
const EMO = { byNative: new Map(), data: null, loading: null };
function loadEmojiData() {
  if (EMO.loading) return EMO.loading;
  EMO.loading = fetch('/vendor/emoji-data.json').then((r) => r.json()).then((d) => {
    EMO.data = d;
    for (const [id, e] of Object.entries(d.emojis)) {
      const n = e.skins[0].native;
      if (!EMOJI_NAMES[id]) EMOJI_NAMES[id] = n;
      if (!EMO.byNative.has(n)) EMO.byNative.set(n, id);
      e.skins.forEach((s) => { if (!EMO.byNative.has(s.native)) EMO.byNative.set(s.native, id); });
    }
    for (const [a, id] of Object.entries(d.aliases || {})) if (!EMOJI_NAMES[a] && d.emojis[id]) EMOJI_NAMES[a] = d.emojis[id].skins[0].native;
    for (const [n, e] of Object.entries(EMOJI_NAMES)) if (!EMO.byNative.has(e)) EMO.byNative.set(e, n);
    return d;
  }).catch(() => { EMO.loading = null; });
  return EMO.loading;
}
function loadEmojiMart() {
  if (window.EmojiMart) return Promise.resolve();
  return new Promise((ok, bad) => { const s = document.createElement('script'); s.src = '/vendor/emoji-mart.js'; s.onload = ok; s.onerror = bad; document.head.append(s); });
}
// Slack-style name for a reaction: ":thumbsup:" style text.
function emojiName(e) {
  if (/^:.+:$/.test(e)) return e.replace(/::skin-tone-\d:?$/, ':');
  const id = EMO.byNative.get(e) || EMO.byNative.get(e.replace(/[\u{1F3FB}-\u{1F3FF}]/gu, '')) || EMO.byNative.get(e.replace(/️/g, ''));
  return id ? ':' + id + ':' : e;
}
const HANDY = ['🙂', '👍', '✅', '❤️', '👀', '🙌', '😂'];
async function emojiPicker(anchor, onPick) {
  closePopups();
  const msgEl = anchor.closest?.('.msg'); msgEl?.classList.add('menu-open');
  const pop = h('div', { class: 'emoji-pop em-pop' }, h('div', { class: 'em-loading' }, 'Loading emoji…'));
  document.body.append(pop);
  const place = () => {
    const r = anchor.getBoundingClientRect(), W = pop.offsetWidth || 352, H = pop.offsetHeight || 440;
    if (innerWidth <= 760) { if (!pop.classList.contains('em-sheet')) pushOverlay(); pop.classList.add('em-sheet'); pop.style.left = '0px'; pop.style.right = '0px'; pop.style.top = 'auto'; pop.style.bottom = '0px'; return; }
    pop.style.left = Math.max(8, Math.min(r.left - W / 2 + r.width / 2, innerWidth - W - 8)) + 'px';
    pop.style.top = Math.max(8, r.top > H + 16 ? r.top - H - 6 : Math.min(r.bottom + 6, innerHeight - H - 8)) + 'px';
  };
  place();
  const pick = (v) => { closePopups(); rememberEmoji(v); onPick(v); };
  try { await Promise.all([loadEmojiMart(), loadEmojiData()]); } catch { pop.firstChild.textContent = 'Could not load emoji. Check your connection.'; return; }
  if (!pop.isConnected) return;
  const custom = Object.entries(S.emoji || {}).map(([n, u]) => ({ id: n, name: n, keywords: [n], skins: [{ src: u }] }));
  const picker = new EmojiMart.Picker({
    data: EMO.data, set: 'native', theme: 'light', previewPosition: 'none', skinTonePosition: 'search', searchPosition: 'sticky',
    navPosition: 'top', perLine: innerWidth <= 760 ? Math.max(7, Math.floor((innerWidth - 30) / 44)) : 9, emojiSize: innerWidth <= 760 ? 28 : 24, emojiButtonSize: innerWidth <= 760 ? 44 : 36, maxFrequentRows: 2, autoFocus: innerWidth > 760,
    custom: custom.length ? [{ id: 'team', name: S.workspace.name || 'Custom', emojis: custom }] : [],
    categoryIcons: custom.length ? { team: { src: '/brand/favicon-64.png' } } : undefined,
    onEmojiSelect: (e) => pick(e.native || ':' + e.id + ':'),
  });
  const handy = h('div', { class: 'em-handy' }, h('span', {}, 'Handy reactions'),
    ...HANDY.map((e) => h('button', { title: emojiName(e), onclick: () => pick(e) }, e)));
  pop.replaceChildren(picker, handy);
  requestAnimationFrame(place);
}
// Who reacted: Slack-style card with a big emoji.
let rxTip = null;
function showReactTip(btn, r) {
  hideReactTip();
  const names = r.users.map((u, i) => (u === S.me.id ? (i ? 'you' : 'You') : user(u).name));
  const list = names.length <= 1 ? names.join('') : names.length === 2 ? names.join(' and ') : names.slice(0, -1).join(', ') + ' and ' + names.at(-1);
  rxTip = h('div', { class: 'rx-tip' }, h('div', { class: 'rx-big' }, emojiNode(r.emoji)),
    h('div', { class: 'rx-who' }, h('b', {}, list), ' reacted with ', h('span', { class: 'rx-name' }, emojiName(r.emoji))));
  document.body.append(rxTip);
  const b = btn.getBoundingClientRect(), t = rxTip.getBoundingClientRect();
  rxTip.style.left = Math.max(8, Math.min(b.left + b.width / 2 - t.width / 2, innerWidth - t.width - 8)) + 'px';
  rxTip.style.top = (b.top > t.height + 12 ? b.top - t.height - 8 : b.bottom + 8) + 'px';
}
function hideReactTip() { rxTip?.remove(); rxTip = null; }
addEventListener('scroll', hideReactTip, true);

function chanMenu(ch, x, y) {
  const items = [];
  items.push([ch.starred ? 'Unpin from top' : 'Pin to top', () => setPref(ch, { starred: !ch.starred })]);
  items.push([ch.muted ? 'Unmute' : 'Mute', () => setPref(ch, { muted: !ch.muted })]);
  items.push(['—']);
  for (const s of S.sections) if (s.id !== ch.section_id) items.push([`Move to ${s.name}`, () => setPref(ch, { section_id: s.id })]);
  if (ch.section_id) items.push(['Remove from section', () => setPref(ch, { section_id: null })]);
  items.push(['Move to a new section…', () => newSection(ch)]);
  if (ch.kind === 'dm') items.push(['—'], ['Close conversation', () => closeDM(ch)]);
  if (ch.kind === 'channel') items.push(['—'], ['Leave channel', async () => { await api(`/api/channels/${ch.id}/leave`, { method: 'POST' }); S.channels.delete(ch.id); if (S.current === ch.id) { S.current = null; location.hash = '#/'; } renderSidebar(); }, 'danger']);
  menu(items, x, y);
}
async function closeDM(ch) {
  await setPref(ch, { hidden: true });
  if (S.current === ch.id) { S.current = null; location.hash = '#/'; }
  toast(`Closed. It comes back if someone writes.`);
}
function showHiddenDMs() {
  const list = [...S.channels.values()].filter((c) => c.kind === 'dm' && c.hidden).sort((a, b) => b.last_ts - a.last_ts);
  modal('Closed conversations', h('div', {}, ...list.map((c) => h('div', { class: 'list-item' }, h('div', { class: 'grow' }, h('div', { class: 't' }, chanLabel(c)), h('div', { class: 's' }, (c.last_ts ? 'Last message ' + dayStr(c.last_ts) : 'No messages yet'))),
    h('button', { class: 'btn sm', onclick: async (e) => { await setPref(c, { hidden: false }); e.target.closest('.list-item').remove(); } }, 'Reopen')))), [['Done']]);
}
async function setPref(ch, prefs) {
  await api(`/api/channels/${ch.id}/prefs`, { method: 'POST', body: prefs });
  Object.assign(ch, Object.fromEntries(Object.entries(prefs).map(([k, v]) => [k, typeof v === 'boolean' ? (v ? 1 : 0) : v])));
  renderSidebar();
}
function sectionMenu(s, x, y) {
  menu([
    ['Rename section…', () => {
      const inp = h('input', { class: 'input', value: s.name });
      modal('Rename section', inp, [['Cancel'], ['Save', async () => { await api(`/api/sections/${s.id}`, { method: 'PATCH', body: { name: inp.value } }); s.name = inp.value; renderSidebar(); }]]);
    }],
    ['Move up', () => moveSection(s, -1)], ['Move down', () => moveSection(s, 1)],
    ['—'], ['Delete section', async () => { await api(`/api/sections/${s.id}`, { method: 'DELETE' }); S.sections = S.sections.filter((x) => x.id !== s.id); for (const c of S.channels.values()) if (c.section_id === s.id) c.section_id = null; renderSidebar(); }, 'danger'],
  ], x, y);
}
async function moveSection(s, dir) {
  const i = S.sections.indexOf(s), j = i + dir;
  if (j < 0 || j >= S.sections.length) return;
  [S.sections[i], S.sections[j]] = [S.sections[j], S.sections[i]];
  S.sections.forEach((x, k) => (x.position = k));
  renderSidebar();
  await Promise.all(S.sections.map((x) => api(`/api/sections/${x.id}`, { method: 'PATCH', body: { position: x.position } })));
}
function newSection(ch) {
  const inp = h('input', { class: 'input', placeholder: 'e.g. Sales' });
  modal('Create a section', h('label', { class: 'field' }, h('span', {}, 'Name'), inp), [['Cancel'], ['Create', async () => {
    const s = await api('/api/sections', { method: 'POST', body: { name: inp.value || 'New section' } });
    S.sections.push(s);
    if (ch) await setPref(ch, { section_id: s.id }); else renderSidebar();
  }]]);
}
function addChannelMenu(e) {
  const r = e.currentTarget.getBoundingClientRect();
  menu([['Create a new channel', createChannel], ['Browse channels', browseChannels], ['—'], ['Create a section', () => newSection()]], r.left + 20, r.bottom);
}
function createChannel() {
  const name = h('input', { class: 'input', placeholder: 'e.g. plan-budget', maxlength: 80 });
  const topic = h('input', { class: 'input', placeholder: 'What is this channel about? (optional)' });
  const priv = h('input', { type: 'checkbox' });
  modal('Create a channel', h('div', {},
    h('label', { class: 'field' }, h('span', {}, 'Name'), name, h('small', {}, 'Lowercase, no spaces. Use dashes: like-this.')),
    h('label', { class: 'field' }, h('span', {}, 'Description'), topic),
    h('label', { class: 'check' }, priv, h('span', {}, h('b', {}, 'Make private'), h('br'), h('small', {}, 'Only invited people can see and join it.')))),
  [['Cancel'], ['Create', async () => {
    const ch = await api('/api/channels', { method: 'POST', body: { name: name.value, topic: topic.value, private: priv.checked } });
    S.channels.set(ch.id, ch); renderSidebar(); go(ch.id);
  }]]);
  name.addEventListener('input', () => { name.value = name.value.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9_-]/g, ''); });
}
async function browseChannels() {
  const list = await api('/api/channels');
  const q = h('input', { class: 'input', placeholder: 'Search for a channel' });
  const box = h('div', { style: { marginTop: '12px' } });
  const draw = () => box.replaceChildren(...list.filter((c) => c.name.includes(q.value.toLowerCase())).map((c) => h('div', { class: 'list-item', onclick: () => { closeModal(); go(c.id); } },
    h('div', { class: 'grow' }, h('div', { class: 't' }, (c.private ? '🔒 ' : '# ') + c.name + (c.archived ? ' (archived)' : '')),
      h('div', { class: 's' }, `${c.joined ? '✓ Joined · ' : ''}${c.members} member${c.members === 1 ? '' : 's'}${c.topic ? ' · ' + c.topic : ''}`)))));
  q.addEventListener('input', draw); draw();
  modal('Channels', h('div', {}, q, box), []);
}
function composeDM() {
  const chosen = [];
  const q = h('input', { class: 'input', placeholder: 'Type a name' });
  const chips = h('div', { class: 'chips' });
  const box = h('div', {});
  const draw = () => {
    chips.replaceChildren(...chosen.map((u) => h('span', { class: 'chip' }, u.name, h('button', { onclick: () => { chosen.splice(chosen.indexOf(u), 1); draw(); } }, '×'))));
    const v = q.value.toLowerCase();
    box.replaceChildren(...[...S.users.values()].filter((u) => u.active && !chosen.includes(u) && u.name.toLowerCase().includes(v)).slice(0, 30)
      .map((u) => h('div', { class: 'list-item', onclick: () => { chosen.push(u); q.value = ''; draw(); q.focus(); } },
        avatar(u, 'av', '14px'), h('div', { class: 'grow' }, h('div', { class: 't' }, u.id === S.me.id ? u.name + ' (you)' : u.name), h('div', { class: 's' }, u.title || u.email)))));
  };
  q.addEventListener('input', draw); draw();
  const inviteLink = ['owner', 'admin'].includes(S.me.role) ? h('p', { style: { marginTop: '10px' } }, h('a', { href: '#', onclick: (e) => { e.preventDefault(); invitePeople(); } }, '+ Invite someone new')) : '';
  modal('New message', h('div', {}, chips, q, h('div', { style: { marginTop: '8px' } }, box), inviteLink), [['Cancel'], ['Go', async () => {
    if (!chosen.length) throw new Error('Pick someone');
    const ch = await api('/api/dm', { method: 'POST', body: { user_ids: chosen.map((u) => u.id) } });
    if (!S.channels.has(ch.id)) S.channels.set(ch.id, ch);
    renderSidebar(); go(ch.id);
  }]]);
}
function findConversation() { document.body.classList.add('instant'); setTimeout(() => document.body.classList.remove('instant'), 400); return findConversationInner(); }
function findConversationInner() {
  const q = h('input', { class: 'input', placeholder: 'Jump to a channel or person' });
  const box = h('div', { style: { marginTop: '8px' } });
  let sel = 0, items = [];
  const draw = () => {
    const v = q.value.toLowerCase();
    const chans = [...S.channels.values()].filter((c) => chanLabel(c).toLowerCase().includes(v)).map((c) => ({ label: (c.kind === 'dm' ? '' : '# ') + chanLabel(c), go: () => go(c.id), unread: c.unread }));
    const people = [...S.users.values()].filter((u) => u.active && u.id !== S.me.id && u.name.toLowerCase().includes(v) && ![...S.channels.values()].some((c) => c.kind === 'dm' && dmOthers(c).length === 1 && dmOthers(c)[0] === u.id))
      .map((u) => ({ label: u.name, go: async () => { const ch = await api('/api/dm', { method: 'POST', body: { user_ids: [u.id] } }); S.channels.set(ch.id, ch); renderSidebar(); go(ch.id); } }));
    items = [...chans, ...people].slice(0, 12);
    sel = Math.min(sel, items.length - 1);
    box.replaceChildren(...items.map((it, i) => h('div', { class: 'list-item' + (i === sel ? ' sel' : ''), onclick: () => { closeModal(); it.go(); } }, h('div', { class: 'grow' }, h('div', { class: 't', style: { fontWeight: it.unread ? 900 : 400 } }, it.label)))));
  };
  q.addEventListener('input', () => { sel = 0; draw(); });
  q.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = (sel + 1) % items.length; draw(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); sel = (sel - 1 + items.length) % items.length; draw(); }
    if (e.key === 'Enter' && items[sel]) { closeModal(); items[sel].go(); }
  });
  draw();
  modal('Find a conversation', h('div', {}, q, box), []);
}
// ------------------------------------------------------------------ full pages: Activity, Threads, Search (like Slack, not pop-ups)
function pageShell(view, title, sub, ...tools) {
  saveDraft(); closeThread(false); S.current = null;
  history.replaceState(null, '', '#/' + view);
  renderSidebar(); setMobileView('main'); railActive(view === 'activity' ? 'activity' : '');
  $$('.nav-row').forEach((r) => r.classList.toggle('active', r.dataset.view === view));
  const list = h('div', { class: 'feed' }, h('div', { class: 'admin-loading' }, 'Loading…'));
  const root = h('div', { class: 'page' }, h('header', { class: 'page-head' }, h('div', {}, h('h1', {}, title), sub ? h('p', {}, sub) : ''), h('div', { class: 'admin-actions' }, ...tools)), list);
  $('#main').replaceChildren(root);
  return list;
}
const where = (cid) => { const c = S.channels.get(cid); return c ? (c.kind === 'dm' ? chanLabel(c) : '# ' + c.name) : ''; };
function feedItem(m, extra) {
  const u = user(m.user_id);
  return h('button', { class: 'fitem', onclick: () => jumpTo(m) },
    h('div', { class: 'fctx' }, extra?.badge || '', h('span', {}, where(m.channel_id)), h('span', { class: 'sep' }, '·'), h('span', {}, ago(m.ts))),
    h('div', { class: 'frow' }, avatar(u, 'av', '13px'), h('div', { class: 'fbody' },
      h('b', {}, u.name), h('div', { class: 'text', html: fmt(m.text) || (m.files?.length ? '<i>Shared a file</i>' : '') }), extra?.after || '')));
}
function jumpTo(m) {
  if (m.thread_id) { S.focus = { id: m.id }; go(m.channel_id, m.thread_id); return; }
  S.focus = { cid: m.channel_id, id: m.id, ts: m.ts };
  if (S.current === m.channel_id) { S.current = null; }
  S.msgs.delete(m.channel_id);
  go(m.channel_id);
  if (location.hash === `#/c/${m.channel_id}`) route();
}
function focusMessage() {
  if (!S.focus) return;
  const el = $(`.msg[data-id="${S.focus.id}"]`);
  if (!el) return;
  S.focus = null;
  el.scrollIntoView({ block: 'center' });
  el.classList.add('highlight', 'focus-flash');
  setTimeout(() => el.classList.remove('focus-flash'), 2200);
}
async function openActivity(tab = 'mentions') {
  const seg = h('div', { class: 'seg' }, ...[['mentions', 'Mentions'], ['reactions', 'Reactions']].map(([k, l]) => h('button', { class: tab === k ? 'on' : '', onclick: () => openActivity(k) }, l)));
  const list = pageShell('activity', 'Activity', 'Where people mentioned you or reacted to your messages.', seg);
  try {
    if (tab === 'mentions') {
      const res = await api('/api/mentions');
      list.replaceChildren(...(res.length ? res.map((m) => feedItem(m, { badge: h('span', { class: 'fbadge at' }, '@') })) : [h('div', { class: 'empty-row' }, 'Nothing yet. When someone @mentions you, it shows here.')]));
    } else {
      const res = await api('/api/activity/reactions');
      list.replaceChildren(...(res.length ? res.map((m) => feedItem(m, { badge: h('span', { class: 'fbadge' }, emojiNode(m.r_emoji)), after: h('div', { class: 'fnote' }, `${user(m.r_user).name} reacted to your message`) })) : [h('div', { class: 'empty-row' }, 'No reactions yet.')]));
    }
  } catch (e) { toast(e.message); }
}
async function openThreadsView() {
  const list = pageShell('threads', 'Threads', 'Conversations you started or replied to, newest first.');
  try {
    const res = await api('/api/threads');
    list.replaceChildren(...(res.length ? res.map((p) => {
      const u = user(p.user_id);
      return h('div', { class: 'tcard-thread' },
        h('div', { class: 'fctx' }, h('span', {}, where(p.channel_id)), h('span', { class: 'sep' }, '·'), h('span', {}, `${p.reply_count} ${p.reply_count === 1 ? 'reply' : 'replies'}`)),
        h('button', { class: 'frow plain', onclick: () => go(p.channel_id, p.id) }, avatar(u, 'av', '13px'), h('div', { class: 'fbody' }, h('b', {}, u.name, h('span', { class: 'ftime' }, dayStr(p.ts))), h('div', { class: 'text', html: fmt(p.text) }))),
        ...(p.latest || []).map((r) => h('button', { class: 'frow plain reply', onclick: () => { S.focus = { id: r.id }; go(p.channel_id, p.id); } }, avatar(user(r.user_id), 'av', '11px'), h('div', { class: 'fbody' }, h('b', {}, user(r.user_id).name, h('span', { class: 'ftime' }, ago(r.ts))), h('div', { class: 'text', html: fmt(r.text) })))),
        h('button', { class: 'btn sm open-thread', onclick: () => go(p.channel_id, p.id) }, 'Open thread'));
    }) : [h('div', { class: 'empty-row' }, 'Threads you start or reply to show up here.')]));
  } catch (e) { toast(e.message); }
}
function searchMessages(initial = '') {
  const q = h('input', { class: 'input page-search', placeholder: `Search messages in ${S.workspace.name}`, value: initial });
  const list = pageShell('search', 'Search', '', q);
  list.replaceChildren(h('div', { class: 'empty-row' }, 'Type at least two letters.'));
  let t;
  const run = async () => {
    const v = q.value.trim();
    history.replaceState(null, '', '#/search/' + encodeURIComponent(v));
    if (v.length < 2) return list.replaceChildren(h('div', { class: 'empty-row' }, 'Type at least two letters.'));
    const res = await api('/api/search?q=' + encodeURIComponent(v));
    list.replaceChildren(h('div', { class: 'fcount' }, `${res.length}${res.length >= 40 ? '+' : ''} result${res.length === 1 ? '' : 's'}`), ...res.map((m) => feedItem(m)));
  };
  q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(run, 250); });
  setTimeout(() => q.focus()); if (initial) run();
}
function resultItem(m) { return feedItem(m); }
function profile(u) {
  const body = h('div', {},
    h('div', { class: 'profile-card' }, avatar(u, 'av', '28px'), h('div', {}, h('div', { style: { fontSize: '22px', fontWeight: 900 } }, u.name),
      h('div', { style: { color: '#616061' } }, u.title || ''), h('div', { style: { color: '#616061', fontSize: '13px' } }, presenceLabel(u) + ' · ' + (u.email || '')),
      statusOf(u) ? h('div', { class: 'p-status' }, emojiNode(statusOf(u).emoji || '💬'), ' ', statusOf(u).text || '') : '',
      inDnd(u) ? h('div', { class: 'p-status' }, svg(I.moon, 13), ' Notifications paused') : '',
      u.tz ? h('div', { class: 'p-local' }, svg('M10 2a8 8 0 1 1 0 16 8 8 0 0 1 0-16zm0 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM9.3 5.5h1.4v4.2l3 1.8-.7 1.2-3.7-2.2v-5z', 14), `${localTime(u.tz)} local time`, u.city ? ` · ${u.city}` : '') : '')),
  );
  const buttons = [];
  if (u.id === S.me.id) {
    const name = h('input', { class: 'input', value: u.name }), title = h('input', { class: 'input', value: u.title || '', placeholder: 'e.g. Head of Sales' });
    const photo = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: async () => {
      const f = photo.files[0]; if (!f) return; const fd = new FormData(); fd.append('file', f);
      try { const r = await api('/api/me/avatar', { method: 'POST', body: fd }); S.me.avatar = r.avatar; S.users.set(S.me.id, { ...S.users.get(S.me.id), avatar: r.avatar }); toast('Photo updated'); closeModal(); profile(S.me); renderSidebar(); rerender(); $('#me-avatar').replaceChildren(avatar(S.me, '', '16px')); } catch (e) { toast(e.message); }
    } });
    body.append(h('button', { class: 'btn sm', onclick: () => photo.click() }, S.me.avatar ? 'Change photo' : 'Add a photo'), photo,
      h('label', { class: 'field' }, h('span', {}, 'Display name'), name), h('label', { class: 'field' }, h('span', {}, 'Title'), title),
      h('p', {}, h('a', { href: '#/prefs', onclick: () => closeModal() }, 'Status, notifications and do not disturb')),
      h('p', {}, h('a', { href: '#', onclick: (e) => { e.preventDefault(); closeModal(); installApp(); } }, 'Install Yakyard on this device')),
      h('p', {}, h('a', { href: '/auth/logout', onclick: (e) => { e.preventDefault(); signOut(); } }, 'Sign out of ' + S.workspace.name)));
    buttons.push(['Cancel'], ['Save', async () => { await api('/api/me', { method: 'PATCH', body: { name: name.value, title: title.value } }); Object.assign(S.me, { name: name.value, title: title.value }); S.users.set(S.me.id, { ...S.me }); renderSidebar(); rerender(); }]);
  } else {
    if (['owner', 'admin'].includes(S.me.role) && u.email) buttons.push(['New sign-in link', async () => { const r = await api('/api/invite', { method: 'POST', body: { email: u.email } }); showLink(u.name, r.link, true); return true; }]);
    buttons.push(['Message', async () => { const ch = await api('/api/dm', { method: 'POST', body: { user_ids: [u.id] } }); S.channels.set(ch.id, ch); renderSidebar(); go(ch.id); }]);
  }
  modal(u.id === S.me.id ? 'Your profile' : 'Profile', body, buttons);
}
async function channelDetails(ch, tab) {
  if (ch.kind === 'dm') return dmOthers(ch).length === 1 ? profile(user(dmOthers(ch)[0])) : null;
  if (S.channels.has(ch.id)) return detailsPanel(ch, tab);
  const ids = await api(`/api/channels/${ch.id}/members`).catch(() => []);
  const topic = h('input', { class: 'input', value: ch.topic || '', placeholder: 'Add a description' });
  const list = h('div', {}, ...ids.map((id) => { const u = user(id); return h('div', { class: 'list-item member', onclick: () => profile(u) }, avatar(u, 'av', '14px'), h('div', { class: 'grow' }, h('div', { class: 't' }, u.name), h('div', { class: 's' }, u.title || u.email))); }));
  const addBox = h('div', {});
  const addBtn = h('button', { class: 'btn', onclick: () => {
    const q = h('input', { class: 'input', placeholder: 'Add people by name' });
    const res = h('div', {});
    q.addEventListener('input', () => res.replaceChildren(...[...S.users.values()].filter((u) => u.active && !ids.includes(u.id) && u.name.toLowerCase().includes(q.value.toLowerCase())).slice(0, 8)
      .map((u) => h('div', { class: 'list-item', onclick: async () => { await api(`/api/channels/${ch.id}/members`, { method: 'POST', body: { user_ids: [u.id] } }); toast(`${u.name} added`); closeModal(); loadMembers(ch.id); } }, avatar(u, 'av', '14px'), h('div', { class: 'grow t' }, u.name)))));
    addBox.replaceChildren(q, res); q.focus();
  } }, 'Add people');
  modal('# ' + ch.name, h('div', {},
    h('label', { class: 'field' }, h('span', {}, 'Description'), topic),
    h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '8px 0' } }, h('b', {}, `${ids.length} members`), addBtn),
    addBox, list),
  [['Close'], ['Save description', async () => { await api(`/api/channels/${ch.id}`, { method: 'PATCH', body: { topic: topic.value } }); ch.topic = topic.value; if (S.current === ch.id) openChannel(ch.id); }]]);
}
function invitePeople() {
  if (!['owner', 'admin'].includes(S.me.role)) return toast('Only admins can invite people');
  const email = h('input', { class: 'input', type: 'email', placeholder: 'name@anything.com' });
  const name = h('input', { class: 'input', placeholder: 'Full name' });
  const guest = h('input', { type: 'checkbox' });
  modal('Invite people to ' + S.workspace.name, h('div', {},
    h('label', { class: 'field' }, h('span', {}, 'Their email'), email, h('small', {}, 'Any email works. It becomes their sign-in.')),
    h('label', { class: 'field' }, h('span', {}, 'Name'), name),
    h('label', { class: 'check' }, guest, h('span', {}, h('b', {}, 'Guest (partner)'), h('br'), h('small', {}, 'Only sees the channels you add them to.')))),
  [['Cancel'], ['Send invite', async () => {
    const u = await api('/api/invite', { method: 'POST', body: { email: email.value, name: name.value, guest: guest.checked } });
    const { link, existing, ...rest } = u;
    S.users.set(u.id, { ...(S.users.get(u.id) || {}), ...rest });
    showLink(u.name, link, existing);
    return true;
  }]]);
}
function showLink(name, link, existing) {
  const inp = h('input', { class: 'input', value: link, readonly: true, onfocus: (e) => e.target.select() });
  const msg = `Hi ${name.split(' ')[0]}, here's your access to Yakyard, our team chat: ${link}`;
  modal(existing ? 'New sign-in link' : 'Invite ready', h('div', {},
    h('p', {}, existing ? `${name} already has an account. This link lets them set a new password.` : `Send this link to ${name} (WhatsApp, email, anything). They open it, pick a password, and they're in.`),
    h('div', { class: 'invite-link' }, inp, h('button', { class: 'btn primary', onclick: () => { navigator.clipboard?.writeText(msg); toast('Copied with a short message'); } }, 'Copy')),
    h('p', { style: { color: '#616061', fontSize: '13px', marginTop: '10px' } }, 'Works once, expires in 14 days.')),
  [['Done']]);
}

// ------------------------------------------------------------------ admin dashboard (owner + admins)
const ROLE_LABEL = { owner: 'Owner', admin: 'Admin', member: 'Member', guest: 'Guest' };
const STATUS_LABEL = { active: 'Active', invited: 'Invite sent', not_invited: 'Not invited yet', deactivated: 'Deactivated' };
const isAdmin = () => ['owner', 'admin'].includes(S.me?.role);
const A = { tab: 'people', filter: 'all', q: '', people: [], channels: [], stats: null };
function relTime(ts) {
  if (!ts) return 'Never';
  const d = (Date.now() - ts) / 864e5;
  if (d < 1) return 'Today'; if (d < 2) return 'Yesterday'; if (d < 30) return Math.floor(d) + ' days ago';
  return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}
async function openAdmin(tab) {
  if (!isAdmin()) return toast('Admins only');
  if (tab) A.tab = tab;
  saveDraft(); closeThread(false);
  S.current = null; history.replaceState(null, '', '#/admin');
  renderSidebar(); setMobileView('main');
  $('#main').replaceChildren(h('div', { class: 'admin' }, h('div', { class: 'admin-loading' }, 'Loading…')));
  try {
    [A.people, A.channels, A.stats] = await Promise.all([api('/api/admin/people'), api('/api/admin/channels'), api('/api/admin/stats')]);
  } catch (e) { return toast(e.message); }
  renderAdmin();
}
function renderAdmin() {
  const root = $('#main .admin'); if (!root) return;
  const counts = { all: A.people.length };
  for (const p of A.people) { counts[p.status] = (counts[p.status] || 0) + 1; if (p.role === 'guest') counts.guest = (counts.guest || 0) + 1; if (p.role === 'admin' || p.role === 'owner') counts.admins = (counts.admins || 0) + 1; }
  const tabs = h('div', { class: 'seg' }, ...[['people', 'People'], ['channels', 'Channels']].map(([k, l]) =>
    h('button', { class: A.tab === k ? 'on' : '', onclick: () => { A.tab = k; renderAdmin(); } }, l)));
  const head = h('header', { class: 'admin-head' },
    h('div', {}, h('h1', {}, 'Admin'), h('p', {}, `${S.workspace.name} workspace · you are ${ROLE_LABEL[S.me.role].toLowerCase()}`)),
    h('div', { class: 'admin-actions' }, tabs, h('button', { class: 'btn primary', onclick: invitePeople }, svg(I.plus, 14), 'Invite people')));
  const st = A.stats || {};
  const kpis = h('div', { class: 'kpis' },
    kpi(counts.active || 0, 'Signed in'), kpi((counts.invited || 0), 'Invites waiting'), kpi(counts.not_invited || 0, 'From Slack, not invited'),
    kpi((st.messages || 0).toLocaleString(), 'Messages'), kpi((st.messages_7d || 0).toLocaleString(), 'Messages this week'));
  root.replaceChildren(head, kpis, A.tab === 'people' ? peopleTable(counts) : channelsTable());
}
const kpi = (n, l) => h('div', { class: 'kpi' }, h('b', {}, String(n)), h('span', {}, l));
function peopleTable(counts) {
  const filters = [['all', 'Everyone'], ['active', 'Signed in'], ['invited', 'Invite sent'], ['not_invited', 'Not invited'], ['admins', 'Admins'], ['guest', 'Guests'], ['deactivated', 'Deactivated']];
  const search = h('input', { class: 'input admin-search', placeholder: 'Search people', value: A.q, oninput: (e) => { A.q = e.target.value; draw(); } });
  const chips = h('div', { class: 'chips-row' }, ...filters.map(([k, l]) => h('button', { class: 'fchip' + (A.filter === k ? ' on' : ''), onclick: () => { A.filter = k; renderAdmin(); } }, l, h('i', {}, counts[k] || 0))));
  const body = h('div', { class: 'tbody' });
  const draw = () => {
    const q = A.q.toLowerCase();
    const list = A.people.filter((p) => (A.filter === 'all' || p.status === A.filter || (A.filter === 'guest' && p.role === 'guest') || (A.filter === 'admins' && ['admin', 'owner'].includes(p.role)))
      && (!q || p.name.toLowerCase().includes(q) || p.email.includes(q)))
      .sort((a, b) => (a.status === 'deactivated') - (b.status === 'deactivated') || (b.status === 'active') - (a.status === 'active'));
    body.replaceChildren(...list.map(personRow));
    if (!list.length) body.append(h('div', { class: 'empty-row' }, 'Nobody matches.'));
  };
  draw();
  return h('section', { class: 'card' }, h('div', { class: 'toolbar' }, search, chips),
    h('div', { class: 'thead pgrid' }, h('span', {}, 'Name'), h('span', {}, 'Access'), h('span', {}, 'Status'), h('span', {}, 'Channels'), h('span', {}, 'Last active'), h('span', {})), body);
}
function personRow(p) {
  const locked = p.role === 'owner' || p.id === S.me.id;
  const roleSel = h('select', { class: 'role-sel', disabled: locked || p.status === 'deactivated' || (p.role === 'admin' && S.me.role !== 'owner'), onchange: (e) => setPerson(p, { role: e.target.value }) },
    ...['owner', 'admin', 'member', 'guest'].filter((r) => r !== 'owner' || p.role === 'owner').map((r) => {
      const o = h('option', { value: r }, ROLE_LABEL[r]);
      if (r === p.role) o.selected = true;
      if (r === 'admin' && S.me.role !== 'owner') o.disabled = true;
      return o;
    }));
  const menuBtn = h('button', { class: 'icon-btn', title: 'More', onclick: (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const items = [];
    if (p.status !== 'active' && p.status !== 'deactivated') items.push([p.status === 'invited' ? 'New sign-in link' : 'Invite (get sign-in link)', () => sendLink(p)]);
    if (p.status === 'active') items.push(['Reset password (new link)', () => sendLink(p)]);
    items.push(['Channels…', () => personChannels(p)]);
    if (!locked) items.push(['—'], p.status === 'deactivated' ? ['Reactivate', () => setPerson(p, { deactivated: false })] : ['Deactivate…', () => confirmDeactivate(p), 'danger']);
    menu(items, r.right - 220, r.bottom + 4);
  } }, svg(I.dots, 16));
  const ch = p.status === 'active' ? p.channels : p.pending_channels;
  return h('div', { class: 'trow pgrid' + (p.status === 'deactivated' ? ' dim' : '') },
    h('div', { class: 'who-cell' }, avatar(p, 'av', '13px'), h('div', {}, h('b', {}, p.name, p.id === S.me.id ? h('em', {}, ' you') : ''), h('small', {}, p.email.endsWith('@bot.local') ? 'App' : p.email.endsWith('@external.slack') ? 'Outside contact from Slack' : p.email))),
    h('div', {}, roleSel),
    h('div', {}, h('span', { class: 'pill s-' + p.status }, STATUS_LABEL[p.status])),
    h('div', { class: 'num' }, ch ? `${ch}${p.status === 'active' ? '' : ' on join'}` : '0'),
    h('div', { class: 'muted' }, p.status === 'active' ? relTime(p.last_seen) : p.last_post ? 'Slack · ' + relTime(p.last_post) : 'Never'),
    h('div', { class: 'row-actions' }, p.status === 'not_invited' || p.status === 'invited' ? h('button', { class: 'btn sm', onclick: () => sendLink(p) }, p.status === 'invited' ? 'Resend' : 'Invite') : '', menuBtn));
}
async function setPerson(p, change) {
  try {
    await api(`/api/admin/users/${p.id}`, { method: 'PATCH', body: change });
    A.people = await api('/api/admin/people'); renderAdmin();
    toast(change.role ? `${p.name} is now ${ROLE_LABEL[change.role].toLowerCase()}` : change.deactivated ? `${p.name} deactivated` : `${p.name} reactivated`);
  } catch (e) { toast(e.message); renderAdmin(); }
}
function confirmDeactivate(p) {
  modal(`Deactivate ${p.name}?`, h('p', {}, 'They are signed out everywhere right away and can no longer get in. Their messages stay. You can reactivate them later.'),
    [['Cancel'], ['Deactivate', () => setPerson(p, { deactivated: true }), 'danger']]);
}
async function sendLink(p) {
  try {
    const r = await api('/api/invite', { method: 'POST', body: { email: p.email } });
    showLink(p.name, r.link, p.status === 'active');
    A.people = await api('/api/admin/people'); if (A.tab === 'people' && !$('#overlay').hidden) renderAdmin();
  } catch (e) { toast(e.message); }
}
async function personChannels(p) {
  const list = await api(`/api/admin/users/${p.id}/channels`);
  const active = p.status === 'active';
  const box = h('div', { class: 'ch-picker' }, ...list.filter((c) => !c.archived).map((c) => {
    const cb = h('input', { type: 'checkbox' }); cb.checked = !!(c.member || c.pending);
    cb.onchange = async () => { try { await api(`/api/admin/users/${p.id}/channels`, { method: 'POST', body: { channel_id: c.id, member: cb.checked } }); } catch (e) { cb.checked = !cb.checked; toast(e.message); } };
    return h('label', { class: 'ch-opt' }, cb, h('span', {}, (c.private ? '🔒 ' : '# ') + c.name));
  }));
  modal(`${p.name} · channels`, h('div', {}, h('p', { class: 'muted' }, active ? 'Changes apply right away.' : 'They get these channels the moment they sign in.'), box),
    [['Done', async () => { A.people = await api('/api/admin/people'); renderAdmin(); }]]);
}
function channelsTable() {
  const body = h('div', { class: 'tbody' }, ...A.channels.map((c) => h('div', { class: 'trow cgrid' + (c.archived ? ' dim' : '') },
    h('div', { class: 'who-cell' }, h('span', { class: 'ch-glyph' }, c.private ? svg(I.lock, 14) : '#'), h('div', {}, h('b', {}, c.name), h('small', {}, c.topic || 'No description'))),
    h('div', {}, h('span', { class: 'pill ' + (c.private ? 's-invited' : 's-active') }, c.private ? 'Private' : 'Public')),
    h('div', { class: 'num' }, String(c.members)),
    h('div', { class: 'num' }, c.messages.toLocaleString()),
    h('div', { class: 'muted' }, relTime(c.last_ts)),
    h('div', { class: 'row-actions' }, h('button', { class: 'icon-btn', title: 'More', onclick: (e) => {
      const r = e.currentTarget.getBoundingClientRect();
      menu([[c.private ? 'Make public' : 'Make private', () => setChannel(c, { private: !c.private })],
        ['Rename…', () => { const inp = h('input', { class: 'input', value: c.name }); modal('Rename channel', inp, [['Cancel'], ['Save', () => setChannel(c, { name: inp.value })]]); }],
        ['—'], [c.archived ? 'Unarchive' : 'Archive', () => setChannel(c, { archived: !c.archived }), c.archived ? '' : 'danger'],
        ['Delete for everyone…', () => deleteChannel(c), 'danger']], r.right - 200, r.bottom + 4);
    } }, svg(I.dots, 16))))));
  const who = h('select', { class: 'input sel-sm', onchange: async () => { await api('/api/settings', { method: 'POST', body: { create_channels: who.value } }); toast('Saved'); } },
    h('option', { value: 'everyone' }, 'Everyone except guests'), h('option', { value: 'admins' }, 'Only admins'));
  api('/api/settings').then((r) => (who.value = r.create_channels)).catch(() => {});
  return h('section', { class: 'card' }, h('div', { class: 'card-tools' }, h('span', {}, 'Who can create channels'), who, h('button', { class: 'btn sm', onclick: createChannel }, svg(I.plus, 12), 'New channel')),
    h('div', { class: 'thead cgrid' }, h('span', {}, 'Channel'), h('span', {}, 'Type'), h('span', {}, 'Members'), h('span', {}, 'Messages'), h('span', {}, 'Last message'), h('span', {})), body);
}
async function setChannel(c, change) {
  try { await api(`/api/admin/channels/${c.id}`, { method: 'PATCH', body: change }); A.channels = await api('/api/admin/channels'); renderAdmin(); await bootstrap(); renderSidebar(); }
  catch (e) { toast(e.message); }
}

// ------------------------------------------------------------------ team clocks + weather
const WX = {
  sun: 'M10 6a4 4 0 1 1 0 8 4 4 0 0 1 0-8zM9.3 1h1.4v2.6H9.3zM9.3 16.4h1.4V19H9.3zM1 9.3h2.6v1.4H1zM16.4 9.3H19v1.4h-2.6zM3.6 4.6l1-1 1.8 1.8-1 1-1.8-1.8zM13.6 14.6l1-1 1.8 1.8-1 1-1.8-1.8zM14.6 3.6l1 1-1.8 1.8-1-1 1.8-1.8zM4.6 13.6l1 1-1.8 1.8-1-1 1.8-1.8z',
  moon: 'M12.5 2.5a7.5 7.5 0 1 0 5 13.1A6.5 6.5 0 0 1 12.5 2.5z',
  partly: 'M7 3a4 4 0 0 1 3.9 3.1 5 5 0 0 0-5.6 3.1A4 4 0 0 1 7 3zM7.5 18a3.5 3.5 0 0 1-.5-7 4.5 4.5 0 0 1 8.6 1.1A3 3 0 0 1 15.3 18H7.5z',
  cloud: 'M6 16a4 4 0 0 1-.6-8 5 5 0 0 1 9.6 1.2A3.4 3.4 0 0 1 14.6 16H6z',
  fog: 'M3 7h14v1.5H3zM2 10.5h16V12H2zM4 14h12v1.5H4z',
  rain: 'M6 12a3.6 3.6 0 0 1-.5-7.2 4.6 4.6 0 0 1 8.8 1.1A3.1 3.1 0 0 1 14 12H6zM6.5 13.5l1.2.5-1 2.4-1.2-.5zM10 13.5l1.2.5-1 2.4-1.2-.5zM13.5 13.5l1.2.5-1 2.4-1.2-.5z',
  snow: 'M6 12a3.6 3.6 0 0 1-.5-7.2 4.6 4.6 0 0 1 8.8 1.1A3.1 3.1 0 0 1 14 12H6zM6.5 14a1 1 0 1 1 0 2 1 1 0 0 1 0-2zM10 15a1 1 0 1 1 0 2 1 1 0 0 1 0-2zM13.5 14a1 1 0 1 1 0 2 1 1 0 0 1 0-2z',
  storm: 'M6 11a3.6 3.6 0 0 1-.5-7.2 4.6 4.6 0 0 1 8.8 1.1A3.1 3.1 0 0 1 14 11H6zM10.5 11.5l-3 4h2.2l-1 3.5 3.8-5h-2.3l1.3-2.5z',
};
function wxKind(code, day) {
  if (code == null) return null;
  if (code === 0) return day ? ['sun', 'Clear'] : ['moon', 'Clear night'];
  if (code <= 2) return day ? ['partly', 'Partly cloudy'] : ['moon', 'Mostly clear'];
  if (code === 3) return ['cloud', 'Cloudy'];
  if (code === 45 || code === 48) return ['fog', 'Fog'];
  if (code >= 71 && code <= 77 || code === 85 || code === 86) return ['snow', 'Snow'];
  if (code >= 95) return ['storm', 'Thunderstorm'];
  return ['rain', code >= 80 ? 'Showers' : 'Rain'];
}
const tzOffset = (tz) => { try { const d = new Date(); const l = new Date(d.toLocaleString('en-US', { timeZone: tz })); const u = new Date(d.toLocaleString('en-US', { timeZone: 'UTC' })); return Math.round((l - u) / 6e4); } catch { return 0; } };
const localTime = (tz, opts = {}) => { try { return new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZone: tz, ...opts }); } catch { return ''; } };
const countryName = (c) => { try { return new Intl.DisplayNames(['en'], { type: 'region' }).of(c); } catch { return c || ''; } };
function workState(tz) {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: tz }));
  const hr = d.getHours(), wd = d.getDay();
  if (wd === 0 || wd === 6) return ['weekend', 'Weekend'];
  if (hr >= 9 && hr < 18) return ['work', 'Working hours'];
  if (hr >= 6 && hr < 22) return ['edge', hr < 9 ? 'Early' : 'Evening'];
  return ['night', 'Night'];
}
let teamTimer = null;
async function openTeam() {
  saveDraft(); closeThread(false); S.current = null; history.replaceState(null, '', '#/team');
  renderSidebar(); setMobileView('main'); railActive('team');
  const root = h('div', { class: 'admin team' }, h('div', { class: 'admin-loading' }, 'Loading…'));
  $('#main').replaceChildren(root);
  let places = [];
  try { places = await api('/api/team/places'); } catch (e) { return toast(e.message); }
  const unit = () => localStorage.getItem('pw-unit') || 'C';
  const draw = () => {
    if (!document.body.contains(root)) { clearInterval(teamTimer); return; }
    const myOff = tzOffset(S.me.tz || Intl.DateTimeFormat().resolvedOptions().timeZone);
    const sorted = [...places].sort((a, b) => tzOffset(a.tz) - tzOffset(b.tz));
    const unitBtn = h('div', { class: 'seg' }, ...['C', 'F'].map((u) => h('button', { class: unit() === u ? 'on' : '', onclick: () => { localStorage.setItem('pw-unit', u); draw(); } }, '°' + u)));
    const cards = sorted.map((p) => {
      const off = tzOffset(p.tz) - myOff;
      const rel = off === 0 ? 'Same time as you' : `${off > 0 ? '+' : '−'}${Math.abs(off / 60) % 1 ? Math.abs(off / 60).toFixed(1) : Math.abs(off / 60)}h from you`;
      const [ws, wl] = workState(p.tz);
      const k = wxKind(p.code, p.day);
      const t = p.temp == null ? null : unit() === 'F' ? Math.round(p.temp * 9 / 5 + 32) : Math.round(p.temp);
      const here = p.people.includes(S.me.id);
      return h('article', { class: 'tcard' + (here ? ' here' : '') + ' ws-' + ws },
        h('header', {}, h('div', {}, h('h3', {}, p.city || countryName(p.country)), h('small', {}, [p.region && p.region !== p.city ? p.region : '', countryName(p.country)].filter(Boolean).join(', '))),
          k ? h('div', { class: 'wx wx-' + k[0], title: k[1] }, svg(WX[k[0]], 22), t != null ? h('b', {}, t + '°') : '') : ''),
        h('div', { class: 'tclock' }, localTime(p.tz)),
        h('div', { class: 'tmeta' }, h('span', { class: 'wsdot' }), wl, h('span', { class: 'sep' }, '·'), new Date().toLocaleDateString([], { weekday: 'short', timeZone: p.tz }), h('span', { class: 'sep' }, '·'), rel),
        h('div', { class: 'tpeople' }, ...p.people.map((id) => { const u = user(id); return h('button', { class: 'tperson', onclick: () => profile(u) }, avatar(u, 'av', '10px'), u.id === S.me.id ? 'You' : u.name.split(' ')[0]); })));
    });
    root.replaceChildren(
      h('header', { class: 'admin-head' }, h('div', {}, h('h1', {}, 'Team time'), h('p', {}, 'Where everyone is right now, from their last sign-in.')), h('div', { class: 'admin-actions' }, unitBtn)),
      cards.length ? h('div', { class: 'tgrid' }, ...cards) : h('div', { class: 'card empty-row' }, 'Locations appear as people sign in.'),
      h('p', { class: 'tnote' }, 'Location comes from each person’s internet connection, so a VPN can show a different city.'));
  };
  draw(); clearInterval(teamTimer); teamTimer = setInterval(draw, 30000);
}

// ------------------------------------------------------------------ team clocks in the top bar (always visible)
let clockPlaces = [];
async function loadClocks() { try { clockPlaces = await api('/api/team/places'); drawClocks(); } catch {} }
function drawClocks() {
  const box = $('#clocks'); if (!box || !S.me) return;
  const unit = localStorage.getItem('pw-unit') || 'C';
  const placeOf = (id) => clockPlaces.find((p) => p.people.includes(id));
  const ch = S.current && S.channels.get(S.current);
  // In a DM: the person (or people) you are talking to. Elsewhere: the rest of the team, never yourself.
  let ids = ch && ch.kind === 'dm' ? dmOthers(ch) : [];
  const chip = (p, label, title) => {
    const k = wxKind(p.code, p.day), [ws] = workState(p.tz);
    const t = p.temp == null ? '' : (unit === 'F' ? Math.round(p.temp * 9 / 5 + 32) : Math.round(p.temp)) + '°';
    return h('button', { class: 'clock ws-' + ws, title, onclick: () => openTeam() },
      h('span', { class: 'wsdot' }), label ? h('span', { class: 'cname' }, label) : '',
      h('b', {}, localTime(p.tz, { hour: 'numeric', minute: '2-digit' }).replace(/\s?([AP])M/i, (m, a) => a.toLowerCase())), h('span', { class: 'ccity' }, p.city || countryName(p.country)),
      k ? h('span', { class: 'cwx wx-' + k[0] }, svg(WX[k[0]], 13), t) : '');
  };
  if (ids.length) {
    box.replaceChildren(...ids.slice(0, 3).map((id) => { const p = placeOf(id), u = user(id), first = u.name.split(' ')[0];
      return p ? chip(p, first, `${u.name} · ${p.city}, ${countryName(p.country)}`)
        : h('span', { class: 'clock off', title: `Time and weather show once ${first} opens Yakyard` }, h('span', { class: 'cname' }, first), h('span', { class: 'ccity' }, 'location shows once they sign in')); }));
    return;
  }
  const list = clockPlaces.map((p) => ({ ...p, people: p.people.filter((id) => id !== S.me.id) })).filter((p) => p.people.length).sort((a, b) => tzOffset(a.tz) - tzOffset(b.tz));
  if (!list.length) { box.replaceChildren(h('span', { class: 'clock off' }, h('span', { class: 'ccity' }, 'Team times show as people sign in'))); return; }
  box.replaceChildren(...list.slice(0, 4).map((p) => {
    const names = p.people.map((id) => user(id).name.split(' ')[0]);
    const label = names.length > 2 ? names.slice(0, 2).join(', ') + ' +' + (names.length - 2) : names.join(', ');
    return chip(p, label, `${p.city}, ${countryName(p.country)} · ${names.join(', ')}`);
  }));
}
addEventListener('hashchange', () => setTimeout(drawClocks, 50));
setInterval(drawClocks, 30000); setInterval(loadClocks, 15 * 60e3);

// ------------------------------------------------------------------ phone: tab bar like Slack mobile, install as an app
function setupTabbar() {
  const bar = $('#tabbar'); if (!bar) return;
  $('#tab-me').replaceChildren(avatar(S.me, '', '10px'));
  bar.onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const t = b.dataset.tab;
    $$('#tabbar button').forEach((x) => x.classList.toggle('on', x === b));
    if (t === 'home' || t === 'dms') { S.view = t; if (location.hash && location.hash !== '#/') location.hash = '#/'; else showList(); }
    if (t === 'activity') openActivity();
    if (t === 'team') openTeam();
    if (t === 'you') meMenu(b);
  };
}
let installEvt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; localStorage.removeItem('pw-installed'); if (S.me) maybeInstallBanner(); });
window.addEventListener('appinstalled', () => { $('.install')?.remove(); localStorage.setItem('pw-installed', '1'); $('.get-app')?.remove(); });
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone;

function shortcuts() {
  const rows = [['Ctrl/⌘ + K', 'Jump to a conversation'], ['Ctrl/⌘ + Shift + H', 'Pop in / pop out (voice call)'], ['Ctrl/⌘ + F', 'Search messages'], ['Alt + ↑ / ↓', 'Previous / next channel'], ['Alt + Shift + ↑ / ↓', 'Previous / next unread'], ['↑ in empty box', 'Edit your last message'], ['Shift + Return', 'New line'], ['Esc', 'Close panel / mark read']];
  modal('Keyboard shortcuts', h('div', {}, ...rows.map(([k, d]) => h('div', { class: 'list-item', style: { cursor: 'default' } }, h('div', { class: 'grow' }, d), h('b', {}, k)))));
}

// ------------------------------------------------------------------ keyboard
document.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); findConversation(); }
  if (mod && e.shiftKey && e.key.toLowerCase() === 'h' && S.current && S.channels.has(S.current)) { e.preventDefault(); H.channel === S.current ? leaveHuddle() : startHuddle(S.current); }
  if (mod && e.key.toLowerCase() === 'f' && !e.shiftKey) { e.preventDefault(); searchMessages(); }
  if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
    e.preventDefault();
    const rows = $$('#side-list .chan[data-id]').filter((r) => !e.shiftKey || r.classList.contains('unread') || r.dataset.id === S.current);
    const i = rows.findIndex((r) => r.dataset.id === S.current);
    const next = rows[(i + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length];
    if (next) go(next.dataset.id);
  }
  if (e.key === 'Escape' && $('#overlay').hidden && !$('.menu, .emoji-pop')) { if (S.thread) closeThread(true); else if (S.current) markRead(S.current); }
});

// ------------------------------------------------------------------ boot
// Files over 90 MB go up in 20 MB pieces (up to 1 GB), with a progress count on the chip.
async function uploadBig(f, chip, p) {
  const PART = 20 * 1024 * 1024;
  const st = await api('/api/upload/start', { method: 'POST', body: { name: f.name, size: f.size, type: f.type } });
  const pct = h('span', { class: 'up-pct' }, '0%'); chip.append(pct);
  const parts = [], total = Math.ceil(f.size / PART);
  try {
    for (let n = 1; n <= total; n++) {
      if (p.cancelled) throw new Error('cancelled');
      const blob = f.slice((n - 1) * PART, Math.min(f.size, n * PART));
      let r, tries = 0;
      for (;;) {
        try {
          const res = await fetch(`/api/upload/part?key=${encodeURIComponent(st.key)}&id=${encodeURIComponent(st.upload_id)}&n=${n}`, { method: 'PUT', body: blob, credentials: 'same-origin' });
          if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Upload failed');
          r = await res.json(); break;
        } catch (e) { if (++tries >= 3) throw e; await new Promise((ok) => setTimeout(ok, 1500 * tries)); }
      }
      parts.push(r); pct.textContent = Math.round((n / total) * 100) + '%';
    }
    return await api('/api/upload/finish', { method: 'POST', body: { key: st.key, upload_id: st.upload_id, parts, name: f.name } });
  } catch (e) {
    api('/api/upload/finish', { method: 'POST', body: { key: st.key, upload_id: st.upload_id, parts: [], cancel: true } }).catch(() => {});
    throw e;
  }
}
async function bootstrap() {
  const b = await api('/api/bootstrap');
  try { localStorage.setItem('pw-boot', JSON.stringify(b)); } catch {}
  return applyBoot(b);
}
// Start from the last copy instantly, then refresh from the server.
function cachedBoot() { try { const b = JSON.parse(localStorage.getItem('pw-boot') || 'null'); return b && b.me && b.channels ? b : null; } catch { return null; } }
function applyBoot(b) {
  S.me = b.me; S.workspace = b.workspace; S.emoji = b.emoji || {}; loadEmojiData()?.then(() => { if (S.current && typeof renderMessages === 'function') try { renderMessages(); } catch {} });
  S.users = new Map(b.users.map((u) => [u.id, u]));
  const prev = S.channels;
  S.channels = new Map(b.channels.map((c) => [c.id, c]));
  for (const [id, c] of S.channels) if (id === S.current) { c.unread = 0; c.mentions = 0; }
  S.sections = b.sections;
  S.saved = new Set(b.saved || []); S.pushKey = b.push_key || ''; S.pushDevices = b.push_devices || 0;
  return prev;
}
async function signOut() {
  try { Object.keys(localStorage).filter((k) => k === 'pw-boot' || k.startsWith('pw-m-')).forEach((k) => localStorage.removeItem(k)); await caches?.delete('yakyard-shell'); } catch {}
  location.href = '/auth/logout';
}
async function start() {
  await null; // let the rest of this file load first
  const cb = cachedBoot();
  let fresh = null;
  if (cb) { applyBoot(cb); fresh = bootstrap().then(() => { drawMe(); renderSidebar(); drawClocks(); }).catch(() => {}); }
  else await bootstrap();
  drawMe();
  $('#me-avatar').onclick = (e) => meMenu(e.currentTarget);
  $('#btn-find').onclick = findConversation;
  $('#btn-search').onclick = () => searchMessages();
  $('#search-label').textContent = 'Search ' + S.workspace.name;
  $('#btn-compose').onclick = composeDM;
  $('#btn-help').onclick = shortcuts;
  $('#ws-menu').onclick = (e) => { const r = e.currentTarget.getBoundingClientRect(); menu([['Create a channel', createChannel], ['Browse channels', browseChannels], ['Create a section', () => newSection()], ['Invite people', invitePeople], ...(isAdmin() ? [['Admin dashboard', () => openAdmin()]] : []), ['—'], ['Your profile', () => profile(S.me)], ['Status and notifications', () => (location.hash = '#/prefs')], ['Moving day: bring my Slack over', () => (location.hash = '#/import')], ['Pause notifications…', () => pauseMenu()], ['Keyboard shortcuts', shortcuts], ['Install the app', installApp], ['—'], ['Sign out', signOut]], r.left, r.bottom + 4); };
  $('#ws-icon').onclick = () => { S.view = 'home'; railActive('home'); renderSidebar(); };
  $('#btn-back').onclick = () => { if (S.thread && $('#app').classList.contains('view-thread')) closeThread(true); else if (history.length > 1 && S.cameFromList) history.back(); else { location.hash = '#/'; } };
  $$('.rail-btn').forEach((b) => (b.onclick = () => {
    const v = b.dataset.view;
    if (v === 'activity') return openActivity();
    if (v === 'team' || v === 'admin') return;
    S.view = v; railActive(v); renderSidebar();
  }));
  $('.rail-spacer').before(h('button', { class: 'rail-btn', 'data-view': 'team', onclick: () => openTeam() },
    h('span', { class: 'rail-ico' }, svg('M10 2a8 8 0 1 1 0 16 8 8 0 0 1 0-16zm-1.6 1.7A6.5 6.5 0 0 0 3.5 9.2h3a12 12 0 0 1 1.9-5.5zm3.2 0a12 12 0 0 1 1.9 5.5h3a6.5 6.5 0 0 0-4.9-5.5zM8 9.2h4A10.5 10.5 0 0 0 10 3.9a10.5 10.5 0 0 0-2 5.3zm-4.5 1.6a6.5 6.5 0 0 0 4.9 5.5 12 12 0 0 1-1.9-5.5h-3zm4.5 0a10.5 10.5 0 0 0 2 5.3 10.5 10.5 0 0 0 2-5.3H8zm5.5 0a12 12 0 0 1-1.9 5.5 6.5 6.5 0 0 0 4.9-5.5h-3z', 20)), h('span', {}, 'Team')));
  if (isAdmin()) {
    const b = h('button', { class: 'rail-btn', 'data-view': 'admin', onclick: () => openAdmin() },
      h('span', { class: 'rail-ico' }, svg('M10 1.8l1.3 1.9 2.3-.4.6 2.2 2.2.6-.4 2.3 1.9 1.3-1.9 1.3.4 2.3-2.2.6-.6 2.2-2.3-.4L10 18.2l-1.3-1.9-2.3.4-.6-2.2-2.2-.6.4-2.3L2.1 10.3 4 9l-.4-2.3 2.2-.6.6-2.2 2.3.4L10 1.8zm0 5.2a3 3 0 1 0 0 6 3 3 0 0 0 0-6z', 20)), h('span', {}, 'Admin'));
    $('.rail-spacer').before(b);
  }
  setupResizers();
  setupTabbar(); loadClocks(); setTimeout(maybeInstallBanner, 2500); startUpdateCheck(); pollImport();
  renderSidebar();
  connect();
  window.addEventListener('hashchange', route);
  if (window.innerWidth <= 760) setupBackGuard();
  if (window.innerWidth <= 760 && (!location.hash || location.hash === '#/')) setMobileView('side'); else route();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).then(() => syncPush()).catch(() => {});
    navigator.serviceWorker.addEventListener('message', (e) => { if (e.data?.type === 'open') { const u = new URL(e.data.url); location.hash = u.hash || '#/'; } });
  }
}
// Drag the sidebar or thread edge to resize; double-click to reset. Saved per browser.
function setupResizers() {
  const app = $('#app');
  const apply = (k, v) => app.style.setProperty(k, v + 'px');
  const sw = +localStorage.getItem('pw-side-w'), tw = +localStorage.getItem('pw-thread-w');
  if (sw) apply('--side-w', sw); if (tw) apply('--thread-w', tw);
  const make = (host, varName, key, min, max, def, fromRight) => {
    const bar = h('div', { class: 'resizer' + (fromRight ? ' left' : ''), title: 'Drag to resize · double-click to reset', role: 'separator', 'aria-orientation': 'vertical' });
    bar.addEventListener('dblclick', () => { app.style.removeProperty(varName); localStorage.removeItem(key); });
    bar.addEventListener('pointerdown', (e) => {
      e.preventDefault(); bar.setPointerCapture(e.pointerId); document.body.classList.add('resizing');
      const startX = e.clientX, startW = host.getBoundingClientRect().width;
      const move = (ev) => { const lim = varName === '--thread-w' ? Math.min(max, innerWidth - $('#sidebar').getBoundingClientRect().right - 440) : max; const w = Math.max(min, Math.min(lim, startW + (fromRight ? startX - ev.clientX : ev.clientX - startX))); apply(varName, Math.round(w)); };
      const up = () => { bar.removeEventListener('pointermove', move); document.body.classList.remove('resizing'); localStorage.setItem(key, Math.round(host.getBoundingClientRect().width)); };
      bar.addEventListener('pointermove', move); bar.addEventListener('pointerup', up, { once: true });
    });
    host.append(bar); return bar;
  };
  make($('#sidebar'), '--side-w', 'pw-side-w', 220, 460, 264, false);
  const rw = +localStorage.getItem('pw-rail-w'); if (rw) apply('--rail-w', rw);
  make($('.rail'), '--rail-w', 'pw-rail-w', 64, 120, 80, false);
  const hideRail = (hide) => { app.classList.toggle('rail-hidden', hide); localStorage.setItem('pw-rail-hidden', hide ? '1' : ''); };
  $('.rail').append(h('button', { class: 'rail-hide', title: 'Hide this bar', onclick: () => hideRail(true) }, svg('M12.7 5.7 8.4 10l4.3 4.3-1.4 1.4L5.6 10l5.7-5.7 1.4 1.4z', 14)));
  $('.side-head').prepend(h('button', { class: 'icon-btn rail-show', title: 'Show the left bar', onclick: () => hideRail(false) }, svg('M7.3 14.3 11.6 10 7.3 5.7l1.4-1.4 5.7 5.7-5.7 5.7-1.4-1.4z', 14)));
  hideRail(localStorage.getItem('pw-rail-hidden') === '1');
  S.threadBar = make($('#thread'), '--thread-w', 'pw-thread-w', 320, 760, 420, true);
}
function railActive(v) {
  $$('.rail-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
  const hs = location.hash;
  const tab = v === 'activity' || hs.startsWith('#/activity') ? 'activity' : v === 'team' || hs.startsWith('#/team') ? 'team' : /^#\/(prefs|import|admin|later|files|threads|search)/.test(hs) ? 'you' : S.view === 'dms' ? 'dms' : 'home';
  $$('#tabbar button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
}

// ------------------------------------------------------------------ emoji
const EMOJI_NAMES = {
  '+1': '👍', thumbsup: '👍', '-1': '👎', thumbsdown: '👎', white_check_mark: '✅', heavy_check_mark: '✔️', eyes: '👀', raised_hands: '🙌', pray: '🙏', clap: '👏',
  joy: '😂', smile: '😄', smiley: '😃', grinning: '😀', laughing: '😆', sweat_smile: '😅', rofl: '🤣', slightly_smiling_face: '🙂', wink: '😉', blush: '😊',
  heart_eyes: '😍', star_struck: '🤩', kissing_heart: '😘', thinking_face: '🤔', face_with_monocle: '🧐', neutral_face: '😐', expressionless: '😑', no_mouth: '😶', roll_eyes: '🙄', smirk: '😏',
  grimacing: '😬', relieved: '😌', pensive: '😔', sleepy: '😪', sleeping: '😴', mask: '😷', face_palm: '🤦', facepalm: '🤦', shrug: '🤷', sunglasses: '😎',
  nerd_face: '🤓', confused: '😕', worried: '😟', open_mouth: '😮', astonished: '😲', flushed: '😳', pleading_face: '🥺', cry: '😢', sob: '😭', scream: '😱',
  rage: '😡', angry: '😠', exploding_head: '🤯', partying_face: '🥳', hugging_face: '🤗', hugs: '🤗', upside_down_face: '🙃', zany_face: '🤪', money_mouth_face: '🤑', saluting_face: '🫡',
  heart: '❤️', orange_heart: '🧡', yellow_heart: '💛', green_heart: '💚', blue_heart: '💙', purple_heart: '💜', black_heart: '🖤', broken_heart: '💔', sparkling_heart: '💖', two_hearts: '💕',
  fire: '🔥', '100': '💯', tada: '🎉', confetti_ball: '🎊', sparkles: '✨', star: '⭐', star2: '🌟', boom: '💥', zap: '⚡', rocket: '🚀',
  ok_hand: '👌', v: '✌️', crossed_fingers: '🤞', muscle: '💪', wave: '👋', point_up: '☝️', point_right: '👉', point_left: '👈', point_down: '👇', handshake: '🤝',
  raising_hand: '🙋', man_raising_hand: '🙋‍♂️', woman_raising_hand: '🙋‍♀️', ok: '🆗', x: '❌', warning: '⚠️', exclamation: '❗', question: '❓', bangbang: '‼️', no_entry: '⛔',
  red_circle: '🔴', large_green_circle: '🟢', large_yellow_circle: '🟡', large_blue_circle: '🔵', white_circle: '⚪', black_circle: '⚫', arrow_right: '➡️', arrow_left: '⬅️', arrow_up: '⬆️', arrow_down: '⬇️',
  memo: '📝', pencil2: '✏️', pushpin: '📌', paperclip: '📎', link: '🔗', calendar: '📅', date: '📅', clock3: '🕒', hourglass: '⌛', bell: '🔔',
  moneybag: '💰', dollar: '💵', credit_card: '💳', chart_with_upwards_trend: '📈', chart_with_downwards_trend: '📉', bar_chart: '📊', package: '📦', truck: '🚚', shopping_bags: '🛍️', gift: '🎁',
  email: '📧', envelope: '✉️', inbox_tray: '📥', outbox_tray: '📤', phone: '📞', iphone: '📱', computer: '💻', camera: '📷', camera_with_flash: '📸', movie_camera: '🎥',
  bulb: '💡', mag: '🔍', lock: '🔒', key: '🔑', hammer_and_wrench: '🛠️', gear: '⚙️', jigsaw: '🧩', puzzle_piece: '🧩', art: '🎨', scissors: '✂️',
  coffee: '☕', wine_glass: '🍷', champagne: '🍾', beers: '🍻', cake: '🍰', birthday: '🎂', pizza: '🍕', doughnut: '🍩', cookie: '🍪', chocolate_bar: '🍫',
  sun_with_face: '🌞', sunny: '☀️', rainbow: '🌈', snowflake: '❄️', christmas_tree: '🎄', jack_o_lantern: '🎃', earth_americas: '🌎', airplane: '✈️', house: '🏠', office: '🏢',
  dog: '🐶', cat: '🐱', unicorn_face: '🦄', see_no_evil: '🙈', hear_no_evil: '🙉', speak_no_evil: '🙊', ghost: '👻', skull: '💀', robot_face: '🤖', alien: '👽',
  trophy: '🏆', medal: '🏅', first_place_medal: '🥇', dart: '🎯', checkered_flag: '🏁', crown: '👑', gem: '💎', money_with_wings: '💸', receipt: '🧾', label: '🏷️',
  heavy_plus_sign: '➕', heavy_minus_sign: '➖', heavy_multiplication_x: '✖️', recycle: '♻️', infinity: '♾️', new: '🆕', free: '🆓', sos: '🆘', soon: '🔜', top: '🔝',
  slightly_frowning_face: '🙁', disappointed: '😞', weary: '😩', tired_face: '😫', yawning_face: '🥱', melting_face: '🫠', face_holding_back_tears: '🥹', saluting: '🫡', dotted_line_face: '🫥', heart_hands: '🫶',
};


// ------------------------------------------------------------------ huddles (mesh WebRTC, signaling through the hub)
// UX patterns taken from OpenSlaq (MIT): Start / Join / In huddle states, one huddle at a time, huddle card in the channel.
const HI = {
  headphones: 'M10 2a7 7 0 0 1 7 7v5.5a2.5 2.5 0 0 1-2.5 2.5H13a1 1 0 0 1-1-1v-4.5a1 1 0 0 1 1-1h2.5V9a5.5 5.5 0 0 0-11 0v1.5H7a1 1 0 0 1 1 1V16a1 1 0 0 1-1 1H5.5A2.5 2.5 0 0 1 3 14.5V9a7 7 0 0 1 7-7z',
  mic: 'M10 2a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3zm-5 8a.8.8 0 0 1 .8.8 4.2 4.2 0 0 0 8.4 0 .8.8 0 1 1 1.6 0 5.8 5.8 0 0 1-5 5.7V18a.8.8 0 1 1-1.6 0v-1.5a5.8 5.8 0 0 1-5-5.7A.8.8 0 0 1 5 10z',
  micOff: 'M3.2 2.2a.8.8 0 0 1 1.1 0l12.5 12.5a.8.8 0 1 1-1.1 1.1l-2.4-2.4a5.8 5.8 0 0 1-2.5 1V16.5V18a.8.8 0 1 1-1.6 0v-1.5a5.8 5.8 0 0 1-5-5.7.8.8 0 1 1 1.6 0 4.2 4.2 0 0 0 6.3 3.6l-1.2-1.2A3 3 0 0 1 7 10V8.1L3.2 3.3a.8.8 0 0 1 0-1.1zM10 2a3 3 0 0 1 3 3v4.9L7.3 4.2A3 3 0 0 1 10 2z',
  cam: 'M3.5 5h8A1.5 1.5 0 0 1 13 6.5v1.3l3.2-2a.8.8 0 0 1 1.3.7v7a.8.8 0 0 1-1.3.7l-3.2-2v1.3A1.5 1.5 0 0 1 11.5 15h-8A1.5 1.5 0 0 1 2 13.5v-7A1.5 1.5 0 0 1 3.5 5z',
  screen: 'M3 3.5h14A1.5 1.5 0 0 1 18.5 5v8a1.5 1.5 0 0 1-1.5 1.5h-6.2v1.7H13a.8.8 0 1 1 0 1.6H7a.8.8 0 1 1 0-1.6h2.2v-1.7H3A1.5 1.5 0 0 1 1.5 13V5A1.5 1.5 0 0 1 3 3.5zm7 2.7-2.6 2.6a.6.6 0 0 0 .4 1h1.6v2.4h1.2V9.8h1.6a.6.6 0 0 0 .4-1L10 6.2z',
  leave: 'M10 6c3.6 0 6.6 1.1 8 2.6.5.5.6 1.2.3 1.8l-.8 1.5a1 1 0 0 1-1.2.5l-2.5-.8a1 1 0 0 1-.7-.9V9.4a10.5 10.5 0 0 0-6.2 0v1.3a1 1 0 0 1-.7.9l-2.5.8a1 1 0 0 1-1.2-.5l-.8-1.5a1.5 1.5 0 0 1 .3-1.8C3.4 7.1 6.4 6 10 6z',
  expand: 'M3 3h5v1.6H5.7l3 3-1.1 1.1-3-3V8H3V3zm14 14h-5v-1.6h2.3l-3-3 1.1-1.1 3 3V12H17v5z',
};
const H = { channel: null, sid: null, local: null, video: null, videoKind: null, peers: new Map(), muted: false, ice: null, since: 0, expanded: false, dismissed: new Set() };
S.huddles = {};

const inHuddleHere = (cid) => H.channel === cid;
const huddleOf = (cid) => S.huddles[cid] || [];
function sendWS(o) { if (ws?.readyState === 1) ws.send(JSON.stringify(o)); }

function tone(up) {
  try {
    const ac = tone.ac ||= new AudioContext();
    const o = ac.createOscillator(), g = ac.createGain();
    o.frequency.setValueAtTime(up ? 520 : 660, ac.currentTime); o.frequency.linearRampToValueAtTime(up ? 780 : 440, ac.currentTime + 0.18);
    g.gain.setValueAtTime(0.08, ac.currentTime); g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.3);
    o.connect(g).connect(ac.destination); o.start(); o.stop(ac.currentTime + 0.32);
  } catch {}
}

async function startHuddle(cid) {
  if (H.channel === cid) { H.panel = true; return renderHuddleUI(); }
  H.panel = true;
  if (H.channel) {
    const ch = S.channels.get(H.channel);
    return modal('Already in a pop-in', h('p', {}, `Leave the pop-in in ${ch ? (ch.kind === 'dm' ? chanLabel(ch) : '#' + ch.name) : 'another conversation'} and pop in here?`),
      [['Cancel'], ['Switch', async () => { leaveHuddle(true); await startHuddle(cid); }]]);
  }
  try {
    H.local = await navigator.mediaDevices.getUserMedia({ audio: micConstraints() });
  } catch (e) {
    return modal('Microphone blocked', h('p', {}, matchMedia('(pointer: coarse)').matches ? 'Yakyard needs the microphone. On Android: press and hold the Yakyard icon, App info, Permissions, Microphone, Allow. On iPhone: Settings, Safari (or Yakyard), Microphone. Then try again.' : 'Allow the microphone for this site (click the lock icon next to the address), then try again.'), [['OK']]);
  }
  if (!H.ice) H.ice = await api('/api/ice').catch(() => [{ urls: 'stun:stun.cloudflare.com:3478' }]);
  H.channel = cid; H.muted = false; H.since = Date.now(); H.expanded = false;
  watchLevel('me', H.local);
  sendWS({ type: 'huddle_join', channel_id: cid });
  tone(true);
  renderHuddleUI();
}

function leaveHuddle(silent) {
  if (!H.channel) return;
  H.panel = false; H.expanded = false; H.ringing = {};
  sendWS({ type: 'huddle_leave' });
  for (const sid of [...H.peers.keys()]) dropPeer(sid);
  H.local?.getTracks().forEach((t) => t.stop());
  H.video?.stop();
  H.local = null; H.video = null; H.videoKind = null; H.channel = null; H.sid = null;
  levels.clear();
  if (!silent) tone(false);
  renderHuddleUI();
}
window.addEventListener('pagehide', () => { if (H.channel) sendWS({ type: 'huddle_leave' }); });

function pushMedia() { sendWS({ type: 'huddle_media', muted: H.muted, video: H.videoKind === 'cam', screen: H.videoKind === 'screen' }); }
function toggleMute() {
  H.muted = !H.muted;
  H.local?.getAudioTracks().forEach((t) => (t.enabled = !H.muted));
  pushMedia(); renderHuddleUI();
}
async function toggleVideo(kind) {
  if (H.videoKind === kind) return setVideo(null, null);
  try {
    const stream = kind === 'screen'
      ? await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 15 }, audio: false })
      : await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 360, frameRate: 24, ...(localStorage.getItem('pw-cam') ? { deviceId: { ideal: localStorage.getItem('pw-cam') } } : {}) } });
    const track = stream.getVideoTracks()[0];
    track.onended = () => { if (H.video === track) setVideo(null, null); };
    setVideo(track, kind);
    if (kind === 'screen') H.expanded = true;
  } catch { if (kind === 'cam') toast('Camera blocked or not available'); }
}
function setVideo(track, kind) {
  if (H.video && H.video !== track) H.video.stop();
  H.video = track; H.videoKind = kind;
  for (const p of H.peers.values()) {
    if (p.videoSender) p.videoSender.replaceTrack(track);
    else if (track) p.videoSender = p.pc.addTrack(track, H.local);
  }
  pushMedia(); renderHuddleUI();
}

function createPeer(sid, userId) {
  const pc = new RTCPeerConnection({ iceServers: H.ice || [] });
  const p = { pc, userId, polite: H.sid < sid, makingOffer: false, ignoreOffer: false, videoSender: null, stream: new MediaStream(), audio: new Audio() };
  p.audio.autoplay = true;
  H.peers.set(sid, p);
  H.local.getTracks().forEach((t) => pc.addTrack(t, H.local));
  if (H.video) p.videoSender = pc.addTrack(H.video, H.local);
  pc.onnegotiationneeded = async () => {
    try { p.makingOffer = true; await pc.setLocalDescription(); sendWS({ type: 'huddle_signal', to: sid, data: { description: pc.localDescription } }); }
    catch (e) { console.warn(e); } finally { p.makingOffer = false; }
  };
  pc.onicecandidate = ({ candidate }) => { if (candidate) sendWS({ type: 'huddle_signal', to: sid, data: { candidate } }); };
  pc.ontrack = ({ track }) => {
    p.stream.addTrack(track);
    if (track.kind === 'audio') { p.audio.srcObject = new MediaStream([track]); applySpeaker(p.audio); p.audio.play().catch(() => {}); watchLevel(sid, p.audio.srcObject); }
    if (track.kind === 'video') { p.videoTrack = track; renderHuddleUI(); }
    track.onunmute = () => renderHuddleUI();
  };
  pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed') pc.restartIce(); renderHuddleUI(); };
  pc.oniceconnectionstatechange = () => renderHuddleUI();
  return p;
}
function dropPeer(sid) {
  const p = H.peers.get(sid); if (!p) return;
  try { p.pc.close(); } catch {}
  p.audio.srcObject = null; levels.delete(sid);
  H.peers.delete(sid);
}
async function onSignal(ev) {
  if (!H.channel) return;
  let p = H.peers.get(ev.from) || createPeer(ev.from, ev.user_id);
  const { description, candidate } = ev.data || {};
  try {
    if (description) {
      const collision = description.type === 'offer' && (p.makingOffer || p.pc.signalingState !== 'stable');
      p.ignoreOffer = !p.polite && collision;
      if (p.ignoreOffer) return;
      await p.pc.setRemoteDescription(description);
      if (description.type === 'offer') {
        await p.pc.setLocalDescription();
        sendWS({ type: 'huddle_signal', to: ev.from, data: { description: p.pc.localDescription } });
      }
    } else if (candidate) {
      try { await p.pc.addIceCandidate(candidate); } catch (e) { if (!p.ignoreOffer) throw e; }
    }
  } catch (e) { console.warn('huddle signal', e); }
}

// who is speaking
const levels = new Map();
function watchLevel(key, stream) {
  try {
    const ac = watchLevel.ac ||= new AudioContext();
    if (ac.state === 'suspended') ac.resume();
    const an = ac.createAnalyser(); an.fftSize = 512;
    ac.createMediaStreamSource(stream).connect(an);
    levels.set(key, { an, buf: new Uint8Array(an.fftSize) });
  } catch {}
}
setInterval(() => {
  if (!H.channel) return;
  for (const [key, l] of levels) {
    l.an.getByteTimeDomainData(l.buf);
    let sum = 0; for (const v of l.buf) sum += (v - 128) ** 2;
    const loud = Math.sqrt(sum / l.buf.length) > 6 && !(key === 'me' && H.muted);
    $$(`[data-hsid="${key}"]`).forEach((el) => el.classList.toggle('speaking', loud));
  }
}, 150);

// server events
function onHuddleEvent(ev) {
  if (ev.type === 'huddle_invited') { invitedCard(ev); return true; }
  if (ev.type === 'huddle_mute_req') { if (H.channel && !H.muted) toggleMute(); toast(`${user(ev.from).name.split(' ')[0]} muted you. Tap Unmute to talk.`); return true; }
  if (ev.type === 'huddles') {
    const before = S.huddles;
    S.huddles = ev.huddles || {};
    // A huddle just started in a DM with me: ring, like Slack.
    for (const [cid, list] of Object.entries(S.huddles)) {
      const ch = S.channels.get(cid);
      if (!ch || ch.kind !== 'dm' || H.channel === cid || before[cid]?.length || H.dismissed.has(cid + list[0]?.since)) continue;
      if (list.some((x) => x.user_id !== S.me.id)) incoming(ch, list);
    }
    $$('.incoming').forEach((el) => { if (!huddleOf(el.dataset.cid).length || H.channel === el.dataset.cid) el.remove(); });
    // peers that left
    if (H.channel) {
      const live = new Set(huddleOf(H.channel).map((x) => x.sid));
      for (const sid of [...H.peers.keys()]) if (!live.has(sid)) dropPeer(sid);
    }
    renderSidebar(); renderHuddleUI();
    return true;
  }
  if (ev.type === 'huddle_joined') {
    H.sid = ev.sid;
    for (const peer of ev.peers) createPeer(peer.sid, peer.user_id);
    return true;
  }
  if (ev.type === 'huddle_signal') { onSignal(ev); return true; }
  return false;
}
function incoming(ch, list) {
  const u = user(list.find((x) => x.user_id !== S.me.id).user_id);
  const key = ch.id + list[0].since;
  const card = h('div', { class: 'incoming', 'data-cid': ch.id },
    avatar(u, 'av', '16px'),
    h('div', { class: 'grow' }, h('b', {}, u.name), h('div', {}, 'popped in and wants to talk')),
    h('button', { class: 'btn', onclick: () => { H.dismissed.add(key); card.remove(); } }, 'Not now'),
    h('button', { class: 'btn join', onclick: () => { card.remove(); go(ch.id); startHuddle(ch.id); } }, svg(HI.headphones, 14), 'Pop in'));
  document.body.append(card);
  tone(true); setTimeout(() => tone(true), 450);
  if ('Notification' in window && Notification.permission === 'granted' && !document.hasFocus()) {
    const n = new Notification(`${u.name} popped in`, { body: 'Click to pop in and talk', tag: key, icon: u.avatar || '/icon.svg' });
    n.onclick = () => { window.focus(); go(ch.id); startHuddle(ch.id); n.close(); };
  }
}

// UI
function huddleLabel(cid) { const ch = S.channels.get(cid); if (!ch && S.guestCall?.id === cid) return S.guestCall.label; return ch ? (ch.kind === 'dm' ? chanLabel(ch) : '# ' + ch.name) : 'Pop-in'; }
const wave = () => h('span', { class: 'wave', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'), h('i'));
function huddleButton(cid) {
  const list = huddleOf(cid);
  if (inHuddleHere(cid)) return h('button', { class: 'huddle-btn on', id: 'huddle-btn', title: 'Pop out (Ctrl+Shift+H)', onclick: () => leaveHuddle() },
    wave(), h('span', { class: 'hb-live-time', id: 'hb-head-time' }, '0:00'), h('span', { class: 'hb-sep' }), 'Pop out');
  if (list.length) {
    const people = [...new Set(list.map((x) => x.user_id))];
    return h('button', { class: 'huddle-btn live', id: 'huddle-btn', title: 'Join the pop-in (Ctrl+Shift+H)', onclick: () => startHuddle(cid) },
      wave(), h('span', { class: 'hb-faces' }, ...people.slice(0, 3).map((u) => avatar(user(u), '', '9px'))), 'Pop in too');
  }
  return h('button', { class: 'huddle-btn', id: 'huddle-btn', title: 'Start a quick voice call here (Ctrl+Shift+H)', onclick: () => startHuddle(cid) }, svg(HI.headphones, 16), 'Pop in');
}
function fmtDur(ms) { const m = Math.max(1, Math.round(ms / 60000)); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`; }
function renderHuddleUI() {
  // header button
  const btn = $('#huddle-btn');
  if (btn && S.current) btn.replaceWith(huddleButton(S.current));
  // bar at the bottom of the sidebar
  let bar = $('#huddle-bar');
  if (!H.channel) { bar?.remove(); $('#huddle-stage')?.remove(); return; }
  if (!bar) { bar = h('div', { id: 'huddle-bar', class: 'huddle-bar' }); $('#sidebar').append(bar); }
  const list = huddleOf(H.channel);
  const people = list.length ? list : [{ sid: 'me', user_id: S.me.id, muted: H.muted }];
  const ctrl = (icon, title, on, fn, cls = '') => h('button', { class: `hb-btn ${on ? 'on' : ''} ${cls}`, title, onclick: fn }, svg(icon, 18));
  bar.replaceChildren(
    h('div', { class: 'hb-top' }, wave(), h('button', { class: 'hb-title', onclick: () => go(H.channel) }, huddleLabel(H.channel)), h('span', { class: 'hb-time', id: 'hb-time' }, '')),
    (() => { const st = callStatus(list); return h('button', { class: 'hb-status s-' + st.kind, onclick: () => { H.panel = true; renderHuddleUI(); } }, h('i'), st.text); })(),
    h('div', { class: 'hb-people' }, ...people.map((x) => {
      const me = x.sid === H.sid || x.sid === 'me';
      const av = avatar(user(x.user_id), 'hb-av', '13px');
      av.dataset.hsid = me ? 'me' : x.sid; av.title = user(x.user_id).name + (x.muted ? ' (muted)' : '');
      if (x.muted) av.append(h('span', { class: 'hb-muted' }, svg(HI.micOff, 10)));
      return av;
    })),
    h('div', { class: 'hb-ctrls' },
      ctrl(H.muted ? HI.micOff : HI.mic, H.muted ? 'Unmute' : 'Mute', !H.muted, toggleMute, H.muted ? 'off' : ''),
      ctrl(HI.cam, 'Camera', H.videoKind === 'cam', () => toggleVideo('cam')),
      navigator.mediaDevices?.getDisplayMedia ? ctrl(HI.screen, 'Share screen', H.videoKind === 'screen', () => toggleVideo('screen')) : '',
      ctrl(HI.expand, 'Open pop-in window', H.expanded, () => { H.expanded = !H.expanded; renderHuddleUI(); }),
      ctrl(HI.leave, 'Pop out', false, () => leaveHuddle(), 'leave')));
  tickHuddle();
  renderStage(list);
}
function tickHuddle() {
  if (!H.since) return;
  const s = Math.floor((Date.now() - H.since) / 1000), txt = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  for (const t of $$('#hb-time, #hb-head-time, #hb-head-time2')) t.textContent = txt;
}
setInterval(tickHuddle, 1000);

function renderStage(list) {
  const anyVideo = H.video || list.some((x) => (x.video || x.screen) && x.sid !== H.sid);
  let stage = $('#huddle-stage');
  if (!H.expanded && !H.panel && !anyVideo) { stage?.remove(); return; }
  const st = callStatus(list);
  if (!stage) { stage = h('div', { id: 'huddle-stage', class: 'huddle-stage' }); document.body.append(stage); }
  stage.classList.toggle('big', H.expanded);
  const tiles = [];
  for (const x of list) {
    const me = x.sid === H.sid;
    const u = user(x.user_id);
    const tile = h('div', { class: 'tile', 'data-hsid': me ? 'me' : x.sid });
    let track = null;
    if (me && H.video) track = H.video;
    else if (!me && (x.video || x.screen)) track = H.peers.get(x.sid)?.videoTrack;
    if (track) {
      const v = h('video', { autoplay: true, playsinline: true, muted: true });
      v.srcObject = new MediaStream([track]);
      if (me && H.videoKind === 'cam') v.style.transform = 'scaleX(-1)';
      if (x.screen || (me && H.videoKind === 'screen')) { tile.classList.add('screen'); v.style.objectFit = 'contain'; }
      tile.append(v);
    } else tile.append(avatar(u, 'tile-av', '28px'));
    const ps = me ? { kind: 'ok', text: H.muted ? 'You · muted' : 'You' } : peerStatus(x.sid);
    tile.classList.add('t-' + ps.kind);
    if (!me) { tile.classList.add('clickable'); tile.title = 'Options'; tile.onclick = (e) => tileMenu(x, e.currentTarget); if (H.peers.get(x.sid)?.audio?.muted) tile.append(h('span', { class: 'tile-flag' }, 'Muted for you')); }
    tile.append(h('span', { class: 'tile-name' }, x.muted ? svg(HI.micOff, 11) : '', me ? 'You' : u.name.split(' ')[0], x.screen ? ' · screen' : ''),
      me ? '' : h('span', { class: 'tile-state s-' + ps.kind }, h('i'), ps.text));
    tiles.push(tile);
  }
  // people who could join but aren't here yet
  const ch = S.channels.get(H.channel);
  const here = new Set(list.map((x) => x.user_id));
  const rung = Object.entries(H.ringing || {}).filter(([u, t]) => Date.now() - t < 60e3).map(([u]) => u);
  const waiting = [...new Set([...(ch?.kind === 'dm' ? dmOthers(ch) : []), ...rung])].filter((u) => !here.has(u));
  for (const uid of waiting.slice(0, 3)) {
    const u = user(uid);
    tiles.push(h('div', { class: 'tile t-wait' }, avatar(u, 'tile-av', '28px'), h('span', { class: 'tile-name' }, u.name.split(' ')[0]), h('span', { class: 'tile-state s-wait' }, h('i'), 'Ringing… not here yet')));
  }
  stage.replaceChildren(
    h('div', { class: 'stage-head' }, h('div', {}, h('b', {}, 'Pop-in · ' + huddleLabel(H.channel)), h('div', { class: 'stage-status s-' + st.kind }, h('i'), st.text, h('span', { class: 'stage-time', id: 'hb-head-time2' }, ''))), h('button', { class: 'icon-btn', title: 'Minimize', onclick: () => { H.expanded = false; H.panel = false; if (!H.video) stage.remove(); else renderHuddleUI(); } }, svg(I.close, 16))),
    h('div', { class: 'stage-grid n' + Math.min(tiles.length, 4) }, ...tiles),
    h('div', { class: 'stage-ctrls' },
      h('button', { class: 'sc-btn' + (H.muted ? ' off' : ''), onclick: toggleMute }, svg(H.muted ? HI.micOff : HI.mic, 18), H.muted ? 'Unmute' : 'Mute'),
      h('button', { class: 'sc-btn' + (H.videoKind === 'cam' ? ' on' : ''), onclick: () => toggleVideo('cam') }, svg(HI.cam, 18), 'Camera'),
      navigator.mediaDevices?.getDisplayMedia ? h('button', { class: 'sc-btn' + (H.videoKind === 'screen' ? ' on' : ''), onclick: () => toggleVideo('screen') }, svg(HI.screen, 18), 'Share') : '',
      h('button', { class: 'sc-btn', title: 'Add someone to this pop-in', onclick: (e) => pickPerson(e.currentTarget, (u) => { sendWS({ type: 'huddle_invite', user_id: u.id }); toast(`Ringing ${u.name.split(' ')[0]}…`); H.ringing = { ...(H.ringing || {}), [u.id]: Date.now() }; renderHuddleUI(); }) }, svg('M8 3a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7zm0 1.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM2 16.5c0-3 2.7-5 6-5 1 0 2 .2 2.8.5l-.6 1.4A6 6 0 0 0 8 13c-2.6 0-4.4 1.4-4.5 3h5v1.5H2v-1zM15 11h1.5v2.5H19V15h-2.5v2.5H15V15h-2.5v-1.5H15V11z', 18), 'Add'),
      h('button', { class: 'sc-btn', title: 'Microphone, speaker and camera', onclick: (e) => soundMenu(e.currentTarget) }, svg('M10 6.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7zm0 1.6a1.9 1.9 0 1 0 0 3.8 1.9 1.9 0 0 0 0-3.8zM8.9 1.5h2.2l.4 2.1 1.4.6 1.8-1.2 1.6 1.6-1.2 1.8.6 1.4 2.1.4v2.2l-2.1.4-.6 1.4 1.2 1.8-1.6 1.6-1.8-1.2-1.4.6-.4 2.1H8.9l-.4-2.1-1.4-.6-1.8 1.2-1.6-1.6 1.2-1.8-.6-1.4-2.1-.4V8.9l2.1-.4.6-1.4-1.2-1.8 1.6-1.6 1.8 1.2 1.4-.6.4-2.1z', 18), 'Sound'),
      h('button', { class: 'sc-btn leave', onclick: () => leaveHuddle() }, svg(HI.leave, 18), 'Pop out')));
}
// What is actually going on in the call, in plain words.
function peerStatus(sid) {
  const pc = H.peers.get(sid)?.pc;
  const st = pc ? pc.connectionState : 'new';
  if (st === 'connected') return { kind: 'ok', text: 'Connected' };
  if (st === 'failed') return { kind: 'bad', text: "Can't connect" };
  if (st === 'disconnected') return { kind: 'warn', text: 'Reconnecting…' };
  return { kind: 'warn', text: 'Connecting…' };
}
function callStatus(list) {
  const others = list.filter((x) => x.sid !== H.sid);
  const ch = S.channels.get(H.channel);
  if (!others.length) {
    if (ch?.kind === 'dm') return { kind: 'wait', text: `Ringing ${dmOthers(ch).map((u) => user(u).name.split(' ')[0]).join(', ')}… nobody else here yet` };
    return { kind: 'wait', text: 'Only you so far. Others in the channel can pop in.' };
  }
  const states = others.map((x) => peerStatus(x.sid));
  const ok = others.filter((x, i) => states[i].kind === 'ok').map((x) => user(x.user_id).name.split(' ')[0]);
  if (ok.length) return { kind: 'ok', text: `Connected with ${ok.join(', ')}` };
  if (states.every((x) => x.kind === 'bad')) return { kind: 'bad', text: "Can't connect. Check your internet." };
  return { kind: 'warn', text: `Connecting to ${others.map((x) => user(x.user_id).name.split(' ')[0]).join(', ')}…` };
}
setInterval(() => { if (H.channel) renderHuddleUI(); }, 3000);

// huddle card inside the channel
function huddleCardEl(m) {
  let d = {}; try { d = JSON.parse(m.text); } catch {}
  const live = !d.end;
  const list = huddleOf(m.channel_id);
  const people = live && list.length ? [...new Set(list.map((x) => x.user_id))] : d.users || [];
  return h('div', { class: 'huddle-card' + (live ? ' live' : '') },
    h('span', { class: 'hc-ico' }, svg(HI.headphones, 18)),
    h('div', { class: 'grow' },
      h('b', {}, live ? 'Pop-in happening now' : 'Pop-in ended'),
      h('div', { class: 'hc-sub' }, live ? `Started ${timeStr(d.start)}` : `${fmtDur(d.end - d.start)} · ${people.map((u) => user(u).name.split(' ')[0]).join(', ')}`)),
    h('span', { class: 'hc-avs' }, ...people.slice(0, 5).map((u) => avatar(user(u), '', '10px'))),
    live && !inHuddleHere(m.channel_id) && S.channels.has(m.channel_id) ? h('button', { class: 'btn join', onclick: () => startHuddle(m.channel_id) }, 'Pop in') : '');
}

start().catch((e) => { console.error(e); if (e.message !== 'signed out') toast('Could not load. Refresh the page.'); });

if (location.hostname === '127.0.0.1') window.__H = H;

// ================================================================== Nov 20: later, pins, status, notifications, install, updates
const DAY = 864e5;
function statusOf(u) {
  if (!u || !(u.status_emoji || u.status_text)) return null;
  if (u.status_until && u.status_until < Date.now()) return null;
  return { emoji: u.status_emoji, text: u.status_text };
}
function hhmmIn(tz) { try { return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: tz || undefined }).format(new Date()); } catch { return ''; } }
function inDnd(u) {
  if (!u) return false;
  if (u.dnd_until && u.dnd_until > Date.now()) return true;
  if (!u.dnd_start || !u.dnd_end || u.dnd_start === u.dnd_end) return false;
  const t = hhmmIn(u.tz);
  return u.dnd_start < u.dnd_end ? t >= u.dnd_start && t < u.dnd_end : t >= u.dnd_start || t < u.dnd_end;
}
function at9(daysAhead, weekday) {
  const d = new Date(); d.setSeconds(0, 0);
  if (weekday != null) { const add = ((weekday - d.getDay() + 7) % 7) || 7; d.setDate(d.getDate() + add); }
  else d.setDate(d.getDate() + daysAhead);
  d.setHours(9, 0); return d.getTime();
}
function whenStr(ts) {
  const d = new Date(ts), today = new Date();
  const t = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === today.toDateString()) return `today at ${t}`;
  if (d.toDateString() === new Date(Date.now() + DAY).toDateString()) return `tomorrow at ${t}`;
  return `${d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })} at ${t}`;
}
function anchorXY(anchor) { const r = anchor?.getBoundingClientRect?.() || anchor; return r ? [r.left - 120, r.bottom + 4] : [innerWidth / 2 - 120, innerHeight / 3]; }
function pickDateTime(title, onPick) {
  const d = new Date(Date.now() + 3600e3); d.setMinutes(0, 0, 0);
  const pad2 = (n) => String(n).padStart(2, '0');
  const input = h('input', { class: 'input', type: 'datetime-local', value: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:00` });
  modal(title, h('div', {}, input), [['Cancel'], ['Save', async () => { const t = new Date(input.value).getTime(); if (!t || t < Date.now()) throw new Error('Pick a time in the future'); await onPick(t); }]]);
}
function scheduleMenu(anchor, onPick) {
  const [x, y] = anchorXY(anchor);
  menu([['Tomorrow at 9:00 AM', () => onPick(at9(1))], ['Monday at 9:00 AM', () => onPick(at9(0, 1))], ['—'], ['Custom time…', () => pickDateTime('Schedule message', (t) => onPick(t))]], x, y - 150);
}
async function toggleSave(m) {
  try {
    const r = await api(`/api/messages/${m.id}/save`, { method: 'POST', body: {} });
    r.saved ? S.saved.add(m.id) : S.saved.delete(m.id);
    toast(r.saved ? 'Saved for later' : 'Removed from Later');
    renderSidebar(); rerender();
  } catch (e) { toast(e.message); }
}
async function togglePin(m) {
  try { applyMessage(await api(`/api/messages/${m.id}/pin`, { method: 'POST', body: {} })); toast(m.pinned_by ? 'Unpinned' : 'Pinned to the channel'); refreshPins(); } catch (e) { toast(e.message); }
}
function remindMenu(m, anchor) {
  const set = async (t) => { await api('/api/reminders', { method: 'POST', body: { message_id: m.id, text: (m.text || '').replace(/<[^>]+>/g, '').slice(0, 140), due_at: t } }); toast(`I'll remind you ${whenStr(t)}`); };
  const [x, y] = anchorXY(anchor);
  menu([['In 20 minutes', () => set(Date.now() + 20 * 60e3)], ['In 1 hour', () => set(Date.now() + 3600e3)], ['In 3 hours', () => set(Date.now() + 3 * 3600e3)],
    ['Tomorrow at 9:00 AM', () => set(at9(1))], ['Next week (Mon 9:00 AM)', () => set(at9(0, 1))], ['—'], ['Custom…', () => pickDateTime('Remind me', set)]], x, y);
}
function pauseMenu(anchor) {
  const set = async (until) => { await api('/api/me', { method: 'PATCH', body: { dnd_until: until } }); S.me.dnd_until = until; S.users.set(S.me.id, { ...S.users.get(S.me.id), dnd_until: until }); renderSidebar(); toast(until ? `Notifications paused until ${whenStr(until)}` : 'Notifications back on'); };
  const items = [['30 minutes', () => set(Date.now() + 30 * 60e3)], ['1 hour', () => set(Date.now() + 3600e3)], ['2 hours', () => set(Date.now() + 2 * 3600e3)], ['Until tomorrow 9:00 AM', () => set(at9(1))], ['Until next week', () => set(at9(0, 1))]];
  if (S.me.dnd_until > Date.now()) items.unshift(['Resume notifications', () => set(0)], ['—']);
  const r = (anchor || $('#ws-menu')).getBoundingClientRect(); menu(items, r.left, r.bottom + 4);
}
function youMenu(b) {
  const r = b.getBoundingClientRect();
  menu([['Your profile', () => profile(S.me)], ['Status and notifications', () => (location.hash = '#/prefs')], ['Pause notifications…', () => pauseMenu(b)], ['—'],
    ['Later', () => openLater()], ['Files', () => openFiles()], ['Install the app', installApp], ['—'], ['Sign out', signOut]], r.left - 160, r.top - 330);
}

// ---------- pinned messages in the channel header
function pinsButton(ch) {
  const b = h('button', { class: 'pins-btn', id: 'pins-btn', title: 'Pinned messages', hidden: true, onclick: (e) => showPins(ch, e.currentTarget) }, svg(I.pin, 14), h('span', {}, ''));
  setTimeout(refreshPins);
  return b;
}
async function refreshPins() {
  const id = S.current, b = $('#pins-btn'); if (!b || !id) return;
  try { const list = await api(`/api/channels/${id}/pins`); S.pins = { id, list }; if (S.current !== id) return; b.hidden = !list.length; b.lastChild.textContent = list.length; } catch {}
}
function showPins(ch, anchor) {
  closePopups();
  const list = S.pins?.id === ch.id ? S.pins.list : [];
  const pop = h('div', { class: 'menu pins-pop' }, h('div', { class: 'pp-head' }, `Pinned in ${ch.kind === 'dm' ? chanLabel(ch) : '#' + ch.name}`),
    ...list.map((m) => { const it = feedItem(m); it.addEventListener('click', closePopups); return it; }));
  document.body.append(pop);
  const r = anchor.getBoundingClientRect();
  pop.style.left = Math.max(8, Math.min(r.right - 380, innerWidth - 390)) + 'px'; pop.style.top = r.bottom + 6 + 'px';
}

// ---------- channel details as a side panel
async function detailsPanel(ch, tab = 'about') {
  saveDraft(); S.thread = null;
  const pane = $('#thread'); pane.hidden = false; $('#app').classList.add('has-thread');
  if (window.innerWidth <= 760) setMobileView('thread');
  const close = () => { closeThread(false); setMobileView('main'); };
  const body = h('div', { class: 'details-body' }, h('div', { class: 'admin-loading' }, 'Loading…'));
  const canManage = ['owner', 'admin'].includes(S.me.role) || ch.created_by === S.me.id;
  const tabs = h('div', { class: 'seg' }, ...[['about', 'About'], ['members', 'Members'], ['pins', 'Pinned'], ...(canManage ? [['settings', 'Settings']] : [])].map(([k, l]) => h('button', { class: tab === k ? 'on' : '', onclick: () => detailsPanel(ch, k) }, l)));
  pane.replaceChildren(h('div', { class: 'thread-head' }, h('button', { class: 'icon-btn th-back', title: 'Back', onclick: close }, svg('M11.7 4.3a1 1 0 0 1 0 1.4L7.4 10l4.3 4.3a1 1 0 0 1-1.4 1.4l-5-5a1 1 0 0 1 0-1.4l5-5a1 1 0 0 1 1.4 0z', 18)),
    h('h3', {}, (ch.private ? '' : '# ') + ch.name), h('button', { class: 'icon-btn', title: 'Close', onclick: close }, svg(I.close, 18))), h('div', { class: 'details-tabs' }, tabs), body);
  const ids = await api(`/api/channels/${ch.id}/members`).catch(() => []);
  if (tab === 'about') {
    const topic = h('textarea', { class: 'input', rows: 3, placeholder: 'Add a description' }); topic.value = ch.topic || '';
    const c = S.channels.get(ch.id) || ch;
    body.replaceChildren(
      h('label', { class: 'field' }, h('span', {}, 'Description'), topic),
      h('button', { class: 'btn sm', onclick: async () => { await api(`/api/channels/${ch.id}`, { method: 'PATCH', body: { topic: topic.value } }); c.topic = topic.value; toast('Saved'); } }, 'Save description'),
      h('div', { class: 'd-rows' },
        h('button', { class: 'd-row', onclick: async () => { await setPref(c, { muted: !c.muted }); detailsPanel(ch, 'about'); } }, svg(I.bell, 16), h('span', { class: 'grow' }, c.muted ? 'Muted. Only direct @mentions notify you.' : 'Notifications on'), h('b', {}, c.muted ? 'Unmute' : 'Mute')),
        h('button', { class: 'd-row', onclick: async () => { await setPref(c, { starred: !c.starred }); detailsPanel(ch, 'about'); } }, svg(I.pin, 16), h('span', { class: 'grow' }, c.starred ? 'Pinned to the top of your sidebar' : 'Not pinned to the top'), h('b', {}, c.starred ? 'Unpin' : 'Pin to top')),
        h('button', { class: 'd-row', onclick: () => openFiles(ch.id) }, svg(I.file, 16), h('span', { class: 'grow' }, 'Files shared here'), h('b', {}, 'Open')),
        h('div', { class: 'd-row static' }, svg(I.at, 16), h('span', { class: 'grow' }, `${ids.length} members`))));
  } else if (tab === 'members') {
    const q = h('input', { class: 'input', placeholder: 'Find or add people' });
    const list = h('div', {});
    const draw = () => {
      const v = q.value.toLowerCase();
      const inside = ids.map(user).filter((u) => !v || u.name.toLowerCase().includes(v));
      const outside = v && S.me.role !== 'guest' ? [...S.users.values()].filter((u) => u.active && !ids.includes(u.id) && u.name.toLowerCase().includes(v)).slice(0, 6) : [];
      list.replaceChildren(...inside.map((u) => h('div', { class: 'list-item member', onclick: () => profile(u) }, (() => { const a = avatar(u, 'av', '14px'); a.append(presenceDot(u)); return a; })(), h('div', { class: 'grow' }, h('div', { class: 't' }, u.name), h('div', { class: 's' }, u.title || '')),
        canManage && u.id !== S.me.id && ch.name !== 'general' ? h('button', { class: 'btn sm ghost', onclick: (e) => { e.stopPropagation(); modal('Remove from channel', h('p', {}, `Remove ${u.name} from #${ch.name}? They can be added back later.`), [['Cancel'], ['Remove', async () => { await api(`/api/channels/${ch.id}/remove`, { method: 'POST', body: { user_id: u.id } }); loadMembers(ch.id); detailsPanel(ch, 'members'); }, 'danger']]); } }, 'Remove') : '')),
        ...(outside.length ? [h('div', { class: 'eg-head' }, 'Add to channel')] : []),
        ...outside.map((u) => h('div', { class: 'list-item', onclick: async () => { await api(`/api/channels/${ch.id}/members`, { method: 'POST', body: { user_ids: [u.id] } }); toast(`${u.name} added`); loadMembers(ch.id); detailsPanel(ch, 'members'); } }, avatar(u, 'av', '14px'), h('div', { class: 'grow t' }, u.name), h('b', { class: 'add' }, 'Add'))));
    };
    q.addEventListener('input', draw); draw();
    body.replaceChildren(q, list);
  } else if (tab === 'settings') {
    const name = h('input', { class: 'input', value: ch.name });
    const save = (change) => api(`/api/channels/${ch.id}/manage`, { method: 'POST', body: change });
    body.replaceChildren(
      h('label', { class: 'field' }, h('span', {}, 'Channel name'), name),
      h('button', { class: 'btn sm', onclick: async () => { try { const c = await save({ name: name.value }); Object.assign(S.channels.get(ch.id) || {}, c); Object.assign(ch, c); toast('Renamed'); renderSidebar(); openChannel(ch.id); detailsPanel(ch, 'settings'); } catch (e) { toast(e.message); } } }, 'Rename'),
      h('div', { class: 'd-rows' },
        h('button', { class: 'd-row', onclick: async () => { const c = await save({ private: !ch.private }); Object.assign(S.channels.get(ch.id) || {}, c); Object.assign(ch, c); renderSidebar(); detailsPanel(ch, 'settings'); } }, svg(I.lock, 16), h('span', { class: 'grow' }, ch.private ? 'Private: only members can see it' : 'Public: anyone can find and join'), h('b', {}, ch.private ? 'Make public' : 'Make private')),
        h('button', { class: 'd-row danger', onclick: () => modal('Archive channel', h('p', {}, `Archive #${ch.name}? It leaves everyone's sidebar. Messages are kept and an admin can bring it back.`), [['Cancel'], ['Archive', async () => { await save({ archived: true }); }, 'danger']]) }, svg(I.close, 16), h('span', { class: 'grow' }, 'Archive this channel'), h('b', {}, 'Archive')),
        ['owner', 'admin'].includes(S.me.role) ? h('button', { class: 'd-row danger', onclick: () => deleteChannel(ch) }, svg(I.close, 16), h('span', { class: 'grow' }, 'Delete the channel and all its messages'), h('b', {}, 'Delete')) : ''));
  } else {
    const list = await api(`/api/channels/${ch.id}/pins`).catch(() => []);
    body.replaceChildren(...(list.length ? list.map((m) => feedItem(m)) : [h('div', { class: 'empty-row' }, 'Nothing pinned yet. Use ⋯ on a message, then "Pin to channel".')]));
  }
}

// ---------- Later: saved, reminders, scheduled
async function openLater(tab = 'saved') {
  const seg = h('div', { class: 'seg' }, ...[['saved', 'Saved'], ['reminders', 'Reminders'], ['scheduled', 'Scheduled']].map(([k, l]) => h('button', { class: tab === k ? 'on' : '', onclick: () => openLater(k) }, l)));
  const list = pageShell('later', 'Later', 'Messages you saved, reminders, and messages scheduled to send.', seg);
  let d; try { d = await api('/api/later'); } catch (e) { return toast(e.message); }
  S.saved = new Set(d.saved.map((m) => m.id)); renderSidebar();
  if (tab === 'saved') {
    list.replaceChildren(...(d.saved.length ? d.saved.map((m) => {
      const card = h('div', { class: 'later-item' }, feedItem(m));
      card.append(h('div', { class: 'li-acts' },
        h('button', { class: 'btn sm', onclick: async () => { await api(`/api/messages/${m.id}/save`, { method: 'POST', body: { done: true } }); toast('Marked done'); openLater('saved'); } }, 'Done'),
        h('button', { class: 'btn sm', onclick: () => remindMenu(m, card.querySelector('.li-acts')) }, 'Remind me'),
        h('button', { class: 'btn sm ghost', onclick: async () => { await api(`/api/messages/${m.id}/save`, { method: 'POST', body: {} }); openLater('saved'); } }, 'Remove')));
      return card;
    }) : [h('div', { class: 'empty-row' }, 'Nothing saved. Hover a message and tap the bookmark to keep it here.')]));
  } else if (tab === 'reminders') {
    list.replaceChildren(...(d.reminders.length ? d.reminders.map((r) => h('div', { class: 'later-item row' },
      h('span', { class: 'li-ico' }, svg(I.clock, 16)), h('div', { class: 'grow' }, h('b', {}, r.text || 'Reminder'), h('div', { class: 's' }, whenStr(r.due_at))),
      r.message_id ? h('button', { class: 'btn sm', onclick: () => (location.hash = '#/m/' + r.message_id) }, 'View') : '',
      h('button', { class: 'btn sm', onclick: () => pickDateTime('Change reminder', async (t) => { await api('/api/reminders/' + r.id, { method: 'PATCH', body: { due_at: t } }); openLater('reminders'); }) }, 'Change'),
      h('button', { class: 'btn sm ghost', onclick: async () => { await api('/api/reminders/' + r.id, { method: 'DELETE' }); openLater('reminders'); } }, 'Delete')))
      : [h('div', { class: 'empty-row' }, 'No reminders yet. Press and hold a message (or use ⋯ on a computer), then Remind me.')]));
  } else {
    list.replaceChildren(...(d.scheduled.length ? d.scheduled.map((x) => h('div', { class: 'later-item row' },
      h('span', { class: 'li-ico' }, svg(I.send, 15)), h('div', { class: 'grow' }, h('div', { class: 's' }, `${where(x.channel_id)}${x.thread_id ? ' · in a thread' : ''} · sends ${whenStr(x.send_at)}`), h('div', { class: 'text', html: fmt(x.text) || '<i>Files</i>' })),
      h('button', { class: 'btn sm', onclick: async () => { await api('/api/scheduled/' + x.id, { method: 'PATCH', body: { send_now: true } }); toast('Sent'); openLater('scheduled'); } }, 'Send now'),
      h('button', { class: 'btn sm', onclick: () => pickDateTime('Change send time', async (t) => { await api('/api/scheduled/' + x.id, { method: 'PATCH', body: { send_at: t } }); openLater('scheduled'); }) }, 'Change time'),
      h('button', { class: 'btn sm ghost', onclick: async () => { await api('/api/scheduled/' + x.id, { method: 'DELETE' }); openLater('scheduled'); } }, 'Delete')))
      : [h('div', { class: 'empty-row' }, 'Nothing scheduled. Next to Send, tap the clock to send a message later.')]));
  }
}

// ---------- Files browser
async function openFiles(channelId = '', type = '', q = '', mine = false) {
  const search = h('input', { class: 'input page-search', placeholder: 'Search file names', value: q });
  const seg = h('div', { class: 'seg' }, ...[['', 'All'], ['image', 'Images'], ['doc', 'Documents'], ['video', 'Videos'], ['other', 'Other']].map(([k, l]) => h('button', { class: type === k ? 'on' : '', onclick: () => openFiles(channelId, k, search.value, mine) }, l)));
  const mineBtn = h('button', { class: 'btn sm' + (mine ? ' primary' : ''), onclick: () => openFiles(channelId, type, search.value, !mine) }, 'Only mine');
  const list = pageShell('files', 'Files', channelId ? `Shared in ${where(channelId)}` : 'Everything shared in your channels and DMs.', search, seg, mineBtn);
  list.classList.add('files-grid');
  let next = null;
  const card = (f) => {
    const url = '/files/' + encodeURIComponent(f.key);
    const ext = (f.name.split('.').pop() || 'file').slice(0, 4);
    const prev = f.kind === 'image' ? h('img', { src: /\.(png|jpe?g|webp|heic|heif)$/i.test(f.key) ? url + '?w=880' : url, loading: 'lazy', alt: f.name, onclick: () => lightbox(url) })
      : h('a', { class: 'fg-ico', href: url, target: '_blank', rel: 'noopener', style: { background: fileColor(ext) } }, ext.toUpperCase());
    return h('div', { class: 'fg-card' }, h('div', { class: 'fg-prev' }, prev),
      h('div', { class: 'fg-meta' }, h('a', { class: 'fg-name', href: url, target: '_blank', rel: 'noopener', title: f.name }, f.name),
        h('button', { class: 'fg-sub', onclick: () => jumpTo({ id: f.message_id, channel_id: f.channel_id, thread_id: f.thread_id, ts: f.ts }) }, `${user(f.user_id).name.split(' ')[0]} · ${where(f.channel_id)} · ${dayStr(f.ts)}`)));
  };
  const more = h('button', { class: 'btn', onclick: () => load() }, 'Load more');
  const load = async (first) => {
    const qs = new URLSearchParams({ type, q: search.value.trim(), ...(channelId ? { channel: channelId } : {}), ...(mine ? { mine: '1' } : {}), ...(next ? { before: next } : {}) });
    const r = await api('/api/files?' + qs).catch((e) => (toast(e.message), { files: [] }));
    if (first) list.replaceChildren();
    more.remove();
    list.append(...r.files.map(card));
    next = r.next;
    if (next) list.append(more);
    if (first && !r.files.length) list.append(h('div', { class: 'empty-row' }, r.next ? 'Nothing on this page. Try Load more.' : 'No files found.'));
  };
  let t; search.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { next = null; load(true); }, 300); });
  load(true);
}

// ---------- preferences: status, notifications, do not disturb
async function openPrefs() {
  const list = pageShell('prefs', 'Status and notifications', 'How and when Yakyard gets your attention.');
  let pr = {}; try { pr = await api('/api/prefs'); } catch {}
  Object.assign(S.me, pr);
  // status
  let emo = S.me.status_emoji || '';
  const emoBtn = h('button', { class: 'emo-btn', title: 'Pick an emoji', onclick: (e) => emojiPicker(e.currentTarget, (v) => { emo = v; emoBtn.replaceChildren(emojiNode(v)); }) }, emo ? emojiNode(emo) : '🙂');
  const stText = h('input', { class: 'input', placeholder: "What's your status?", value: S.me.status_text || '' });
  const clear = h('select', { class: 'input' }, ...[['0', "Don't clear"], ['1800000', '30 minutes'], ['3600000', '1 hour'], ['14400000', '4 hours'], ['today', 'Today'], ['week', 'This week']].map(([v, l]) => h('option', { value: v }, l)));
  const until = () => { const v = clear.value; if (v === 'today') { const d = new Date(); d.setHours(23, 59, 0, 0); return d.getTime(); } if (v === 'week') { const d = new Date(at9(0, 1)); d.setHours(0, 0); return d.getTime(); } return +v ? Date.now() + +v : 0; };
  const saveStatus = async (e2, t2, u2) => { await api('/api/me', { method: 'PATCH', body: { status_emoji: e2, status_text: t2, status_until: u2 } }); Object.assign(S.me, { status_emoji: e2, status_text: t2, status_until: u2 }); S.users.set(S.me.id, { ...S.users.get(S.me.id), status_emoji: e2, status_text: t2, status_until: u2 }); toast(e2 || t2 ? 'Status set' : 'Status cleared'); openPrefs(); };
  const presets = [['📅', 'In a meeting', 3600e3], ['🚌', 'Commuting', 1800e3], ['🤒', 'Out sick', 'today'], ['🌴', 'On vacation', 0], ['🏡', 'Working remotely', 'today'], ['🎧', 'Focusing', 7200e3]];
  const section = (title, sub, ...kids) => h('section', { class: 'pref-sec' }, h('h2', {}, title), sub ? h('p', { class: 'pref-sub' }, sub) : '', ...kids);
  // notifications on this device
  const support = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  let devState = 'off';
  if (!support) devState = ios && !isStandalone() ? 'ios-install' : 'unsupported';
  else if (Notification.permission === 'denied') devState = 'blocked';
  else if (Notification.permission === 'granted' && (await currentSub())) devState = 'on';
  const devMsg = { on: 'On for this device.', off: 'Off for this device.', blocked: 'Blocked in this browser. Allow notifications for this site in your browser or phone settings, then come back.', unsupported: 'This browser can\'t show notifications. Use Chrome, Edge or Safari.', 'ios-install': 'On iPhone, add Yakyard to your Home Screen first, then open it from there to turn notifications on.' }[devState];
  const level = h('div', { class: 'radio-list' }, ...[['all', 'All new messages'], ['mentions', 'Direct messages, mentions and threads you\'re in'], ['none', 'Nothing']].map(([v, l]) =>
    h('label', { class: 'radio' }, h('input', { type: 'radio', name: 'lvl', value: v, checked: (S.me.notify_level || 'mentions') === v, onchange: async () => { await api('/api/me', { method: 'PATCH', body: { notify_level: v } }); S.me.notify_level = v; toast('Saved'); } }), l)));
  const dndOn = h('input', { type: 'checkbox', checked: !!(S.me.dnd_start && S.me.dnd_end) });
  const from = h('input', { class: 'input t', type: 'time', value: S.me.dnd_start || '22:00' }), to = h('input', { class: 'input t', type: 'time', value: S.me.dnd_end || '08:00' });
  const saveDnd = async () => { const b = dndOn.checked ? { dnd_start: from.value, dnd_end: to.value } : { dnd_start: '', dnd_end: '' }; await api('/api/me', { method: 'PATCH', body: b }); Object.assign(S.me, b); toast('Saved'); };
  [dndOn, from, to].forEach((x) => x.addEventListener('change', saveDnd));
  const paused = S.me.dnd_until > Date.now();
  // VIPs: their DMs come through even while paused
  const vips = new Set(JSON.parse(S.me.vips || '[]'));
  const vipBox = h('div', { class: 'vip-list' });
  const drawVips = () => vipBox.replaceChildren(...[...vips].map((id) => h('span', { class: 'chip' }, avatar(user(id), 'av', '9px'), user(id).name, h('button', { title: 'Remove', onclick: async () => { vips.delete(id); await saveVips(); } }, '×'))),
    h('button', { class: 'btn sm', onclick: (e) => pickPerson(e.currentTarget, async (u) => { vips.add(u.id); await saveVips(); }) }, '+ Add VIP'));
  const saveVips = async () => { const v = JSON.stringify([...vips]); await api('/api/me', { method: 'PATCH', body: { vips: [...vips] } }); S.me.vips = v; drawVips(); };
  drawVips();
  list.replaceChildren(
    section('Status', 'Shows next to your name for everyone.',
      h('div', { class: 'status-row' }, emoBtn, stText, clear),
      h('div', { class: 'pref-btns' }, h('button', { class: 'btn primary sm', onclick: () => saveStatus(emo, stText.value.trim(), until()) }, 'Save status'), statusOf(S.me) ? h('button', { class: 'btn sm', onclick: () => saveStatus('', '', 0) }, 'Clear status') : ''),
      h('div', { class: 'presets' }, ...presets.map(([e, t, d]) => h('button', { class: 'preset', onclick: () => saveStatus(e, t, d === 'today' ? (() => { const x = new Date(); x.setHours(23, 59, 0, 0); return x.getTime(); })() : d ? Date.now() + d : 0) }, e, ' ', t)))),
    section('Presence', S.me.away ? 'Everyone sees you as away, even while Yakyard is open.' : 'You show as active (green dot) while Yakyard is open, away when it is closed.',
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!S.me.away, onchange: async (e) => { await setMe({ away: e.target.checked ? 1 : 0 }); openPrefs(); } }), 'Always show me as away')),
    section('Notify me about', '', level),
    section('This device', devMsg,
      h('div', { class: 'pref-btns' },
        devState === 'off' ? h('button', { class: 'btn primary sm', onclick: async () => { await enablePush(); openPrefs(); } }, 'Turn on notifications') : '',
        devState === 'on' ? h('button', { class: 'btn sm', onclick: async () => { const r = await api('/api/push/test', { method: 'POST', body: {} }); toast(r.sent ? 'Test sent. Lock your phone or switch apps to see it.' : 'Could not reach this device'); } }, 'Send a test') : '',
        devState === 'on' ? h('button', { class: 'btn sm ghost', onclick: async () => { await disablePush(); openPrefs(); } }, 'Turn off on this device') : '',
        devState === 'ios-install' ? h('button', { class: 'btn primary sm', onclick: installApp }, 'Show me how') : ''),
      h('p', { class: 'pref-sub' }, `${(pr.devices || []).length} device${(pr.devices || []).length === 1 ? '' : 's'} getting notifications. While Yakyard is open on screen, your phone stays quiet.`)),
    section('Do not disturb', paused ? `Paused until ${whenStr(S.me.dnd_until)}.` : 'No notifications during these hours. People see a moon next to your name.',
      h('label', { class: 'check' }, dndOn, 'Every day from', from, 'to', to),
      h('div', { class: 'pref-btns' }, h('button', { class: 'btn sm', onclick: (e) => pauseMenu(e.currentTarget) }, paused ? 'Change or resume' : 'Pause notifications…'))),
    section('VIPs', 'Direct messages from these people still reach you while notifications are paused.', vipBox),
    section('Look', 'How messages appear on this device.',
      h('div', { class: 'radio-list' }, ...[['bubbles', 'Bubbles, like text messages'], ['classic', 'Classic list, like Slack']].map(([v, l]) =>
        h('label', { class: 'radio' }, h('input', { type: 'radio', name: 'look', value: v, checked: (localStorage.getItem('pw-look') || 'bubbles') === v, onchange: () => { localStorage.setItem('pw-look', v); applyLook(); } }), l)))),
    section('Enter key', 'What Enter does while you write a message on this device.',
      h('div', { class: 'radio-list' }, ...[['send', 'Enter sends the message (Shift + Enter for a new line)'], ['newline', 'Enter starts a new line (Ctrl + Enter or the arrow sends)']].map(([v, l]) =>
        h('label', { class: 'radio' }, h('input', { type: 'radio', name: 'enterk', value: v, checked: (enterSends() ? 'send' : 'newline') === v, onchange: () => localStorage.setItem('pw-enter', v) }), l)))),
    section('Text size', 'Make Yakyard easier to read on this device.',
      h('div', { class: 'radio-list' }, ...[['m', 'Standard'], ['l', 'Large (default)'], ['xl', 'Extra large']].map(([v, l]) =>
        h('label', { class: 'radio' }, h('input', { type: 'radio', name: 'tsize', value: v, checked: (localStorage.getItem('pw-text') || 'l') === v, onchange: () => { localStorage.setItem('pw-text', v); applyLook(); } }), l)))),
    section('The app', isStandalone() ? 'You are using the installed app.' : 'Install Yakyard so it opens like a normal app, with its own icon.',
      isStandalone() ? '' : h('button', { class: 'btn sm', onclick: installApp }, 'Install Yakyard')),
  );
}
function pickPerson(anchor, onPick) {
  closePopups();
  const pop = h('div', { class: 'menu person-pop' });
  const q = h('input', { class: 'input', placeholder: 'Name' }); const res = h('div', {});
  const draw = () => res.replaceChildren(...[...S.users.values()].filter((u) => u.active && u.id !== S.me.id && !/bot\.local$/.test(u.email || '') && u.name.toLowerCase().includes(q.value.toLowerCase())).slice(0, 8)
    .map((u) => h('button', { onclick: () => { closePopups(); onPick(u); } }, avatar(u, 'av', '9px'), u.name)));
  q.addEventListener('input', draw); draw();
  pop.append(q, res); document.body.append(pop);
  const r = anchor.getBoundingClientRect(); pop.style.left = r.left + 'px'; pop.style.top = Math.min(r.bottom + 4, innerHeight - 330) + 'px'; q.focus();
}

// ---------- phone / desktop push
const b64u = (s) => { const p = '='.repeat((4 - (s.length % 4)) % 4); const raw = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from([...raw].map((c) => c.charCodeAt(0))); };
async function currentSub() { try { const reg = await navigator.serviceWorker.ready; return await reg.pushManager.getSubscription(); } catch { return null; } }
async function enablePush() {
  if (!S.pushKey) return toast('Notifications are not set up yet');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') { toast('Notifications were not allowed'); return false; }
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64u(S.pushKey) });
  await api('/api/push/subscribe', { method: 'POST', body: sub.toJSON() });
  S.pushDevices = (S.pushDevices || 0) + 1; localStorage.removeItem('pw-notif-snooze');
  toast('Notifications on for this device'); renderSidebar();
  return true;
}
async function disablePush() {
  const sub = await currentSub(); if (!sub) return;
  await api('/api/push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } }).catch(() => {});
  await sub.unsubscribe().catch(() => {});
  toast('Notifications off for this device');
}
async function syncPush() {
  if (!('PushManager' in window) || Notification.permission !== 'granted' || !S.pushKey) return;
  const sub = await currentSub();
  if (sub) api('/api/push/subscribe', { method: 'POST', body: sub.toJSON() }).catch(() => {});
  else enablePush().catch(() => {});
}
function notifBanner() {
  if (!('PushManager' in window) || !('Notification' in window) || !S.pushKey || Notification.permission !== 'default') return null;
  if (/iphone|ipad|ipod/i.test(navigator.userAgent) && !isStandalone()) return null;
  if (+localStorage.getItem('pw-notif-snooze') > Date.now()) return null;
  return h('div', { class: 'notif-card' }, h('span', { class: 'nc-ico' }, svg(I.bell, 16)),
    h('div', { class: 'grow' }, h('b', {}, 'Turn on notifications'), h('small', {}, 'So you never miss a DM or a mention.')),
    h('button', { class: 'btn primary sm', onclick: () => enablePush() }, 'Turn on'),
    h('button', { class: 'icon-btn', title: 'Not now', onclick: () => { localStorage.setItem('pw-notif-snooze', Date.now() + 3 * DAY); renderSidebar(); } }, svg(I.close, 12)));
}
function sendVis() { try { if (ws?.readyState === 1) ws.send(JSON.stringify({ type: 'vis', visible: document.visibilityState === 'visible' })); } catch {} }
document.addEventListener('visibilitychange', () => { sendVis(); if (document.visibilityState === 'visible') checkUpdate(); });

// ---------- "add the app" prompt
function platform() {
  const ua = navigator.userAgent;
  const ios = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const inApp = /FBAN|FBAV|Instagram|Line\/|GSA\/|LinkedInApp|Snapchat|WhatsApp|Gmail/i.test(ua);
  const android = /android/i.test(ua);
  const macSafari = !ios && /Macintosh/.test(ua) && /Safari\//.test(ua) && !/Chrome|Chromium|Edg|Firefox/.test(ua);
  const firefox = /Firefox\//.test(ua) && !ios;
  const mac = !ios && /Macintosh/.test(ua);
  return { ios, inApp, android, macSafari, firefox, mac, phone: ios || android, desktop: !ios && !android };
}
function maybeInstallBanner() {
  // "Installed" is only remembered, so it goes stale when someone deletes the app. The browser's own install
  // signal wins, and on iPhone (no signal) opening Yakyard in Safari means it is not on the Home Screen anymore.
  if (!isStandalone() && (installEvt || platform().ios)) localStorage.removeItem('pw-installed');
  if (isStandalone() || localStorage.getItem('pw-installed') || $('.install')) return;
  const seen = JSON.parse(localStorage.getItem('pw-install') || '{"n":0,"t":0}');
  if (seen.n >= 5 || seen.t > Date.now()) return;
  const p = platform();

  const close = () => { localStorage.setItem('pw-install', JSON.stringify({ n: seen.n + 1, t: Date.now() + 3 * DAY })); el.remove(); };
  const sub = p.inApp ? 'Open this page in Safari or Chrome first, then add it to your Home Screen.'
    : p.ios ? 'Add it to your Home Screen. It opens like a normal app and can send you notifications.'
      : p.macSafari ? 'Add it to your Dock so it opens like Slack, in its own window, with notifications.'
        : p.firefox ? 'Firefox can’t install apps. Open Yakyard in Chrome, Edge or Safari to get the desktop app.'
          : p.desktop ? 'Get the desktop app: its own window and icon, opens at startup, with notifications. Like Slack.'
            : 'Install it so it opens like a normal app, with notifications.';
  const el = h('div', { class: 'install' + (p.phone ? ' phone' : '') }, h('img', { src: '/brand/icon-192.png', alt: '' }),
    h('div', { class: 'grow' }, h('b', {}, p.desktop ? 'Get the Yakyard desktop app' : 'Get the Yakyard app'), h('small', {}, sub)),
    p.inApp ? '' : h('button', { class: 'btn primary sm', onclick: async () => { if (installEvt) { installEvt.prompt(); const c = await installEvt.userChoice; if (c.outcome === 'accepted') { localStorage.setItem('pw-installed', '1'); el.remove(); } } else installApp(); } }, installEvt ? 'Install' : 'Show me how'),
    h('button', { class: 'icon-btn', title: 'Not now', onclick: close }, svg(I.close, 14)));
  document.body.append(el);
}
function installApp() {
  if (installEvt) return installEvt.prompt();
  const p = platform();
  const share = h('span', { class: 'share-ico' }, svg('M10 2.5l3.3 3.3-1 1-1.6-1.6V12H9.3V5.2L7.7 6.8l-1-1L10 2.5zM5 8h2v1.5H5.5v7h9v-7H13V8h2a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z', 16));
  const steps = p.ios ? [h('li', {}, 'Tap the Share button ', share, ' (Safari: bottom of the screen. Chrome: top right).'), h('li', {}, 'Scroll down and tap ', h('b', {}, 'Add to Home Screen'), '.'), h('li', {}, 'Tap ', h('b', {}, 'Add'), '. Open Yakyard from your Home Screen, then turn on notifications.')]
    : p.android ? [h('li', {}, 'In Chrome, tap ⋮ at the top right.'), h('li', {}, 'Tap ', h('b', {}, 'Install app'), ' or ', h('b', {}, 'Add to Home screen'), '.'), h('li', {}, 'Open Yakyard from your home screen.')]
      : p.macSafari ? [h('li', {}, 'In the menu bar at the top of the screen, click ', h('b', {}, 'File'), '.'), h('li', {}, 'Click ', h('b', {}, 'Add to Dock'), ', then ', h('b', {}, 'Add'), '.'), h('li', {}, 'Open Yakyard from the Dock and allow notifications. (Needs macOS Sonoma or newer. On older Macs, use Chrome.)')]
      : p.firefox ? [h('li', {}, 'Firefox can’t install apps.'), h('li', {}, 'Open ', h('b', {}, location.host), ' in Chrome, Edge or Safari and sign in.'), h('li', {}, 'Then click ', h('b', {}, 'Get the desktop app'), ' at the bottom left.')]
        : [h('li', {}, 'Click the install icon (a screen with a down arrow) at the right end of the address bar.'), h('li', {}, 'Or open the ⋮ menu at the top right, then ', h('b', {}, 'Cast, save and share'), ' › ', h('b', {}, 'Install page as app'), ' (Edge: ', h('b', {}, 'Apps › Install this site as an app'), ').'), h('li', {}, 'Yakyard opens in its own window' + (p.mac ? ' and appears in your Dock and Launchpad.' : ' and gets an icon on your desktop and Start menu.'))];
  modal('Install Yakyard', h('div', {}, p.inApp ? h('p', {}, 'You opened this inside another app. Open it in Safari or Chrome first.') : '', h('ol', { class: 'steps' }, ...steps)), [['Got it']]);
}

// ---------- new version prompt
let updShown = '';
async function checkUpdate() {
  if (APP_VERSION === 'dev') return;
  try {
    const r = await fetch('/version.json?t=' + Date.now(), { cache: 'no-store' });
    const { v } = await r.json();
    if (!v || v === APP_VERSION || updShown === v || H.channel) return;
    if (+localStorage.getItem('pw-upd-snooze-' + v) > Date.now()) return;
    updShown = v;
    modal('New version of Yakyard', h('div', {}, h('p', {}, 'A new version is ready. Update now to get the latest. It only takes a second, and your drafts are kept.')),
      [['Later', () => { localStorage.setItem('pw-upd-snooze-' + v, Date.now() + 30 * 60e3); updShown = ''; }], ['Update now', async () => { saveDraft(); try { const reg = await navigator.serviceWorker?.getRegistration(); await reg?.update(); await caches?.delete('yakyard-shell'); } catch {} location.reload(); return true; }]]);
  } catch {}
}
function startUpdateCheck() { setInterval(checkUpdate, 5 * 60e3); setTimeout(checkUpdate, 20e3); }

// ---------- emoji recents
function recentEmoji() { try { return JSON.parse(localStorage.getItem('pw-emoji-recent') || '[]'); } catch { return []; } }
function rememberEmoji(e) { const r = recentEmoji().filter((x) => x !== e); r.unshift(e); localStorage.setItem('pw-emoji-recent', JSON.stringify(r.slice(0, 16))); }

async function deleteChannel(c) {
  const conf = h('input', { class: 'input', placeholder: c.name });
  modal('Delete channel', h('div', {}, h('p', {}, `This deletes #${c.name} and every message in it, for everyone. It can't be undone. Archive keeps the history instead.`), h('label', { class: 'field' }, h('span', {}, 'Type the channel name to confirm'), conf)),
    [['Cancel'], ['Delete for everyone', async () => { if (conf.value.trim() !== c.name) throw new Error('Name does not match'); await api(`/api/channels/${c.id}/manage`, { method: 'POST', body: { delete: true } }); toast(`#${c.name} deleted`); S.channels.delete(c.id); if (typeof A !== 'undefined' && A.channels) { A.channels = A.channels.filter((x) => x.id !== c.id); renderAdmin(); } if (S.current === c.id) { S.current = null; closeThread(false); location.hash = '#/'; } renderSidebar(); }, 'danger']]);
}

function applyLook() {
  document.body.classList.toggle('bubbles', (localStorage.getItem('pw-look') || 'bubbles') === 'bubbles');
  const t = localStorage.getItem('pw-text') || 'l';
  document.body.classList.toggle('text-m', t === 'm'); document.body.classList.toggle('text-xl', t === 'xl');
}
applyLook();

// Phone: show the conversation list you were on (Home or DMs) and light up the right tab.
function showList() {
  saveDraft(); closeThread(false); S.current = null; S.cameFromList = false;
  setMobileView('side'); railActive(S.view === 'dms' ? 'dms' : 'home');
  $$('#tabbar button').forEach((x) => x.classList.toggle('on', x.dataset.tab === (S.view === 'dms' ? 'dms' : 'home')));
  renderSidebar();
}
// Opening a conversation from the list: remember it so Back returns to the list.
document.addEventListener('click', (e) => { if (e.target.closest('#side-list .chan[data-id]')) S.cameFromList = true; }, true);

// ================================================================== presence (like Slack)
function presenceOf(u) {
  if (!u) return 'away';
  if (inDnd(u)) return 'dnd';
  return S.online.has(u.id) && !u.away ? 'active' : 'away';
}
function presenceLabel(u) { return { active: 'Active', away: 'Away', dnd: 'Notifications paused' }[presenceOf(u)]; }
function presenceDot(u) {
  const p = presenceOf(u);
  return h('i', { class: 'dot p-' + p + (p === 'active' ? ' on' : ''), title: presenceLabel(u) }, p === 'dnd' ? svg(I.moon, 7) : '');
}
function drawMe() {
  const b = $('#me-avatar'); if (!b || !S.me) return;
  const me = S.users.get(S.me.id) || S.me;
  const a = avatar(me, '', '16px'); a.style.cssText += ';width:38px;height:38px;border-radius:11px';
  b.replaceChildren(a, presenceDot({ ...me, ...S.me }));
  const st = statusOf(S.me); b.title = st ? `${st.text || ''}` : presenceLabel(S.me);
}
async function setMe(change) {
  await api('/api/me', { method: 'PATCH', body: change });
  Object.assign(S.me, change); S.users.set(S.me.id, { ...S.users.get(S.me.id), ...change });
  drawMe(); renderSidebar();
}
function meMenu(anchor) {
  closePopups();
  const st = statusOf(S.me), p = presenceOf(S.me);
  const row = (label, fn, cls = '', icon) => h('button', { class: 'mm-row ' + cls, onclick: () => { closePopups(); fn(); } }, icon || '', h('span', {}, label));
  const quick = [['📅', 'In a meeting', 3600e3], ['🍽️', 'Out for lunch', 3600e3], ['🤒', 'Out sick', 'today'], ['🌴', 'On vacation', 0], ['🏡', 'Working remotely', 'today']];
  const endOfDay = () => { const x = new Date(); x.setHours(23, 59, 0, 0); return x.getTime(); };
  const pop = h('div', { class: 'menu me-menu' },
    h('div', { class: 'mm-head' }, (() => { const a = avatar(S.me, 'av', '15px'); a.append(presenceDot(S.me)); return a; })(),
      h('div', {}, h('b', {}, S.me.name), h('small', { class: 'mm-pres p-' + p }, presenceLabel(S.me)))),
    h('button', { class: 'mm-status', onclick: () => { closePopups(); location.hash = '#/prefs'; } }, st ? emojiNode(st.emoji || '💬') : '🙂', h('span', {}, st ? st.text || 'Status set' : 'Update your status'),
      st ? h('span', { class: 'mm-clear', role: 'button', title: 'Clear status', onclick: (e) => { e.stopPropagation(); closePopups(); setMe({ status_emoji: '', status_text: '', status_until: 0 }); } }, '×') : ''),
    st ? '' : h('div', { class: 'mm-quick' }, ...quick.map(([e, t, d]) => h('button', { title: t, onclick: () => { closePopups(); setMe({ status_emoji: e, status_text: t, status_until: d === 'today' ? endOfDay() : d ? Date.now() + d : 0 }); toast(`Status: ${t}`); } }, e))),
    h('hr'),
    row(S.me.away ? 'Set yourself as active' : 'Set yourself as away', () => setMe({ away: S.me.away ? 0 : 1 })),
    row(S.me.dnd_until > Date.now() ? 'Resume notifications' : 'Pause notifications…', () => (S.me.dnd_until > Date.now() ? setMe({ dnd_until: 0 }) : pauseMenu(anchor))),
    h('hr'),
    row('Profile', () => profile(S.me)),
    row('Status and notifications', () => (location.hash = '#/prefs')),
    row('Moving day: bring my Slack over', () => (location.hash = '#/import')),
    row('Later', () => openLater()),
    row('Files', () => openFiles()),
    row('Install the app', installApp),
    h('hr'),
    row('Sign out of ' + S.workspace.name, () => (location.href = '/auth/logout'), 'danger'));
  document.body.append(pop);
  const r = anchor.getBoundingClientRect(), pr = pop.getBoundingClientRect();
  pop.style.left = Math.max(8, Math.min(r.right + 8, innerWidth - pr.width - 8)) + 'px';
  pop.style.top = Math.max(8, Math.min(r.bottom - pr.height, innerHeight - pr.height - 8)) + 'px';
}

// Phone: the last swipe back asks first, so Yakyard isn't closed by accident.
// History looks like [root, guard, conversation...]. Landing on root means the next back would close the app.
let backWarnAt = 0;
function setupBackGuard() {
  const start = location.hash;
  history.replaceState({ root: 1 }, '', location.pathname);
  history.pushState({ guard: 1 }, '', location.pathname);
  if (start && start !== '#/') location.hash = start;
  window.addEventListener('popstate', (e) => {
    if (!e.state?.root) return;
    if (Date.now() - backWarnAt < 2500) { history.back(); return; }
    backWarnAt = Date.now();
    exitHint();
    history.pushState({ guard: 1 }, '', location.pathname);
    showList();
  });
}
function exitHint() {
  $('.exit-hint')?.remove();
  const el = h('div', { class: 'exit-hint', role: 'status' }, 'Swipe back again to close Yakyard');
  document.body.append(el);
  setTimeout(() => el.classList.add('out'), 2200);
  setTimeout(() => el.remove(), 2600);
}

// ================================================================== Bring my Slack history
S.imp = null;
let impTimer = null;
async function pollImport() {
  clearTimeout(impTimer);
  try { S.imp = await api('/api/slack/import'); } catch { return; }
  renderSidebar();
  if (location.hash.startsWith('#/import')) drawImport();
  if (S.imp?.job?.status === 'running') impTimer = setTimeout(pollImport, 5000);
}
function importCard() {
  const im = S.imp; if (!im || !im.ready) return null;
  const j = im.job;
  if (j?.status === 'running') return h('button', { class: 'notif-card imp', onclick: () => (location.hash = '#/import') }, h('span', { class: 'nc-ico spin' }, svg(I.clock, 16)),
    h('div', { class: 'grow' }, h('b', {}, 'Moving your Slack in'), h('small', {}, `${(j.msgs || 0).toLocaleString()} messages so far`)));
  if (j?.status === 'done' || +localStorage.getItem('pw-imp-snooze') > Date.now()) return null;
  return h('div', { class: 'notif-card' }, h('span', { class: 'nc-ico' }, svg(I.thread, 16)),
    h('div', { class: 'grow' }, h('b', {}, 'Moving day'), h('small', {}, 'Bring your Slack DMs and private channels over.')),
    h('button', { class: 'btn primary sm', onclick: () => (location.hash = '#/import') }, 'Move in'),
    h('button', { class: 'icon-btn', title: 'Not now', onclick: () => { localStorage.setItem('pw-imp-snooze', Date.now() + 7 * DAY); renderSidebar(); } }, svg(I.close, 12)));
}
function openImport() {
  pageShell('import', 'Moving day', 'Bring your own Slack DMs, group messages and private channels over to Yakyard.');
  drawImport();
  pollImport();
}
async function drawImport() {
  const list = $('#main .feed'); if (!list) return;
  const im = S.imp || {}; const j = im.job;
  const e = (location.hash.split('?e=')[1] || '').split('&')[0];
  const errText = { cancelled: 'You cancelled in Slack. Nothing was copied.', expired: 'That took too long. Please start again.', slack: "Slack didn't confirm. Please try again.", workspace: `That was a different Slack workspace. Pick ${S.workspace.name}.`, other: 'That Slack account belongs to someone else in Yakyard. Sign in to Slack as yourself.', setup: 'The Slack connection is not set up yet.' }[e];
  const sec = (title, ...kids) => h('section', { class: 'pref-sec' }, title ? h('h2', {}, title) : '', ...kids);
  const kids = [];
  if (errText) kids.push(h('div', { class: 'imp-err' }, errText));
  if (!im.ready) {
    kids.push(sec('Not ready yet', h('p', { class: 'pref-sub' }, S.me.role === 'owner' ? 'One last step for you: paste the Slack Client Secret below.' : 'Your admin still has to finish connecting Slack. Check back soon.')));
  } else if (j?.status === 'running') {
    const pct = j.convs_total ? Math.round((j.convs_done / j.convs_total) * 100) : 0;
    kids.push(sec('Moving in now', h('p', { class: 'pref-sub' }, 'You can keep using Yakyard or close it. It keeps going and tells you when it is done.'),
      h('div', { class: 'imp-bar' }, h('i', { style: { width: Math.max(4, pct) + '%' } })),
      h('div', { class: 'imp-stats' }, h('span', {}, h('b', {}, `${j.convs_done || 0} of ${j.convs_total || '…'}`), ' conversations'), h('span', {}, h('b', {}, (j.msgs || 0).toLocaleString()), ' messages'), h('span', {}, h('b', {}, (j.files || 0).toLocaleString()), ' files'))));
  } else if (j?.status === 'done') {
    kids.push(sec('Done', h('p', { class: 'pref-sub' }, `Copied ${(j.msgs || 0).toLocaleString()} messages and ${(j.files || 0).toLocaleString()} files from ${j.convs_total} conversations. Yakyard no longer has access to your Slack.`),
      h('div', { class: 'pref-btns' }, h('button', { class: 'btn sm', onclick: () => (location.hash = '#/') }, 'See my messages'), h('a', { class: 'btn sm ghost', href: '/slack/connect' }, 'Copy again to catch new messages'))));
  } else {
    kids.push(sec('', h('ol', { class: 'steps big' },
      h('li', {}, 'Tap ', h('b', {}, 'Connect Slack'), '. Slack opens.'),
      h('li', {}, 'Check it says ', h('b', {}, S.workspace.name), ' at the top right, then tap ', h('b', {}, 'Allow'), '.'),
      h('li', {}, 'You come back here and the copy starts. It runs in the background.')),
      h('p', { class: 'pref-sub' }, 'Read only: Yakyard can only read your conversations, never post or change anything in Slack. Only you can start this for your account, and access is cancelled as soon as the copy is done. Nothing is doubled if you run it again.'),
      j?.status === 'error' ? h('div', { class: 'imp-err' }, 'The last try stopped. Start again and it picks up what is missing.') : '',
      h('div', { class: 'pref-btns' }, h('a', { class: 'btn primary', href: '/slack/connect' }, 'Connect Slack'))));
  }
  if (['owner', 'admin'].includes(S.me.role)) {
    let a = { ready: im.ready, imports: [] }; try { a = await api('/api/slack/admin'); } catch {}
    const box = [];
    if (S.me.role === 'owner') {
      const inp = h('input', { class: 'input', type: 'password', placeholder: a.ready ? 'Saved. Paste again only to replace it.' : 'Paste the Client Secret here', autocomplete: 'off' });
      box.push(h('div', { class: 'status-row' }, inp, h('button', { class: 'btn primary sm', onclick: async () => { try { await api('/api/slack/secret', { method: 'POST', body: { secret: inp.value } }); inp.value = ''; toast('Saved. Slack is connected.'); pollImport(); } catch (err) { toast(err.message); } } }, 'Save')));
    }
    box.push(...(a.imports || []).map((x) => h('div', { class: 'imp-row' }, h('b', {}, x.name), h('span', { class: 'pill ' + (x.status === 'done' ? 's-active' : x.status === 'error' ? 's-deactivated' : 's-invited') }, x.status === 'done' ? 'Done' : x.status === 'error' ? 'Stopped' : 'Copying'), h('span', { class: 'muted' }, `${(x.msgs || 0).toLocaleString()} messages · ${(x.files || 0).toLocaleString()} files`))));
    if (!(a.imports || []).length) box.push(h('p', { class: 'pref-sub' }, 'Nobody has copied their history yet.'));
    kids.push(sec('Admin: Slack connection', h('p', { class: 'pref-sub' }, a.ready ? 'Connected. Everyone can bring their own history.' : 'Not connected yet.'), ...box));
  }
  list.replaceChildren(...kids);
}

// ================================================================== pick microphone, speaker, camera
function micConstraints() {
  const id = localStorage.getItem('pw-mic');
  return { echoCancellation: true, noiseSuppression: true, autoGainControl: true, ...(id ? { deviceId: { ideal: id } } : {}) };
}
const canPickSpeaker = typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;
function applySpeaker(el) { const id = localStorage.getItem('pw-spk'); if (canPickSpeaker && id) el.setSinkId(id).catch(() => {}); }
async function useMic(id) {
  localStorage.setItem('pw-mic', id);
  if (!H.channel) return;
  try {
    const st = await navigator.mediaDevices.getUserMedia({ audio: micConstraints() });
    const track = st.getAudioTracks()[0]; track.enabled = !H.muted;
    for (const p of H.peers.values()) { const snd = p.pc.getSenders().find((x) => x.track?.kind === 'audio'); if (snd) await snd.replaceTrack(track); }
    H.local.getAudioTracks().forEach((t) => { H.local.removeTrack(t); t.stop(); });
    H.local.addTrack(track);
    toast('Microphone switched');
  } catch { toast("Couldn't use that microphone"); }
}
function useSpeaker(id) { localStorage.setItem('pw-spk', id); for (const p of H.peers.values()) applySpeaker(p.audio); toast('Speaker switched'); }
async function soundMenu(anchor) {
  closePopups();
  let devs = [];
  try { devs = await navigator.mediaDevices.enumerateDevices(); } catch {}
  const label = (d, i, kind) => d.label || `${kind} ${i + 1}`;
  const group = (title, kind, list, current, fn, note) => h('div', { class: 'sm-group' }, h('div', { class: 'eg-head' }, title),
    list.length ? list.map((d, i) => h('button', { class: 'sm-item' + ((current ? d.deviceId === current : d.deviceId === 'default' || i === 0) ? ' on' : ''), onclick: () => { closePopups(); fn(d.deviceId); } }, label(d, i, kind))) : h('div', { class: 'sm-note' }, note));
  const mics = devs.filter((d) => d.kind === 'audioinput'), spk = devs.filter((d) => d.kind === 'audiooutput'), cams = devs.filter((d) => d.kind === 'videoinput');
  const pop = h('div', { class: 'menu sound-menu' },
    group('Microphone', 'Microphone', mics, localStorage.getItem('pw-mic'), useMic, 'No microphone found'),
    group('Speaker', 'Speaker', canPickSpeaker ? spk : [], localStorage.getItem('pw-spk'), useSpeaker, 'On this phone or browser, sound follows your system: connect headphones or a speaker and it switches by itself.'),
    group('Camera', 'Camera', cams, localStorage.getItem('pw-cam'), (id) => { localStorage.setItem('pw-cam', id); if (H.videoKind === 'cam') { setVideo(null, null); toggleVideo('cam'); } toast('Camera switched'); }, 'No camera found'));
  document.body.append(pop);
  const r = anchor.getBoundingClientRect(), pr = pop.getBoundingClientRect();
  pop.style.left = Math.max(8, Math.min(r.left, innerWidth - pr.width - 8)) + 'px';
  pop.style.top = Math.max(8, r.top - pr.height - 8) + 'px';
}
// Plugging in headphones mid-call: follow the system default unless a device was picked.
navigator.mediaDevices?.addEventListener?.('devicechange', () => { if (H.channel && !localStorage.getItem('pw-mic')) useMic(''); });

// ================================================================== add someone / mute someone
function tileMenu(x, anchor) {
  const p = H.peers.get(x.sid); const name = user(x.user_id).name.split(' ')[0];
  const r = anchor.getBoundingClientRect();
  menu([
    [x.muted ? `${name} is already muted` : `Mute ${name}`, () => { if (!x.muted) { sendWS({ type: 'huddle_mute', to: x.sid }); toast(`${name} is muted. They can unmute themselves.`); } }],
    [p?.audio?.muted ? `Hear ${name} again` : `Mute ${name} for me only`, () => { if (p) { p.audio.muted = !p.audio.muted; renderHuddleUI(); } }],
    ['—'],
    [`Open profile`, () => profile(user(x.user_id))],
  ], r.left, r.bottom - 10);
}
function invitedCard(ev) {
  if (H.channel === ev.channel_id) return;
  const from = user(ev.from);
  const others = (ev.people || []).filter((u) => u !== S.me.id).map((u) => user(u).name.split(' ')[0]);
  const label = ev.kind === 'dm' ? `with ${others.join(', ')}` : `in #${ev.name}`;
  $(`.incoming[data-cid="${ev.channel_id}"]`)?.remove();
  const card = h('div', { class: 'incoming', 'data-cid': ev.channel_id },
    avatar(from, 'av', '16px'),
    h('div', { class: 'grow' }, h('b', {}, from.name), h('div', {}, `wants you in a pop-in ${label}`)),
    h('button', { class: 'btn', onclick: () => card.remove() }, 'Not now'),
    h('button', { class: 'btn join', onclick: () => { card.remove(); if (!S.channels.has(ev.channel_id)) S.guestCall = { id: ev.channel_id, label: 'Pop-in ' + label }; else go(ev.channel_id); startHuddle(ev.channel_id); } }, svg(HI.headphones, 14), 'Pop in'));
  document.body.append(card);
  tone(true); setTimeout(() => tone(true), 900);
  if ('Notification' in window && Notification.permission === 'granted' && !document.hasFocus()) {
    const n = new Notification(`${from.name} wants you in a pop-in`, { body: label, tag: 'inv' + ev.channel_id, icon: from.avatar || '/brand/icon-192.png' });
    n.onclick = () => { window.focus(); n.close(); };
  }
  setTimeout(() => card.remove(), 60e3);
}

// ================================================================== unread on the icons
// Browser tab: the red star spins while something is waiting for you.
// Installed app: the system badge shows the count (phones and computers don't allow animated app icons).
const FAV = { n: 0, timer: null, base: null, star: null, link: null, still: null };
function favImgs() {
  if (FAV.base) return;
  FAV.base = new Image(); FAV.base.src = '/brand/logo-base.png';
  FAV.star = new Image(); FAV.star.src = '/brand/logo-star.png';
  FAV.link = document.querySelector('link[rel="icon"][type="image/png"]') || document.querySelector('link[rel="icon"]');
  FAV.still = FAV.link?.href;
}
function drawFav() {
  if (!FAV.base?.complete || !FAV.star?.complete || !FAV.link) return;
  const c = drawFav.c ||= Object.assign(document.createElement('canvas'), { width: 64, height: 64 });
  const x = c.getContext('2d'), k = 64 / 256;
  x.clearRect(0, 0, 64, 64);
  x.drawImage(FAV.base, 0, 0, 64, 64);
  const cx = (256 - 50) * k, cy = (256 - 50) * k, sz = 100 * k; // red star, bottom right corner
  x.save(); x.translate(cx, cy); x.rotate(((Date.now() / 6) % 360) * Math.PI / 180);
  x.drawImage(FAV.star, -sz / 2, -sz / 2, sz, sz); x.restore();
  FAV.link.href = c.toDataURL('image/png');
}
function iconBadge(n) {
  if (n === FAV.n) return;
  FAV.n = n;
  try { if (navigator.setAppBadge) n ? navigator.setAppBadge(n) : navigator.clearAppBadge(); } catch {}
  favImgs();
  clearInterval(FAV.timer);
  if (n) { FAV.timer = setInterval(drawFav, 90); drawFav(); }
  else if (FAV.link && FAV.still) FAV.link.href = FAV.still;
}
