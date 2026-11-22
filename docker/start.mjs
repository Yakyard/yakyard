// Starts Yakyard in the container: brings the database up to date, then runs the Worker with `wrangler dev --local`,
// the same local runtime CI tests on every change: workerd (the open-source runtime Cloudflare Workers is built on)
// with local D1, R2 and Durable Objects. Everything is stored in DATA_DIR, one volume.
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const DATA = process.env.DATA_DIR || '/data';
const PORT = process.env.PORT || '8787';
const ENV_FILE = '/tmp/yakyard.env';
const wrangler = 'node_modules/wrangler/bin/wrangler.js';

// Settings and secrets come from the container environment (.env), with the names from wrangler.jsonc and .dev.vars.example.
const vars = readFileSync('wrangler.jsonc', 'utf8').match(/"vars":\s*\{([\s\S]*?)\}/)[1].match(/"[A-Z0-9_]+"(?=\s*:)/g).map((s) => s.slice(1, -1));
const secrets = Object.keys(JSON.parse(readFileSync('package.json', 'utf8')).cloudflare.bindings);
const names = [...new Set([...vars, ...secrets, 'CF_ACCOUNT_ID', 'CF_API_TOKEN'])].filter((n) => process.env[n]);
for (const n of names.filter((n) => /['\n]/.test(process.env[n]))) console.warn(`${n} is ignored: it contains a ' or a line break.`);
const lines = names.filter((n) => !/['\n]/.test(process.env[n])).map((n) => `${n}='${process.env[n]}'`);
lines.push("DEV_LOGIN='0'");   // the localhost test sign-in never belongs on a server
writeFileSync(ENV_FILE, lines.join('\n') + '\n', { mode: 0o600 });

// Safe to run on every start: it only adds what is missing.
execFileSync(process.execPath, ['scripts/migrate.mjs', '--local', `--persist-to=${DATA}`], { stdio: 'inherit' });

// wrangler.server.jsonc is wrangler.jsonc without the Workers AI binding (made in the Dockerfile).
const child = spawn(process.execPath, [wrangler, 'dev', '--config', 'wrangler.server.jsonc', '--local', '--persist-to', DATA,
  '--ip', '0.0.0.0', '--port', PORT, '--env-file', ENV_FILE, '--test-scheduled', '--show-interactive-dev-session=false', '--live-reload=false',
  // Behind Caddy the Worker would see http://yakyard:8787 as its address. This makes it see https://DOMAIN, as on
  // Cloudflare, so sign-in origin checks, links and secure cookies all match the address people open.
  ...(process.env.DOMAIN ? ['--local-upstream', process.env.DOMAIN, '--upstream-protocol', 'https'] : [])],
  { stdio: 'inherit' });
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => child.kill(sig));
child.on('exit', (code) => process.exit(code ?? 1));

// Cron triggers only fire by themselves on Cloudflare, so this fires the 5-minute one.
// shortcut: assumes the single "*/5 * * * *" cron in wrangler.jsonc; parse the expressions if more are added.
setInterval(() => fetch(`http://127.0.0.1:${PORT}/__scheduled?cron=${encodeURIComponent('*/5 * * * *')}`).catch(() => {}), 5 * 60e3);
