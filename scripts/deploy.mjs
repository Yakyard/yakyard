// Deploy Yakyard: brings the database up to date, deploys, makes the setup code on the first deploy and stamps a
// version (open apps then show the "new version" pop-up). Works the same on macOS, Linux and Windows, and in
// Cloudflare's own build (the Deploy to Cloudflare button runs `npm run deploy`).
// public/index.html is put back afterwards, so `git pull` stays clean.
import { execSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, statSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { root, wrangler } from './wrangler.mjs';
import { fromToml } from './settings.mjs';

const ci = !!(process.env.CI || process.env.WORKERS_CI);
const run = (cmd) => execSync(cmd, { stdio: 'inherit', cwd: root });
const d = new Date();
const v = [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes()].map((n) => String(n).padStart(2, '0')).join('');

// Install only when needed: a fresh copy, or package-lock.json changed since the last install.
const lock = join(root, 'package-lock.json'), mods = join(root, 'node_modules/.package-lock.json');
if (!existsSync(mods) || statSync(lock).mtimeMs > statSync(mods).mtimeMs) run('npm ci --no-audit --no-fund');
// Installs from before wrangler.jsonc kept their settings in wrangler.toml: move them over once.
const toml = join(root, 'wrangler.toml'), jsonc = join(root, 'wrangler.jsonc');
if (existsSync(toml)) {
  writeFileSync(jsonc, fromToml(readFileSync(toml, 'utf8'), readFileSync(jsonc, 'utf8')));
  renameSync(toml, toml + '.old');
  console.log('Your settings moved from wrangler.toml to wrangler.jsonc (the old file is now wrangler.toml.old).');
}
// Update the database before the new code goes live. On the very first deploy there is no database yet, so this waits.
let migrated = false;
try { run('node scripts/migrate.mjs --remote'); migrated = true; } catch { console.log('No database yet: it will be created now.'); }
writeFileSync(join(root, 'public/version.json'), JSON.stringify({ v }));
const file = join(root, 'public/index.html');
const original = readFileSync(file, 'utf8');
try {
  writeFileSync(file, original.replace(/(yakyard-version" content=")[^"]+/, `$1${v}`).replace(/(app\.(css|js)\?v=)[^"]+/g, `$1${v}`));
  wrangler(['deploy'], { stdio: 'inherit' });   // the first time, this also creates the database and the file storage
  if (!migrated) run('node scripts/migrate.mjs --remote');
  console.log(`Deployed version ${v}`);
  // First deploy from a computer: make the setup code and show it once. (The Deploy button asks for it instead.)
  if (!ci && !wrangler(['secret', 'list']).includes('SETUP_TOKEN')) {
    const code = randomBytes(24).toString('hex');
    wrangler(['secret', 'put', 'SETUP_TOKEN'], { input: code, stdio: ['pipe', 'inherit', 'inherit'] });
    console.log(`\nYour setup code (shown once, keep it until you have set up Yakyard):\n\n  ${code}\n`);
  }
} finally {
  writeFileSync(file, original);
}
