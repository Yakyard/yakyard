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
  if (u.toBase64) return u.toBase64();   // native: about 1 ms of CPU per MB instead of 10+
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

// Workers AI gives 10,000 free neurons a day (about 214 minutes of voice notes). When they run out,
// notes still send; their transcripts wait until the next day (midnight UTC), when their job wakes up again.
const nextUtcDay = () => { const d = new Date(); d.setUTCHours(24, 1, 0, 0); return d.getTime(); };
// Workers AI errors carry a numeric code (and an HTTP status), documented at
// developers.cloudflare.com/workers-ai/platform/errors: 3036 (429) is the daily free allocation used up, 3040 (429)
// is busy for a moment. We read the code from the error object, or the "3036:" the binding puts first in the message,
// never from the wording, which can change.
export function aiErrorKind(e) {
  const m = String(e?.message ?? e ?? '').match(/^(?:[A-Za-z]*Error:\s*)?(\d{4})\b/);
  const code = +(e?.code ?? e?.cause?.code ?? (m ? m[1] : 0)) || 0, status = +(e?.status ?? e?.cause?.status ?? 0) || 0;
  if (code === 3036 || code === 4006) return 'quota';   // 4006 is the older code for the same limit
  if (code === 3040 || code === 3007 || status === 429 || status === 503 || status === 408) return 'busy';
  return 'other';
}
async function aiPausedUntil(env) {
  const r = await env.DB.prepare("SELECT value FROM settings WHERE key='ai_paused_until'").first().catch(() => null);
  return +(r?.value || 0) > now() ? +r.value : 0;
}

// Claim the job so two runs never transcribe the same note. A "Try again" can re-run a failed one, a few times at most.
async function claim(env, key, force) {
  const stale = now() - 5 * 60e3;
  const r = await env.DB.prepare(`UPDATE files SET t_status='working', t_at=?, t_tries=t_tries+1 WHERE key=? AND voice IS NOT NULL AND (
      t_status='pending' OR (t_status='working' AND t_at<?) OR (? AND t_status='failed' AND t_tries < 6))`).bind(now(), key, stale, force ? 1 : 0).run();
  return (r.meta?.changes || 0) > 0;
}

export async function transcribe(env, key, deps, force = false) {
  const paused = await aiPausedUntil(env);
  if (paused) {
    // Wait for tomorrow without spending tries. t_at in the future keeps the cron away until then.
    await env.DB.prepare("UPDATE files SET t_status='pending', t_at=? WHERE key=? AND t_status IN ('pending','failed')").bind(paused, key).run();
    await patchMessage(env, key, deps);
    return { status: 'later', transcript: '' };
  }
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
    const res = await ai(env).run(MODEL, { audio: b64(await obj.arrayBuffer()), language: env.VOICE_LANGUAGE || 'en', task: 'transcribe', vad_filter: true, initial_prompt: await hint(env) });
    const text = String(res?.text || '').replace(/\s+/g, ' ').trim();
    await env.DB.prepare("UPDATE files SET transcript=?, t_status='done', t_at=? WHERE key=?").bind(text, now(), key).run();
    await patchMessage(env, key, deps);
    return { status: 'done', transcript: text };
  } catch (e) {
    console.log('transcribe failed', key, String(e));
    const kind = aiErrorKind(e);
    if (kind === 'busy') {
      // Busy for a moment: try again in two minutes without using up a try.
      await env.DB.prepare("UPDATE files SET t_status='pending', t_tries=MAX(0,t_tries-1), t_at=? WHERE key=?").bind(now() + 120e3, key).run();
      return { status: 'pending', transcript: '', at: now() + 120e3 };
    }
    if (kind === 'quota') {
      const until = nextUtcDay();
      await env.DB.batch([
        env.DB.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('ai_paused_until',?)").bind(String(until)),
        env.DB.prepare("UPDATE files SET t_status='pending', t_tries=MAX(0,t_tries-1), t_at=? WHERE key=?").bind(until, key),
      ]);
      await patchMessage(env, key, deps);
      return { status: 'later', transcript: '', at: until };
    }
    const f = await env.DB.prepare('SELECT t_tries FROM files WHERE key=?').bind(key).first();
    const st = (f?.t_tries || 0) >= MAX_TRIES ? 'failed' : 'pending';
    await env.DB.prepare('UPDATE files SET t_status=?, t_at=? WHERE key=?').bind(st, now(), key).run();
    if (st === 'failed') await patchMessage(env, key, deps);
    return { status: st, transcript: '' };
  }
}

// Put the transcript (or the failed state) into the message that holds this voice note, index it, tell everyone.
export async function patchMessage(env, key, deps) {
  const f = await env.DB.prepare('SELECT channel_id, transcript, t_status, t_at FROM files WHERE key=?').bind(key).first();
  if (!f?.channel_id) return false;
  // instr, not LIKE: D1 caps LIKE patterns at 50 characters and file keys are longer.
  const msg = await env.DB.prepare('SELECT * FROM messages WHERE channel_id=? AND instr(files, ?) > 0 ORDER BY ts DESC LIMIT 1').bind(f.channel_id, JSON.stringify(key)).first();
  if (!msg) return false;
  let files = [];
  try { files = JSON.parse(msg.files || '[]'); } catch {}
  let changed = false;
  for (const x of files) {
    if (x.key !== key) continue;
    const t = ['done', 'failed', 'off'].includes(f.t_status) ? f.t_status : f.t_at > now() + 60e3 ? 'later' : 'pending';
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

// The transcript job (see arm in features.js): one note per run, retried until it is done or out of tries.
// Returns when to run again, or null when there is nothing left to do.
export async function voiceJob(env, key, deps) {
  const r = await transcribe(env, key, deps);
  if (r.status === 'later') return r.at || (await aiPausedUntil(env)) || now() + 3600e3;
  if (r.status === 'pending') return r.at || now() + 60e3;
  if (r.status === 'working') return now() + 5 * 60e3 + 1000;   // another run has it; check once its claim goes stale
  return null;
}

// Only for tests: VOICE_AI_URL points transcripts at a local stand-in for Workers AI (localhost only).
const testUrl = (env) => env.VOICE_AI_URL && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(env.VOICE_AI_URL) ? env.VOICE_AI_URL : '';
// On your own server there is no Workers AI binding: with CF_ACCOUNT_ID and CF_API_TOKEN set, transcripts use its REST API.
const restOn = (env) => !env.AI && !!(env.CF_ACCOUNT_ID && env.CF_API_TOKEN);
// False on a server with no way to transcribe: voice notes still send, marked "off" instead of waiting forever.
export const transcriptsOn = (env) => !!(env.AI || restOn(env) || testUrl(env));
async function post(url, headers, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  return { r, j };
}
function ai(env) {
  const u = testUrl(env);
  if (u) return { run: async (model, input) => {
    const { r, j } = await post(u, {}, { model, input: { ...input, audio: String(input.audio).length } });
    if (!r.ok) throw Object.assign(new Error(j.message || 'AI error'), { code: j.code, status: r.status });
    return j;
  } };
  if (restOn(env)) return { run: async (model, input) => {
    const { r, j } = await post(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(env.CF_ACCOUNT_ID)}/ai/run/${model}`, { authorization: `Bearer ${env.CF_API_TOKEN}` }, input);
    if (!r.ok || j.success === false) { const e = j.errors?.[0] || {}; throw Object.assign(new Error(`${e.code || r.status}: ${e.message || 'AI error'}`), { code: e.code, status: r.status }); }
    return j.result;
  } };
  return env.AI;
}

export const fmtDur = (s) => { s = Math.round(s || 0); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
