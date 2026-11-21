// Get the newest Yakyard and deploy it, keeping your own settings in wrangler.jsonc:
// set your changes aside, pull, put them back, deploy. Run: npm run update
import { execSync } from 'node:child_process';
import { root } from './wrangler.mjs';
const sh = (c, o = {}) => execSync(c, { cwd: root, encoding: 'utf8', ...o });
const dirty = sh('git status --porcelain').trim() !== '';
if (dirty) sh('git stash push --include-untracked -m "yakyard update"', { stdio: 'inherit' });
try { sh('git pull --ff-only', { stdio: 'inherit' }); } finally {
  if (dirty) {
    try { sh('git stash pop', { stdio: 'inherit' }); } catch {
      console.error('\nYour settings and the update both changed the same lines. Open wrangler.jsonc, keep your values between the <<<<<<< and >>>>>>> marks, delete the marks, save, then run npm run deploy.');
      process.exit(1);
    }
  }
}
sh('node scripts/deploy.mjs', { stdio: 'inherit' });
