// Writes docs/E2EE-HASHES.md for this release from public/lock/manifest.json. Run after npm run lock:sync.
import { readFileSync, writeFileSync } from 'node:fs';
import { securityCode } from './lock-sync.mjs';
const man = JSON.parse(readFileSync(new URL('../public/lock/manifest.json', import.meta.url), 'utf8'));
const app = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
let s = `# Locking code per release

Each Yakyard release lists the security code of its locking code and the SHA-256 of every file behind it. The app shows the same code after an update (see [E2EE.md](E2EE.md#code-delivered-by-the-server)). To check a running Yakyard against this release: \`npm run lock:verify -- https://your-yakyard\`.

## Yakyard ${app} (yakyard-lock ${man.version})

Security code: **${securityCode(man)}**

| File | SHA-256 |
|---|---|
`;
for (const [k, v] of Object.entries(man.files)) s += `| \`${k === 'locked.js' ? '/locked.js' : '/lock/' + k}\` | \`${v}\` |\n`;
writeFileSync(new URL('../docs/E2EE-HASHES.md', import.meta.url), s);
console.log('docs/E2EE-HASHES.md: security code ' + securityCode(man));
