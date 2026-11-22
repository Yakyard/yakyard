// Deploys the public demo: its own Worker, database and file storage, from wrangler.demo.jsonc.
// Your own Yakyard (wrangler.jsonc) is not touched. See docs/TECHNICAL.md, "Public demo".
process.env.YY_CONFIG = 'wrangler.demo.jsonc';
await import('./deploy.mjs');
