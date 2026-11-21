// Brings a database up to date with schema.sql: adds any column a table is missing (ALTER TABLE),
// then runs schema.sql, which creates whatever tables, indexes and triggers don't exist yet.
// Safe to run again and again. `npm run deploy` runs it; so do `npm run db:init` and `db:init:local`.
//   node scripts/migrate.mjs --remote     (your live database)
//   node scripts/migrate.mjs --local      (the copy on your computer, for npm run dev)
// Rule for new columns in schema.sql: give them a DEFAULT (or allow NULL), never UNIQUE or PRIMARY KEY.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { root, d1, target } from './wrangler.mjs';

// Every plain table in schema.sql with its column definitions.
export function schemaColumns(sql) {
  const out = {};
  const clean = sql.replace(/--[^\n]*/g, '');
  for (const m of clean.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)\s*\(([\s\S]*?)\);/g)) {
    const parts = []; let depth = 0, q = false, cur = '';
    for (const ch of m[2]) {
      if (ch === "'") q = !q;
      if (!q && ch === '(') depth++;
      if (!q && ch === ')') depth--;
      if (!q && depth === 0 && ch === ',') { parts.push(cur); cur = ''; } else cur += ch;
    }
    parts.push(cur);
    out[m[1]] = parts.map((p) => p.trim().replace(/\s+/g, ' ')).filter((p) => p && !/^(PRIMARY|UNIQUE|FOREIGN|CHECK|CONSTRAINT)\b/i.test(p))
      .map((def) => ({ name: def.split(' ')[0], def }));
  }
  return out;
}

// ALTER statements for columns that exist in schema.sql but not in the database. `have` maps table -> [column names];
// tables the database doesn't have yet are skipped (schema.sql creates them whole).
export function missingColumns(sql, have) {
  const alters = [];
  for (const [t, cols] of Object.entries(schemaColumns(sql))) {
    if (!have[t] || !have[t].length) continue;
    for (const c of cols) if (!have[t].includes(c.name)) alters.push(`ALTER TABLE ${t} ADD COLUMN ${c.def.replace(/\s+REFERENCES\s+\w+\(\w+\)(\s+ON DELETE \w+)?/i, '')}`);
  }
  return alters;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { where, extra } = target();
  const schema = readFileSync(join(root, 'schema.sql'), 'utf8');
  const wrangler = (args) => d1(where, extra, args);
  const tables = Object.keys(schemaColumns(schema));
  const res = JSON.parse(wrangler(['--json', '--command', tables.map((t) => `PRAGMA table_info(${t})`).join('; ')]));
  const have = Object.fromEntries(tables.map((t, i) => [t, (res[i]?.results || []).map((r) => r.name)]));
  const alters = missingColumns(schema, have);
  for (const a of alters) { console.log(a); wrangler(['--command', a]); }
  wrangler(['--file', join(root, 'schema.sql')]);
  console.log(alters.length ? `Database updated (${alters.length} new column${alters.length > 1 ? 's' : ''}).` : 'Database is up to date.');
}
