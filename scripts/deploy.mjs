// Deploy Yakyard: stamps a version (open apps then show the "new version" pop-up) and runs wrangler deploy.
// Works the same on macOS, Linux and Windows. public/index.html is put back afterwards, so `git pull` stays clean.
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const run = (cmd) => execSync(cmd, { stdio: 'inherit', cwd: root });
const d = new Date();
const v = [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes()].map((n) => String(n).padStart(2, '0')).join('');

run('npm ci --no-audit --no-fund');
writeFileSync(join(root, 'public/version.json'), JSON.stringify({ v }));
const file = join(root, 'public/index.html');
const original = readFileSync(file, 'utf8');
try {
  writeFileSync(file, original.replace(/(yakyard-version" content=")[^"]+/, `$1${v}`).replace(/(app\.(css|js)\?v=)[^"]+/g, `$1${v}`));
  run('npx wrangler deploy');
  console.log(`Deployed version ${v}`);
} finally {
  writeFileSync(file, original);
}
