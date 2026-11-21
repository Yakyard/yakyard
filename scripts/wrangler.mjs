// Runs wrangler for the scripts. Uses wrangler.toml when an older install made one (it holds that install's
// database id), otherwise the wrangler.jsonc that comes with Yakyard.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const config = existsSync(join(root, 'wrangler.toml')) ? 'wrangler.toml' : 'wrangler.jsonc';
const win = process.platform === 'win32';
export function wrangler(args, opts = {}) {
  return execFileSync(win ? 'npx.cmd' : 'npx', ['wrangler', ...args, '--config', config], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], shell: win, maxBuffer: 1 << 30, ...opts });
}
// `where` is --local or --remote; `extra` carries --persist-to=... for tests.
export const d1 = (where, extra, args) => wrangler(['d1', 'execute', 'DB', where, ...extra, '-y', ...args]);
export const d1json = (where, extra, sql) => JSON.parse(d1(where, extra, ['--json', '--command', sql]));
export function target(argv = process.argv) {
  return { where: argv.includes('--local') ? '--local' : '--remote', extra: argv.filter((a) => a.startsWith('--persist-to=')) };
}
