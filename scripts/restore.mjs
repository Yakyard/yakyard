// Puts a backup from npm run backup back into the database. Replaces everything in it.
//   npm run restore -- backups/yakyard-remote-2026-11-21-09-30.sql            (your live Yakyard; asks first)
//   npm run restore -- backups/yakyard-remote-2026-11-21-09-30.sql --local    (the copy on your computer)
// Steps: bring the tables up to date, load the file (rows and the voice-note search index), rebuild the message
// search index, put the triggers back, and recount the storage in use.
import { existsSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { execFileSync } from 'node:child_process';
import { root, d1, target } from './wrangler.mjs';

const { where, extra } = target();
const file = resolve(process.argv.slice(2).find((a) => !a.startsWith('--')) || '');
if (!existsSync(file) || !readFileSync(file, 'utf8').startsWith('-- Yakyard backup')) { console.error('Give a backup file made by npm run backup: npm run restore -- <file>'); process.exit(1); }
if (where === '--remote' && !process.argv.includes('--yes')) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const a = await rl.question('This replaces everything in your live Yakyard database with the backup. Type yes to go on: ');
  rl.close();
  if (a.trim().toLowerCase() !== 'yes') { console.log('Nothing changed.'); process.exit(0); }
}
const node = (args) => execFileSync(process.execPath, args, { cwd: root, stdio: 'inherit' });
node([join(root, 'scripts/migrate.mjs'), where, ...extra]);
d1(where, extra, ['--file', file]);
node([join(root, 'scripts/migrate.mjs'), where, ...extra]);   // triggers back
d1(where, extra, ['--command', "INSERT OR IGNORE INTO settings (key,value) VALUES ('storage_bytes','0'); UPDATE settings SET value=(SELECT COALESCE(SUM(size),0) FROM files) WHERE key='storage_bytes'"]);
console.log('Restored. Sign in and open a channel to check.');
