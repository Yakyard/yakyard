// Copies the locking library (packages/yakyard-lock, Apache-2.0) into public/lock/ and writes
// public/lock/manifest.json: the SHA-256 of every file the browser runs for locked conversations.
// The app checks the WebAssembly against it, shows a "security code" made from it, and docs/E2EE-HASHES.md
// lists it per release so anyone can check a running Yakyard (npm run lock:verify -- https://your-yakyard).
//   node scripts/lock-sync.mjs           copy and write the manifest
//   node scripts/lock-sync.mjs --check   exit 1 if public/lock is out of date (used by the tests)
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = join(root, 'packages/yakyard-lock');
const out = join(root, 'public/lock');
const FILES = [['src/lock.js', 'lock.js'], ['src/store-idb.js', 'store-idb.js'], ['dist/yakyard-crypto.js', 'yakyard-crypto.js'], ['dist/yakyard-crypto_bg.wasm', 'yakyard-crypto_bg.wasm']];
const sha = (b) => createHash('sha256').update(b).digest('hex');

export function manifest() {
  const files = {};
  for (const [, name] of FILES) files[name] = sha(readFileSync(join(pkg, FILES.find((f) => f[1] === name)[0])));
  files['locked.js'] = sha(readFileSync(join(root, 'public/locked.js')));
  return { name: 'yakyard-lock', version: JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8')).version, files };
}
// SHA-256 over "name:hash" lines of every file, first 64 bits, in four groups. Any file changing changes it.
export function securityCode(man) {
  const text = Object.keys(man.files).sort().map((k) => `${k}:${man.files[k]}\n`).join('');
  return createHash('sha256').update(text).digest('hex').slice(0, 16).toUpperCase().match(/.{4}/g).join('-');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const man = manifest();
  const text = JSON.stringify(man, null, 2) + '\n';
  if (process.argv.includes('--check')) {
    const bad = FILES.filter(([src, name]) => !existsSync(join(out, name)) || sha(readFileSync(join(out, name))) !== sha(readFileSync(join(pkg, src)))).map((f) => f[1]);
    if (!existsSync(join(out, 'manifest.json')) || readFileSync(join(out, 'manifest.json'), 'utf8') !== text) bad.push('manifest.json');
    if (bad.length) { console.error('public/lock is out of date (' + bad.join(', ') + '). Run: node scripts/lock-sync.mjs'); process.exit(1); }
    console.log('public/lock matches packages/yakyard-lock. Security code ' + securityCode(man));
  } else {
    mkdirSync(out, { recursive: true });
    for (const [src, name] of FILES) writeFileSync(join(out, name), readFileSync(join(pkg, src)));
    writeFileSync(join(out, 'manifest.json'), text);
    console.log('Copied yakyard-lock ' + man.version + ' to public/lock. Security code ' + securityCode(man));
  }
}
