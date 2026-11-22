// Checks that a running Yakyard serves exactly the locking code of this release.
//   npm run lock:verify -- https://chat.example.com
// It downloads every file listed in public/lock/manifest.json (and public/locked.js) from that server,
// hashes them, and compares. It prints the security code people see in the app after an update.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { securityCode } from './lock-sync.mjs';

const base = (process.argv[2] || '').replace(/\/+$/, '');
if (!/^https?:\/\//.test(base)) { console.error('Usage: npm run lock:verify -- https://your-yakyard'); process.exit(2); }
const man = JSON.parse(readFileSync(new URL('../public/lock/manifest.json', import.meta.url), 'utf8'));
let bad = 0;
for (const [name, want] of Object.entries(man.files)) {
  const url = base + (name === 'locked.js' ? '/locked.js' : '/lock/' + name);
  const r = await fetch(url, { headers: { 'cache-control': 'no-cache' } });
  const got = createHash('sha256').update(Buffer.from(await r.arrayBuffer())).digest('hex');
  const ok = r.ok && got === want;
  if (!ok) bad++;
  console.log(`${ok ? 'OK      ' : 'DIFFERS '} ${name}${ok ? '' : `  (server ${r.status}, sha256 ${got.slice(0, 16)}…, expected ${want.slice(0, 16)}…)`}`);
}
const live = await fetch(base + '/lock/manifest.json', { cache: 'no-store' }).then((r) => r.json()).catch(() => null);
console.log(`\nThis release: yakyard-lock ${man.version}, security code ${securityCode(man)}`);
if (live) console.log(`Server says: yakyard-lock ${live.version}, security code ${securityCode(live)}`);
console.log(bad ? `\n${bad} file(s) differ. Don't trust locked conversations on this server until you know why.` : '\nThe server sends the same locking code as this release.');
process.exit(bad ? 1 : 0);
