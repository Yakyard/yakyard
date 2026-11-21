// Deploy Yakyard: makes the setup code on the first deploy, creates any new tables, stamps a version
// (open apps then show the "new version" pop-up) and runs wrangler deploy.
// Works the same on macOS, Linux and Windows. public/index.html is put back afterwards, so `git pull` stays clean.
import { execSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const run = (cmd) => execSync(cmd, { stdio: 'inherit', cwd: root });
const d = new Date();
const v = [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes()].map((n) => String(n).padStart(2, '0')).join('');

run('npm ci --no-audit --no-fund');
run('npx wrangler d1 execute DB --remote --file=schema.sql');   // safe to repeat: only creates what is missing
writeFileSync(join(root, 'public/version.json'), JSON.stringify({ v }));
const file = join(root, 'public/index.html');
const original = readFileSync(file, 'utf8');
try {
  writeFileSync(file, original.replace(/(yakyard-version" content=")[^"]+/, `$1${v}`).replace(/(app\.(css|js)\?v=)[^"]+/g, `$1${v}`));
  run('npx wrangler deploy');
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
