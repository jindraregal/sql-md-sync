import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import type { ColumnInfo, IndexInfo } from './types.js';

export function getTableNames(db: Database.Database): string[] {
  const rows = db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
    )
    .all() as { name: string }[];
  return rows.map((r) => r.name);
}

export function getCreateStatement(db: Database.Database, table: string): string {
  const row = db
    .prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name=?`)
    .get(table) as { sql: string } | undefined;
  if (!row) throw new Error(`Table not found: ${table}`);
  return row.sql;
}

export function getColumns(db: Database.Database, table: string): ColumnInfo[] {
  return db.prepare(`PRAGMA table_info(${JSON.stringify(table)})`).all() as ColumnInfo[];
}

export function getPkColumn(db: Database.Database, table: string): string {
  const cols = getColumns(db, table);
  const pk = cols.find((c) => c.pk === 1);
  return pk ? pk.name : (cols[0]?.name ?? 'rowid');
}

export function getIndexes(db: Database.Database, table: string): IndexInfo[] {
  const indexList = db.prepare(`PRAGMA index_list(${JSON.stringify(table)})`).all() as {
    name: string;
    unique: number;
    origin: string;
  }[];

  return indexList
    .filter((i) => i.origin !== 'pk')
    .map((i) => {
      const cols = db.prepare(`PRAGMA index_info(${JSON.stringify(i.name)})`).all() as {
        name: string;
      }[];
      return {
        name: i.name,
        columns: cols.map((c) => c.name),
        unique: i.unique === 1,
      };
    });
}

export function writeSchemaFiles(db: Database.Database, outDir: string): string {
  const schemaDir = path.join(outDir, '_schema');
  fs.mkdirSync(schemaDir, { recursive: true });

  const tables = getTableNames(db);
  let combined = '';
  for (const table of tables) {
    const sql = getCreateStatement(db, table);
    fs.writeFileSync(path.join(schemaDir, `${table}.sql`), sql + ';\n');
    combined += sql + ';\n';
  }
  return combined;
}

export function readSchemaFiles(outDir: string): Record<string, string> {
  const schemaDir = path.join(outDir, '_schema');
  if (!fs.existsSync(schemaDir)) {
    throw new Error(`Missing _schema/ directory in ${outDir}`);
  }
  const result: Record<string, string> = {};
  // Sort so iteration order matches writeSchemaFiles (alphabetical), which
  // keeps the schema fingerprint deterministic across filesystems.
  for (const f of fs.readdirSync(schemaDir).sort()) {
    if (!f.endsWith('.sql')) continue;
    const table = f.replace(/\.sql$/, '');
    // Read raw file bytes; do not trim. writeSchemaFiles wrote `sql + ';\n'`
    // and the fingerprint is computed over that exact content joined.
    result[table] = fs.readFileSync(path.join(schemaDir, f), 'utf8');
  }
  return result;
}

// ─── Column-to-section mapping (spec §4.2) ────────────────────────────────────

export interface ColumnMapping {
  bodyColumns: string[];
  displayColumn?: string;
  excludeColumns?: string[];
}

export function writeColumnMapping(outDir: string, table: string, mapping: ColumnMapping): void {
  const schemaDir = path.join(outDir, '_schema');
  fs.mkdirSync(schemaDir, { recursive: true });
  fs.writeFileSync(
    path.join(schemaDir, `${table}.columns.json`),
    JSON.stringify(mapping, null, 2) + '\n'
  );
}

export function readColumnMapping(outDir: string, table: string): ColumnMapping | null {
  const filePath = path.join(outDir, '_schema', `${table}.columns.json`);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as ColumnMapping;
}
