// Deploy Yakyard: deploys, brings the database up to date, makes the setup code on the first deploy, stamps a version
// (open apps then show the "new version" pop-up) and runs wrangler deploy.
// Works the same on macOS, Linux and Windows. public/index.html is put back afterwards, so `git pull` stays clean.
import { execSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, statSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const run = (cmd) => execSync(cmd, { stdio: 'inherit', cwd: root });
const d = new Date();
const v = [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes()].map((n) => String(n).padStart(2, '0')).join('');

// Install only when needed: a fresh copy, or package-lock.json changed since the last install.
const lock = join(root, 'package-lock.json'), mods = join(root, 'node_modules/.package-lock.json');
if (!existsSync(mods) || statSync(lock).mtimeMs > statSync(mods).mtimeMs) run('npm ci --no-audit --no-fund');
// First time on this computer: start from the example settings. Wrangler creates the database and the
// file storage on the first deploy and writes their ids into wrangler.toml (which git ignores).
if (!existsSync(join(root, 'wrangler.toml'))) copyFileSync(join(root, 'wrangler.toml.example'), join(root, 'wrangler.toml'));
// Update the database before the new code goes live. On the very first deploy there is no database yet, so this waits.
let migrated = false;
try { run('node scripts/migrate.mjs --remote'); migrated = true; } catch { console.log('No database yet: it will be created now.'); }
writeFileSync(join(root, 'public/version.json'), JSON.stringify({ v }));
const file = join(root, 'public/index.html');
const original = readFileSync(file, 'utf8');
try {
  writeFileSync(file, original.replace(/(yakyard-version" content=")[^"]+/, `$1${v}`).replace(/(app\.(css|js)\?v=)[^"]+/g, `$1${v}`));
  run('npx wrangler deploy');   // the first time, this also creates the database and the file storage
  if (!migrated) run('node scripts/migrate.mjs --remote');
  console.log(`Deployed version ${v}`);
  // First deploy only: make the setup code and show it once.
  const secrets = execSync('npx wrangler secret list', { cwd: root, encoding: 'utf8' });
  if (!secrets.includes('SETUP_TOKEN')) {
    const code = randomBytes(24).toString('hex');
    execSync('npx wrangler secret put SETUP_TOKEN', { cwd: root, input: code, stdio: ['pipe', 'inherit', 'inherit'] });
    console.log(`\nYour setup code (shown once, keep it until you have set up Yakyard):\n\n  ${code}\n`);
  }
} finally {
  writeFileSync(file, original);
}
