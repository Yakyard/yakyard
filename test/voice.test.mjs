// Transcripts on your own server: Workers AI over its REST API when CF_ACCOUNT_ID and CF_API_TOKEN are set, off otherwise.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transcriptsOn, transcribe } from '../src/voice.js';

test('transcripts are off with no binding and no token', () => {
  assert.equal(transcriptsOn({}), false);
  assert.equal(transcriptsOn({ CF_ACCOUNT_ID: 'a' }), false);
  assert.equal(transcriptsOn({ CF_ACCOUNT_ID: 'a', CF_API_TOKEN: 't' }), true);
  assert.equal(transcriptsOn({ AI: {} }), true);
});

// A tiny stand-in for D1 and R2: enough for one transcribe() run.
function fakeEnv(extra) {
  const file = { t_status: 'pending', t_tries: 0 };
  const stmt = (sql) => ({ bind: (...a) => ({
    first: async () => (/ai_paused_until/.test(sql) ? null : /SELECT channel_id/.test(sql) ? null : { ...file }),
    run: async () => { if (/t_status='working'/.test(sql)) { file.t_status = 'working'; return { meta: { changes: 1 } }; } if (/transcript=\?/.test(sql)) Object.assign(file, { transcript: a[0], t_status: 'done' }); else if (/SET t_status=\?/.test(sql)) file.t_status = a[0]; return { meta: { changes: 1 } }; },
    all: async () => ({ results: [] }),
  }), first: async () => null });
  return { file, env: { DB: { prepare: stmt, batch: async () => {} }, FILES: { get: async () => ({ size: 3, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }) }, ...extra } };
}

test('REST call: right URL and token, result unwrapped', async (t) => {
  const seen = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => { seen.push({ url, init }); return new Response(JSON.stringify({ success: true, result: { text: ' hello  there ' } })); });
  const { env, file } = fakeEnv({ CF_ACCOUNT_ID: 'acc1', CF_API_TOKEN: 'tok' });
  const r = await transcribe(env, 'k', null);
  assert.equal(r.status, 'done');
  assert.equal(file.transcript, 'hello there');
  assert.equal(seen[0].url, 'https://api.cloudflare.com/client/v4/accounts/acc1/ai/run/@cf/openai/whisper-large-v3-turbo');
  assert.equal(seen[0].init.headers.authorization, 'Bearer tok');
});

test('REST errors keep their Workers AI code, so a used-up day waits for tomorrow', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ success: false, errors: [{ code: 3036, message: 'daily limit' }] }), { status: 429 }));
  const { env } = fakeEnv({ CF_ACCOUNT_ID: 'acc1', CF_API_TOKEN: 'tok' });
  let batched = 0;
  env.DB.batch = async () => { batched++; };   // only the quota branch writes ai_paused_until in a batch
  const r = await transcribe(env, 'k', null);
  assert.equal(r.status, 'later');
  assert.equal(batched, 1);
});
