// Backs up the whole database to one .sql file, full-text search tables included.
// `wrangler d1 export` stops on databases with full-text search (FTS5) tables, and its newer option for them
// makes a file D1 can't import, so this reads every real table itself and writes plain INSERTs.
//   npm run backup                      (your live Yakyard; file in backups/)
//   npm run backup -- --local           (the copy on your computer)
//   npm run backup -- my-file.sql       (choose the file)
// Restore with npm run restore -- <file>. Files (photos, voice notes) live in R2 and are not in this backup.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { root, d1json, target } from './wrangler.mjs';

const PAGE = 500;
export const q = (v) => v === null || v === undefined ? 'NULL'
  : typeof v === 'number' ? (Number.isFinite(v) ? String(v) : 'NULL')
  : Array.isArray(v) ? `X'${Buffer.from(v).toString('hex')}'`
  : `'${String(v).replace(/'/g, "''")}'`;

// Splits the schema into what a backup copies and what it rebuilds.
export function plan(master) {
  const virtual = master.filter((m) => m.type === 'table' && /^CREATE VIRTUAL TABLE/i.test(m.sql));
  const shadow = new Set(virtual.flatMap((v) => master.filter((m) => m.type === 'table' && m.name.startsWith(v.name + '_')).map((m) => m.name)));
  const skip = (n) => /^(sqlite_|_cf_|d1_)/.test(n) || shadow.has(n);
  return {
    tables: master.filter((m) => m.type === 'table' && !virtual.includes(m) && !skip(m.name)).map((m) => m.name),
    // FTS tables that keep their own text are copied row by row; ones that index another table (content=...) are rebuilt.
    ftsCopy: virtual.filter((v) => !/content\s*=/i.test(v.sql)).map((v) => v.name),
    ftsRebuild: virtual.filter((v) => /content\s*=\s*'[^']+'/i.test(v.sql)).map((v) => v.name),
    triggers: master.filter((m) => m.type === 'trigger').map((m) => m.name),
  };
}
// Parents before children, so foreign keys line up while rows go in.
export function order(tables, fks) {
  const done = [], seen = new Set();
  const visit = (t) => { if (seen.has(t)) return; seen.add(t); for (const p of fks[t] || []) if (tables.includes(p) && p !== t) visit(p); done.push(t); };
  tables.forEach(visit);
  return done;
}

export function backup(where, extra, log = console.log) {
  const sql = (s) => d1json(where, extra, s);
  const master = sql("SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY rowid")[0].results;
  const p = plan(master);
  const info = sql(p.tables.map((t) => `PRAGMA foreign_key_list(${t})`).join('; '));
  const fks = Object.fromEntries(p.tables.map((t, i) => [t, (info[i]?.results || []).map((r) => r.table)]));
  const tables = order(p.tables, fks);
  const out = [`-- Yakyard backup, ${new Date().toISOString()}. Restore: npm run restore -- <this file>`,
    `-- tables: ${tables.join(' ')}`, `-- search: ${[...p.ftsCopy, ...p.ftsRebuild].join(' ')}`,
    'PRAGMA defer_foreign_keys = true;',
    ...p.triggers.map((t) => `DROP TRIGGER IF EXISTS ${t};`),   // put back by schema.sql after the restore
    ...[...tables].reverse().map((t) => `DELETE FROM ${t};`),
    ...p.ftsCopy.map((t) => `DELETE FROM ${t};`)];
  // Pages of 500 rows by rowid, all tables in one call per round (each wrangler call costs a second or two).
  const sel = Object.fromEntries(tables.map((t) => [t, '*']));
  if (p.ftsCopy.length) {
    const cols = sql(p.ftsCopy.map((t) => `PRAGMA table_info(${t})`).join('; '));
    p.ftsCopy.forEach((t, i) => (sel[t] = cols[i].results.map((c) => c.name).join(', ')));
  }
  const counts = Object.fromEntries(Object.keys(sel).map((t) => [t, 0])), rows = Object.fromEntries(Object.keys(sel).map((t) => [t, []]));
  let pending = Object.fromEntries(Object.keys(sel).map((t) => [t, -9e15]));
  while (Object.keys(pending).length) {
    const names = Object.keys(pending);
    const res = sql(names.map((t) => `SELECT rowid AS _rowid, ${sel[t]} FROM ${t} WHERE rowid > ${pending[t]} ORDER BY rowid LIMIT ${PAGE}`).join('; '));
    const next = {};
    names.forEach((t, i) => {
      const list = res[i].results;
      rows[t].push(...list); counts[t] += list.length;
      if (list.length === PAGE) next[t] = list[list.length - 1]._rowid;
    });
    pending = next;
  }
  for (const t of Object.keys(sel)) for (const r of rows[t]) {
    const cols = Object.keys(r).filter((c) => c !== '_rowid');
    out.push(`INSERT INTO ${t} (rowid, ${cols.join(', ')}) VALUES (${[r._rowid, ...cols.map((c) => r[c])].map(q).join(', ')});`);
  }
  out.push(...p.ftsRebuild.map((t) => `INSERT INTO ${t}(${t}) VALUES('rebuild');`));
  out.push(`-- rows: ${Object.entries(counts).map(([t, n]) => `${t}=${n}`).join(' ')}`);
  log(`Backed up ${tables.length} tables and ${p.ftsCopy.length + p.ftsRebuild.length} search indexes (${Object.values(counts).reduce((a, b) => a + b, 0)} rows).`);
  return out.join('\n') + '\n';
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { where, extra } = target();
  const stamp = new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-');
  const file = resolve(process.argv.slice(2).find((a) => !a.startsWith('--')) || join(root, 'backups', `yakyard-${where.slice(2)}-${stamp}.sql`));
  const text = backup(where, extra);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
  console.log(`Saved ${file}`);
}
