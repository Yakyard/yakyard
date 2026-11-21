// Voice notes: record in the app, transcript by Whisper (Workers AI). Language from VOICE_LANGUAGE (default English).
const MODEL = '@cf/openai/whisper-large-v3-turbo';
const MAX_TRIES = 3;
export const VOICE_MAX = 25 * 1024 * 1024; // voice notes are read into memory to transcribe
const now = () => Date.now();

// Meta sent with the upload: length in seconds and a small waveform (0-100 bars).
export function parseVoiceMeta(form) {
  if (form.get('voice') !== '1') return null;
  const dur = Math.max(0, Math.min(1800, +form.get('dur') || 0));
  let wave = [];
  try { wave = JSON.parse(form.get('wave') || '[]'); } catch {}
  if (!Array.isArray(wave)) wave = [];
  wave = wave.slice(0, 64).map((x) => Math.max(0, Math.min(100, Math.round(+x || 0))));
  return { dur: Math.round(dur * 10) / 10, wave };
}

function b64(buf) {
  const u = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < u.length; i += 32768) s += String.fromCharCode.apply(null, u.subarray(i, i + 32768));
  return btoa(s);
}

// Names help Whisper spell people and brands right, whatever the accent.
async function hint(env) {
  let names = [];
  try {
    const r = await env.DB.prepare("SELECT name FROM users WHERE active=1 AND email NOT LIKE '%@bot.local' LIMIT 60").all();
    names = [...new Set(r.results.map((x) => String(x.name || '').split(' ')[0]).filter(Boolean))];
  } catch {}
  return `${env.VOICE_HINT ? env.VOICE_HINT + ' ' : ''}${env.WORKSPACE_NAME || ''}. ${names.join(', ')}.`;
}

// Claim the job so two runs never transcribe the same note.
async function claim(env, key, force) {
  const stale = now() - 5 * 60e3;
  const r = await env.DB.prepare(`UPDATE files SET t_status='working', t_at=?, t_tries=t_tries+1 WHERE key=? AND voice IS NOT NULL AND (
      t_status='pending' OR (t_status='working' AND t_at<?) OR (? AND t_status='failed'))`).bind(now(), key, stale, force ? 1 : 0).run();
  return (r.meta?.changes || 0) > 0;
}

export async function transcribe(env, key, deps, force = false) {
  if (!(await claim(env, key, force))) {
    const f = await env.DB.prepare('SELECT transcript, t_status FROM files WHERE key=?').bind(key).first();
    return { status: f?.t_status || 'none', transcript: f?.transcript || '' };
  }
  try {
    const obj = await env.FILES.get(key);
    if (!obj) throw new Error('audio missing');
    if (obj.size > VOICE_MAX) {
      // Too big to transcribe safely: stop now instead of retrying.
      await env.DB.prepare("UPDATE files SET t_status='failed', t_tries=?, t_at=? WHERE key=?").bind(MAX_TRIES, now(), key).run();
      await patchMessage(env, key, deps);
      return { status: 'failed', transcript: '' };
    }
    const res = await env.AI.run(MODEL, { audio: b64(await obj.arrayBuffer()), language: env.VOICE_LANGUAGE || 'en', task: 'transcribe', vad_filter: true, initial_prompt: await hint(env) });
    const text = String(res?.text || '').replace(/\s+/g, ' ').trim();
    await env.DB.prepare("UPDATE files SET transcript=?, t_status='done', t_at=? WHERE key=?").bind(text, now(), key).run();
    await patchMessage(env, key, deps);
    return { status: 'done', transcript: text };
  } catch (e) {
    console.log('transcribe failed', key, String(e));
    const f = await env.DB.prepare('SELECT t_tries FROM files WHERE key=?').bind(key).first();
    const st = (f?.t_tries || 0) >= MAX_TRIES ? 'failed' : 'pending';
    await env.DB.prepare('UPDATE files SET t_status=?, t_at=? WHERE key=?').bind(st, now(), key).run();
    if (st === 'failed') await patchMessage(env, key, deps);
    return { status: st, transcript: '' };
  }
}

// Put the transcript (or the failed state) into the message that holds this voice note, index it, tell everyone.
export async function patchMessage(env, key, deps) {
  const f = await env.DB.prepare('SELECT channel_id, transcript, t_status FROM files WHERE key=?').bind(key).first();
  if (!f?.channel_id) return false;
  // instr, not LIKE: D1 caps LIKE patterns at 50 characters and file keys are longer.
  const msg = await env.DB.prepare('SELECT * FROM messages WHERE channel_id=? AND instr(files, ?) > 0 ORDER BY ts DESC LIMIT 1').bind(f.channel_id, JSON.stringify(key)).first();
  if (!msg) return false;
  let files = [];
  try { files = JSON.parse(msg.files || '[]'); } catch {}
  let changed = false;
  for (const x of files) {
    if (x.key !== key) continue;
    const t = f.t_status === 'done' ? 'done' : f.t_status === 'failed' ? 'failed' : 'pending';
    if (x.t !== t || (x.transcript || '') !== (f.transcript || '')) { x.t = t; x.transcript = f.transcript || ''; changed = true; }
  }
  if (!changed) return false;
  const stmts = [env.DB.prepare('UPDATE messages SET files=? WHERE id=?').bind(JSON.stringify(files), msg.id)];
  if (f.t_status === 'done' && f.transcript) {
    stmts.push(env.DB.prepare('DELETE FROM voice_fts WHERE file_key=?').bind(key));
    stmts.push(env.DB.prepare('INSERT INTO voice_fts (text, message_id, file_key) VALUES (?,?,?)').bind(f.transcript, msg.id, key));
  }
  await env.DB.batch(stmts);
  msg.files = JSON.stringify(files);
  if (deps?.hydrateMessages && deps?.broadcast) {
    const [full] = await deps.hydrateMessages(env, [msg]);
    await deps.broadcast(env, { type: 'message_changed', message: full }, await deps.channelMembers(env, f.channel_id)).catch(() => {});
  }
  return true;
}

// Wait (max a few seconds) for transcripts, so the phone notification can show the words.
export async function waitTranscripts(env, keys, ms = 20000) {
  const end = now() + ms;
  while (now() < end) {
    const r = await env.DB.prepare(`SELECT key, transcript, t_status FROM files WHERE key IN (${keys.map(() => '?').join(',')})`).bind(...keys).all();
    if (r.results.every((x) => x.t_status === 'done' || x.t_status === 'failed')) return Object.fromEntries(r.results.map((x) => [x.key, x.transcript || '']));
    await new Promise((res) => setTimeout(res, 1500));
  }
  return null;
}

// Safety net, every minute: notes whose transcript never started (app closed right after sending).
export async function voiceCron(env, deps) {
  const r = await env.DB.prepare(`SELECT key FROM files WHERE channel_id IS NOT NULL AND ((t_status='pending' AND COALESCE(t_at, created_at) < ?) OR (t_status='working' AND t_at < ?)) ORDER BY created_at LIMIT 3`)
    .bind(now() - 45e3, now() - 5 * 60e3).all();
  for (const x of r.results) await transcribe(env, x.key, deps);
}

export const fmtDur = (s) => { s = Math.round(s || 0); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
