// Cache in R2 for outside pictures, link previews and weather.
// *.workers.dev has no edge cache (the Cache API does nothing there), so outside pictures, link previews and
// weather are kept in R2 under cache/, each with its own lifetime. One outside fetch per item, however many people
// look at it. The hourly job deletes expired copies and keeps the whole cache under IMG_CACHE_MB (default 200 MB).
const CACHE = 'cache/';
export async function cacheGet(env, key) {
  const hit = await env.FILES.get(CACHE + key);
  if (hit && Date.now() - hit.uploaded.getTime() < +(hit.customMetadata?.ttl || 0)) return hit;
  if (hit) await hit.body.cancel();
  return null;
}
export function cachePut(env, key, body, ttl, type, extra = {}) {
  return env.FILES.put(CACHE + key, body, { httpMetadata: type ? { contentType: type } : undefined, customMetadata: { ttl: String(ttl), ...extra } }).catch((e) => console.log('cache put', e));
}
export async function cacheCleanup(env, t = Date.now()) {
  const cap = (+env.IMG_CACHE_MB || 200) * 1024 * 1024, all = [];
  let cursor;
  for (let i = 0; i < 10; i++) {   // pages of 1,000, at most 10 per run
    const page = await env.FILES.list({ prefix: CACHE, cursor, limit: 1000, include: ['customMetadata'] });
    all.push(...page.objects);
    if (!page.truncated) break;
    cursor = page.cursor;
  }
  const expired = (o) => t - o.uploaded.getTime() >= +(o.customMetadata?.ttl || 0);
  const gone = all.filter(expired), keep = all.filter((o) => !expired(o)).sort((a, b) => b.uploaded - a.uploaded);
  let total = 0;
  for (const o of keep) { total += o.size; if (total > cap) gone.push(o); }   // over the cap: oldest go first
  for (let i = 0; i < gone.length; i += 1000) await env.FILES.delete(gone.slice(i, i + 1000).map((o) => o.key));
  return gone.length;
}
