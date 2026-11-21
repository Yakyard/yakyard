// Moves an older install's wrangler.toml settings (its [vars] values, database and bucket) into wrangler.jsonc.
// Only touches values that exist in both, so new settings keep their defaults.
export function fromToml(toml, jsonc) {
  let out = jsonc, section = '';
  for (const line of toml.split(/\r?\n/)) {
    const sec = line.match(/^\s*\[+([^\]]+)\]+/);
    if (sec) { section = sec[1].trim(); continue; }
    const kv = line.match(/^\s*([A-Za-z_][\w]*)\s*=\s*"((?:[^"\\]|\\.)*)"/);
    if (!kv) continue;
    const [, k, val] = kv;
    if (section === 'vars') out = out.replace(new RegExp(`("${k}"\\s*:\\s*)"(?:[^"\\\\]|\\\\.)*"`), (_, p) => p + JSON.stringify(val.replace(/\\"/g, '"')));
    if (section === 'd1_databases' && k === 'database_name') out = out.replace(/("database_name"\s*:\s*)"[^"]*"/, (_, p) => p + JSON.stringify(val));
    if (section === 'r2_buckets' && k === 'bucket_name') out = out.replace(/("bucket_name"\s*:\s*)"[^"]*"/, (_, p) => p + JSON.stringify(val));
    if (section === 'd1_databases' && k === 'database_id' && !/^0+(-0+)*$/.test(val.replace(/-/g, '')))
      out = out.replace(/("database_name"\s*:\s*"[^"]*")(?![^}]*"database_id")/, `$1, "database_id": ${JSON.stringify(val)}`);
  }
  return out;
}
